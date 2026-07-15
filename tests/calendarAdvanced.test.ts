import { describe, expect, it } from 'vitest';
import { calendarEventToIcs, calendarInviteToCreateInput, parseIcsInvite } from '../shared/calendar';
import { calendarEventReminderMinutes, isCalendarReminderDue } from '../shared/calendarReminderSchedule';
import type { CalendarEvent } from '../shared/types';
import { recurrenceBeforeBoundary, recurrenceWithoutEnd } from '../main/googleWorkspace';

function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1', accountId: 'me@example.com', calendarId: 'primary', summary: 'Planning',
    startAt: '2026-07-15T10:00:00.000Z', endAt: '2026-07-15T11:00:00.000Z', isAllDay: false,
    attendees: [], updatedAt: '2026-07-01T00:00:00.000Z', status: 'confirmed', ...partial,
  };
}

describe('calendar recurrence scopes', () => {
  it('terminates a timed series immediately before the selected occurrence', () => {
    expect(recurrenceBeforeBoundary(['RRULE:FREQ=WEEKLY;COUNT=12'], '2026-07-15T10:00:00.000Z')).toEqual([
      'RRULE:FREQ=WEEKLY;UNTIL=20260715T095959Z',
    ]);
  });

  it('uses a date-only UNTIL for all-day series', () => {
    expect(recurrenceBeforeBoundary(['RRULE:FREQ=DAILY'], '2026-07-15T00:00:00.000Z', true)).toEqual([
      'RRULE:FREQ=DAILY;UNTIL=20260714',
    ]);
  });

  it('removes prior COUNT and UNTIL limits when creating the following series', () => {
    expect(recurrenceWithoutEnd(['RRULE:FREQ=MONTHLY;COUNT=4', 'EXDATE:20260715T100000Z'])).toEqual([
      'RRULE:FREQ=MONTHLY', 'EXDATE:20260715T100000Z',
    ]);
  });
});

describe('calendar ICS workflows', () => {
  it('round-trips an exported timed event through the local parser', () => {
    const original = event({
      iCalUID: 'planning@example.com', description: 'Discuss roadmap', location: 'Room 4',
      attendees: [{ email: 'ada@example.com', responseStatus: 'accepted' }],
    });
    const parsed = parseIcsInvite(calendarEventToIcs(original));
    expect(parsed).toMatchObject({
      uid: 'planning@example.com', summary: 'Planning', description: 'Discuss roadmap', location: 'Room 4',
      startAt: original.startAt, endAt: original.endAt,
    });
    expect(parsed?.attendees[0].email).toBe('ada@example.com');
  });

  it('preserves all-day exclusive dates on export', () => {
    const text = calendarEventToIcs(event({
      isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-17',
      startAt: '2026-07-15T00:00:00.000Z', endAt: '2026-07-17T00:00:00.000Z',
    }));
    expect(text).toContain('DTSTART;VALUE=DATE:20260715');
    expect(text).toContain('DTEND;VALUE=DATE:20260717');
  });

  it('builds a no-email previewed import input', () => {
    const invite = parseIcsInvite(calendarEventToIcs(event()))!;
    expect(calendarInviteToCreateInput(invite, 'team@example.com')).toMatchObject({
      calendarId: 'team@example.com', summary: 'Planning', sendUpdates: 'none', conferenceProvider: 'none',
    });
  });
});

describe('calendar reminder schedule', () => {
  it('uses per-event popup reminders before the default', () => {
    const candidate = event({ reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 30 }] } });
    expect(calendarEventReminderMinutes(candidate, 10)).toBe(30);
    expect(isCalendarReminderDue(candidate, 10, new Date('2026-07-15T09:30:00.000Z'))).toBe(true);
    expect(isCalendarReminderDue(candidate, 10, new Date('2026-07-15T09:29:59.000Z'))).toBe(false);
  });

  it('schedules all-day reminders at local 09:00', () => {
    const candidate = event({ isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-16' });
    const localNine = new Date(2026, 6, 15, 9, 0, 30);
    expect(isCalendarReminderDue(candidate, 10, localNine)).toBe(true);
    expect(isCalendarReminderDue(candidate, 10, new Date(2026, 6, 15, 14, 30))).toBe(true);
    expect(isCalendarReminderDue(candidate, 10, new Date(2026, 6, 16, 8, 0))).toBe(false);
  });
});
