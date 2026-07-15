import { describe, expect, it } from 'vitest';
import {
  availabilitySlotsHtml,
  availabilitySlotsPlainText,
  calendarEventMatchesInvite,
  expandCalendarCreateOccurrences,
  findCalendarConflicts,
  findAvailabilitySlots,
  findAvailabilitySlotsFromBusyIntervals,
  findCalendarInviteConflicts,
  findRecurringCalendarConflicts,
  freeBusyWarningMessage,
} from '../shared/calendarAvailability';
import type { CalendarEvent, CalendarInvite, CalendarSettings } from '../shared/types';

const settings: CalendarSettings = {
  showAgendaInRightPanel: true,
  defaultMeetingDurationMinutes: 30,
  availabilityLookaheadDays: 2,
  availabilityStartTime: '09:00',
  availabilityEndTime: '12:00',
  availabilitySlotStepMinutes: 30,
  calendlyUrl: '',
  calComUrl: '',
  defaultConferenceProvider: 'googleMeet',
  defaultView: 'month',
  lastAnchorDate: '',
  weekStartsOn: 1,
  showWeekends: true,
  showWeekNumbers: false,
  workingDays: [1, 2, 3, 4, 5],
  hiddenCalendarIds: [],
  defaultCalendarId: 'primary',
  defaultReminderMinutes: 10,
  secondaryTimeZone: '',
  favoriteTimeZones: [],
  defaultTravelTimeMinutes: 0,
  calendarSets: [],
  activeCalendarSetId: null,
  eventTemplates: [],
  hideNotificationDetails: false,
  mutedNotificationCalendarKeys: [],
};

function event(startAt: string, endAt: string, status: string | null = null): CalendarEvent {
  return {
    id: `${startAt}-${endAt}`,
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: 'Busy',
    startAt,
    endAt,
    isAllDay: false,
    status,
    attendees: [],
    updatedAt: startAt,
  };
}

function localDate(hours: number, minutes = 0): Date {
  return new Date(2026, 6, 1, hours, minutes, 0, 0);
}

function localIso(hours: number, minutes = 0): string {
  return localDate(hours, minutes).toISOString();
}

function localTime(value: string): string {
  const date = new Date(value);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

describe('findAvailabilitySlots', () => {
  it('returns open slots inside the configured working window', () => {
    const slots = findAvailabilitySlots([], settings, localDate(8, 10), 3);

    expect(slots).toHaveLength(3);
    expect(slots.map(slot => localTime(slot.startAt))).toEqual(['09:00', '09:30', '10:00']);
  });

  it('skips busy intervals and rounds to the configured step', () => {
    const slots = findAvailabilitySlots([
      event(localIso(9), localIso(10)),
      event(localIso(10, 30), localIso(11)),
    ], settings, localDate(8, 45), 3);

    expect(slots.map(slot => localTime(slot.startAt))).toEqual(['10:00', '11:00', '11:30']);
  });

  it('ignores cancelled events', () => {
    const slots = findAvailabilitySlots([
      event(localIso(9), localIso(11), 'cancelled'),
    ], settings, localDate(8, 45), 1);

    expect(localTime(slots[0].startAt)).toBe('09:00');
  });

  it('formats availability for draft insertion', () => {
    const slots = findAvailabilitySlots([], settings, localDate(8, 45), 1);

    expect(availabilitySlotsPlainText(slots)).toContain('A few times that work for me:');
    expect(availabilitySlotsPlainText(slots)).toContain('- ');
    expect(availabilitySlotsHtml(slots)).toContain('<ul>');
    expect(availabilitySlotsHtml(slots)).toContain('<li>');
    expect(availabilitySlotsHtml(slots, 'A few shared times that look open:')).toContain('A few shared times that look open:');
  });

  it('returns shared open slots from free/busy intervals', () => {
    const slots = findAvailabilitySlotsFromBusyIntervals([
      { calendarId: 'primary', startAt: localIso(9), endAt: localIso(10) },
      { calendarId: 'guest@example.com', startAt: localIso(10), endAt: localIso(10, 30) },
      { calendarId: 'guest@example.com', startAt: localIso(10, 15), endAt: localIso(11) },
    ], settings, localDate(8, 45), 2);

    expect(slots.map(slot => localTime(slot.startAt))).toEqual(['11:00', '11:30']);
  });

  it('reports guest calendars that FreeBusy could not read', () => {
    const warning = freeBusyWarningMessage({
      calendars: [
        { id: 'primary', busy: [] },
        { id: 'ada@example.com', busy: [] },
        { id: 'grace@example.com', busy: [], errors: [{ reason: 'notFound' }] },
      ],
      busy: [],
    }, ['ada@example.com', 'grace@example.com', 'missing@example.com']);

    expect(warning).toBe('Could not read availability for grace@example.com, missing@example.com.');
  });
});

describe('findCalendarConflicts', () => {
  it('returns overlapping calendar events with clipped overlap bounds', () => {
    const conflicts = findCalendarConflicts([
      { ...event(localIso(9), localIso(10)), id: 'a', summary: 'Standup' },
      { ...event(localIso(10), localIso(11)), id: 'b', summary: 'Review' },
    ], localIso(9, 30), localIso(10, 30));

    expect(conflicts.map(conflict => conflict.event.summary)).toEqual(['Standup', 'Review']);
    expect(localTime(conflicts[0].overlapStartAt)).toBe('09:30');
    expect(localTime(conflicts[0].overlapEndAt)).toBe('10:00');
    expect(localTime(conflicts[1].overlapStartAt)).toBe('10:00');
    expect(localTime(conflicts[1].overlapEndAt)).toBe('10:30');
  });

  it('ignores cancelled events and exact boundary touches', () => {
    const conflicts = findCalendarConflicts([
      event(localIso(8), localIso(9)),
      event(localIso(9), localIso(10), 'cancelled'),
      event(localIso(11), localIso(12)),
    ], localIso(9), localIso(11));

    expect(conflicts).toEqual([]);
  });
});

describe('calendar invite conflicts', () => {
  const invite: CalendarInvite = {
    uid: 'invite-1@example.com',
    method: 'REQUEST',
    summary: 'Product Review',
    startAt: localIso(9),
    endAt: localIso(10),
    isAllDay: false,
    attendees: [],
    recurrenceRules: [],
  };

  it('matches imported events by iCalUID or exact title and time', () => {
    expect(calendarEventMatchesInvite({ ...event(localIso(9), localIso(10)), iCalUID: invite.uid }, invite)).toBe(true);
    expect(calendarEventMatchesInvite({ ...event(localIso(9), localIso(10)), summary: 'Product Review' }, invite)).toBe(true);
    expect(calendarEventMatchesInvite({ ...event(localIso(9), localIso(10)), summary: 'Other' }, invite)).toBe(false);
  });

  it('excludes the imported invite itself and returns real overlapping conflicts', () => {
    const imported = { ...event(localIso(9), localIso(10)), id: 'imported', iCalUID: invite.uid, summary: invite.summary };
    const conflict = { ...event(localIso(9, 30), localIso(10, 15)), id: 'conflict', summary: 'Customer Call' };
    const outside = { ...event(localIso(10), localIso(11)), id: 'outside', summary: 'Later' };

    const conflicts = findCalendarInviteConflicts([imported, conflict, outside], invite);

    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].event.summary).toBe('Customer Call');
    expect(localTime(conflicts[0].overlapStartAt)).toBe('09:30');
    expect(localTime(conflicts[0].overlapEndAt)).toBe('10:00');
  });
});

describe('recurring calendar create conflicts', () => {
  it('expands weekly create previews and finds future occurrence conflicts', () => {
    const weeklyStart = new Date(2026, 6, 1, 9, 0, 0, 0).toISOString();
    const weeklyEnd = new Date(2026, 6, 1, 9, 30, 0, 0).toISOString();
    const futureBusy = event(
      new Date(2026, 6, 8, 9, 15, 0, 0).toISOString(),
      new Date(2026, 6, 8, 9, 45, 0, 0).toISOString(),
    );

    const conflicts = findRecurringCalendarConflicts([futureBusy], weeklyStart, weeklyEnd, 'weekly', {
      horizonDays: 14,
      maxOccurrences: 4,
    });

    expect(conflicts).toHaveLength(1);
    expect(localTime(conflicts[0].occurrenceStartAt!)).toBe('09:00');
    expect(new Date(conflicts[0].occurrenceStartAt!).getDate()).toBe(8);
    expect(localTime(conflicts[0].overlapStartAt)).toBe('09:15');
    expect(localTime(conflicts[0].overlapEndAt)).toBe('09:30');
  });

  it('skips invalid monthly dates rather than shifting the recurrence day', () => {
    const occurrences = expandCalendarCreateOccurrences(
      new Date(2026, 0, 31, 10, 0, 0, 0).toISOString(),
      new Date(2026, 0, 31, 10, 30, 0, 0).toISOString(),
      'monthly',
      { maxOccurrences: 3, horizonDays: 150 },
    );

    expect(occurrences.map(occurrence => new Date(occurrence.startAt).getDate())).toEqual([31, 31, 31]);
    expect(occurrences.map(occurrence => new Date(occurrence.startAt).getMonth())).toEqual([0, 2, 4]);
  });
});
