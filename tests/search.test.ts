import { describe, it, expect } from 'vitest';
import { buildFtsMatchQuery, matchesSearchDateRange, parseSearchQuery, searchDateBoundaryMs, searchTextQuery } from '../shared/search';

describe('Search Query Parser', () => {
  it('keeps adjacent plain text terms as a phrase', () => {
    const query = 'hello world';
    const parsed = parseSearchQuery(query);
    expect(parsed.textTerms).toEqual(['hello world']);
    expect(searchTextQuery(parsed)).toBe('hello world');
  });

  it('keeps text separated by operators as separate phrase fragments', () => {
    const parsed = parseSearchQuery('alpha from:team@example.com beta gamma');
    expect(parsed.from).toBe('team@example.com');
    expect(parsed.textTerms).toEqual(['alpha', 'beta gamma']);
    expect(searchTextQuery(parsed)).toBe('alpha beta gamma');
  });

  it('parses quoted phrase values', () => {
    const parsed = parseSearchQuery('"Google workspace" from:"Maksim Korolyov"');
    expect(parsed.textTerms).toEqual(['Google workspace']);
    expect(parsed.from).toBe('maksim korolyov');
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

  it('parses in: split or mailbox constraints', () => {
    const parsed = parseSearchQuery('receipt in:purchases');
    expect(parsed.textTerms).toEqual(['receipt']);
    expect(parsed.inSplit).toBe('purchases');
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

  it('handles label: with and without a space before the value', () => {
    expect(parseSearchQuery('label:forums').label).toBe('FORUMS');
    expect(parseSearchQuery('label: Jira').label).toBe('JIRA');
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

  it('builds inclusive date-only boundaries for after: and before:', () => {
    expect(searchDateBoundaryMs('2026-01-01', 'start')).toBe(new Date(2026, 0, 1, 0, 0, 0, 0).getTime());
    expect(searchDateBoundaryMs('2026-01-01', 'end')).toBe(new Date(2026, 0, 1, 23, 59, 59, 999).getTime());
    expect(searchDateBoundaryMs('not-a-date', 'start')).toBeNull();
  });

  it('matches message dates against after:/before: ranges', () => {
    expect(matchesSearchDateRange(new Date(2026, 2, 15, 12, 0, 0, 0).toISOString(), '2026-03-15', '2026-03-15')).toBe(true);
    expect(matchesSearchDateRange(new Date(2026, 2, 14, 23, 59, 59, 999).toISOString(), '2026-03-15', undefined)).toBe(false);
    expect(matchesSearchDateRange(new Date(2026, 2, 16, 0, 0, 0, 0).toISOString(), undefined, '2026-03-15')).toBe(false);
  });

  it('builds quoted FTS phrase queries for text search', () => {
    expect(buildFtsMatchQuery(['Google workspace'])).toBe('"Google workspace"');
    expect(buildFtsMatchQuery(['alpha', 'beta gamma'])).toBe('"alpha" "beta gamma"');
    expect(buildFtsMatchQuery(['quoted "phrase"'])).toBe('"quoted ""phrase"""');
  });
});
