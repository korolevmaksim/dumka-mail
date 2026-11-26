import path from 'path';
import type { MailboxRead } from './mailboxRead';
import { Worker } from 'worker_threads';
import { createWritePrioritySignal } from './sqliteWriteGuard';
import type { MailEmbeddingRow } from './database';
import type {
  DatabaseWorkerPayload,
  DatabaseWorkerResponse,
} from './databaseWorkerProtocol';
import type {
  BriefingThreadBatch,
  BriefingThreadContext,
  BriefingThreadSelection,
  EmbeddingCandidateBatch,
  EmbeddingCandidateSource,
  ThreadSecurityMode,
} from './mailAnalysisJobs';
import {
  DATABASE_WORKER_REQUEST_TIMEOUT_MS,
  databaseWorkerTimeoutMessage,
} from '../shared/databaseWorkerTimeout';
import type { ThreadMaintenanceResult } from './migrations';
import type { DeletedConversationMessages, DeletedMessagesOutcome } from '../shared/gmailHistory';
import type { ReplyStyleSample } from '../shared/replyStyle';
import type { MailMessage, MailThread, MessageSecurityInsight, SenderCleanupStat, ThreadDecisionRecord } from '../shared/types';

/** What one agent-prep pass reads: the newest inbox threads and their cached decisions. */
export interface AgentPrepInboxSnapshot {
  threads: MailThread[];
  decisions: ThreadDecisionRecord[];
}

interface PendingRequest {
  type: DatabaseWorkerPayload['type'];
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export { DATABASE_WORKER_REQUEST_TIMEOUT_MS };

const MESSAGE_BATCH_SIZE = 5;
const THREAD_BATCH_SIZE = 50;
const THREAD_DELETE_BATCH_SIZE = 50;
// Briefing threads carry full message bodies; keep each worker task short so
// interactive requests are never stuck behind the whole selection.
const BRIEFING_THREAD_BATCH_SIZE = 20;

function yieldToEventLoop(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}

function createError(error: { name: string; message: string; stack?: string }): Error {
  const result = new Error(error.message);
  result.name = error.name;
  result.stack = error.stack;
  return result;
}

class DatabaseWorkerClient {
  private worker: Worker | null = null;
  // Shared counter: the main thread announces interactive writes, the worker
  // pauses between bulk chunks while it is non-zero. Kept across restarts.
  private writePrioritySignal: SharedArrayBuffer | null = null;
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private shuttingDown = false;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    if (!this.writePrioritySignal) this.writePrioritySignal = createWritePrioritySignal();
    const worker = new Worker(path.join(__dirname, 'databaseWorker.js'), {
      workerData: { writePrioritySignal: this.writePrioritySignal },
    });
    this.worker = worker;
    this.shuttingDown = false;

    worker.on('message', (response: DatabaseWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;

      this.pending.delete(response.id);
      if (response.ok) {
        pending.resolve(response.result);
      } else {
        pending.reject(createError(response.error));
      }
    });

    worker.on('error', error => {
      const next = error instanceof Error ? error : new Error(String(error));
      console.error('[Database worker] crashed:', next);
      this.rejectAll(next);
      this.worker = null;
    });

    worker.on('exit', code => {
      this.worker = null;
      if (!this.shuttingDown && code !== 0) {
        const next = new Error(`Database worker exited with code ${code}`);
        console.error('[Database worker]', next.message);
        this.rejectAll(next);
      }
    });

    return worker;
  }

  private rejectAll(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    this.pending.clear();
  }

  /**
   * The request types the worker has not answered yet. Recorded when an
   * interactive write had to wait for the database lock, to show what the
   * worker was writing at that moment.
   */
  pendingRequestTypes(): string[] {
    return Array.from(new Set(Array.from(this.pending.values(), pending => pending.type)));
  }

  private request<T>(payload: DatabaseWorkerPayload): Promise<T> {
    const id = this.nextRequestId++;
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(databaseWorkerTimeoutMessage(payload.type)));
      }, DATABASE_WORKER_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
        type: payload.type,
        resolve: value => {
          clearTimeout(timeout);
          resolve(value as T);
        },
        reject: reason => {
          clearTimeout(timeout);
          reject(reason);
        },
        timeout,
      });
      worker.postMessage({ id, ...payload });
    });
  }

  async saveMessages(messages: MailMessage[], options?: { notifyOfNew?: boolean; indexBodies?: boolean }, read?: MailboxRead): Promise<{ newMessages: MailMessage[] }> {
    const newMessages: MailMessage[] = [];
    const batches = chunk(messages, MESSAGE_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      const result = await this.request<{ newMessages: MailMessage[] }>({
        type: 'saveMessages',
        messages: read ? read.messages(batches[index]) : batches[index],
        notifyOfNew: options?.notifyOfNew,
        indexBodies: options?.indexBodies
      });
      newMessages.push(...result.newMessages);

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }

    return { newMessages: read ? read.messages(newMessages) : newMessages };
  }

  async saveThreads(threads: MailThread[], read?: MailboxRead): Promise<void> {
    const batches = chunk(threads, THREAD_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      await this.request<null>({
        type: 'saveThreads',
        threads: read ? read.threads(batches[index]) : batches[index]
      });

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }
  }

  countInboxThreads(accountIds: string[]): Promise<Record<string, number>> {
    return this.request<Record<string, number>>({ type: 'countInboxThreads', accountIds, nowIso: new Date().toISOString() });
  }

  /** Unread inbox threads of one account (not postponed with Later), newest first, for the unread badge. */
  unreadInboxThreads(accountId: string, limit: number, nowIso: string = new Date().toISOString()): Promise<MailThread[]> {
    return this.request<MailThread[]>({ type: 'unreadInboxThreads', accountId, nowIso, limit });
  }

  agentPrepInbox(accountId: string, limit: number): Promise<AgentPrepInboxSnapshot> {
    return this.request<AgentPrepInboxSnapshot>({ type: 'agentPrepInbox', accountId, limit });
  }

  getThreads(accountId: string, threadIds: string[]): Promise<MailThread[]> {
    return this.request<MailThread[]>({ type: 'getThreads', accountId, threadIds });
  }

  /** One committed chunk of the `in_inbox` / signals maintenance pass. */
  runThreadMaintenance(chunkSize?: number): Promise<ThreadMaintenanceResult> {
    return this.request<ThreadMaintenanceResult>({ type: 'runThreadMaintenance', chunkSize });
  }

  deleteThread(accountId: string, threadId: string): Promise<void> {
    return this.request({ type: 'deleteThread', accountId, threadId });
  }

  /** Removes conversations Gmail reported as deleted, in short worker tasks. */
  async deleteThreads(accountId: string, threadIds: string[]): Promise<void> {
    const batches = chunk(threadIds, THREAD_DELETE_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      await this.request<null>({ type: 'deleteThreads', accountId, threadIds: batches[index] });

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }
  }

  /** Removes the messages Gmail deleted for good, in short worker tasks (`ThreadsRepo.removeDeletedMessages`). */
  async removeDeletedMessages(accountId: string, deletions: DeletedConversationMessages[]): Promise<DeletedMessagesOutcome> {
    const outcome: DeletedMessagesOutcome = { removedThreadIds: [], remainingThreadIds: [], shortenedThreads: [] };
    const batches = chunk(deletions, THREAD_DELETE_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      const result = await this.request<DeletedMessagesOutcome>({ type: 'removeDeletedMessages', accountId, deletions: batches[index] });
      outcome.removedThreadIds.push(...result.removedThreadIds);
      outcome.remainingThreadIds.push(...result.remainingThreadIds);
      outcome.shortenedThreads.push(...result.shortenedThreads);

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }
    return outcome;
  }

  loggedMissingThreadIds(accountId: string): Promise<string[]> {
    return this.request({ type: 'loggedMissingThreadIds', accountId });
  }

  listThreads(accountIds: string[]): Promise<MailThread[]> {
    return this.request<MailThread[]>({ type: 'listThreads', accountIds });
  }

  listMessagesForThread(accountId: string, threadId: string): Promise<MailMessage[]> {
    return this.request<MailMessage[]>({ type: 'listMessagesForThread', accountId, threadId });
  }

  listMessageMetadataForThread(accountId: string, threadId: string): Promise<MailMessage[]> {
    return this.request<MailMessage[]>({ type: 'listMessageMetadataForThread', accountId, threadId });
  }

  /** A few short excerpts of the account's own earlier messages, best match for `recipientEmail` first (`shared/replyStyle.ts`). */
  replyStyleSamples(
    accountId: string,
    options: { recipientEmail: string; excludeThreadId: string | null; signaturePlain: string },
  ): Promise<ReplyStyleSample[]> {
    return this.request<ReplyStyleSample[]>({ type: 'replyStyleSamples', accountId, ...options });
  }

  recentSenderMessages(accountId: string, senderEmail: string, limit = 3): Promise<MailMessage[]> {
    return this.request<MailMessage[]>({ type: 'recentSenderMessages', accountId, senderEmail, limit });
  }

  senderCleanupStats(accountId: string): Promise<SenderCleanupStat[]> {
    return this.request<SenderCleanupStat[]>({ type: 'senderCleanupStats', accountId });
  }

  // The analysis jobs below read bulk message bodies. They stay on the worker
  // so the Electron main event loop never blocks on them; only their small
  // results cross the thread boundary.

  threadSecurityInsights(
    accountId: string,
    threadId: string,
    mode: ThreadSecurityMode = 'refresh',
    knownMessageCount?: number,
  ): Promise<MessageSecurityInsight[]> {
    return this.request<MessageSecurityInsight[]>({
      type: 'threadSecurityInsights',
      accountId,
      threadId,
      mode,
      knownMessageCount,
    });
  }

  embeddingCandidates(
    accountId: string,
    model: string,
    source: EmbeddingCandidateSource,
  ): Promise<EmbeddingCandidateBatch> {
    return this.request<EmbeddingCandidateBatch>({ type: 'embeddingCandidates', accountId, model, source });
  }

  saveEmbeddingVectors(rows: MailEmbeddingRow[]): Promise<void> {
    return this.request<void>({ type: 'saveEmbeddingVectors', rows });
  }

  /**
   * Selects the briefing's threads, then walks them in bounded batches so the
   * worker stays available to interactive requests (thread open, mailbox list)
   * between batches instead of being held for the whole multi-second read.
   */
  async briefingThreadContext(
    accountId: string,
    selection: BriefingThreadSelection,
  ): Promise<BriefingThreadContext> {
    const threads = await this.request<MailThread[]>({ type: 'selectBriefingThreads', accountId, selection });
    const latestMessageByThreadId: Record<string, MailMessage> = {};
    const securityByThreadId: Record<string, MessageSecurityInsight[]> = {};
    const batches = chunk(threads.map(thread => thread.id), BRIEFING_THREAD_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      const batch = await this.request<BriefingThreadBatch>({
        type: 'briefingThreadBatch',
        accountId,
        threadIds: batches[index],
      });
      Object.assign(latestMessageByThreadId, batch.latestMessageByThreadId);
      Object.assign(securityByThreadId, batch.securityByThreadId);

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }

    return { threads, latestMessageByThreadId, securityByThreadId };
  }

  shutdown() {
    this.shuttingDown = true;
    this.rejectAll(new Error('Database worker is shutting down'));
    const worker = this.worker;
    this.worker = null;
    void worker?.terminate();
  }
}

export const databaseWorkerClient = new DatabaseWorkerClient();
