import { describe, expect, it } from 'vitest';
import {
  ALL_MAIL_INDEXED_TEXT,
  FETCHING_INBOX_TEXT,
  applyBackfillEvent,
  applySyncSuccess,
  displaySyncStatus,
  mergeStoredProgress,
  pendingFirstSyncProgress,
  progressFromSyncState,
  summarizeScopeProgress,
} from '../shared/mailboxSyncProgress';

const WORK = 'alex.morgan@northwind.example';
const HOME = 'alex@morgan-family.example';

describe('mailbox sync progress', () => {
  it('treats an account without lastFullSyncAt/historyId as still fetching its inbox', () => {
    const progress = { [WORK]: progressFromSyncState(null) };
    const summary = summarizeScopeProgress(progress, [WORK]);
    expect(summary.fetchingInbox).toBe(true);
    expect(displaySyncStatus({ health: 'ready', text: 'Ready' }, summary)).toEqual({ health: 'syncing', text: FETCHING_INBOX_TEXT });
  });

  it('leaves Fetching inbox… after the first successful sync and shows indexing progress', () => {
    const synced = applySyncSuccess(pendingFirstSyncProgress());
    const summary = summarizeScopeProgress({ [WORK]: synced }, [WORK]);
    expect(summary.fetchingInbox).toBe(false);
    expect(summary.olderMailIndexing).toBe(true);
    expect(displaySyncStatus({ health: 'ready', text: 'Ready' }, summary).text).toBe('Indexing older mail, 0 threads');
  });

  it('counts backfill progress from main-process events and finishes with All mail indexed', () => {
    let entry = applyBackfillEvent(undefined, { accountId: WORK, threadsIndexed: 1200, completed: false, running: true });
    expect(summarizeScopeProgress({ [WORK]: entry }, [WORK]).backfillText).toBe('Indexing older mail, 1,200 threads');
    entry = applyBackfillEvent(entry, { accountId: WORK, threadsIndexed: 6034, completed: true, running: false });
    const summary = summarizeScopeProgress({ [WORK]: entry }, [WORK]);
    expect(summary.backfillText).toBe(ALL_MAIL_INDEXED_TEXT);
    expect(summary.olderMailIndexing).toBe(false);
    // `Ready` stays once everything is indexed.
    expect(displaySyncStatus({ health: 'ready', text: 'Ready' }, summary)).toEqual({ health: 'ready', text: 'Ready' });
  });

  it('reports a paused loop (offline / reauthorization) without claiming it is running', () => {
    const entry = applyBackfillEvent(undefined, { accountId: WORK, threadsIndexed: 300, completed: false, running: false, pausedReason: 'network' });
    const summary = summarizeScopeProgress({ [WORK]: entry }, [WORK]);
    expect(summary.backfillText).toBe('Older mail indexing paused, 300 threads');
    expect(displaySyncStatus({ health: 'ready', text: 'Ready' }, summary).health).toBe('paused');
    // A later successful sync resumes the loop.
    expect(summarizeScopeProgress({ [WORK]: applySyncSuccess(entry) }, [WORK]).backfillText).toBe('Indexing older mail, 300 threads');
  });

  it('keeps Unified in Fetching inbox… while a second, newly connected account has not synced', () => {
    const progress = {
      [WORK]: applyBackfillEvent(undefined, { accountId: WORK, threadsIndexed: 50, completed: true, running: false }),
      [HOME]: pendingFirstSyncProgress(),
    };
    expect(summarizeScopeProgress(progress, [WORK, HOME]).fetchingInbox).toBe(true);
    expect(summarizeScopeProgress(progress, [WORK]).fetchingInbox).toBe(false);
    expect(summarizeScopeProgress(progress, [HOME]).fetchingInbox).toBe(true);
  });

  it('never lets a stale sync_state read undo a sync success that already arrived', () => {
    const fromEvent = applySyncSuccess(pendingFirstSyncProgress());
    const merged = mergeStoredProgress(fromEvent, progressFromSyncState(null));
    expect(merged.firstSyncDone).toBe(true);
  });

  it('lets reconnect and failure states win over progress text', () => {
    const summary = summarizeScopeProgress({ [WORK]: pendingFirstSyncProgress() }, [WORK]);
    expect(displaySyncStatus({ health: 'reconnect', text: `Reconnect ${WORK}` }, summary).text).toBe(`Reconnect ${WORK}`);
    expect(displaySyncStatus({ health: 'failed', text: 'Degraded sync' }, summary).text).toBe('Degraded sync');
  });

  it('is empty when no progress is known for the scope', () => {
    expect(summarizeScopeProgress({}, [WORK])).toEqual({ fetchingInbox: false, olderMailIndexing: false, backfillText: '' });
  });
});
