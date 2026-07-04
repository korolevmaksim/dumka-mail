import { describe, expect, it, vi } from 'vitest';
import {
  collectFtsMatchLists,
  collectSemanticOutcomes,
  flattenMatchLists,
  SEMANTIC_SEARCH_MIN_QUERY_LENGTH,
  shouldRunSemanticSearch,
  waitUnlessCancelled,
} from '../renderer/src/stores/mailSearchHelpers';
import type { SemanticSearchOutcome } from '../shared/types';

const okOutcome = (ids: string[], scanned = 10, totalIndexed = 10): SemanticSearchOutcome => ({
  status: 'ok',
  results: ids.map((id, i) => ({
    threadId: id, messageId: `${id}-m`, score: 1 - i * 0.1,
    subject: 's', sender: 'x', snippet: 'sn', receivedAt: '2026-07-01T00:00:00.000Z',
  })),
  coverage: { scanned, totalIndexed },
});

describe('collectFtsMatchLists', () => {
  it('returns one ranked list per account preserving order', async () => {
    const searchFTS = vi.fn(async (accountId: string) =>
      accountId === 'a@x.com'
        ? [{ threadId: 't1', messageId: 'm1' }, { threadId: 't2', messageId: 'm2' }]
        : [{ threadId: 't3', messageId: 'm3' }]);
    const lists = await collectFtsMatchLists(['a@x.com', 'b@y.com'], 'q', searchFTS);
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({ accountId: 'a@x.com', source: 'fts' });
    expect(lists[0].entries.map(e => e.threadId)).toEqual(['t1', 't2']);
  });
});

describe('collectSemanticOutcomes', () => {
  it('aggregates ok outcomes with summed coverage and score-carrying entries', async () => {
    const searchSemantic = vi.fn(async (accountId: string) =>
      accountId === 'a@x.com' ? okOutcome(['t1'], 100, 200) : okOutcome(['t2'], 50, 60));
    const result = await collectSemanticOutcomes(['a@x.com', 'b@y.com'], 'q', searchSemantic);
    expect(result.state).toBe('ok');
    expect(result.coverage).toEqual({ scanned: 150, totalIndexed: 260 });
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0].entries[0].score).toBeCloseTo(1);
  });

  it('reports off when every account is disabled', async () => {
    const searchSemantic = vi.fn(async (): Promise<SemanticSearchOutcome> =>
      ({ status: 'disabled', results: [], coverage: null }));
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('off');
    expect(result.lists).toHaveLength(0);
  });

  it('reports error (worst state wins) and keeps successful lists', async () => {
    const searchSemantic = vi.fn(async (accountId: string): Promise<SemanticSearchOutcome> =>
      accountId === 'a@x.com'
        ? okOutcome(['t1'])
        : { status: 'error', results: [], coverage: null, errorMessage: 'HTTP 500' });
    const result = await collectSemanticOutcomes(['a@x.com', 'b@y.com'], 'q', searchSemantic);
    expect(result.state).toBe('error');
    expect(result.errorMessage).toBe('HTTP 500');
    expect(result.lists).toHaveLength(1);
  });

  it('captures thrown IPC errors per account instead of swallowing them', async () => {
    const searchSemantic = vi.fn(async () => { throw new Error('ipc broke'); });
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('error');
    expect(result.errorMessage).toBe('ipc broke');
  });

  it('treats superseded outcomes as silent (no error, no list)', async () => {
    const searchSemantic = vi.fn(async (): Promise<SemanticSearchOutcome> =>
      ({ status: 'superseded', results: [], coverage: null }));
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('off');
    expect(result.errorMessage).toBeUndefined();
  });
});

describe('flattenMatchLists', () => {
  it('flattens entries preserving thread and message ids', () => {
    const flat = flattenMatchLists([
      { accountId: 'a@x.com', source: 'fts', entries: [{ threadId: 't1', messageId: 'm1' }] },
      { accountId: 'a@x.com', source: 'semantic', entries: [{ threadId: 't2', messageId: 'm2', score: 0.5 }] },
    ]);
    expect(flat).toEqual([
      { threadId: 't1', messageId: 'm1' },
      { threadId: 't2', messageId: 'm2' },
    ]);
  });
});

describe('semantic search gating', () => {
  it('only allows semantic search for queries of at least the minimum length', () => {
    expect(SEMANTIC_SEARCH_MIN_QUERY_LENGTH).toBe(3);
    expect(shouldRunSemanticSearch('')).toBe(false);
    expect(shouldRunSemanticSearch('ab')).toBe(false);
    expect(shouldRunSemanticSearch('  ab  ')).toBe(false);
    expect(shouldRunSemanticSearch('abc')).toBe(true);
    expect(shouldRunSemanticSearch('contract renewal')).toBe(true);
  });

  it('resolves true when the settle delay elapses without cancellation', async () => {
    vi.useFakeTimers();
    const pending = waitUnlessCancelled(450, () => false);

    await vi.advanceTimersByTimeAsync(450);

    await expect(pending).resolves.toBe(true);
    vi.useRealTimers();
  });

  it('resolves false when the search is cancelled during the settle delay', async () => {
    vi.useFakeTimers();
    let cancelled = false;
    const pending = waitUnlessCancelled(450, () => cancelled);

    await vi.advanceTimersByTimeAsync(200);
    cancelled = true;
    await vi.advanceTimersByTimeAsync(250);

    await expect(pending).resolves.toBe(false);
    vi.useRealTimers();
  });

  it('resolves false immediately when already cancelled before the delay starts', async () => {
    await expect(waitUnlessCancelled(450, () => true)).resolves.toBe(false);
  });
});
