import { describe, expect, it } from 'vitest';
import {
  allDayRangeLabel,
  calendarEventTimeLabel,
  calendarEventTimeZoneNote,
  calendarEventWhenLabel,
  calendarHeaderTitle,
  dayRangeLabel,
  monthYearLabel,
  secondaryClockLabel,
  weekdayInitials,
  weekdayShortNames,
} from '../renderer/src/calendar/calendarDateLabels';
import { conflictTimeLabel, eventEndClock, parseClockInput, quickDraftLabel } from '../renderer/src/lib/calendarEventFormHelpers';

const NOW = new Date(2026, 10, 12, 8, 0);
const TWELVE_HOUR = /\b(AM|PM)\b/i;
const NUMERIC_DATE = /\d{1,2}[./]\d{1,2}[./]\d{2,4}/;

describe('calendar date and time labels', () => {
  it('titles each view in the shared vocabulary', () => {
    const anchor = new Date(2026, 10, 12, 12);
    expect(calendarHeaderTitle(anchor, 'month', 1)).toBe('November 2026');
    expect(calendarHeaderTitle(anchor, 'week', 1)).toBe('Nov 9 – 15, 2026');
    expect(calendarHeaderTitle(anchor, 'week', 0)).toBe('Nov 8 – 14, 2026');
    expect(calendarHeaderTitle(anchor, 'day', 1)).toBe('Thu, Nov 12, 2026');
    expect(calendarHeaderTitle(anchor, 'quarter', 1)).toBe('Q4 2026');
    expect(calendarHeaderTitle(anchor, 'year', 1)).toBe('2026');
    expect(monthYearLabel(new Date(2027, 0, 3))).toBe('January 2027');
  });

  it('names ranges across months and years', () => {
    expect(dayRangeLabel(new Date(2026, 10, 30), new Date(2026, 11, 6))).toBe('Nov 30 – Dec 6, 2026');
    expect(dayRangeLabel(new Date(2026, 11, 28), new Date(2027, 0, 3))).toBe('Dec 28, 2026 – Jan 3, 2027');
  });

  it('orders weekday names by the first day of the week', () => {
    expect(weekdayShortNames(1)).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    expect(weekdayShortNames(0)[0]).toBe('Sun');
    expect(weekdayInitials(1).join('')).toBe('MTWTFSS');
  });

  it('labels timed events with a 24-hour range', () => {
    const event = { isAllDay: false, startAt: new Date(2026, 10, 12, 14, 0).toISOString(), endAt: new Date(2026, 10, 12, 14, 45).toISOString() };
    expect(calendarEventTimeLabel(event, NOW)).toBe('14:00–14:45');
    expect(calendarEventWhenLabel({ ...event, startDate: null, endDate: null }, NOW)).toBe('Thu, Nov 12, 14:00–14:45');
  });

  it('labels all-day events with an inclusive last day', () => {
    const oneDay = { startAt: '', endAt: '', startDate: '2026-11-13', endDate: '2026-11-14' };
    const threeDays = { startAt: '', endAt: '', startDate: '2026-11-13', endDate: '2026-11-16' };
    expect(allDayRangeLabel(oneDay, NOW)).toBe('Fri, Nov 13 · All day');
    expect(allDayRangeLabel(threeDays, NOW)).toBe('Fri, Nov 13 – Sun, Nov 15 · All day');
    expect(calendarEventWhenLabel({ isAllDay: true, ...threeDays }, NOW)).toBe('Fri, Nov 13 – Sun, Nov 15 · All day');
    expect(calendarEventTimeLabel({ isAllDay: true, startAt: '', endAt: '' }, NOW)).toBe('All day');
  });

  it('adds the year only for another year', () => {
    const event = { isAllDay: false, startDate: null, endDate: null, startAt: new Date(2027, 0, 5, 9, 0).toISOString(), endAt: new Date(2027, 0, 5, 10, 0).toISOString() };
    expect(calendarEventWhenLabel(event, NOW)).toBe('Tue, Jan 5, 2027, 09:00–10:00');
  });

  it('shows the time in the event time zone only when the clock differs', () => {
    const event = { isAllDay: false, startAt: '2026-11-12T14:00:00.000Z', endAt: '2026-11-12T14:45:00.000Z' };
    expect(calendarEventTimeZoneNote({ ...event, timeZone: 'America/New_York' }, 'Europe/Berlin')).toBe('09:00–09:45 in New York');
    expect(calendarEventTimeZoneNote({ ...event, timeZone: 'Europe/Paris' }, 'Europe/Berlin')).toBeNull();
    expect(calendarEventTimeZoneNote({ ...event, timeZone: 'Europe/Berlin' }, 'Europe/Berlin')).toBeNull();
    expect(calendarEventTimeZoneNote({ ...event, timeZone: null }, 'Europe/Berlin')).toBeNull();
    expect(calendarEventTimeZoneNote({ ...event, timeZone: 'Not/AZone' }, 'Europe/Berlin')).toBeNull();
  });

  it('formats the second clock in 24-hour time', () => {
    expect(secondaryClockLabel('Asia/Tokyo', new Date('2026-11-12T05:30:00.000Z'))).toBe('14:30 Tokyo');
    expect(secondaryClockLabel('')).toBeNull();
  });

  it('never produces 12-hour times or numeric dates', () => {
    const samples = [
      calendarHeaderTitle(new Date(2026, 10, 12), 'day', 1),
      calendarEventWhenLabel({ isAllDay: false, startDate: null, endDate: null, startAt: new Date(2026, 10, 12, 0, 5).toISOString(), endAt: new Date(2026, 10, 12, 13, 0).toISOString() }, NOW),
      conflictTimeLabel({ occurrenceStartAt: null, overlapStartAt: new Date(2026, 10, 12, 13, 0).toISOString(), overlapEndAt: new Date(2026, 10, 12, 13, 30).toISOString() } as never, NOW),
      quickDraftLabel({ title: 'Lunch', date: '2026-11-13', startTime: '13:00', durationMinutes: 90, recurrence: 'none', location: 'Cafe', attendees: [] } as never, NOW),
    ];
    for (const sample of samples) {
      expect(sample).not.toMatch(TWELVE_HOUR);
      expect(sample).not.toMatch(NUMERIC_DATE);
    }
    expect(samples[2]).toBe('Thu, Nov 12 · 13:00–13:30');
    expect(samples[3]).toBe('Lunch · Nov 13, 13:00 · 1 h 30 min · Cafe');
  });
});

describe('event form inputs', () => {
  it('reads typed clock times as 24-hour', () => {
    expect(parseClockInput('14:30')).toBe('14:30');
    expect(parseClockInput('1430')).toBe('14:30');
    expect(parseClockInput('930')).toBe('09:30');
    expect(parseClockInput('9')).toBe('09:00');
    expect(parseClockInput('9.15')).toBe('09:15');
    expect(parseClockInput('24:00')).toBeNull();
    expect(parseClockInput('12:75')).toBeNull();
    expect(parseClockInput('2pm')).toBeNull();
    expect(parseClockInput('')).toBeNull();
  });

  it('works out the end time from the start and duration', () => {
    expect(eventEndClock('2026-11-12', '14:00', 45, NOW)).toBe('14:45');
    expect(eventEndClock('2026-11-12', '23:30', 60, NOW)).toBe(`Nov 13, 00:30`);
    expect(eventEndClock('bad', '14:00', 45)).toBeNull();
  });
});
