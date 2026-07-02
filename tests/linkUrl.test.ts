import { describe, expect, it } from 'vitest';
import { normalizeLinkUrl } from '../renderer/src/lib/linkUrl';

describe('normalizeLinkUrl', () => {
  it('accepts http, https, and mailto links', () => {
    expect(normalizeLinkUrl('https://example.com/path')).toBe('https://example.com/path');
    expect(normalizeLinkUrl('http://example.com')).toBe('http://example.com/');
    expect(normalizeLinkUrl('mailto:user@example.com')).toBe('mailto:user@example.com');
  });

  it('defaults bare domains to https', () => {
    expect(normalizeLinkUrl('example.com/docs')).toBe('https://example.com/docs');
  });

  it('rejects empty, malformed, and unsafe protocol values', () => {
    expect(normalizeLinkUrl('')).toBeNull();
    expect(normalizeLinkUrl('not a url')).toBeNull();
    expect(normalizeLinkUrl('javascript:alert(1)')).toBeNull();
  });
});
