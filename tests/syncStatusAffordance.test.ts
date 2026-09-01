import { describe, expect, it } from 'vitest';
import {
  isIncompleteBackfillProgress,
  isRenderedBackfillProgress,
  syncStatusAffordance,
} from '../shared/syncStatusAffordance';

describe('syncStatusAffordance', () => {
  it('retries on a failed sync even if backfill looks unfinished', () => {
    expect(syncStatusAffordance({
      syncHealth: 'failed',
      backfillProgress: '12 threads indexed',
      hasAccount: true,
    })).toBe('retrySync');
  });

  it('does not offer continue-indexing for the empty sentinel or zero accounts', () => {
    expect(isRenderedBackfillProgress('')).toBe(false);
    expect(isRenderedBackfillProgress('0%')).toBe(false);
    expect(isIncompleteBackfillProgress('0%')).toBe(false);
    expect(syncStatusAffordance({
      syncHealth: 'ready',
      backfillProgress: '0%',
      hasAccount: true,
    })).toBe('none');
    expect(syncStatusAffordance({
      syncHealth: 'ready',
      backfillProgress: '12 threads indexed',
      hasAccount: false,
    })).toBe('none');
  });

  it('offers continue-indexing only for an incomplete live backfill', () => {
    expect(syncStatusAffordance({
      syncHealth: 'ready',
      backfillProgress: '12 threads indexed',
      hasAccount: true,
    })).toBe('continueIndexing');
    expect(syncStatusAffordance({
      syncHealth: 'ready',
      backfillProgress: 'All mail indexed',
      hasAccount: true,
    })).toBe('none');
  });
});
