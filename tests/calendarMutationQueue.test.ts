import { describe, expect, it } from 'vitest';
import { optimisticCalendarEvent } from '../main/calendarMutationWorker';

describe('calendar offline mutation projection', () => {
  it('creates a complete local event while Google is unavailable', () => {
    const event = optimisticCalendarEvent('me@example.com', {
      calendarId: 'team@example.com',
      summary: 'Offline planning',
      description: 'Queued locally',
      startAt: '2026-07-15T08:00:00.000Z',
      endAt: '2026-07-15T09:00:00.000Z',
      attendees: ['ada@example.com'],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      sendUpdates: 'all',
    }, 'local-fixed');

    expect(event).toMatchObject({
      id: 'local-fixed',
      accountId: 'me@example.com',
      calendarId: 'team@example.com',
      summary: 'Offline planning',
      description: 'Queued locally',
      status: 'pending',
      attendees: [{ email: 'ada@example.com', responseStatus: 'needsAction' }],
      reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
    });
  });

  it('preserves all-day date boundaries in the local projection', () => {
    const event = optimisticCalendarEvent('me@example.com', {
      summary: 'Offsite',
      startAt: '2026-07-15T00:00:00.000Z',
      endAt: '2026-07-17T00:00:00.000Z',
      isAllDay: true,
      startDate: '2026-07-15',
      endDate: '2026-07-17',
    }, 'local-all-day');
    expect(event).toMatchObject({ isAllDay: true, startDate: '2026-07-15', endDate: '2026-07-17' });
  });
});
