import { describe, it, expect } from 'vitest';
import {
  formatDateTime,
  formatDay,
  formatDuration,
  formatEventWhen,
  formatFullDateTime,
  formatTime,
  formatTimeRange,
  formatWeekdayDay,
  listTimestamp,
  listTimestampCompact,
  messageHeaderDate,
  relativeTime,
} from '../shared/dateFormat';

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
  it('renders the date and a 24-hour time', () => {
    expect(messageHeaderDate('2026-06-26T15:42:00')).toBe('Jun 26, 2026, 15:42');
    expect(messageHeaderDate('2026-06-26T09:05:00')).toBe('Jun 26, 2026, 09:05');
  });

  it('renders midnight as 00:00 and noon as 12:00', () => {
    expect(messageHeaderDate('2026-06-26T00:00:00')).toBe('Jun 26, 2026, 00:00');
    expect(messageHeaderDate('2026-06-26T12:00:00')).toBe('Jun 26, 2026, 12:00');
  });

  it('returns empty string for an invalid date', () => {
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

describe('the app-wide date and time vocabulary', () => {
  const now = new Date('2026-11-12T10:00:00');

  it('is always 24-hour', () => {
    expect(formatTime('2026-11-12T14:05:00')).toBe('14:05');
    expect(formatTime('2026-11-12T00:00:00')).toBe('00:00');
    expect(formatTime(new Date('2026-11-12T03:14:00'))).toBe('03:14');
  });

  it('adds the year only when it is not the current one', () => {
    expect(formatDay('2026-11-12T14:05:00', now)).toBe('Nov 12');
    expect(formatDay('2025-11-12T14:05:00', now)).toBe('Nov 12, 2025');
    expect(formatDateTime('2026-11-12T14:05:00', now)).toBe('Nov 12, 14:05');
    expect(formatWeekdayDay('2026-11-12T14:05:00', now)).toBe('Thu, Nov 12');
    expect(formatFullDateTime('2026-11-12T14:05:00')).toBe('Thu, Nov 12, 2026, 14:05');
  });

  it('writes a range once per day and in full across midnight', () => {
    expect(formatTimeRange('2026-11-12T14:00:00', '2026-11-12T14:45:00', now)).toBe('14:00–14:45');
    expect(formatTimeRange('2026-11-12T22:00:00', '2026-11-13T01:00:00', now)).toBe('Nov 12, 22:00 – Nov 13, 01:00');
    expect(formatEventWhen('2026-11-12T14:00:00', '2026-11-12T14:45:00', now)).toBe('Thu, Nov 12, 14:00–14:45');
  });

  it('names durations', () => {
    expect(formatDuration(15)).toBe('15 min');
    expect(formatDuration(60)).toBe('1 h');
    expect(formatDuration(90)).toBe('1 h 30 min');
  });

  it('returns an empty string for an invalid date', () => {
    expect(formatTime('garbage')).toBe('');
    expect(formatDateTime('garbage')).toBe('');
    expect(formatTimeRange('garbage', 'garbage')).toBe('');
  });
});

describe('listTimestampCompact', () => {
  const now = new Date('2026-11-13T10:00:00');

  it('is the time alone for today', () => {
    expect(listTimestampCompact('2026-11-13T09:07:00', now)).toBe('09:07');
  });

  it('is the day alone for another day this year, and adds the year otherwise', () => {
    expect(listTimestampCompact('2026-11-12T23:40:00', now)).toBe('Nov 12');
    expect(listTimestampCompact('2025-11-12T23:40:00', now)).toBe('Nov 12, 2025');
  });

  it('returns an empty string for an invalid input', () => {
    expect(listTimestampCompact('not-a-date', now)).toBe('');
  });
});
