import { describe, expect, it } from 'vitest';
import {
  buildMiniCalendarMonth,
  calendarEventOverlapsDay,
  calendarEventsForDay,
  countCalendarEventsByDay,
  localDateKey,
  sameLocalDay,
  visibleMiniCalendarRange,
} from '../shared/calendarMini';
import type { CalendarEvent } from '../shared/types';

function event(id: string, startAt: Date): CalendarEvent {
  return {
    id,
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: id,
    startAt: startAt.toISOString(),
    endAt: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
    isAllDay: false,
    status: null,
    attendees: [],
    updatedAt: startAt.toISOString(),
  };
}

function eventRange(id: string, startAt: Date, endAt: Date, isAllDay = false): CalendarEvent {
  return {
    ...event(id, startAt),
    endAt: endAt.toISOString(),
    isAllDay,
  };
}

describe('mini calendar helpers', () => {
  it('builds a six-week Monday-first month grid with selected and today flags', () => {
    const visibleMonth = new Date(2026, 6, 1);
    const selectedDate = new Date(2026, 6, 15);
    const today = new Date(2026, 6, 2);
    const weeks = buildMiniCalendarMonth(visibleMonth, selectedDate, today);

    expect(weeks).toHaveLength(6);
    expect(weeks.every(week => week.length === 7)).toBe(true);
    expect(localDateKey(weeks[0][0].date)).toBe('2026-06-29');
    expect(weeks.flat().find(day => day.key === '2026-07-15')?.isSelected).toBe(true);
    expect(weeks.flat().find(day => day.key === '2026-07-02')?.isToday).toBe(true);
  });

  it('returns the exact visible grid range for syncing events', () => {
    const range = visibleMiniCalendarRange(new Date(2026, 6, 1));

    expect(localDateKey(new Date(range.startAt))).toBe('2026-06-29');
    expect(localDateKey(new Date(range.endAt))).toBe('2026-08-10');
  });

  it('counts events by local start day', () => {
    const counts = countCalendarEventsByDay([
      event('a', new Date(2026, 6, 1, 9)),
      event('b', new Date(2026, 6, 1, 12)),
      event('c', new Date(2026, 6, 2, 9)),
    ]);

    expect(counts['2026-07-01']).toBe(2);
    expect(counts['2026-07-02']).toBe(1);
  });

  it('counts multi-day events on every overlapped local day', () => {
    const counts = countCalendarEventsByDay([
      eventRange('overnight', new Date(2026, 6, 1, 22), new Date(2026, 6, 2, 1)),
      eventRange('all-day', new Date(2026, 6, 3, 0), new Date(2026, 6, 5, 0), true),
    ]);

    expect(counts['2026-07-01']).toBe(1);
    expect(counts['2026-07-02']).toBe(1);
    expect(counts['2026-07-03']).toBe(1);
    expect(counts['2026-07-04']).toBe(1);
    expect(counts['2026-07-05']).toBeUndefined();
  });

  it('returns agenda events that overlap the selected local day', () => {
    const overnight = eventRange('overnight', new Date(2026, 6, 1, 22), new Date(2026, 6, 2, 1));
    const later = event('later', new Date(2026, 6, 2, 9));

    expect(calendarEventOverlapsDay(overnight, new Date(2026, 6, 2, 12))).toBe(true);
    expect(calendarEventsForDay([later, overnight], new Date(2026, 6, 2, 12)).map(item => item.id)).toEqual(['overnight', 'later']);
  });

  it('compares local calendar days without depending on exact time', () => {
    expect(sameLocalDay(new Date(2026, 6, 1, 0), new Date(2026, 6, 1, 23))).toBe(true);
    expect(sameLocalDay(new Date(2026, 6, 1, 23), new Date(2026, 6, 2, 0))).toBe(false);
  });
});
