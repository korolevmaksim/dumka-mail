import { applyPendingLabelDeltas } from '../shared/mailActions';
import type { MailActionLog, MailboxDelta, MailMessage, MailThread, SyncState } from '../shared/types';
import { buildMailThreadFromMessages } from '../shared/mailThread';

export interface MailboxSyncDeps {
  getSyncState(email: string): SyncState | null;
  saveSyncState(state: SyncState): void;
  nextSyncState(accountId: string, base: SyncState | null, historyId: string, lastFullSyncAt?: string | null): SyncState;
  syncInbox(email: string): Promise<{ threads: MailThread[]; messages: MailMessage[]; historyId: string }>;
  syncIncremental(email: string, historyId: string): Promise<{ updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string }>;
  fetchThreadDetail(email: string, threadId: string): Promise<MailMessage[]>;
  saveThreads(threads: MailThread[]): Promise<void>;
  saveMessages(messages: MailMessage[], options?: { notifyOfNew?: boolean }): Promise<void>;
  deleteThread(accountId: string, threadId: string): void;
  listPendingActions(email: string): MailActionLog[];
  publishDelta(accountId: string, upserts: MailThread[], deletedThreadIds: string[]): MailboxDelta;
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
  const deletedThreadIds: string[] = [];
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

  if (!syncState?.historyId) {
    const fullSync = await deps.syncInbox(email);
    const saved = await persistThreads(fullSync.threads);
    await persistMessages(fullSync.messages);
    deps.saveSyncState(deps.nextSyncState(email, syncState, fullSync.historyId, now().toISOString()));
    upserts.push(...saved);
    return deps.publishDelta(email, upserts, deletedThreadIds);
  }

  try {
    const incrementalSync = await deps.syncIncremental(email, syncState.historyId);
    let threadFetchFailed = false;

    for (const threadId of incrementalSync.updatedThreadIds) {
      try {
        const messages = await deps.fetchThreadDetail(email, threadId);
        await persistMessages(messages, { notifyOfNew: true });
        const thread = buildMailThreadFromMessages(email, threadId, messages);
        if (thread) {
          const [saved] = await persistThreads([thread]);
          upserts.push(saved);
        }
      } catch (err: unknown) {
        deps.logger?.warning('Mailbox Sync', 'Failed to fetch synchronized thread details.', {
          accountId: email,
          threadId,
          error: err,
        });
        if (isMissingThreadError(err)) {
          deps.deleteThread(email, threadId);
          deletedThreadIds.push(threadId);
        } else {
          threadFetchFailed = true;
        }
      }
    }

    for (const threadId of incrementalSync.deletedThreadIds) {
      deps.deleteThread(email, threadId);
      deletedThreadIds.push(threadId);
    }

    if (!threadFetchFailed) {
      deps.saveSyncState(deps.nextSyncState(email, syncState, incrementalSync.historyId));
    }
  } catch (err: unknown) {
    if (err instanceof Error && err.message === 'HISTORY_EXPIRED') {
      const fullSync = await deps.syncInbox(email);
      const saved = await persistThreads(fullSync.threads);
      await persistMessages(fullSync.messages);
      deps.saveSyncState(deps.nextSyncState(email, syncState, fullSync.historyId, now().toISOString()));
      upserts.push(...saved);
      return deps.publishDelta(email, upserts, deletedThreadIds);
    }
    throw err;
  }

  return deps.publishDelta(email, upserts, deletedThreadIds);
}
