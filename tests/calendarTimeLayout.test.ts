import { describe, expect, it } from 'vitest';
import {
  isAllDayRowEvent,
  layoutTimedEventsForDay,
  layoutTimedIntervals,
  minuteAtOffset,
  timedBlockHasTwoLines,
  type TimedBlock,
} from '../renderer/src/calendar/calendarTimeLayout';
import type { CalendarEvent } from '../shared/types';

const OPTIONS = { hourHeight: 60, minHeight: 20 };

function byKey(blocks: TimedBlock[]): Record<string, TimedBlock> {
  return Object.fromEntries(blocks.map(block => [block.key, block]));
}

function event(id: string, start: Date, end: Date, overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    id,
    accountId: 'me@example.com',
    calendarId: 'primary',
    summary: id,
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    isAllDay: false,
    attendees: [],
    updatedAt: '2026-11-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('time grid layout', () => {
  it('makes a block as tall as the event is long', () => {
    const blocks = byKey(layoutTimedIntervals([
      { key: 'standup', startMinute: 9 * 60 + 30, endMinute: 9 * 60 + 45 },
      { key: 'focus', startMinute: 12 * 60, endMinute: 16 * 60 },
    ], OPTIONS));

    expect(blocks.focus.top).toBe(720);
    expect(blocks.focus.height).toBe(240);
    expect(blocks.standup.top).toBe(570);
    // 15 minutes is 15 px at 60 px per hour; the minimum keeps one line readable.
    expect(blocks.standup.height).toBe(20);
    expect(blocks.focus.height).toBeGreaterThan(blocks.standup.height * 10);
  });

  it('places overlapping events side by side', () => {
    const blocks = byKey(layoutTimedIntervals([
      { key: 'a', startMinute: 600, endMinute: 660 },
      { key: 'b', startMinute: 630, endMinute: 690 },
      { key: 'c', startMinute: 720, endMinute: 750 },
    ], OPTIONS));

    expect([blocks.a.column, blocks.a.columns]).toEqual([0, 2]);
    expect([blocks.b.column, blocks.b.columns]).toEqual([1, 2]);
    expect([blocks.c.column, blocks.c.columns]).toEqual([0, 1]);
  });

  it('gives a whole chain of overlaps the same column count and reuses free columns', () => {
    // a overlaps b, b overlaps c, but a and c do not touch.
    const blocks = byKey(layoutTimedIntervals([
      { key: 'a', startMinute: 540, endMinute: 600 },
      { key: 'b', startMinute: 570, endMinute: 660 },
      { key: 'c', startMinute: 600, endMinute: 630 },
    ], OPTIONS));

    expect(blocks.a.columns).toBe(2);
    expect(blocks.b.columns).toBe(2);
    expect(blocks.c.columns).toBe(2);
    expect(blocks.c.column).toBe(0);
    expect(blocks.b.column).toBe(1);
  });

  it('keeps back-to-back events in one column', () => {
    const blocks = byKey(layoutTimedIntervals([
      { key: 'first', startMinute: 600, endMinute: 660 },
      { key: 'second', startMinute: 660, endMinute: 720 },
    ], OPTIONS));

    expect(blocks.first.columns).toBe(1);
    expect(blocks.second.columns).toBe(1);
    expect(blocks.second.top).toBe(blocks.first.top + blocks.first.height);
  });

  it('does not let a short event drawn at minimum height cover the next one', () => {
    // 5 minutes is drawn 20 px (= 20 minutes) tall, so the 10:10 event would sit under it.
    const blocks = byKey(layoutTimedIntervals([
      { key: 'short', startMinute: 600, endMinute: 605 },
      { key: 'next', startMinute: 610, endMinute: 640 },
    ], OPTIONS));

    expect(blocks.short.columns).toBe(2);
    expect(blocks.next.column).toBe(1);
  });

  it('keeps blocks inside the day', () => {
    const blocks = byKey(layoutTimedIntervals([
      { key: 'late', startMinute: 1435, endMinute: 1440 },
      { key: 'overnight', startMinute: -60, endMinute: 120 },
    ], OPTIONS));

    expect(blocks.late.top + blocks.late.height).toBeLessThanOrEqual(1440);
    expect(blocks.late.height).toBe(20);
    expect(blocks.overnight.top).toBe(0);
    expect(blocks.overnight.height).toBe(120);
  });

  it('positions the events of one day and flags those crossing midnight', () => {
    const day = new Date(2026, 10, 12);
    const positioned = layoutTimedEventsForDay([
      event('standup', new Date(2026, 10, 12, 9, 30), new Date(2026, 10, 12, 9, 45)),
      event('flight', new Date(2026, 10, 12, 22, 0), new Date(2026, 10, 13, 2, 0)),
      event('allday', new Date(2026, 10, 12), new Date(2026, 10, 13), { isAllDay: true, startDate: '2026-11-12', endDate: '2026-11-13' }),
      event('tomorrow', new Date(2026, 10, 13, 9, 0), new Date(2026, 10, 13, 10, 0)),
    ], day, OPTIONS);

    expect(positioned.map(item => item.event.id).sort()).toEqual(['flight', 'standup']);
    const flight = positioned.find(item => item.event.id === 'flight');
    expect(flight?.continuesAfter).toBe(true);
    expect(flight?.continuesBefore).toBe(false);
    expect(flight?.height).toBe(120);
  });

  it('decides when a block has room for the time range line', () => {
    expect(timedBlockHasTwoLines(20, 14)).toBe(false);
    expect(timedBlockHasTwoLines(34, 14)).toBe(true);
  });

  it('snaps a pointer position to quarter hours inside the day', () => {
    expect(minuteAtOffset(570, 60)).toBe(570);
    expect(minuteAtOffset(577, 60)).toBe(570);
    expect(minuteAtOffset(-20, 60)).toBe(0);
    expect(minuteAtOffset(5000, 60)).toBe(1425);
  });
});

describe('all-day row', () => {
  it('holds all-day events and timed events of a day or longer', () => {
    expect(isAllDayRowEvent({ isAllDay: true, startAt: '', endAt: '' })).toBe(true);
    expect(isAllDayRowEvent({ isAllDay: false, startAt: '2026-11-12T22:00:00Z', endAt: '2026-11-13T02:00:00Z' })).toBe(false);
    expect(isAllDayRowEvent({ isAllDay: false, startAt: '2026-11-12T09:00:00Z', endAt: '2026-11-14T09:00:00Z' })).toBe(true);
  });
});
