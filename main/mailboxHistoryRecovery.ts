import type { SyncState } from '../shared/types';

const COVERAGE_POLICY = '1';

/** A new History cursor says nothing about the interval missed before it. */
export function restartHistoryBackfill(state: SyncState): SyncState {
  return {
    ...state,
    historyBackfillPageToken: null,
    lastHistoryBackfillAt: null,
    historyBackfillCompletedAt: null,
    historyBackfillPagesSynced: 0,
    historyBackfillThreadsSynced: 0,
  };
}

interface RecoveryDeps {
  getSyncState(accountId: string): SyncState | null;
  saveSyncState(state: SyncState): void;
  getSetting(key: string): string | null;
  setSetting(key: string, value: string): void;
}

/** Repair caches whose old History fallback advanced past mail it never fetched. */
export function ensureHistoryCoverage(accountId: string, deps: RecoveryDeps): boolean {
  const key = `mailbox_history_coverage:${accountId.trim().toLowerCase()}`;
  if (deps.getSetting(key) === COVERAGE_POLICY) return false;
  const state = deps.getSyncState(accountId);
  if (!state?.historyId) return false;
  deps.saveSyncState(restartHistoryBackfill(state));
  // Persist last: interruption before this write safely repeats the recovery.
  deps.setSetting(key, COVERAGE_POLICY);
  return true;
}

/** A page may finish after a live sync. Never restore its old History cursor. */
export function completeHistoryBackfillPage(
  started: SyncState | null,
  latest: SyncState | null,
  page: { nextPageToken?: string; threads: readonly unknown[] },
  at: string,
): SyncState | null {
  if (!latest || !sameHistoryBackfillRun(started, latest)) return null;
  return {
    ...latest,
    historyBackfillPageToken: page.nextPageToken || null,
    lastHistoryBackfillAt: at,
    historyBackfillCompletedAt: page.nextPageToken ? null : at,
    historyBackfillPagesSynced: latest.historyBackfillPagesSynced + 1,
    historyBackfillThreadsSynced: latest.historyBackfillThreadsSynced + page.threads.length,
  };
}

export function sameHistoryBackfillRun(started: SyncState | null, latest: SyncState | null): boolean {
  return Boolean(latest)
    && (started?.lastFullSyncAt || null) === (latest?.lastFullSyncAt || null)
    && (started?.historyBackfillPageToken || null) === (latest?.historyBackfillPageToken || null);
}
