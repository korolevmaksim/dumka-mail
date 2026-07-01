import { describe, expect, it } from 'vitest';
import { agendaEventTime, upcomingAgendaDateTimeLabel } from '../renderer/src/lib/calendarAgenda';
import type { CalendarEvent } from '../shared/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: 'Planning call',
    startAt: '2026-07-02T14:00:00.000Z',
    endAt: '2026-07-02T14:30:00.000Z',
    isAllDay: false,
    attendees: [],
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

describe('calendar agenda labels', () => {
  it('includes the clock time for timed events', () => {
    const label = upcomingAgendaDateTimeLabel(makeEvent(), 'en-US');

    expect(label).toContain('Thu, Jul 2');
    expect(label).toMatch(/\d{1,2}:00\s?[AP]M - \d{1,2}:30\s?[AP]M/);
  });

  it('labels all-day events without a time range', () => {
    const event = makeEvent({ isAllDay: true });

    expect(agendaEventTime(event, 'en-US')).toBe('All day');
    expect(upcomingAgendaDateTimeLabel(event, 'en-US')).toContain('All day');
  });
});
