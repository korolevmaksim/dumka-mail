import { describe, expect, it } from 'vitest';
import { calendarSearchMatchQuery } from '../shared/calendarSearch';

describe('calendar local search query', () => {
  it('builds a bounded prefix query for normal text', () => {
    expect(calendarSearchMatchQuery('Product roadmap Ada@example.com')).toBe('"product"* AND "roadmap"* AND "ada@example.com"*');
  });

  it('normalizes punctuation-only and long queries safely', () => {
    expect(calendarSearchMatchQuery('()[]{}')).toBeNull();
    expect(calendarSearchMatchQuery('one two three four five six seven eight nine')).toBe('"one"* AND "two"* AND "three"* AND "four"* AND "five"* AND "six"* AND "seven"* AND "eight"*');
  });
});
