import { describe, expect, it } from 'vitest';
import { completeHistoryBackfillPage, ensureHistoryCoverage, restartHistoryBackfill } from '../main/mailboxHistoryRecovery';
import type { SyncState } from '../shared/types';

function state(overrides: Partial<SyncState> = {}): SyncState {
  return { accountId: 'me@example.com', historyId: '100', lastFullSyncAt: '2026-10-20T12:00:00Z',
    historyBackfillPageToken: 'old-archive-page', historyBackfillPagesSynced: 300, historyBackfillThreadsSynced: 16000,
    lastHistoryBackfillAt: '2026-11-13T12:00:00Z', ...overrides };
}

describe('mailbox history coverage recovery', () => {
  it('starts again from newest mail after History expiry, even if old backfill was completed', () => {
    const reset = restartHistoryBackfill(state({ historyBackfillCompletedAt: '2026-10-20T12:00:00Z' }));
    expect(reset).toMatchObject({ historyId: '100', historyBackfillPageToken: null, lastHistoryBackfillAt: null,
      historyBackfillCompletedAt: null, historyBackfillPagesSynced: 0, historyBackfillThreadsSynced: 0 });
  });

  it('repairs previously affected installations once, without resetting progress every minute', () => {
    let current = state();
    const settings = new Map<string, string>();
    const deps = { getSyncState: () => current, saveSyncState: (next: SyncState) => { current = next; },
      getSetting: (key: string) => settings.get(key) || null,
      setSetting: (key: string, value: string) => { settings.set(key, value); } };
    expect(ensureHistoryCoverage('me@example.com', deps)).toBe(true);
    current.historyBackfillPageToken = 'recovered-second-page';
    current.historyBackfillThreadsSynced = 20;
    expect(ensureHistoryCoverage('ME@example.com', deps)).toBe(false);
    expect(current.historyBackfillPageToken).toBe('recovered-second-page');
    expect(current.historyBackfillThreadsSynced).toBe(20);
  });

  it('does not mark a new account repaired before its first sync', () => {
    const settings = new Map<string, string>();
    expect(ensureHistoryCoverage('me@example.com', { getSyncState: () => null, saveSyncState: () => {
      throw new Error('Unexpected write');
    }, getSetting: () => null, setSetting: (key, value) => { settings.set(key, value); } })).toBe(false);
    expect(settings.size).toBe(0);
  });

  it('preserves a live History cursor advanced while a slow backfill page was fetched', () => {
    const start = state();
    const latest = { ...start, historyId: '150' };
    expect(completeHistoryBackfillPage(start, latest, { nextPageToken: 'next', threads: ['t1'] }, '2026-11-13T14:00:00Z'))
      .toMatchObject({ historyId: '150', historyBackfillPageToken: 'next', historyBackfillThreadsSynced: 16001 });
  });

  it('drops an old page when a full sync restarts coverage during the fetch', () => {
    const start = state();
    const latest = restartHistoryBackfill({ ...start, lastFullSyncAt: '2026-11-13T14:00:00Z' });
    expect(completeHistoryBackfillPage(start, latest, { nextPageToken: 'stale-next', threads: ['t1'] }, '2026-11-13T14:01:00Z')).toBeNull();
    expect(completeHistoryBackfillPage(start, restartHistoryBackfill(start), { threads: [] }, '2026-11-13T14:01:00Z')).toBeNull();
  });
});
