// Reciprocal Rank Fusion over per-account, per-source ranked match lists.
// Pure and dependency-free: runs in the renderer, tested directly.

export const RRF_K = 60;
export const TOP_RESULTS_MAX = 5;

export interface RankedMatchEntry {
  threadId: string;
  messageId: string;
  score?: number;
}

export interface RankedSourceList {
  accountId: string;
  source: 'fts' | 'semantic';
  entries: RankedMatchEntry[];
}

export interface SearchFusion {
  scoreByThreadId: Map<string, number>;
  semanticOnlyThreadIds: Set<string>;
}

export function fuseSearchMatches(lists: RankedSourceList[], k = RRF_K): SearchFusion {
  const scoreByThreadId = new Map<string, number>();
  const ftsThreadIds = new Set<string>();
  const semanticThreadIds = new Set<string>();

  for (const list of lists) {
    const bestRankByThread = new Map<string, number>();
    list.entries.forEach((entry, index) => {
      if (!bestRankByThread.has(entry.threadId)) {
        bestRankByThread.set(entry.threadId, index);
      }
      (list.source === 'fts' ? ftsThreadIds : semanticThreadIds).add(entry.threadId);
    });

    for (const [threadId, rank] of bestRankByThread) {
      const contribution = 1 / (k + rank + 1);
      scoreByThreadId.set(threadId, (scoreByThreadId.get(threadId) || 0) + contribution);
    }
  }

  const semanticOnlyThreadIds = new Set(
    [...semanticThreadIds].filter(threadId => !ftsThreadIds.has(threadId))
  );

  return { scoreByThreadId, semanticOnlyThreadIds };
}

export interface OrderedSearchResults<T extends { id: string }> {
  threads: T[];
  topCount: number;
  semanticOnlyThreadIds: Set<string>;
}

// filteredThreads arrive membership-filtered and date-ordered; the top section is
// pulled out by fused score, the remainder keeps its incoming (date) order.
export function orderSearchResults<T extends { id: string }>(
  filteredThreads: T[],
  fusion: SearchFusion,
  topMax = TOP_RESULTS_MAX,
): OrderedSearchResults<T> {
  if (filteredThreads.length <= topMax) {
    return { threads: filteredThreads, topCount: 0, semanticOnlyThreadIds: fusion.semanticOnlyThreadIds };
  }

  const byScore = [...filteredThreads].sort((a, b) => {
    const scoreA = fusion.scoreByThreadId.get(a.id) ?? -1;
    const scoreB = fusion.scoreByThreadId.get(b.id) ?? -1;
    return scoreB - scoreA;
  });
  const top = byScore.slice(0, topMax);
  const topIds = new Set(top.map(thread => thread.id));
  const rest = filteredThreads.filter(thread => !topIds.has(thread.id));

  return {
    threads: [...top, ...rest],
    topCount: top.length,
    semanticOnlyThreadIds: fusion.semanticOnlyThreadIds,
  };
}
