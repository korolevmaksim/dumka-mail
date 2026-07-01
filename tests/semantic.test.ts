import { describe, expect, it } from 'vitest';
import { cosineSimilarity, normalizeEmbeddingText, stableTextHash } from '../shared/semantic';

describe('semantic vector helpers', () => {
  it('computes cosine similarity for same-size vectors', () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it('normalizes text and hashes deterministically', () => {
    const normalized = normalizeEmbeddingText('  design   contractor\ncontract  ');
    expect(normalized).toBe('design contractor contract');
    expect(stableTextHash(normalized)).toBe(stableTextHash(normalized));
    expect(stableTextHash(normalized)).not.toBe(stableTextHash(`${normalized}!`));
  });
});
