import { describe, expect, it } from 'vitest';
import { DEFAULT_LIST_WIDTH, LIST_MIN_WIDTH, READING_MIN_WIDTH, clampListWidth, resolveListWidth } from '../shared/listLayout';

describe('mailbox list width', () => {
  it('keeps a dragged width between the list minimum and what leaves room to read', () => {
    expect(clampListWidth(500, 1400)).toBe(500);
    expect(clampListWidth(100, 1400)).toBe(LIST_MIN_WIDTH);
    expect(clampListWidth(5000, 1400)).toBe(1400 - READING_MIN_WIDTH);
    expect(clampListWidth(Number.NaN, 1400)).toBe(LIST_MIN_WIDTH);
  });

  it('never goes below the list minimum, even in a very small window', () => {
    expect(clampListWidth(500, 600)).toBe(LIST_MIN_WIDTH);
  });

  it('uses the remembered width, kept in range for the current window', () => {
    expect(resolveListWidth(520, 'home', 1400)).toBe('520px');
    expect(resolveListWidth(900, 'reading', 1000)).toBe(`${1000 - READING_MIN_WIDTH}px`);
  });

  it('falls back to the default until the divider has been moved', () => {
    expect(resolveListWidth(undefined, 'home', 1400)).toBe(DEFAULT_LIST_WIDTH.home);
    expect(resolveListWidth(null, 'reading', 1400)).toBe(DEFAULT_LIST_WIDTH.reading);
    expect(resolveListWidth(0, 'reading', 1400)).toBe(DEFAULT_LIST_WIDTH.reading);
    expect(resolveListWidth('500', 'home', 1400)).toBe(DEFAULT_LIST_WIDTH.home);
  });
});
