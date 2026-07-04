import { describe, expect, it, vi } from 'vitest';
import {
  collectFtsMatches,
  collectSemanticMatchesWithTimeout,
  SEMANTIC_SEARCH_MIN_QUERY_LENGTH,
  shouldRunSemanticSearch,
  waitUnlessCancelled,
} from '../renderer/src/stores/mailSearchHelpers';

describe('mail search helpers', () => {
  it('collects local FTS matches without waiting for semantic search', async () => {
    const searchFTS = vi.fn(async () => [{ threadId: 'thread-1', messageId: 'msg-1' }]);

    const matches = await collectFtsMatches(['me@example.com'], 'contract', searchFTS);

    expect(matches).toEqual([{ threadId: 'thread-1', messageId: 'msg-1' }]);
    expect(searchFTS).toHaveBeenCalledWith('me@example.com', 'contract');
  });

  it('returns no semantic matches when semantic search misses its UI budget', async () => {
    vi.useFakeTimers();
    const searchSemantic = vi.fn(() => new Promise<never>(() => {}));

    const pending = collectSemanticMatchesWithTimeout(
      ['me@example.com'],
      'contract',
      searchSemantic,
      25
    );

    await vi.advanceTimersByTimeAsync(26);

    await expect(pending).resolves.toEqual([]);
    expect(searchSemantic).toHaveBeenCalledWith('me@example.com', 'contract', 80);
    vi.useRealTimers();
  });

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
