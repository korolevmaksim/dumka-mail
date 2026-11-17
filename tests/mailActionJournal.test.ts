import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailActionLog } from '../shared/types';
import { LOCAL_SAVE_FAILED_MESSAGE, localSaveFailedErrorMessage, mailActionFailureMessage } from '../shared/mailActionErrors';
import { recordSettledMailAction, runJournaledMailAction } from '../renderer/src/lib/mailActionJournal';

function trashAction(): MailActionLog {
  return {
    id: 'action-1',
    accountId: 'alex.morgan@northwind.example',
    threadId: 'thread-1',
    kind: 'moveToTrash',
    status: 'queued',
    createdAt: '2026-11-17T19:24:14.000Z',
    payloadJson: null,
  };
}

/** What `db:saveActionLog` rejects with once the main process used up its wait for the lock. */
function lockedJournalError(): Error {
  return new Error(`Error invoking remote method 'db:saveActionLog': Error: ${localSaveFailedErrorMessage()}`);
}

/** A journal whose writes fail while `locked` is true; stores a copy of every write that lands. */
function journal() {
  const state = { locked: false, stored: [] as MailActionLog[], attempts: 0 };
  const saveActionLog = vi.fn(async (log: MailActionLog) => {
    state.attempts += 1;
    if (state.locked) throw lockedJournalError();
    state.stored.push({ ...log });
  });
  return { state, saveActionLog };
}

/** Collects the background retries instead of waiting for real timers. */
function manualSchedule() {
  const pending: Array<{ callback: () => void; delayMs: number }> = [];
  return {
    pending,
    schedule: (callback: () => void, delayMs: number) => { pending.push({ callback, delayMs }); },
    async runNext() {
      const next = pending.shift();
      if (!next) throw new Error('No retry is scheduled.');
      next.callback();
      await new Promise(resolve => setTimeout(resolve, 0));
    },
  };
}

describe('runJournaledMailAction', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('records queued and running, runs the mutation once, then records completed', async () => {
    const { state, saveActionLog } = journal();
    const order: string[] = [];
    saveActionLog.mockImplementation(async (log: MailActionLog) => {
      order.push(`journal:${log.status}`);
      state.stored.push({ ...log });
    });
    const mutate = vi.fn(async () => {
      order.push('gmail');
      return { offline: false };
    });
    const log = trashAction();

    const outcome = await runJournaledMailAction({ log, saveActionLog, mutate });

    expect(outcome).toEqual({ status: 'completed' });
    expect(order).toEqual(['journal:queued', 'journal:running', 'gmail', 'journal:completed']);
    expect(log.status).toBe('completed');
    expect(log.completedAt).toEqual(expect.any(String));
  });

  it('waits for a journal write that was delayed by a lock, then runs the mutation exactly once', async () => {
    const releases: Array<() => void> = [];
    const stored: string[] = [];
    // Each write stays pending until the "lock" is released, as the IPC call
    // does while the main process waits for the database.
    const saveActionLog = vi.fn((log: MailActionLog) => new Promise<void>(resolve => {
      const status = log.status;
      releases.push(() => {
        stored.push(status);
        resolve();
      });
    }));
    const mutate = vi.fn(async () => ({ offline: false }));

    const running = runJournaledMailAction({ log: trashAction(), saveActionLog, mutate });
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(mutate).not.toHaveBeenCalled();
    expect(saveActionLog).toHaveBeenCalledTimes(1);

    // The lock clears: the same action goes on by itself.
    for (let released = 0; released < 3; released += 1) {
      while (releases.length === 0) await new Promise(resolve => setTimeout(resolve, 1));
      releases.shift()!();
    }

    await expect(running).resolves.toEqual({ status: 'completed' });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(stored).toEqual(['queued', 'running', 'completed']);
  });

  it.each([
    ['the first journal write', 1],
    ['the second journal write', 2],
  ])('never runs the mutation when %s fails, and reports a local save failure', async (_name, failingWrite) => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, saveActionLog } = journal();
    saveActionLog.mockImplementation(async (log: MailActionLog) => {
      state.attempts += 1;
      if (state.attempts >= failingWrite) throw lockedJournalError();
      state.stored.push({ ...log });
    });
    const mutate = vi.fn(async () => ({ offline: false }));
    const retries = manualSchedule();
    const log = trashAction();

    const outcome = await runJournaledMailAction({ log, saveActionLog, mutate, schedule: retries.schedule });

    expect(outcome.status).toBe('notSaved');
    expect(mutate).not.toHaveBeenCalled();
    expect(log.status).toBe('failed');
    expect(log.failureMessage).toContain('db:saveActionLog');
    // What the toast says: our sentence, never the raw IPC text.
    expect(mailActionFailureMessage((outcome as { error: unknown }).error, log.kind)).toBe(LOCAL_SAVE_FAILED_MESSAGE);
  });

  it('records the failure in the background once the journal can be written again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, saveActionLog } = journal();
    state.locked = true;
    const retries = manualSchedule();
    const settled = vi.fn();
    const mutate = vi.fn(async () => ({ offline: false }));

    const outcome = await runJournaledMailAction({
      log: trashAction(),
      saveActionLog,
      mutate,
      schedule: retries.schedule,
      onJournalSettled: settled,
      settleRetryDelaysMs: [10, 20],
    });
    // The caller is not kept waiting for the failure record.
    expect(outcome.status).toBe('notSaved');
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(retries.pending.map(retry => retry.delayMs)).toEqual([10]);

    await retries.runNext();
    expect(retries.pending.map(retry => retry.delayMs)).toEqual([20]);
    expect(settled).not.toHaveBeenCalled();

    state.locked = false;
    await retries.runNext();
    expect(state.stored.map(entry => entry.status)).toEqual(['failed']);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(retries.pending).toEqual([]);
    expect(mutate).not.toHaveBeenCalled();
  });

  it('tells the caller when the failure record is stored by its first write', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, saveActionLog } = journal();
    saveActionLog.mockImplementation(async (log: MailActionLog) => {
      state.attempts += 1;
      // Only the write that starts the action hits the lock.
      if (state.attempts === 1) throw lockedJournalError();
      state.stored.push({ ...log });
    });
    const settled = vi.fn();

    const outcome = await runJournaledMailAction({
      log: trashAction(),
      saveActionLog,
      mutate: async () => ({ offline: false }),
      onJournalSettled: settled,
    });
    expect(outcome.status).toBe('notSaved');
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(state.stored.map(entry => entry.status)).toEqual(['failed']);
    expect(settled).toHaveBeenCalledTimes(1);
  });

  it('does not repeat the mutation or report a failure when the completed state cannot be recorded', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, saveActionLog } = journal();
    const retries = manualSchedule();
    const settled = vi.fn();
    const mutate = vi.fn(async () => {
      // Gmail accepted the change; the lock is taken right after.
      state.locked = true;
      return { offline: false };
    });
    const log = trashAction();

    const outcome = await runJournaledMailAction({
      log,
      saveActionLog,
      mutate,
      schedule: retries.schedule,
      onJournalSettled: settled,
    });

    expect(outcome).toEqual({ status: 'completed' });
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(state.stored.map(entry => entry.status)).toEqual(['queued', 'running']);

    // The row must not stay `running` (it would be replayed on the next
    // launch): the completed state is written as soon as the lock is gone.
    state.locked = false;
    await retries.runNext();
    expect(state.stored.map(entry => entry.status)).toEqual(['queued', 'running', 'completed']);
    expect(settled).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it('leaves an action parked by the main process as pending_sync without a completion write', async () => {
    const { state, saveActionLog } = journal();
    const log = trashAction();

    const outcome = await runJournaledMailAction({ log, saveActionLog, mutate: async () => ({ offline: true }) });

    expect(outcome).toEqual({ status: 'parked' });
    expect(log.status).toBe('pending_sync');
    expect(state.stored.map(entry => entry.status)).toEqual(['queued', 'running']);
  });

  it('records a failed mutation and returns its error', async () => {
    const { state, saveActionLog } = journal();
    const log = trashAction();
    const rejection = new Error('Gmail rejected the change.');

    const outcome = await runJournaledMailAction({ log, saveActionLog, mutate: async () => { throw rejection; } });

    expect(outcome).toEqual({ status: 'failed', error: rejection });
    expect(state.stored.map(entry => entry.status)).toEqual(['queued', 'running', 'failed']);
    expect(state.stored[2].failureMessage).toBe('Gmail rejected the change.');
  });
});

describe('recordSettledMailAction', () => {
  it('stops after the last retry delay', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { state, saveActionLog } = journal();
    state.locked = true;
    const retries = manualSchedule();

    const stored = await recordSettledMailAction(
      { saveActionLog, schedule: retries.schedule, settleRetryDelaysMs: [5, 5] },
      { ...trashAction(), status: 'completed' },
    );
    expect(stored).toBe(false);
    await retries.runNext();
    await retries.runNext();

    expect(retries.pending).toEqual([]);
    expect(saveActionLog).toHaveBeenCalledTimes(3);
    expect(errors.mock.calls.some(call => String(call[0]).includes('Gave up recording'))).toBe(true);
    errors.mockRestore();
  });

  it('stores the state as it was when the action settled', async () => {
    const { state, saveActionLog } = journal();
    const log: MailActionLog = { ...trashAction(), status: 'completed' };

    const pending = recordSettledMailAction({ saveActionLog }, log);
    log.status = 'failed';

    await expect(pending).resolves.toBe(true);
    expect(state.stored.map(entry => entry.status)).toEqual(['completed']);
  });
});
