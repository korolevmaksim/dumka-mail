import { describe, expect, it } from 'vitest';
import type { CalendarEvent } from '../shared/types';
import {
  calendarEventParticipants,
  calendarParticipantPreview,
  calendarParticipantsAccessibleLabel,
} from '../renderer/src/calendar/calendarParticipants';

function event(partial: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: 'Planning',
    startAt: '2026-07-16T10:00:00.000Z',
    endAt: '2026-07-16T11:00:00.000Z',
    isAllDay: false,
    attendees: [],
    updatedAt: '2026-07-16T09:00:00.000Z',
    ...partial,
  };
}

describe('calendar event participants', () => {
  it('merges the organizer with attendees without duplicating email addresses', () => {
    const participants = calendarEventParticipants(event({
      organizerEmail: 'ME@example.com',
      attendees: [
        { email: 'me@example.com', displayName: 'Maksim', responseStatus: 'accepted' },
        { email: 'ada@example.com', displayName: 'Ada Lovelace', responseStatus: 'tentative', optional: true },
      ],
    }));

    expect(participants).toHaveLength(2);
    expect(participants[0]).toMatchObject({
      email: 'me@example.com',
      displayName: 'Maksim',
      responseStatus: 'accepted',
      isOrganizer: true,
      isSelf: true,
    });
    expect(participants[1]).toMatchObject({
      email: 'ada@example.com',
      displayName: 'Ada Lovelace',
      responseStatus: 'tentative',
      optional: true,
      isOrganizer: false,
      isSelf: false,
    });
  });

  it('prioritizes other people in the compact card preview', () => {
    const item = event({
      organizerEmail: 'me@example.com',
      attendees: [
        { email: 'me@example.com', displayName: 'Maksim' },
        { email: 'ada@example.com', displayName: 'Ada Lovelace' },
        { email: 'grace@example.com', displayName: 'Grace Hopper' },
      ],
    });

    expect(calendarParticipantPreview(item)).toBe('Ada +1');
    expect(calendarParticipantsAccessibleLabel(item)).toBe('3 participants: Maksim, Ada Lovelace, Grace Hopper');
  });

  it('keeps participant-free event cards uncluttered', () => {
    const item = event({ organizerEmail: 'me@example.com' });

    expect(calendarParticipantPreview(item)).toBeNull();
    expect(calendarParticipantsAccessibleLabel(item)).toBe('1 participant: me@example.com');
  });
});
