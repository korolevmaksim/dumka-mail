import type { MailActionLog, MailRuleAction, MailThread } from '../shared/types';

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
