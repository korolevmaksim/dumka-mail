// A label action the main process runs on its own (a notification button, a
// mail rule): the label change and its journal entry, the Gmail call, and the
// record of how it ended. The window's actions follow the same three steps in
// `api:modifyLabels` and renderer/src/lib/mailActionJournal.ts.

import type { MailActionLog } from '../shared/types';
import type { LocalWrites } from './localWrites';

export type LocalLabelActionOutcome = 'completed' | 'parked' | 'failed';

export interface LocalLabelActionDeps {
  writes: Pick<LocalWrites, 'begin' | 'settle' | 'rollback'>;
  threads: {
    /** May return the labels it really changed; the rollback then puts back exactly those. */
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): { added: string[]; removed: string[] } | void;
  };
  /** What the action must put back if it fails (see labelRollback.ts). */
  rollbacks: {
    track(actionId: string, change: { added: string[]; removed: string[] }): void;
    accept(actionId: string): void;
    forget(actionId: string): void;
    rollback(action: { id: string; accountId: string; threadId: string }, fallback: { add: string[]; remove: string[] }): unknown;
  };
  actionLog: { save(log: MailActionLog): void };
  isRetryableRemoteError(error: unknown): boolean;
  now?: () => Date;
}

export interface LocalLabelAction {
  /** Short name for the lock-wait diagnostics, e.g. `notification`. */
  label: string;
  /** The journal entry, stored as `running` together with the label change. */
  log: MailActionLog & { threadId: string };
  addLabelIds: string[];
  removeLabelIds: string[];
  runRemote(): Promise<unknown>;
  /** The stored labels changed (after the first write, and after a rollback). */
  onLocalChange?: () => void;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rejects only when the first write could not be stored; nothing was sent
 * then. After the Gmail call the outcome is always written through `settle` /
 * `rollback`, which wait for the database and never throw.
 */
export async function runLocalLabelAction(deps: LocalLabelActionDeps, action: LocalLabelAction): Promise<LocalLabelActionOutcome> {
  const { log, addLabelIds, removeLabelIds } = action;
  const now = deps.now || (() => new Date());

  // One write: a label change without its journal entry could never be
  // synced or undone, and an entry without the change would replay it.
  const applied = await deps.writes.begin(action.label, () => {
    const change = deps.threads.updateLabels(log.accountId, log.threadId, addLabelIds, removeLabelIds)
      || { added: addLabelIds, removed: removeLabelIds };
    deps.actionLog.save({ ...log, status: 'running' });
    deps.rollbacks.track(log.id, change);
    return change;
  });
  action.onLocalChange?.();

  try {
    await action.runRemote();
  } catch (error) {
    if (deps.isRetryableRemoteError(error)) {
      // Parked for the reconciler. If even this cannot be stored the entry
      // stays `running` and is recovered on the next launch.
      await deps.writes.settle(`${action.label}:park`, () => {
        deps.actionLog.save({ ...log, status: 'pending_sync', failureMessage: messageOf(error) });
      });
      return 'parked';
    }
    await deps.writes.rollback(`${action.label}:rollback`, () => {
      // Only what this action changed, and not a label a newer action took over.
      deps.rollbacks.rollback(log, { add: applied.removed, remove: applied.added });
      deps.actionLog.save({ ...log, status: 'failed', completedAt: now().toISOString(), failureMessage: messageOf(error) });
    });
    action.onLocalChange?.();
    return 'failed';
  }

  // Accepted, but the journal still says `running` until the write below is
  // stored: until then the action keeps the labels it took over.
  deps.rollbacks.accept(log.id);
  const stored = await deps.writes.settle(`${action.label}:completed`, () => {
    deps.actionLog.save({ ...log, status: 'completed', completedAt: now().toISOString() });
  });
  if (stored) deps.rollbacks.forget(log.id);
  return 'completed';
}
