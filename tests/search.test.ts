import { describe, it, expect } from 'vitest';
import { parseSearchQuery } from '../shared/search';

describe('Search Query Parser', () => {
  it('parses basic query terms', () => {
    const query = 'hello world';
    const parsed = parseSearchQuery(query);
    expect(parsed.textTerms).toEqual(['hello', 'world']);
  });

  it('parses from: and domain: operators', () => {
    const query = 'meeting from:john domain:google.com';
    const parsed = parseSearchQuery(query);
    expect(parsed.textTerms).toEqual(['meeting']);
    expect(parsed.from).toBe('john');
    expect(parsed.domain).toBe('google.com');
  });

  it('parses is: and has: operators', () => {
    const query = 'invoice is:unread has:attachment';
    const parsed = parseSearchQuery(query);
    expect(parsed.textTerms).toEqual(['invoice']);
    expect(parsed.isUnread).toBe(true);
    expect(parsed.hasAttachment).toBe(true);
  });

  it('parses before: and after: date constraints', () => {
    const query = 'project after:2026-01-01 before:2026-06-30';
    const parsed = parseSearchQuery(query);
    expect(parsed.textTerms).toEqual(['project']);
    expect(parsed.after).toBe('2026-01-01');
    expect(parsed.before).toBe('2026-06-30');
  });

  it('handles space between operator and value (from: apple.com)', () => {
    const parsed = parseSearchQuery('from: apple.com');
    expect(parsed.from).toBe('apple.com');
    expect(parsed.textTerms).toEqual([]);
  });

  it('handles space between operator and value for domain:', () => {
    const parsed = parseSearchQuery('domain: google.com');
    expect(parsed.domain).toBe('google.com');
    expect(parsed.textTerms).toEqual([]);
  });

  it('handles mixed spaced and non-spaced operators', () => {
    const parsed = parseSearchQuery('from: john@test.com is:unread hello');
    expect(parsed.from).toBe('john@test.com');
    expect(parsed.isUnread).toBe(true);
    expect(parsed.textTerms).toEqual(['hello']);
  });

  it('handles consecutive spaced operators', () => {
    const parsed = parseSearchQuery('from: alice domain: example.com');
    expect(parsed.from).toBe('alice');
    expect(parsed.domain).toBe('example.com');
    expect(parsed.textTerms).toEqual([]);
  });

  it('skips bare operator with no value at end of query', () => {
    const parsed = parseSearchQuery('hello from:');
    expect(parsed.from).toBeUndefined();
    expect(parsed.textTerms).toEqual(['hello']);
  });

  it('skips bare spaced operator followed by another operator', () => {
    const parsed = parseSearchQuery('from: is:unread');
    expect(parsed.from).toBeUndefined();
    expect(parsed.isUnread).toBe(true);
  });
});
