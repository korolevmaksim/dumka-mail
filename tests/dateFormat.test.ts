import { describe, it, expect } from 'vitest';
import { listTimestamp, messageHeaderDate, relativeTime } from '../shared/dateFormat';

// NOTE: ISO strings here intentionally omit a time-zone designator so they are
// parsed as *local* time and formatted back in the *local* time zone, making
// the assertions deterministic regardless of the machine's TZ. Strings with a
// trailing "Z" would shift by the local UTC offset.

describe('listTimestamp', () => {
  it('formats "MMM d, HH:mm" with a 24h zero-padded time', () => {
    expect(listTimestamp('2026-06-26T14:30:00')).toBe('Jun 26, 14:30');
  });

  it('zero-pads single-digit hours and minutes', () => {
    expect(listTimestamp('2026-01-05T09:05:00')).toBe('Jan 5, 09:05');
  });

  it('renders midnight as 00:00 (not 24:00)', () => {
    expect(listTimestamp('2026-12-31T00:00:00')).toBe('Dec 31, 00:00');
  });

  it('renders noon and afternoon hours in 24h form', () => {
    expect(listTimestamp('2026-03-09T23:59:00')).toBe('Mar 9, 23:59');
  });

  it('ignores the optional `now` argument', () => {
    const a = listTimestamp('2026-06-26T14:30:00');
    const b = listTimestamp('2026-06-26T14:30:00', new Date('2020-01-01T00:00:00'));
    expect(a).toBe(b);
  });

  it('returns empty string for an unparseable input', () => {
    expect(listTimestamp('not-a-date')).toBe('');
  });
});

describe('messageHeaderDate', () => {
  it('formats medium date + short time joined by " at "', () => {
    expect(messageHeaderDate('2026-06-26T15:42:00')).toBe('Jun 26, 2026 at 3:42 PM');
  });

  it('renders AM times', () => {
    expect(messageHeaderDate('2026-06-26T09:05:00')).toBe('Jun 26, 2026 at 9:05 AM');
  });

  it('renders midnight as 12:00 AM', () => {
    expect(messageHeaderDate('2026-06-26T00:00:00')).toBe('Jun 26, 2026 at 12:00 AM');
  });

  it('renders noon as 12:00 PM', () => {
    expect(messageHeaderDate('2026-06-26T12:00:00')).toBe('Jun 26, 2026 at 12:00 PM');
  });

  it('returns empty string for an unparseable input', () => {
    expect(messageHeaderDate('garbage')).toBe('');
  });
});

describe('relativeTime', () => {
  const now = new Date('2026-06-26T12:00:00');

  it('returns "just now" for sub-minute deltas', () => {
    expect(relativeTime(new Date(now.getTime() - 30 * 1000).toISOString(), now)).toBe('just now');
  });

  it('returns "just now" exactly at 0 seconds', () => {
    expect(relativeTime(now.toISOString(), now)).toBe('just now');
  });

  it('returns minutes for sub-hour deltas', () => {
    expect(relativeTime(new Date(now.getTime() - 5 * 60_000).toISOString(), now)).toBe('5m ago');
  });

  it('returns "1m ago" exactly at 60 seconds', () => {
    expect(relativeTime(new Date(now.getTime() - 60_000).toISOString(), now)).toBe('1m ago');
  });

  it('returns hours for sub-day deltas', () => {
    expect(relativeTime(new Date(now.getTime() - 2 * 60 * 60_000).toISOString(), now)).toBe('2h ago');
  });

  it('returns days for sub-week deltas', () => {
    expect(relativeTime(new Date(now.getTime() - 3 * 24 * 60 * 60_000).toISOString(), now)).toBe('3d ago');
  });

  it('returns "6d ago" at the upper edge of the week window', () => {
    expect(relativeTime(new Date(now.getTime() - 6 * 24 * 60 * 60_000).toISOString(), now)).toBe('6d ago');
  });

  it('falls back to an absolute short date once older than a week', () => {
    const old = relativeTime(new Date(now.getTime() - 30 * 24 * 60 * 60_000).toISOString(), now);
    expect(old).not.toMatch(/ago/);
    expect(old).toMatch(/\d{4}/);
  });

  it('treats future timestamps as "just now"', () => {
    expect(relativeTime(new Date(now.getTime() + 5 * 60_000).toISOString(), now)).toBe('just now');
  });

  it('returns empty string for an unparseable input', () => {
    expect(relativeTime('nope', now)).toBe('');
  });
});
