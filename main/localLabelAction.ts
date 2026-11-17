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
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
    rollbackLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
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
  await deps.writes.begin(action.label, () => {
    deps.threads.updateLabels(log.accountId, log.threadId, addLabelIds, removeLabelIds);
    deps.actionLog.save({ ...log, status: 'running' });
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
      deps.threads.rollbackLabels(log.accountId, log.threadId, removeLabelIds, addLabelIds);
      deps.actionLog.save({ ...log, status: 'failed', completedAt: now().toISOString(), failureMessage: messageOf(error) });
    });
    action.onLocalChange?.();
    return 'failed';
  }

  await deps.writes.settle(`${action.label}:completed`, () => {
    deps.actionLog.save({ ...log, status: 'completed', completedAt: now().toISOString() });
  });
  return 'completed';
}
