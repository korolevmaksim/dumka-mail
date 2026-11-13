import { describe, expect, it } from 'vitest';
import { agendaEventTime, upcomingAgendaDateTimeLabel } from '../renderer/src/lib/calendarAgenda';
import type { CalendarEvent } from '../shared/types';

function makeEvent(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id: 'event-1',
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: 'Planning call',
    startAt: new Date(2026, 6, 2, 14, 0).toISOString(),
    endAt: new Date(2026, 6, 2, 14, 30).toISOString(),
    isAllDay: false,
    attendees: [],
    updatedAt: '2026-07-01T10:00:00.000Z',
    ...overrides,
  };
}

const NOW = new Date(2026, 6, 1, 9, 0);

describe('calendar agenda labels', () => {
  it('uses the shared 24-hour vocabulary for timed events', () => {
    const label = upcomingAgendaDateTimeLabel(makeEvent(), NOW);

    expect(label).toBe('Thu, Jul 2 · 14:00–14:30');
    expect(label).not.toMatch(/[AP]M/);
  });

  it('labels all-day events without a time range', () => {
    const event = makeEvent({ isAllDay: true, startDate: '2026-07-02', endDate: '2026-07-03' });

    expect(agendaEventTime(event, NOW)).toBe('All day');
    expect(upcomingAgendaDateTimeLabel(event, NOW)).toBe('Thu, Jul 2 · All day');
  });
});
