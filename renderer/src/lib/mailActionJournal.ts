// The journal sequence of one mail action: record it (queued, then running),
// run the remote mutation once, record how it ended. Shared by the single
// action and the batch action in useMailState so both treat a failed journal
// write the same way:
//
//   - before the mutation, a failed write stops the action. Nothing reached
//     Gmail and nothing was changed in SQLite; the caller puts the list back.
//   - after the mutation, a failed write is bookkeeping. Gmail already took the
//     change, so it is never reported as a failed action (that would roll the
//     list back and invite a repeat) and the mutation is never run again.
//
// A final state that could not be stored is retried in the background: a row
// left `queued` or `running` keeps overlaying its label change on every sync,
// and a `running` row is replayed to Gmail on the next launch.
//
// The main process already waits out a held database lock for every write
// (bounded), so a rejection here means that wait was used up.

import type { MailActionLog } from '../../../shared/types';

export type SaveMailActionLog = (log: MailActionLog) => Promise<void>;

export type JournaledMailActionOutcome =
  /** The mutation ran and was accepted. */
  | { status: 'completed' }
  /** The mutation is parked for the reconciler (offline). */
  | { status: 'parked' }
  /** The journal could not be written, so the mutation never ran. */
  | { status: 'notSaved'; error: unknown }
  /** The mutation ran and failed. */
  | { status: 'failed'; error: unknown };

export interface JournaledMailActionOptions {
  /** Updated in place (status, completedAt, failureMessage), as the callers expect. */
  log: MailActionLog;
  saveActionLog: SaveMailActionLog;
  /** The remote mutation. Called at most once, and only after the journal holds the action. */
  mutate: () => Promise<{ offline?: boolean } | null | undefined | void>;
  /** A final state reached the journal after this call returned (a retried or not-awaited write). */
  onJournalSettled?: () => void;
  now?: () => Date;
  settleRetryDelaysMs?: readonly number[];
  schedule?: (callback: () => void, delayMs: number) => void;
}

/** Later attempts to store a final state whose first write failed. */
export const MAIL_ACTION_SETTLE_RETRY_DELAYS_MS: readonly number[] = [2_000, 10_000, 30_000, 120_000];

function failureText(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (error && typeof error === 'object' && typeof (error as { message?: unknown }).message === 'string') {
    return (error as { message: string }).message;
  }
  return String(error);
}

/**
 * Stores a final journal state. Resolves to whether the first write stored it;
 * if not, the same snapshot is tried again after each delay and
 * `onJournalSettled` is called once it lands. Never rejects.
 */
export async function recordSettledMailAction(
  options: Pick<JournaledMailActionOptions, 'saveActionLog' | 'onJournalSettled' | 'settleRetryDelaysMs' | 'schedule'>,
  log: MailActionLog,
): Promise<boolean> {
  // A snapshot: the caller keeps using (and may change) its own object.
  const snapshot = { ...log };
  const delays = options.settleRetryDelaysMs ?? MAIL_ACTION_SETTLE_RETRY_DELAYS_MS;
  const schedule = options.schedule ?? ((callback: () => void, delayMs: number) => { setTimeout(callback, delayMs); });

  const retry = (index: number) => {
    if (index >= delays.length) {
      console.error(`Gave up recording the ${snapshot.status} mail action ${snapshot.id}.`);
      return;
    }
    schedule(() => {
      options.saveActionLog(snapshot).then(
        () => options.onJournalSettled?.(),
        () => retry(index + 1),
      );
    }, delays[index]);
  };

  try {
    await options.saveActionLog(snapshot);
    return true;
  } catch (error) {
    console.error(`Could not record the ${snapshot.status} mail action:`, error);
    retry(0);
    return false;
  }
}

export async function runJournaledMailAction(options: JournaledMailActionOptions): Promise<JournaledMailActionOutcome> {
  const { log, saveActionLog } = options;
  const now = options.now ?? (() => new Date());

  try {
    await saveActionLog(log);
    log.status = 'running';
    await saveActionLog(log);
  } catch (error) {
    log.status = 'failed';
    log.failureMessage = failureText(error);
    // Not awaited: the caller restores the list now, not after another wait
    // for the same lock. It hears about the record when it lands, including
    // when the first write already stores it.
    void recordSettledMailAction(options, log).then(stored => {
      if (stored) options.onJournalSettled?.();
    });
    return { status: 'notSaved', error };
  }

  let response: { offline?: boolean } | null | undefined | void;
  try {
    response = await options.mutate();
  } catch (error) {
    log.status = 'failed';
    // Raw detail stays in the action log; the toast gets a human sentence.
    log.failureMessage = failureText(error);
    await recordSettledMailAction(options, log);
    return { status: 'failed', error };
  }

  if (response && response.offline) {
    // The main process parked the action (`pending_sync`) in the journal itself.
    log.status = 'pending_sync';
    return { status: 'parked' };
  }

  log.status = 'completed';
  log.completedAt = now().toISOString();
  await recordSettledMailAction(options, log);
  return { status: 'completed' };
}
