import { cosineSimilarity } from '../shared/semantic';
import type { SemanticSearchResult } from '../shared/types';

export const EMBEDDING_SEARCH_PAGE_SIZE = 500;
export const EMBEDDING_SEARCH_SCAN_LIMIT = 12000;
export const EMBEDDING_SEARCH_TIME_BUDGET_MS = 1200;
export const EMBEDDING_SEARCH_SCORE_THRESHOLD = 0.14;

export interface SemanticScanRow {
  threadId: string;
  messageId: string;
  subject: string;
  sender: string;
  snippet: string;
  receivedAt: string;
  vector: ArrayLike<number>;
}

export interface SemanticScanOptions {
  queryVector: ArrayLike<number>;
  limit: number;
  fetchPage: (limit: number, offset: number) => SemanticScanRow[];
  isStale?: () => boolean;
  yieldBetweenPages?: () => Promise<void>;
  now?: () => number;
  pageSize?: number;
  scanLimit?: number;
  timeBudgetMs?: number;
}

export interface SemanticScanOutcome {
  results: SemanticSearchResult[];
  aborted: boolean;
}

export async function runSemanticScan(options: SemanticScanOptions): Promise<SemanticScanOutcome> {
  const now = options.now || Date.now;
  const isStale = options.isStale || (() => false);
  const yieldBetweenPages = options.yieldBetweenPages || (() => Promise.resolve());
  const pageSize = options.pageSize ?? EMBEDDING_SEARCH_PAGE_SIZE;
  const scanLimit = options.scanLimit ?? EMBEDDING_SEARCH_SCAN_LIMIT;
  // cosineSimilarity only reads length and numeric indexes, so Float32Array works.
  const queryVector = options.queryVector as unknown as number[];
  const requestedLimit = Math.max(1, Math.min(200, options.limit));
  const scoredRows: Array<{ row: SemanticScanRow; score: number }> = [];
  const deadline = now() + (options.timeBudgetMs ?? EMBEDDING_SEARCH_TIME_BUDGET_MS);

  if (isStale()) return { results: [], aborted: true };

  for (let offset = 0; offset < scanLimit; offset += pageSize) {
    if (now() > deadline) break;
    const rows = options.fetchPage(Math.min(pageSize, scanLimit - offset), offset);
    if (rows.length === 0) break;

    for (const row of rows) {
      const score = cosineSimilarity(queryVector, row.vector as unknown as number[]);
      if (score > EMBEDDING_SEARCH_SCORE_THRESHOLD) scoredRows.push({ row, score });
    }

    if (scoredRows.length > requestedLimit * 4) {
      scoredRows.sort((a, b) => b.score - a.score);
      scoredRows.splice(requestedLimit * 2);
    }

    if (rows.length < pageSize) break;
    await yieldBetweenPages();
    if (isStale()) return { results: [], aborted: true };
  }

  const results = scoredRows
    .sort((a, b) => b.score - a.score)
    .slice(0, requestedLimit)
    .map(item => ({
      threadId: item.row.threadId,
      messageId: item.row.messageId,
      score: Number(item.score.toFixed(4)),
      subject: item.row.subject,
      sender: item.row.sender,
      snippet: item.row.snippet,
      receivedAt: item.row.receivedAt,
    }));

  return { results, aborted: false };
}
