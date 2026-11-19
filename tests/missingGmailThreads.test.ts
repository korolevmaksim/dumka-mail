import { describe, expect, it, vi } from 'vitest';
import { MissingGmailThreadError, MissingGmailThreads } from '../main/missingGmailThreads';
import { failedMailActionResult, MISSING_GMAIL_THREAD_MESSAGE } from '../shared/mailActionErrors';
import { aggregateMailActionResults, resolveMailActionFeedback } from '../shared/mailActionFeedback';

const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { status });
const missing = () => Promise.reject(httpError(404));

function fixture() {
  const deps = {
    exists: vi.fn(async (_account: string, _thread: string) => false),
    removeCached: vi.fn(async (_account: string, _thread: string) => {}),
    loggedCandidates: vi.fn(async (_account: string): Promise<string[]> => []),
  };
  return { ...deps, repair: new MissingGmailThreads(deps) };
}

describe('reconciling missing Gmail conversations', () => {
  it('coalesces simultaneous auto-read and archive checks and scopes eviction to the affected account', async () => {
    const f = fixture();
    const results = await Promise.allSettled([
      f.repair.mutate('first', 'thread', missing),
      f.repair.mutate('first', 'thread', missing),
      f.repair.mutate('other', 'thread', async () => {}),
    ]);
    expect(results.map(result => result.status)).toEqual(['rejected', 'rejected', 'fulfilled']);
    expect(f.exists.mock.calls).toEqual([['first', 'thread']]);
    expect(f.removeCached.mock.calls).toEqual([['first', 'thread']]);
    for (const result of results.slice(0, 2)) {
      if (result.status === 'rejected') expect(result.reason).toBeInstanceOf(MissingGmailThreadError);
    }
  });

  it('preserves a live conversation when the missing resource was a label', async () => {
    const f = fixture();
    f.exists.mockResolvedValue(true);
    await expect(f.repair.mutate('account', 'thread', missing)).rejects.toMatchObject({ status: 404 });
    expect(f.removeCached).not.toHaveBeenCalled();
  });

  it.each([403, 429, 503])('preserves the cache if verification fails with %s', async status => {
    const f = fixture();
    f.exists.mockRejectedValue(httpError(status));
    await expect(f.repair.mutate('account', 'thread', missing)).rejects.toMatchObject({ status });
    expect(f.removeCached).not.toHaveBeenCalled();
    await expect(f.repair.mutate('account', 'thread', () => Promise.reject(httpError(status)))).rejects.toMatchObject({ status });
    expect(f.exists).toHaveBeenCalledTimes(1);
  });

  it('rechecks old failures in bounded passes, resuming after a temporary failure', async () => {
    const f = fixture();
    f.loggedCandidates.mockResolvedValue(['a', 'b', 'c', 'd']);
    f.exists.mockRejectedValueOnce(httpError(429));
    await expect(f.repair.repairLoggedFailures('account')).rejects.toMatchObject({ status: 429 });
    f.exists.mockResolvedValueOnce(true);
    await f.repair.repairLoggedFailures('account');
    expect(f.removeCached.mock.calls).toEqual([['account', 'c'], ['account', 'b']]);
    await f.repair.repairLoggedFailures('account');
    expect(f.removeCached.mock.calls.at(-1)).toEqual(['account', 'a']);
    await f.repair.repairLoggedFailures('account');
    expect(f.loggedCandidates).toHaveBeenCalledTimes(1);
    expect(f.exists).toHaveBeenCalledTimes(5);
  });

  it('shows the terminal result through Electron IPC without Retry or Undo', () => {
    const error = new Error(`Error invoking remote method 'api:modifyLabels': Error: ${MISSING_GMAIL_THREAD_MESSAGE}`);
    const result = failedMailActionResult(error, 'markDone', 'id');
    expect(resolveMailActionFeedback({ kind: 'markDone', result })).toEqual({
      tone: 'info', silent: false, action: null, message: MISSING_GMAIL_THREAD_MESSAGE,
    });
    const batch = aggregateMailActionResults([result, { accepted: true, offline: false }]);
    expect(resolveMailActionFeedback({ kind: 'markDone', result: batch, count: 2, succeeded: 1, failed: 1 }).action).toBeNull();
  });
});
