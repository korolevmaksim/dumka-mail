import { describe, expect, it } from 'vitest';
import { findCalendarFreeSlots } from '../shared/calendarAssistant';
import type { CalendarEvent } from '../shared/types';

function event(startAt: string, endAt: string, transparency: CalendarEvent['transparency'] = 'opaque'): CalendarEvent {
  return { id: startAt, accountId: 'me@example.com', calendarId: 'primary', summary: 'Busy', startAt, endAt, isAllDay: false, transparency, attendees: [], updatedAt: startAt };
}

describe('calendar assistant tools', () => {
  it('finds bounded gaps from cached blocking events', () => {
    expect(findCalendarFreeSlots([
      event('2026-07-15T09:30:00.000Z', '2026-07-15T10:00:00.000Z'),
      event('2026-07-15T10:30:00.000Z', '2026-07-15T11:00:00.000Z'),
    ], '2026-07-15T09:00:00.000Z', '2026-07-15T12:00:00.000Z', 30)).toEqual([
      { startAt: '2026-07-15T09:00:00.000Z', endAt: '2026-07-15T09:30:00.000Z' },
      { startAt: '2026-07-15T10:00:00.000Z', endAt: '2026-07-15T10:30:00.000Z' },
      { startAt: '2026-07-15T11:00:00.000Z', endAt: '2026-07-15T11:30:00.000Z' },
    ]);
  });

  it('ignores transparent events and rejects unbounded ranges', () => {
    expect(findCalendarFreeSlots([
      event('2026-07-15T09:00:00.000Z', '2026-07-15T10:00:00.000Z', 'transparent'),
    ], '2026-07-15T09:00:00.000Z', '2026-07-15T10:00:00.000Z', 30)).toHaveLength(1);
    expect(findCalendarFreeSlots([], '2026-01-01T00:00:00.000Z', '2026-03-01T00:00:00.000Z', 30)).toEqual([]);
  });
});
