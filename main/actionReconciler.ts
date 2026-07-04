import type { ActionKind, MailActionLog, MailRuleAction, MailThread } from '../shared/types';

export interface ReconcilerDeps {
  actionLog: {
    listPending(nowIso?: string): MailActionLog[];
    listRunning(): MailActionLog[];
    save(log: MailActionLog): void;
  };
  threads: {
    get(accountId: string, threadId: string): MailThread | null;
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
  };
  drafts: {
    get(draftId: string): unknown;
    delete(draftId: string): void;
  };
  gmail: {
    modifyLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<unknown>;
    trashThread(accountId: string, threadId: string): Promise<unknown>;
    untrashThread(accountId: string, threadId: string): Promise<unknown>;
    sendDraft(accountId: string, draft: unknown): Promise<unknown>;
  };
  buildForwardDraft(accountId: string, thread: MailThread, forwardTo: string): unknown;
  buildAutoReplyDraft(accountId: string, threadId: string, replyBody: string): unknown;
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'error'>;
}

export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  const code = String(err.code || '').toUpperCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('timeout') ||
    msg.includes('request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('dns') ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  );
}

// One reconciliation pass: replay every pending_sync action against Gmail.
// Moved verbatim from main/index.ts startBackgroundSyncWorker; semantics are
// pinned by tests/actionReconciler.test.ts — change them deliberately or not at all.
export async function reconcilePendingActions(deps: ReconcilerDeps): Promise<void> {
  const now = deps.now || (() => new Date());
  const logger = deps.logger || console;

  const pendingActions = deps.actionLog.listPending();
  if (pendingActions.length === 0) return;

  logger.log(`[Sync Worker] Found ${pendingActions.length} pending actions to sync`);

  for (const action of pendingActions) {
    action.status = 'running';
    deps.actionLog.save(action);

    try {
      const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
      if (action.kind === 'markDone') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], ['INBOX']);
      } else if (action.kind === 'restoreInbox') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], []);
      } else if (action.kind === 'markRead') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], ['UNREAD']);
      } else if (action.kind === 'markUnread') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['UNREAD'], []);
      } else if (action.kind === 'moveToTrash') {
        await deps.gmail.trashThread(action.accountId, action.threadId!);
      } else if (action.kind === 'restoreFromTrash') {
        await deps.gmail.untrashThread(action.accountId, action.threadId!);
      } else if (action.kind === 'reportSpam') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['SPAM'], ['INBOX']);
      } else if (action.kind === 'restoreFromSpam') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], ['SPAM']);
      } else if (action.kind === 'muteThread') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, labelId ? [labelId] : [], ['INBOX']);
      } else if (action.kind === 'unmuteThread') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], labelId ? [labelId] : []);
      } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        if (labelId) {
          await deps.gmail.modifyLabels(action.accountId, action.threadId!, [labelId], action.kind === 'moveToLabel' ? ['INBOX'] : []);
        }
      } else if (action.kind === 'removeLabel') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        if (labelId) await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], [labelId]);
      } else if (action.kind === 'send') {
        if (action.draftId) {
          const draft = deps.drafts.get(action.draftId);
          if (!draft) throw new Error('Draft not found for pending send.');
          await deps.gmail.sendDraft(action.accountId, draft);
          deps.drafts.delete(action.draftId);
        }
      } else if (action.kind === 'forwardThread') {
        const payloadAction = payload.action as MailRuleAction | undefined;
        const forwardTo = payloadAction?.forwardTo;
        const thread = action.threadId ? deps.threads.get(action.accountId, action.threadId) : null;
        if (!forwardTo) throw new Error('Forward rule action is missing forwardTo.');
        if (!thread) throw new Error('Thread not found for pending forward rule.');
        await deps.gmail.sendDraft(
          action.accountId,
          deps.buildForwardDraft(action.accountId, thread, forwardTo),
        );
      } else if (action.kind === 'autoReply') {
        const payloadAction = payload.action as MailRuleAction | undefined;
        const replyBody = payloadAction?.replyBody?.trim();
        if (!replyBody) throw new Error('Auto-reply rule action is missing replyBody.');
        if (!action.threadId) throw new Error('Thread id is missing for pending auto-reply rule.');
        await deps.gmail.sendDraft(
          action.accountId,
          deps.buildAutoReplyDraft(action.accountId, action.threadId, replyBody),
        );
      }

      action.status = 'completed';
      action.completedAt = now().toISOString();
      deps.actionLog.save(action);
      logger.log(`[Sync Worker] Successfully synced action ${action.id} of kind ${action.kind}`);
    } catch (err: any) {
      if (isNetworkError(err)) {
        logger.log(`[Sync Worker] Network still offline, will retry action ${action.id} later:`, err.message);
        action.status = 'pending_sync';
        deps.actionLog.save(action);
        break;
      } else {
        logger.error(`[Sync Worker] Action ${action.id} failed permanently:`, err);
        action.status = 'failed';
        action.completedAt = now().toISOString();
        action.failureMessage = err.message;
        deps.actionLog.save(action);

        // Roll back local DB changes for labels on permanent failure
        if (action.threadId) {
          if (action.kind === 'markDone') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], []);
          } else if (action.kind === 'restoreInbox') {
            deps.threads.updateLabels(action.accountId, action.threadId, [], ['INBOX']);
          } else if (action.kind === 'markRead') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['UNREAD'], []);
          } else if (action.kind === 'markUnread') {
            deps.threads.updateLabels(action.accountId, action.threadId, [], ['UNREAD']);
          } else if (action.kind === 'moveToTrash') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], ['TRASH']);
          } else if (action.kind === 'restoreFromTrash') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['TRASH'], ['INBOX']);
          } else if (action.kind === 'reportSpam') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], ['SPAM']);
          } else if (action.kind === 'restoreFromSpam') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['SPAM'], ['INBOX']);
          } else if (action.kind === 'muteThread') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], typeof rollbackPayload.labelId === 'string' ? [rollbackPayload.labelId] : []);
          } else if (action.kind === 'unmuteThread') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            deps.threads.updateLabels(action.accountId, action.threadId, typeof rollbackPayload.labelId === 'string' ? [rollbackPayload.labelId] : [], ['INBOX']);
          } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel' || action.kind === 'removeLabel') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            const labelId = typeof rollbackPayload.labelId === 'string' ? rollbackPayload.labelId : null;
            if (labelId && action.kind === 'removeLabel') {
              deps.threads.updateLabels(action.accountId, action.threadId, [labelId], []);
            } else if (labelId) {
              deps.threads.updateLabels(action.accountId, action.threadId, action.kind === 'moveToLabel' ? ['INBOX'] : [], [labelId]);
            }
          }
        }
      }
    }
  }
}

export const SEND_LIKE_KINDS: ReadonlySet<ActionKind> = new Set(['send', 'forwardThread', 'autoReply']);

// The kinds reconcilePendingActions actually dispatches. Any other kind hits the
// loop's fall-through and is marked 'completed' without doing any work, so recovery
// must never re-queue them (that would fabricate success).
export const REPLAYABLE_KINDS: ReadonlySet<ActionKind> = new Set([
  'markDone',
  'restoreInbox',
  'markRead',
  'markUnread',
  'moveToTrash',
  'restoreFromTrash',
  'reportSpam',
  'restoreFromSpam',
  'muteThread',
  'unmuteThread',
  'applyLabel',
  'removeLabel',
  'moveToLabel',
  'send',
  'forwardThread',
  'autoReply',
]);

// Stranded rows can be arbitrarily old (nothing ever cleaned them up); replaying
// months-old destructive intent (e.g. moveToTrash — Gmail purges trash after 30
// days) is worse than failing. Rows older than this are failed, not re-queued.
export const RECOVERY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

// A crash or quit can strand actions in 'running' — listPending never picks them
// up again. Policy per kind:
// - send-like: failed (a send may already have left the outbox; never risk a duplicate)
// - replayable label-family, fresh: re-queued to pending_sync (Gmail label/trash
//   calls are idempotent, so replaying is safe), clearing stale failure fields
// - replayable label-family, older than RECOVERY_MAX_AGE_MS: failed (stale intent)
// - everything else (no dispatch branch): failed — re-queueing would fabricate success
export function recoverStaleRunningActions(deps: ReconcilerDeps): void {
  const now = deps.now || (() => new Date());
  for (const action of deps.actionLog.listRunning()) {
    const ageMs = now().getTime() - new Date(action.createdAt).getTime();
    if (SEND_LIKE_KINDS.has(action.kind)) {
      action.status = 'failed';
      action.failureMessage = 'Interrupted while sending; not retried to avoid a duplicate send.';
      action.completedAt = now().toISOString();
    } else if (!REPLAYABLE_KINDS.has(action.kind)) {
      action.status = 'failed';
      action.failureMessage = 'Interrupted before completion; not retried automatically.';
      action.completedAt = now().toISOString();
    } else if (!(ageMs <= RECOVERY_MAX_AGE_MS)) {
      // NaN age (unparseable createdAt) fails closed rather than replaying.
      action.status = 'failed';
      action.failureMessage = 'Interrupted too long ago; not retried automatically.';
      action.completedAt = now().toISOString();
    } else {
      action.status = 'pending_sync';
      action.failureMessage = null;
      action.completedAt = null;
    }
    deps.actionLog.save(action);
  }
}

export function startBackgroundSyncWorker(deps: ReconcilerDeps, intervalMs = 15000): NodeJS.Timeout {
  const logger = deps.logger || console;
  try {
    recoverStaleRunningActions(deps);
  } catch (e) {
    // Recovery is best-effort; a repo error here must not abort app startup
    // (this is called synchronously from Electron's whenReady handler).
    logger.error('[Sync Worker] Stale-running recovery failed:', e);
  }

  let active = false;
  return setInterval(async () => {
    if (active) return;
    active = true;
    try {
      await reconcilePendingActions(deps);
    } catch (e) {
      logger.error('[Sync Worker] Error in background sync loop:', e);
    } finally {
      active = false;
    }
  }, intervalMs);
}
