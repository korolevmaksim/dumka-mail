import { describe, expect, it } from 'vitest';
import {
  availabilitySlotsHtml,
  availabilitySlotsPlainText,
  findAvailabilitySlots,
} from '../shared/calendarAvailability';
import type { CalendarEvent, CalendarSettings } from '../shared/types';

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
  });
});
