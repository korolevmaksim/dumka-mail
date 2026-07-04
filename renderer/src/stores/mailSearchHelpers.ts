import type { SemanticSearchCoverage, SemanticSearchOutcome } from '../../../shared/types';
import type { RankedSourceList } from '../../../shared/searchRanking';

export interface ThreadSearchMatch {
  threadId: string;
  messageId: string;
}

type SearchFTS = (accountId: string, query: string) => Promise<ThreadSearchMatch[]>;
type SearchSemantic = (accountId: string, query: string, limit?: number) => Promise<SemanticSearchOutcome>;

const SEMANTIC_RESULT_LIMIT = 80;

export const SEMANTIC_SEARCH_MIN_QUERY_LENGTH = 3;
export const SEMANTIC_SEARCH_SETTLE_DELAY_MS = 450;

export function shouldRunSemanticSearch(textQuery: string): boolean {
  return textQuery.trim().length >= SEMANTIC_SEARCH_MIN_QUERY_LENGTH;
}

export async function waitUnlessCancelled(ms: number, isCancelled: () => boolean): Promise<boolean> {
  if (isCancelled()) return false;
  await new Promise<void>(resolve => {
    globalThis.setTimeout(resolve, Math.max(0, ms));
  });
  return !isCancelled();
}

export async function collectFtsMatchLists(
  accountIds: string[],
  textQuery: string,
  searchFTS: SearchFTS,
): Promise<RankedSourceList[]> {
  const batches = await Promise.all(accountIds.map(async accountId => ({
    accountId,
    source: 'fts' as const,
    entries: await searchFTS(accountId, textQuery),
  })));
  return batches.filter(list => list.entries.length > 0);
}

export interface SemanticCollectResult {
  lists: RankedSourceList[];
  state: 'ok' | 'off' | 'error';
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}

export async function collectSemanticOutcomes(
  accountIds: string[],
  textQuery: string,
  searchSemantic: SearchSemantic,
): Promise<SemanticCollectResult> {
  const outcomes = await Promise.all(accountIds.map(async accountId => {
    try {
      return { accountId, outcome: await searchSemantic(accountId, textQuery, SEMANTIC_RESULT_LIMIT) };
    } catch (error) {
      const outcome: SemanticSearchOutcome = {
        status: 'error',
        results: [],
        coverage: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      return { accountId, outcome };
    }
  }));

  const lists: RankedSourceList[] = [];
  let coverage: SemanticSearchCoverage | null = null;
  let sawOk = false;
  let errorMessage: string | undefined;

  for (const { accountId, outcome } of outcomes) {
    if (outcome.status === 'ok') {
      sawOk = true;
      if (outcome.results.length > 0) {
        lists.push({
          accountId,
          source: 'semantic',
          entries: outcome.results.map(result => ({
            threadId: result.threadId,
            messageId: result.messageId,
            score: result.score,
          })),
        });
      }
      if (outcome.coverage) {
        coverage = coverage
          ? {
              scanned: coverage.scanned + outcome.coverage.scanned,
              totalIndexed: coverage.totalIndexed + outcome.coverage.totalIndexed,
            }
          : outcome.coverage;
      }
    } else if (outcome.status === 'error' && errorMessage === undefined) {
      errorMessage = outcome.errorMessage || 'Semantic search failed';
    }
  }

  // Worst state wins for the indicator; superseded/disabled stay silent.
  const state: SemanticCollectResult['state'] =
    errorMessage !== undefined ? 'error' : sawOk ? 'ok' : 'off';

  return { lists, state, coverage, errorMessage };
}

export function flattenMatchLists(lists: RankedSourceList[]): ThreadSearchMatch[] {
  return lists.flatMap(list => list.entries.map(entry => ({
    threadId: entry.threadId,
    messageId: entry.messageId,
  })));
}
