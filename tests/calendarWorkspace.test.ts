import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarListEntry } from '../shared/types';
import { calendarDuplicateInput } from '../renderer/src/calendar/calendarWorkspaceUtils';
import {
  calendarDateKey,
  calendarEventOverlapsDay,
  calendarEventsForDate,
  calendarMonthDays,
  calendarNavigationDate,
  calendarViewRange,
  filterCalendarEvents,
  layoutTimedCalendarEvents,
  layoutCalendarAllDayLanes,
  moveCalendarEventToDate,
  parseCalendarQuickAdd,
  startOfCalendarWeek,
} from '../shared/calendarWorkspace';

function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: partial.id || 'event-1',
    accountId: partial.accountId || 'me@example.com',
    calendarId: partial.calendarId || 'primary',
    summary: partial.summary || 'Planning',
    startAt: partial.startAt || new Date(2026, 6, 15, 10).toISOString(),
    endAt: partial.endAt || new Date(2026, 6, 15, 11).toISOString(),
    isAllDay: partial.isAllDay || false,
    startDate: partial.startDate,
    endDate: partial.endDate,
    status: partial.status || 'confirmed',
    attendees: partial.attendees || [],
    updatedAt: partial.updatedAt || '2026-07-01T00:00:00.000Z',
    ...partial,
  };
}

const calendar: CalendarListEntry = {
  id: 'primary', accountId: 'me@example.com', summary: 'Work', primary: true, selected: true,
  accessRole: 'owner', backgroundColor: '#3367d6', foregroundColor: '#ffffff', updatedAt: '2026-07-01T00:00:00.000Z',
};

describe('calendar workspace date math', () => {
  it('creates a stable 42-cell month grid with Monday week starts', () => {
    const days = calendarMonthDays(new Date(2026, 6, 15), 1);
    expect(days).toHaveLength(42);
    expect(calendarDateKey(days[0].date)).toBe('2026-06-29');
    expect(calendarDateKey(days[41].date)).toBe('2026-08-09');
  });

  it('builds deterministic ranges for every workspace view', () => {
    const anchor = new Date(2026, 6, 15, 12);
    expect(new Date(calendarViewRange(anchor, 'day').endAt).getTime() - new Date(calendarViewRange(anchor, 'day').startAt).getTime()).toBe(86_400_000);
    expect(new Date(calendarViewRange(anchor, 'week', 1).startAt).getDay()).toBe(1);
    expect(new Date(calendarViewRange(anchor, 'quarter').startAt).getMonth()).toBe(6);
    expect(new Date(calendarViewRange(anchor, 'year').endAt).getFullYear()).toBe(2027);
  });

  it('honors Sunday and Monday week starts', () => {
    const wednesday = new Date(2026, 6, 15);
    expect(startOfCalendarWeek(wednesday, 0).getDay()).toBe(0);
    expect(startOfCalendarWeek(wednesday, 1).getDay()).toBe(1);
  });

  it('navigates at the granularity of the active view', () => {
    const anchor = new Date(2026, 6, 15);
    expect(calendarNavigationDate(anchor, 'day', 1).getDate()).toBe(16);
    expect(calendarNavigationDate(anchor, 'month', 1).getMonth()).toBe(7);
    expect(calendarNavigationDate(anchor, 'quarter', -1).getMonth()).toBe(3);
    expect(calendarNavigationDate(anchor, 'year', 1).getFullYear()).toBe(2027);
  });
});

describe('calendar workspace event layout', () => {
  it('keeps all-day exclusive end dates on the correct days', () => {
    const allDay = event({ isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-17', startAt: '2026-07-15T00:00:00.000Z', endAt: '2026-07-17T00:00:00.000Z' });
    expect(calendarEventOverlapsDay(allDay, new Date(2026, 6, 15))).toBe(true);
    expect(calendarEventOverlapsDay(allDay, new Date(2026, 6, 16))).toBe(true);
    expect(calendarEventOverlapsDay(allDay, new Date(2026, 6, 17))).toBe(false);
  });

  it('sorts all-day events before timed events and hides cancelled events', () => {
    const items = calendarEventsForDate([
      event({ id: 'timed' }),
      event({ id: 'cancelled', status: 'cancelled' }),
      event({ id: 'all-day', isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-16' }),
    ], new Date(2026, 6, 15));
    expect(items.map(item => item.id)).toEqual(['all-day', 'timed']);
  });

  it('assigns deterministic columns to overlapping timed events', () => {
    const positioned = layoutTimedCalendarEvents([
      event({ id: 'a', startAt: new Date(2026, 6, 15, 9).toISOString(), endAt: new Date(2026, 6, 15, 11).toISOString() }),
      event({ id: 'b', startAt: new Date(2026, 6, 15, 9, 30).toISOString(), endAt: new Date(2026, 6, 15, 10, 30).toISOString() }),
      event({ id: 'c', startAt: new Date(2026, 6, 15, 12).toISOString(), endAt: new Date(2026, 6, 15, 13).toISOString() }),
    ], new Date(2026, 6, 15));
    expect(positioned.find(item => item.event.id === 'a')).toMatchObject({ column: 0, columnCount: 2 });
    expect(positioned.find(item => item.event.id === 'b')).toMatchObject({ column: 1, columnCount: 2 });
    expect(positioned.find(item => item.event.id === 'c')).toMatchObject({ column: 0, columnCount: 1 });
  });

  it('packs all-day and multi-day spans into stable non-overlapping lanes', () => {
    const days = Array.from({ length: 7 }, (_, index) => new Date(2026, 6, 13 + index));
    const spans = layoutCalendarAllDayLanes([
      event({ id: 'week', isAllDay: true, startDate: '2026-07-13', endDate: '2026-07-18' }),
      event({ id: 'mid', isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-17' }),
      event({ id: 'single', isAllDay: true, startDate: '2026-07-19', endDate: '2026-07-20' }),
    ], days);
    expect(spans.find(span => span.event.id === 'week')).toMatchObject({ startColumn: 0, endColumn: 4, lane: 0 });
    expect(spans.find(span => span.event.id === 'mid')).toMatchObject({ startColumn: 2, endColumn: 3, lane: 1 });
    expect(spans.find(span => span.event.id === 'single')).toMatchObject({ startColumn: 6, endColumn: 6, lane: 0 });
  });

  it('filters by calendar visibility and offline text search', () => {
    const second = { ...calendar, id: 'personal', summary: 'Personal', primary: false };
    const items = [event({ id: 'work', summary: 'Roadmap' }), event({ id: 'gym', calendarId: 'personal', summary: 'Gym' })];
    expect(filterCalendarEvents(items, [calendar, second], ['personal'], '')).toHaveLength(1);
    expect(filterCalendarEvents(items, [calendar, second], [], 'gym').map(item => item.id)).toEqual(['gym']);
  });

  it('moves a timed event without changing its duration or local clock time', () => {
    const source = event({ startAt: new Date(2026, 6, 15, 10, 30).toISOString(), endAt: new Date(2026, 6, 15, 11, 15).toISOString() });
    const moved = moveCalendarEventToDate(source, new Date(2026, 6, 20));
    expect(new Date(moved.startAt).getDate()).toBe(20);
    expect(new Date(moved.startAt).getHours()).toBe(10);
    expect(new Date(moved.endAt).getTime() - new Date(moved.startAt).getTime()).toBe(45 * 60_000);
  });
});

describe('calendar quick add', () => {
  it('parses relative date, time, and duration', () => {
    const parsed = parseCalendarQuickAdd('Roadmap tomorrow at 2:30pm for 45m', new Date(2026, 6, 15, 9), 30);
    expect(parsed?.summary).toBe('Roadmap');
    expect(new Date(parsed!.startAt).getDate()).toBe(16);
    expect(new Date(parsed!.startAt).getHours()).toBe(14);
    expect(new Date(parsed!.endAt).getTime() - new Date(parsed!.startAt).getTime()).toBe(45 * 60_000);
  });

  it('parses all-day events with exclusive end dates', () => {
    const parsed = parseCalendarQuickAdd('Company holiday tomorrow all day', new Date(2026, 6, 15, 9));
    expect(parsed).toMatchObject({ summary: 'Company holiday', isAllDay: true });
    expect(new Date(parsed!.endAt).getTime() - new Date(parsed!.startAt).getTime()).toBe(86_400_000);
  });
});

describe('calendar event actions', () => {
  it('duplicates event details without reusing conferencing or emailing guests', () => {
    const input = calendarDuplicateInput(event({
      summary: 'Customer review',
      attendees: [{ email: 'ada@example.com', responseStatus: 'accepted' }],
      conferenceUrl: 'https://meet.google.com/example',
      colorId: '7',
    }), 'team@example.com');
    expect(input).toMatchObject({
      calendarId: 'team@example.com',
      summary: 'Customer review copy',
      attendees: ['ada@example.com'],
      conferenceProvider: 'none',
      sendUpdates: 'none',
      colorId: '7',
    });
  });
});
