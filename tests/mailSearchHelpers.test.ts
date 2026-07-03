import { describe, expect, it, vi } from 'vitest';
import {
  collectFtsMatches,
  collectSemanticMatchesWithTimeout,
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
    const searchSemantic = vi.fn(() => new Promise<any[]>(() => {}));

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
});
