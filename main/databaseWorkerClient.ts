import path from 'path';
import { Worker } from 'worker_threads';
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
import type { MailMessage, MailThread, MessageSecurityInsight, SenderCleanupStat } from '../shared/types';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
  timeout: ReturnType<typeof setTimeout>;
}

export { DATABASE_WORKER_REQUEST_TIMEOUT_MS };

const MESSAGE_BATCH_SIZE = 5;
const THREAD_BATCH_SIZE = 50;
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
  private nextRequestId = 1;
  private readonly pending = new Map<number, PendingRequest>();
  private shuttingDown = false;

  private getWorker(): Worker {
    if (this.worker) return this.worker;

    const worker = new Worker(path.join(__dirname, 'databaseWorker.js'));
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

  private request<T>(payload: DatabaseWorkerPayload): Promise<T> {
    const id = this.nextRequestId++;
    const worker = this.getWorker();

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(databaseWorkerTimeoutMessage(payload.type)));
      }, DATABASE_WORKER_REQUEST_TIMEOUT_MS);
      this.pending.set(id, {
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

  async saveMessages(messages: MailMessage[], options?: { notifyOfNew?: boolean; indexBodies?: boolean }): Promise<{ newMessages: MailMessage[] }> {
    const newMessages: MailMessage[] = [];
    const batches = chunk(messages, MESSAGE_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      const result = await this.request<{ newMessages: MailMessage[] }>({
        type: 'saveMessages',
        messages: batches[index],
        notifyOfNew: options?.notifyOfNew,
        indexBodies: options?.indexBodies
      });
      newMessages.push(...result.newMessages);

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }

    return { newMessages };
  }

  async saveThreads(threads: MailThread[]): Promise<void> {
    const batches = chunk(threads, THREAD_BATCH_SIZE);

    for (let index = 0; index < batches.length; index += 1) {
      await this.request<null>({
        type: 'saveThreads',
        threads: batches[index]
      });

      if (index < batches.length - 1) {
        await yieldToEventLoop();
      }
    }
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
