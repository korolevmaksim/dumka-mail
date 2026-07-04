import { describe, expect, it } from 'vitest';
import {
  fuseSearchMatches,
  orderSearchResults,
  RRF_K,
  TOP_RESULTS_MAX,
  type RankedSourceList,
} from '../shared/searchRanking';

function list(
  accountId: string,
  source: 'fts' | 'semantic',
  threadIds: string[],
): RankedSourceList {
  return {
    accountId,
    source,
    entries: threadIds.map((threadId, index) => ({
      threadId,
      messageId: `${threadId}-m${index}`,
      score: source === 'semantic' ? 1 - index * 0.1 : undefined,
    })),
  };
}

function threads(ids: string[]): { id: string }[] {
  return ids.map(id => ({ id }));
}

describe('fuseSearchMatches', () => {
  it('scores a thread appearing in both lists higher than single-list threads at the same rank', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1', 't2']),
      list('a@x.com', 'semantic', ['t1', 't3']),
    ]);
    const s = fusion.scoreByThreadId;
    expect(s.get('t1')).toBeCloseTo(2 / (RRF_K + 1), 10);
    expect(s.get('t2')).toBeCloseTo(1 / (RRF_K + 2), 10);
    expect(s.get('t3')).toBeCloseTo(1 / (RRF_K + 2), 10);
    expect(s.get('t1')! > s.get('t2')!).toBe(true);
  });

  it('uses the best rank when a thread has several messages in one list', () => {
    const fusion = fuseSearchMatches([
      {
        accountId: 'a@x.com',
        source: 'fts',
        entries: [
          { threadId: 't1', messageId: 'm1' },
          { threadId: 't2', messageId: 'm2' },
          { threadId: 't1', messageId: 'm3' }, // duplicate thread, worse rank
        ],
      },
    ]);
    expect(fusion.scoreByThreadId.get('t1')).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('treats each account list as an independent ranked list', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1']),
      list('b@y.com', 'fts', ['t1']),
    ]);
    expect(fusion.scoreByThreadId.get('t1')).toBeCloseTo(2 / (RRF_K + 1), 10);
  });

  it('tracks semantic-only thread ids', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1', 't2']),
      list('a@x.com', 'semantic', ['t2', 't3']),
    ]);
    expect(fusion.semanticOnlyThreadIds).toEqual(new Set(['t3']));
  });
});

describe('orderSearchResults', () => {
  it('returns a flat list (topCount 0) when matches do not exceed topMax', () => {
    const fusion = fuseSearchMatches([list('a@x.com', 'fts', ['t1', 't2'])]);
    const input = threads(['t2', 't1']); // date order
    const result = orderSearchResults(input, fusion);
    expect(result.topCount).toBe(0);
    expect(result.threads.map(t => t.id)).toEqual(['t2', 't1']);
  });

  it('puts the topMax best-fused threads first and keeps the rest date-ordered without duplicates', () => {
    // t6 best (both sources), then fts ranks t1..t5.
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t6', 't1', 't2', 't3', 't4', 't5']),
      list('a@x.com', 'semantic', ['t6']),
    ]);
    // Date order deliberately different from relevance order.
    const input = threads(['t5', 't4', 't3', 't2', 't1', 't6', 't7']);
    const result = orderSearchResults(input, fusion);
    expect(result.topCount).toBe(TOP_RESULTS_MAX);
    // Top: fused-score order.
    expect(result.threads.slice(0, 5).map(t => t.id)).toEqual(['t6', 't1', 't2', 't3', 't4']);
    // Rest: original (date) order, minus the promoted ones, no duplicates.
    expect(result.threads.slice(5).map(t => t.id)).toEqual(['t5', 't7']);
    expect(new Set(result.threads.map(t => t.id)).size).toBe(result.threads.length);
  });

  it('threads missing from the fusion map sort after scored ones within the top selection', () => {
    const fusion = fuseSearchMatches([list('a@x.com', 'fts', ['t1'])]);
    const input = threads(['t1', 't2']);
    const result = orderSearchResults(input, fusion, 1);
    expect(result.topCount).toBe(1);
    expect(result.threads.map(t => t.id)).toEqual(['t1', 't2']);
  });
});
