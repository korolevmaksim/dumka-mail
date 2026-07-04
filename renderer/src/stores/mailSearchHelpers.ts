import type { SemanticSearchResult } from '../../../shared/types';

export interface ThreadSearchMatch {
  threadId: string;
  messageId: string;
}

type SearchFTS = (accountId: string, query: string) => Promise<ThreadSearchMatch[]>;
type SearchSemantic = (accountId: string, query: string, limit?: number) => Promise<SemanticSearchResult[]>;

const DEFAULT_SEMANTIC_UI_BUDGET_MS = 1200;

export const SEMANTIC_SEARCH_MIN_QUERY_LENGTH = 3;
export const SEMANTIC_SEARCH_SETTLE_DELAY_MS = 450;

function timeoutAfter<T>(ms: number, fallback: T): Promise<T> {
  return new Promise(resolve => {
    globalThis.setTimeout(() => resolve(fallback), Math.max(1, ms));
  });
}

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

export async function collectFtsMatches(
  accountIds: string[],
  textQuery: string,
  searchFTS: SearchFTS,
): Promise<ThreadSearchMatch[]> {
  const batches = await Promise.all(accountIds.map(accountId => searchFTS(accountId, textQuery)));
  return batches.flat();
}

export async function collectSemanticMatchesWithTimeout(
  accountIds: string[],
  textQuery: string,
  searchSemantic: SearchSemantic,
  timeoutMs = DEFAULT_SEMANTIC_UI_BUDGET_MS,
): Promise<ThreadSearchMatch[]> {
  const semanticMatches = Promise.all(
    accountIds.map(accountId => searchSemantic(accountId, textQuery, 80))
  )
    .then(batches => batches.flat().map(match => ({
      threadId: match.threadId,
      messageId: match.messageId,
    })))
    .catch(() => []);

  return Promise.race([
    semanticMatches,
    timeoutAfter<ThreadSearchMatch[]>(timeoutMs, []),
  ]);
}
