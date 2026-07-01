import { describe, expect, it } from 'vitest';
import {
  calendarEventFormDefaultsFromRange,
  calendarEventTimesFromLocalInput,
  calendarTimeZoneForCreate,
  defaultCalendarEventFormForDate,
  localDateInputValue,
  localTimeInputValue,
  normalizeCalendarTimeZone,
  parseCalendarAttendeeEmails,
  parseNaturalLanguageCalendarEvent,
  recurrenceRuleForCalendarCreate,
  roundUpLocalTime,
} from '../shared/calendarCreate';

describe('calendar create helpers', () => {
  it('formats local date and time input values', () => {
    const date = new Date(2026, 6, 4, 9, 5);

    expect(localDateInputValue(date)).toBe('2026-07-04');
    expect(localTimeInputValue(date)).toBe('09:05');
  });

  it('rounds up to the next configured time step', () => {
    expect(localTimeInputValue(roundUpLocalTime(new Date(2026, 6, 4, 9, 1), 30))).toBe('09:30');
    expect(localTimeInputValue(roundUpLocalTime(new Date(2026, 6, 4, 9, 30), 30))).toBe('09:30');
  });

  it('defaults future selected days to the morning work block', () => {
    const defaults = defaultCalendarEventFormForDate(
      new Date(2026, 6, 6, 18),
      45,
      new Date(2026, 6, 4, 9),
    );

    expect(defaults).toEqual({
      date: '2026-07-06',
      startTime: '09:00',
      durationMinutes: 45,
    });
  });

  it('uses an availability range as create-event defaults', () => {
    const defaults = calendarEventFormDefaultsFromRange(
      new Date(2026, 6, 6, 13, 15).toISOString(),
      new Date(2026, 6, 6, 14, 0).toISOString(),
      30,
    );

    expect(defaults).toEqual({
      date: '2026-07-06',
      startTime: '13:15',
      durationMinutes: 45,
    });
    expect(calendarEventFormDefaultsFromRange('bad', new Date(2026, 6, 6, 14).toISOString(), 30)).toBeNull();
  });

  it('builds start and end ISO values from local form fields', () => {
    const times = calendarEventTimesFromLocalInput('2026-07-04', '10:15', 45);
    expect(times).not.toBeNull();

    const start = new Date(times!.startAt);
    const end = new Date(times!.endAt);
    expect(start.getFullYear()).toBe(2026);
    expect(start.getMonth()).toBe(6);
    expect(start.getDate()).toBe(4);
    expect(start.getHours()).toBe(10);
    expect(start.getMinutes()).toBe(15);
    expect(end.getTime() - start.getTime()).toBe(45 * 60_000);
  });

  it('rejects impossible local form fields', () => {
    expect(calendarEventTimesFromLocalInput('2026-02-31', '10:00', 30)).toBeNull();
    expect(calendarEventTimesFromLocalInput('2026-07-04', '24:00', 30)).toBeNull();
  });

  it('parses quick-add text with relative date, time, duration, and location', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Lunch with Sarah tomorrow at 1pm for 45m @ Cafe',
      new Date(2026, 6, 4, 18),
      30,
      new Date(2026, 6, 4, 9),
    );

    expect(draft).toEqual({
      title: 'Lunch with Sarah',
      date: '2026-07-05',
      startTime: '13:00',
      durationMinutes: 45,
      location: 'Cafe',
      attendees: [],
      recurrence: 'none',
      hasExplicitDate: true,
      hasExplicitTime: true,
    });
  });

  it('parses quick-add time ranges and attendee emails', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Product demo tomorrow 2-3pm with Sam@example.com @ Zoom',
      new Date(2026, 6, 4, 18),
      30,
      new Date(2026, 6, 4, 9),
    );

    expect(draft).toMatchObject({
      title: 'Product demo',
      date: '2026-07-05',
      startTime: '14:00',
      durationMinutes: 60,
      location: 'Zoom',
      attendees: ['sam@example.com'],
      hasExplicitDate: true,
      hasExplicitTime: true,
    });
  });

  it('parses 24-hour quick-add ranges', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Design review next Monday 14:00-15:30',
      new Date(2026, 6, 1, 18),
      30,
      new Date(2026, 6, 1, 9),
    );

    expect(draft).toMatchObject({
      title: 'Design review',
      date: '2026-07-06',
      startTime: '14:00',
      durationMinutes: 90,
    });
  });

  it('parses next weekday and 24-hour time', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Roadmap review next Monday at 14:30 for 1h in Room 4',
      new Date(2026, 6, 1, 18),
      30,
      new Date(2026, 6, 1, 9),
    );

    expect(draft).toMatchObject({
      title: 'Roadmap review',
      date: '2026-07-06',
      startTime: '14:30',
      durationMinutes: 60,
      location: 'Room 4',
      recurrence: 'none',
    });
  });

  it('parses weekly recurring quick-add text with a weekday', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Team sync every Monday at 10am',
      new Date(2026, 6, 1, 18),
      30,
      new Date(2026, 6, 1, 9),
    );

    expect(draft).toMatchObject({
      title: 'Team sync',
      date: '2026-07-06',
      startTime: '10:00',
      durationMinutes: 30,
      location: null,
      recurrence: 'weekly',
      hasExplicitDate: true,
      hasExplicitTime: true,
    });
  });

  it('parses daily recurring quick-add text without stripping title words', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Daily standup every day at 9am',
      new Date(2026, 6, 1, 18),
      30,
      new Date(2026, 6, 1, 9),
    );

    expect(draft).toMatchObject({
      title: 'Daily standup',
      date: '2026-07-01',
      startTime: '09:00',
      durationMinutes: 30,
      recurrence: 'daily',
    });
  });

  it('maps event recurrence presets to Google Calendar RRULE values', () => {
    expect(recurrenceRuleForCalendarCreate('none')).toBeUndefined();
    expect(recurrenceRuleForCalendarCreate(undefined)).toBeUndefined();
    expect(recurrenceRuleForCalendarCreate('daily')).toEqual(['RRULE:FREQ=DAILY']);
    expect(recurrenceRuleForCalendarCreate('weekly')).toEqual(['RRULE:FREQ=WEEKLY']);
    expect(recurrenceRuleForCalendarCreate('monthly')).toEqual(['RRULE:FREQ=MONTHLY']);
    expect(recurrenceRuleForCalendarCreate('yearly')).toEqual(['RRULE:FREQ=YEARLY']);
  });

  it('normalizes create-event time zones for Google recurring events', () => {
    expect(normalizeCalendarTimeZone(' Europe/Warsaw ')).toBe('Europe/Warsaw');
    expect(normalizeCalendarTimeZone('Not/AZone')).toBeNull();
    expect(calendarTimeZoneForCreate('none', null, 'Europe/Warsaw')).toBeUndefined();
    expect(calendarTimeZoneForCreate('weekly', null, 'Europe/Warsaw')).toBe('Europe/Warsaw');
    expect(calendarTimeZoneForCreate('weekly', 'America/New_York', 'Europe/Warsaw')).toBe('America/New_York');
    expect(calendarTimeZoneForCreate('weekly', 'Not/AZone', 'Not/AZone')).toBe('UTC');
  });

  it('parses attendee emails from compact guest input', () => {
    expect(parseCalendarAttendeeEmails('Sarah <Sarah@example.com>, bob@example.com; bob@example.com')).toEqual({
      emails: ['sarah@example.com', 'bob@example.com'],
      invalid: [],
    });

    expect(parseCalendarAttendeeEmails('sarah@example.com, not-an-email')).toEqual({
      emails: ['sarah@example.com'],
      invalid: ['not-an-email'],
    });
  });

  it('falls back to the selected day when quick-add text has only a title', () => {
    const draft = parseNaturalLanguageCalendarEvent(
      'Plan roadmap',
      new Date(2026, 6, 7, 18),
      45,
      new Date(2026, 6, 4, 9),
    );

    expect(draft).toEqual({
      title: 'Plan roadmap',
      date: '2026-07-07',
      startTime: '09:00',
      durationMinutes: 45,
      location: null,
      attendees: [],
      recurrence: 'none',
      hasExplicitDate: false,
      hasExplicitTime: false,
    });
  });
});
