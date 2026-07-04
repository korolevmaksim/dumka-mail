import { describe, expect, it, vi } from 'vitest';
import { runSemanticScan, type SemanticScanRow } from '../main/semanticSearchScan';

// With a [1, 0] query, a [score, sqrt(1 - score^2)] unit row vector scores exactly `score`.
function rowWithScore(id: number, score: number): SemanticScanRow {
  return {
    threadId: `thread-${id}`,
    messageId: `message-${id}`,
    subject: `Subject ${id}`,
    sender: `Sender ${id}`,
    snippet: `Snippet ${id}`,
    receivedAt: '2026-07-01T00:00:00.000Z',
    vector: [score, Math.sqrt(Math.max(0, 1 - score * score))],
  };
}

function pagedProvider(rows: SemanticScanRow[]) {
  return vi.fn((limit: number, offset: number) => rows.slice(offset, offset + limit));
}

const QUERY = [1, 0];

describe('semantic search scan', () => {
  it('filters by score threshold, sorts descending, and rounds scores to 4 decimals', async () => {
    const fetchPage = pagedProvider([
      rowWithScore(1, 0.5),
      rowWithScore(2, 0.9876543),
      rowWithScore(3, 0.1),
      rowWithScore(4, 0.139),
    ]);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 10, fetchPage });

    expect(outcome.aborted).toBe(false);
    expect(outcome.results.map(result => result.messageId)).toEqual(['message-2', 'message-1']);
    expect(outcome.results[0].score).toBe(0.9877);
    expect(outcome.results[0]).toMatchObject({
      threadId: 'thread-2',
      subject: 'Subject 2',
      sender: 'Sender 2',
      snippet: 'Snippet 2',
      receivedAt: '2026-07-01T00:00:00.000Z',
    });
  });

  it('pages through the provider and stops on a short page', async () => {
    const fetchPage = pagedProvider([
      rowWithScore(1, 0.3),
      rowWithScore(2, 0.6),
      rowWithScore(3, 0.9),
    ]);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 2, fetchPage, pageSize: 2 });

    expect(fetchPage).toHaveBeenNthCalledWith(1, 2, 0);
    expect(fetchPage).toHaveBeenNthCalledWith(2, 2, 2);
    expect(fetchPage).toHaveBeenCalledTimes(2);
    expect(outcome.results.map(result => result.messageId)).toEqual(['message-3', 'message-2']);
  });

  it('keeps the global best result across top-K pruning', async () => {
    const scores = [0.99, 0.2, 0.3, 0.4, 0.5, 0.6, 0.61, 0.62];
    const fetchPage = pagedProvider(scores.map((score, index) => rowWithScore(index, score)));

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 1, fetchPage, pageSize: 2 });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].messageId).toBe('message-0');
    expect(outcome.results[0].score).toBe(0.99);
  });

  it('stops fetching once the scan limit is reached', async () => {
    const fetchPage = pagedProvider([0.5, 0.6, 0.7, 0.8, 0.9].map((score, index) => rowWithScore(index, score)));

    await runSemanticScan({ queryVector: QUERY, limit: 10, fetchPage, pageSize: 2, scanLimit: 2 });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(fetchPage).toHaveBeenCalledWith(2, 0);
  });

  it('returns partial results when the time budget is exhausted', async () => {
    const fetchPage = pagedProvider([0.5, 0.6, 0.7].map((score, index) => rowWithScore(index, score)));
    let clockCalls = 0;
    const now = () => (clockCalls++ < 2 ? 0 : 99999);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 10, fetchPage, pageSize: 1, now });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(outcome.aborted).toBe(false);
    expect(outcome.results.map(result => result.messageId)).toEqual(['message-0']);
  });

  it('aborts between pages when a newer request supersedes the scan', async () => {
    const fetchPage = pagedProvider([0.5, 0.6, 0.7].map((score, index) => rowWithScore(index, score)));
    let stale = false;

    const outcome = await runSemanticScan({
      queryVector: QUERY,
      limit: 10,
      fetchPage,
      pageSize: 1,
      isStale: () => stale,
      yieldBetweenPages: async () => {
        stale = true;
      },
    });

    expect(fetchPage).toHaveBeenCalledTimes(1);
    expect(outcome).toEqual({ results: [], aborted: true, scanned: 1 });
  });

  it('aborts without fetching when the request is stale from the start', async () => {
    const fetchPage = pagedProvider([rowWithScore(1, 0.9)]);

    const outcome = await runSemanticScan({
      queryVector: QUERY,
      limit: 10,
      fetchPage,
      isStale: () => true,
    });

    expect(fetchPage).not.toHaveBeenCalled();
    expect(outcome).toEqual({ results: [], aborted: true, scanned: 0 });
  });

  it('scores Float32Array row vectors against a Float32Array query', async () => {
    const rows = [0.25, 0.75].map((score, index) => ({
      ...rowWithScore(index, score),
      vector: Float32Array.from(rowWithScore(index, score).vector as number[]),
    }));
    const fetchPage = pagedProvider(rows);

    const outcome = await runSemanticScan({
      queryVector: Float32Array.from(QUERY),
      limit: 10,
      fetchPage,
    });

    expect(outcome.results.map(result => result.messageId)).toEqual(['message-1', 'message-0']);
    expect(outcome.results[0].score).toBeCloseTo(0.75, 4);
    expect(outcome.results[1].score).toBeCloseTo(0.25, 4);
  });

  it('clamps the requested limit to at least one result', async () => {
    const fetchPage = pagedProvider([rowWithScore(1, 0.9), rowWithScore(2, 0.8)]);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 0, fetchPage });

    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0].messageId).toBe('message-1');
  });

  it('reports how many rows were scanned', async () => {
    const fetchPage = pagedProvider([
      rowWithScore(1, 0.5),
      rowWithScore(2, 0.9),
      rowWithScore(3, 0.05),
    ]);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 10, fetchPage });

    expect(outcome.scanned).toBe(3);
  });

  it('scans past 12000 rows when no scanLimit is given', async () => {
    const rows = Array.from({ length: 12500 }, (_, i) => rowWithScore(i, 0.5));
    const fetchPage = pagedProvider(rows);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 5, fetchPage });

    expect(outcome.scanned).toBe(12500);
    expect(outcome.aborted).toBe(false);
  });

  it('returns partial results with a scanned count when the deadline is hit', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => rowWithScore(i, 0.5));
    const fetchPage = pagedProvider(rows);
    let calls = 0;
    const now = vi.fn(() => {
      calls += 1;
      // First call sets the deadline; second (page-loop check) is already past it.
      return calls === 1 ? 0 : 999999;
    });

    const outcome = await runSemanticScan({
      queryVector: QUERY,
      limit: 5,
      fetchPage,
      now,
      pageSize: 100,
    });

    expect(outcome.aborted).toBe(false);
    expect(outcome.scanned).toBe(0); // deadline before the first page
  });
});
