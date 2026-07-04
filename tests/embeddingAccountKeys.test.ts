import { describe, expect, it } from 'vitest';
import {
  normalizeAccountKey,
  pruneAccountKeyVariants,
  resolveAccountEntry,
} from '../renderer/src/components/settings/embeddingAccountKeys';

describe('normalizeAccountKey', () => {
  it('trims whitespace and lowercases', () => {
    expect(normalizeAccountKey('  Test@Example.com ')).toBe('test@example.com');
    expect(normalizeAccountKey('test@example.com')).toBe('test@example.com');
  });
});

describe('resolveAccountEntry', () => {
  it('returns the entry stored under the exact normalized key', () => {
    const map = {
      'test@example.com': { provider: 'gemini' },
      'other@example.com': { provider: 'openAI' },
    };
    expect(resolveAccountEntry(map, 'test@example.com')).toEqual({ provider: 'gemini' });
  });

  it('prefers the exact normalized key over an earlier variant key', () => {
    // Insertion order puts the variant first; the exact key must still win.
    const map = {
      'Test@Example.com ': 'variant-value',
      'test@example.com': 'canonical-value',
    };
    expect(resolveAccountEntry(map, 'test@example.com')).toBe('canonical-value');
  });

  it('falls back to a mixed-case variant key', () => {
    const map = { 'Test@Example.com': { provider: 'gemini', dimensions: 768 } };
    expect(resolveAccountEntry(map, 'test@example.com')).toEqual({ provider: 'gemini', dimensions: 768 });
  });

  it('falls back to a variant key with surrounding whitespace', () => {
    const map = { ' test@example.com ': true };
    expect(resolveAccountEntry(map, 'test@example.com')).toBe(true);
  });

  it('returns undefined when no key matches', () => {
    const map = { 'other@example.com': true };
    expect(resolveAccountEntry(map, 'test@example.com')).toBeUndefined();
  });

  it('returns undefined for an undefined map', () => {
    expect(resolveAccountEntry(undefined, 'test@example.com')).toBeUndefined();
  });

  it('returns undefined for an empty account key', () => {
    expect(resolveAccountEntry({ '': true, 'test@example.com': true }, '')).toBeUndefined();
  });

  it('resolves a stored false value instead of treating it as missing', () => {
    const map: Record<string, boolean> = { 'test@example.com': false };
    expect(resolveAccountEntry(map, 'test@example.com')).toBe(false);

    const variantMap: Record<string, boolean> = { 'Test@Example.com ': false };
    expect(resolveAccountEntry(variantMap, 'test@example.com')).toBe(false);
  });
});

describe('pruneAccountKeyVariants', () => {
  it('removes all variants of the normalized key while keeping the canonical entry', () => {
    const map: Record<string, string> = {
      'Test@Example.com': 'variant-a',
      ' test@example.com ': 'variant-b',
      'TEST@EXAMPLE.COM': 'variant-c',
      'test@example.com': 'canonical',
      'other@example.com': 'other-account',
    };

    pruneAccountKeyVariants(map, 'test@example.com');

    expect(map).toEqual({
      'test@example.com': 'canonical',
      'other@example.com': 'other-account',
    });
  });

  it('leaves keys of different accounts untouched, including their variants', () => {
    const map: Record<string, boolean> = {
      'Test@Example.com': true,
      'Other@Example.com': true,
      ' other@example.com ': false,
    };

    pruneAccountKeyVariants(map, 'test@example.com');

    expect(map).toEqual({
      'Other@Example.com': true,
      ' other@example.com ': false,
    });
  });

  it('is a no-op when no variants exist', () => {
    const map: Record<string, string> = {
      'test@example.com': 'canonical',
      'other@example.com': 'other-account',
    };

    pruneAccountKeyVariants(map, 'test@example.com');

    expect(map).toEqual({
      'test@example.com': 'canonical',
      'other@example.com': 'other-account',
    });
  });

  it('is a no-op on an empty map', () => {
    const map: Record<string, string> = {};
    pruneAccountKeyVariants(map, 'test@example.com');
    expect(map).toEqual({});
  });

  it('never deletes the canonical key itself, even when it is the only entry', () => {
    const map: Record<string, number> = { 'test@example.com': 42 };
    pruneAccountKeyVariants(map, 'test@example.com');
    expect(map).toEqual({ 'test@example.com': 42 });
  });
});
