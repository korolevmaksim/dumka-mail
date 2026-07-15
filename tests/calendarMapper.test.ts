import { describe, expect, it } from 'vitest';
import { mapCalendarEvent, mapCalendarListEntry } from '../main/googleWorkspace';

describe('Google Calendar mapping', () => {
  it('preserves multi-calendar metadata and permissions', () => {
    expect(mapCalendarListEntry({
      id: 'team@example.com',
      summary: 'Team',
      summaryOverride: 'Product Team',
      description: 'Shared schedule',
      accessRole: 'writer',
      selected: true,
      backgroundColor: '#123456',
      foregroundColor: '#ffffff',
      timeZone: 'Europe/Warsaw',
    }, 'me@example.com')).toMatchObject({
      id: 'team@example.com',
      accountId: 'me@example.com',
      summary: 'Product Team',
      accessRole: 'writer',
      selected: true,
      backgroundColor: '#123456',
      timeZone: 'Europe/Warsaw',
    });
  });

  it('preserves date-only boundaries for all-day events', () => {
    const mapped = mapCalendarEvent({
      id: 'holiday',
      iCalUID: 'holiday@example.com',
      summary: 'Holiday',
      start: { date: '2026-07-15' },
      end: { date: '2026-07-17' },
      status: 'confirmed',
      updated: '2026-07-01T10:00:00Z',
    }, 'me@example.com', 'holidays@example.com');
    expect(mapped).toMatchObject({
      id: 'holiday',
      calendarId: 'holidays@example.com',
      isAllDay: true,
      startDate: '2026-07-15',
      endDate: '2026-07-17',
    });
  });

  it('maps recurrence identity, self RSVP, reminders, and Meet links', () => {
    const mapped = mapCalendarEvent({
      id: 'instance-1',
      summary: 'Weekly sync',
      start: { dateTime: '2026-07-15T10:00:00+02:00', timeZone: 'Europe/Warsaw' },
      end: { dateTime: '2026-07-15T10:30:00+02:00', timeZone: 'Europe/Warsaw' },
      recurringEventId: 'series-1',
      originalStartTime: { dateTime: '2026-07-15T10:00:00+02:00' },
      attendees: [{ email: 'me@example.com', self: true, responseStatus: 'accepted' }],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      hangoutLink: 'https://meet.google.com/abc-defg-hij',
      transparency: 'opaque',
      visibility: 'private',
    }, 'me@example.com');
    expect(mapped).toMatchObject({
      recurringEventId: 'series-1',
      selfResponseStatus: 'accepted',
      conferenceUrl: 'https://meet.google.com/abc-defg-hij',
      timeZone: 'Europe/Warsaw',
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] },
      transparency: 'opaque',
      visibility: 'private',
    });
  });
});
