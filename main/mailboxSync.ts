import { applyPendingLabelDeltas } from '../shared/mailActions';
import type { MailActionLog, MailboxDelta, MailMessage, MailThread, SyncState } from '../shared/types';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { DeletedConversationMessages, DeletedMessageIds, DeletedMessagesOutcome } from '../shared/gmailHistory';
import { restartHistoryBackfill } from './mailboxHistoryRecovery';
import { isGoogleReauthorizationRequiredError } from './googleAuthState';
import { isRateLimitError } from './remoteRetry';

/** Conversations one pass reads from Gmail at most; the rest stay queued for the next pass. */
export const MAX_THREAD_READS_PER_PASS = 25;
/** A pass stops reading after this many failures in a row: Gmail or the network is not answering. */
const MAX_CONSECUTIVE_READ_FAILURES = 3;

export interface MailboxSyncDeps {
  getSyncState(email: string): SyncState | null;
  saveSyncState(state: SyncState): void;
  nextSyncState(accountId: string, base: SyncState | null, historyId: string, lastFullSyncAt?: string | null): SyncState;
  syncInbox(email: string): Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }>;
  syncIncremental(email: string, historyId: string): Promise<{ updatedThreadIds: string[]; deletedMessageIds: DeletedMessageIds; historyId: string }>;
  fetchThreadDetail(email: string, threadId: string): Promise<MailMessage[]>;
  saveThreads(threads: MailThread[]): Promise<void>;
  saveMessages(messages: MailMessage[], options?: { notifyOfNew?: boolean }): Promise<void>;
  /** Removes conversations from the local cache, off the main event loop. */
  deleteThreads(accountId: string, threadIds: string[]): Promise<void>;
  /**
   * Removes the messages Gmail deleted for good, off the main event loop, and
   * says which conversations went with them and which still have messages.
   */
  removeDeletedMessages(accountId: string, deletions: DeletedConversationMessages[]): Promise<DeletedMessagesOutcome>;
  /**
   * Stores the history cursor (`state`) together with the conversations the
   * history up to it reported as changed, in one write.
   */
  queueThreadReads(state: SyncState, threadIds: string[]): void;
  /** The queued conversations to read now, most urgent first. */
  dueThreadReads(accountId: string, limit: number): string[];
  /** Takes the conversations that were read off the queue and makes the failed ones wait. */
  settleThreadReads(accountId: string, done: string[], failed: string[]): void;
  /** False while the account's Gmail quota does not allow another full conversation read. */
  takeThreadRead(accountId: string): boolean;
  listPendingActions(email: string): MailActionLog[];
  publishDelta(accountId: string, upserts: MailThread[], deletedThreadIds: string[]): MailboxDelta;
  /**
   * Runs once threads and their messages are persisted (sender rules, SPEC §7)
   * and returns the threads as they are locally afterwards, so the published
   * delta matches SQLite.
   */
  afterPersist?(accountId: string, threads: MailThread[]): Promise<MailThread[]>;
  /**
   * Called with threads as Gmail has them, before the pending-label overlay is
   * read: drops parked automatic actions those threads no longer qualify for.
   */
  revalidateParked?(accountId: string, threads: MailThread[]): void;
  now?: () => Date;
  logger?: {
    warning(scope: string, message: string, extra?: Record<string, unknown>): void;
  };
}

function overlayPendingLabels(thread: MailThread, pending: MailActionLog[]): MailThread {
  return applyPendingLabelDeltas(thread, pending.filter(action => (
    action.accountId === thread.accountId && action.threadId === thread.id
  )));
}

function overlayPendingOnMessage(message: MailMessage, pending: MailActionLog[]): MailMessage {
  const overlaid = applyPendingLabelDeltas({
    id: message.threadId,
    accountId: message.accountId,
    subject: message.subject,
    snippet: message.snippet,
    lastMessageAt: message.receivedAt,
    senderNames: [message.senderName],
    senderEmail: message.senderEmail,
    labelIds: message.labelIds,
    hasAttachments: message.hasAttachments,
    isUnread: message.isUnread,
  }, pending);
  if (overlaid.labelIds === message.labelIds && overlaid.isUnread === message.isUnread) return message;
  return { ...message, labelIds: overlaid.labelIds, isUnread: overlaid.isUnread };
}

export function isMissingThreadError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: number }).status);
    if (Number.isFinite(status)) return status === 404;
  }
  const message = error instanceof Error ? error.message : String(error);
  return /\bHTTP\s+404\b/i.test(message);
}

export async function performMailboxSyncForAccount(email: string, deps: MailboxSyncDeps): Promise<MailboxDelta> {
  const syncState = deps.getSyncState(email);
  const upserts: MailThread[] = [];
  const deletedThreadIds = new Set<string>();
  const now = deps.now || (() => new Date());

  const persistThreads = async (threads: MailThread[]) => {
    const latestPending = deps.listPendingActions(email);
    const overlaid = threads.map(thread => overlayPendingLabels(thread, latestPending));
    await deps.saveThreads(overlaid);
    return overlaid;
  };

  const persistMessages = async (messages: MailMessage[], options?: { notifyOfNew?: boolean }) => {
    const latestPending = deps.listPendingActions(email);
    const overlaid = messages.map(message => overlayPendingOnMessage(message, latestPending));
    await deps.saveMessages(overlaid, options);
  };

  const revalidateParked = (threads: MailThread[]) => {
    if (!deps.revalidateParked || threads.length === 0) return;
    try {
      deps.revalidateParked(email, threads);
    } catch (err: unknown) {
      deps.logger?.warning('Mailbox Sync', 'Revalidating parked actions failed.', { accountId: email, error: err });
    }
  };

  const afterPersist = async (threads: MailThread[]): Promise<MailThread[]> => {
    if (!deps.afterPersist || threads.length === 0) return threads;
    try {
      return await deps.afterPersist(email, threads);
    } catch (err: unknown) {
      deps.logger?.warning('Mailbox Sync', 'Post-persist actions failed.', { accountId: email, error: err });
      return threads;
    }
  };

  const fullSync = async (): Promise<MailboxDelta> => {
    const inbox = await deps.syncInbox(email);
    revalidateParked(inbox.threads);
    const saved = await persistThreads(inbox.threads);
    await persistMessages(inbox.messages);
    deps.saveSyncState(restartHistoryBackfill(deps.nextSyncState(email, deps.getSyncState(email), inbox.historyId, now().toISOString())));
    upserts.push(...await afterPersist(saved));
    return deps.publishDelta(email, upserts, Array.from(deletedThreadIds));
  };

  /**
   * Reads one changed conversation from Gmail and stores it. `stop` means the
   * account cannot be read at the moment, which is not this conversation's
   * fault: it keeps its place in the queue.
   */
  const readThread = async (threadId: string): Promise<'stored' | 'missing' | 'stop' | 'failed'> => {
    try {
      const messages = await deps.fetchThreadDetail(email, threadId);
      const thread = buildMailThreadFromMessages(email, threadId, messages);
      if (thread) revalidateParked([thread]);
      await persistMessages(messages, { notifyOfNew: true });
      if (thread) {
        const saved = await persistThreads([thread]);
        upserts.push(...await afterPersist(saved));
      }
      return 'stored';
    } catch (err: unknown) {
      if (isRateLimitError(err)) {
        deps.logger?.warning('Mailbox Sync', 'Gmail quota reached; the remaining conversations wait for a later pass.', {
          accountId: email,
          error: err,
        });
        return 'stop';
      }
      if (isGoogleReauthorizationRequiredError(err)) {
        deps.logger?.warning('Mailbox Sync', 'Google sign-in is needed; the remaining conversations wait for it.', {
          accountId: email,
          error: err,
        });
        return 'stop';
      }
      deps.logger?.warning('Mailbox Sync', 'Failed to fetch synchronized thread details.', {
        accountId: email,
        threadId,
        error: err,
      });
      if (!isMissingThreadError(err)) return 'failed';
    }
    try {
      await deps.deleteThreads(email, [threadId]);
      return 'missing';
    } catch (err: unknown) {
      deps.logger?.warning('Mailbox Sync', 'Could not remove a conversation Gmail no longer has.', {
        accountId: email,
        threadId,
        error: err,
      });
      return 'failed';
    }
  };

  /**
   * Works off the queue of changed conversations: at most one pass's share,
   * and only while the Gmail quota allows. Whatever is left stays queued.
   */
  const readQueuedThreads = async (): Promise<void> => {
    const done: string[] = [];
    const failed: string[] = [];
    let failuresInARow = 0;
    try {
      for (const threadId of deps.dueThreadReads(email, MAX_THREAD_READS_PER_PASS)) {
        if (!deps.takeThreadRead(email)) break;
        const outcome = await readThread(threadId);
        if (outcome === 'stop') break;
        if (outcome === 'failed') {
          failed.push(threadId);
          failuresInARow += 1;
          if (failuresInARow >= MAX_CONSECUTIVE_READ_FAILURES) break;
          continue;
        }
        failuresInARow = 0;
        done.push(threadId);
        if (outcome === 'missing') deletedThreadIds.add(threadId);
        else deletedThreadIds.delete(threadId);
      }
    } catch (err: unknown) {
      // What this pass stored and removed is still published below.
      deps.logger?.warning('Mailbox Sync', 'Could not read the queue of changed conversations.', { accountId: email, error: err });
    }
    try {
      deps.settleThreadReads(email, done, failed);
    } catch (err: unknown) {
      // The conversations stay queued and are read once more; nothing is lost.
      deps.logger?.warning('Mailbox Sync', 'Could not update the queue of changed conversations.', { accountId: email, error: err });
    }
  };

  if (!syncState?.historyId) return fullSync();

  let incrementalSync: Awaited<ReturnType<MailboxSyncDeps['syncIncremental']>>;
  try {
    incrementalSync = await deps.syncIncremental(email, syncState.historyId);
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'HISTORY_EXPIRED') return fullSync();
    throw err;
  }

  // Deleted messages first: removing them costs no Gmail request. Gmail names
  // the message, not the conversation, so a conversation goes only when
  // nothing of it is left here. One that still has messages is read again
  // like a changed one, which also shows if Gmail no longer has it at all.
  const changed = new Set(incrementalSync.updatedThreadIds);
  const deletions = Object.entries(incrementalSync.deletedMessageIds).map(([threadId, messageIds]) => ({
    threadId,
    messageIds,
    alsoChanged: changed.has(threadId),
  }));
  let toReadAgain: string[] = [];
  let shortened: MailThread[] = [];
  if (deletions.length > 0) {
    const outcome = await deps.removeDeletedMessages(email, deletions);
    for (const threadId of outcome.removedThreadIds) deletedThreadIds.add(threadId);
    toReadAgain = outcome.remainingThreadIds.filter(threadId => !changed.has(threadId));
    shortened = outcome.shortenedThreads;
  }

  // The cursor moves past this stretch of history in the same write that
  // queues what it changed, so the conversations Gmail's quota does not allow
  // now are read by later passes instead of being listed again from the start.
  // The last id is read first: changed conversations before shortened ones.
  deps.queueThreadReads(
    deps.nextSyncState(email, deps.getSyncState(email), incrementalSync.historyId),
    [...toReadAgain, ...incrementalSync.updatedThreadIds],
  );

  await readQueuedThreads();

  // A conversation that lost a message and was not read again in this pass
  // is published as it is stored, so a window showing it drops the message
  // now and not when its turn on the queue comes.
  const stored = new Set(upserts.map(thread => thread.id));
  for (const thread of shortened) {
    if (!stored.has(thread.id) && !deletedThreadIds.has(thread.id)) upserts.push(thread);
  }

  return deps.publishDelta(email, upserts, Array.from(deletedThreadIds));
}
