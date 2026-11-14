// Geometry of timed events in the day and week grids: an event's block is as
// tall as the event is long (with a minimum for short events), and events that
// overlap — in time, or on screen because of that minimum — sit side by side in
// columns. Pure, so it is unit-tested (tests/calendarTimeLayout.test.ts).
import type { CalendarEvent } from '../../../shared/types';
import { calendarEventsForDate, startOfCalendarDay } from '../../../shared/calendarWorkspace';

export const MINUTES_PER_DAY = 1440;

export interface TimedInterval {
  key: string;
  /** Minutes from the start of the day (0–1440). */
  startMinute: number;
  endMinute: number;
}

export interface TimedBlock {
  key: string;
  startMinute: number;
  endMinute: number;
  /** Pixels from the top of the day column. */
  top: number;
  height: number;
  /** Zero-based column inside its overlap group. */
  column: number;
  /** Number of columns in its overlap group. */
  columns: number;
}

export interface TimedLayoutOptions {
  hourHeight: number;
  /** Shortest block drawn, in pixels; short events still get room for one line. */
  minHeight: number;
}

/**
 * Lays out intervals of one day. Groups are formed transitively (A overlaps B,
 * B overlaps C → one group), so every block of a group gets the same column
 * count and none of them is drawn wider than its neighbours.
 */
export function layoutTimedIntervals(intervals: readonly TimedInterval[], options: TimedLayoutOptions): TimedBlock[] {
  const { hourHeight, minHeight } = options;
  const dayHeight = (MINUTES_PER_DAY / 60) * hourHeight;
  const minMinutes = (minHeight / hourHeight) * 60;
  const items = intervals
    .map(interval => {
      const startMinute = clamp(interval.startMinute, 0, MINUTES_PER_DAY);
      const endMinute = clamp(Math.max(interval.endMinute, startMinute), 0, MINUTES_PER_DAY);
      return { key: interval.key, startMinute, endMinute, visualEnd: Math.max(endMinute, startMinute + minMinutes) };
    })
    .sort((left, right) => left.startMinute - right.startMinute
      || right.endMinute - left.endMinute
      || left.key.localeCompare(right.key));

  const blocks: TimedBlock[] = [];
  let group: Array<{ item: (typeof items)[number]; column: number }> = [];
  let columnEnds: number[] = [];
  let groupEnd = -Infinity;

  const closeGroup = () => {
    const columns = Math.max(1, columnEnds.length);
    for (const { item, column } of group) {
      let top = (item.startMinute / 60) * hourHeight;
      let height = Math.max(minHeight, ((item.endMinute - item.startMinute) / 60) * hourHeight);
      if (top + height > dayHeight) {
        height = Math.max(Math.min(height, dayHeight), minHeight);
        top = Math.max(0, dayHeight - height);
      }
      blocks.push({ key: item.key, startMinute: item.startMinute, endMinute: item.endMinute, top, height, column, columns });
    }
    group = [];
    columnEnds = [];
    groupEnd = -Infinity;
  };

  for (const item of items) {
    if (group.length > 0 && item.startMinute >= groupEnd) closeGroup();
    let column = columnEnds.findIndex(end => end <= item.startMinute);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.visualEnd);
    } else {
      columnEnds[column] = item.visualEnd;
    }
    group.push({ item, column });
    groupEnd = Math.max(groupEnd, item.visualEnd);
  }
  if (group.length > 0) closeGroup();
  return blocks;
}

export interface PositionedTimedEvent extends TimedBlock {
  event: CalendarEvent;
  /** The event started on an earlier day (crosses midnight into this one). */
  continuesBefore: boolean;
  /** The event ends on a later day. */
  continuesAfter: boolean;
}

export function calendarEventKey(event: Pick<CalendarEvent, 'accountId' | 'calendarId' | 'id'>): string {
  return `${event.accountId}:${event.calendarId}:${event.id}`;
}

/**
 * Where a moment falls on `dayStart`'s day by the clock: 14:30 is always minute
 * 870. Moments before the day are negative, moments after it exceed 1440.
 */
function wallClockMinuteOfDay(moment: number, dayStart: number): number {
  const date = new Date(moment);
  const dayOfMoment = startOfCalendarDay(date).getTime();
  const minutes = date.getHours() * 60 + date.getMinutes() + date.getSeconds() / 60;
  if (dayOfMoment === dayStart) return minutes;
  // Whole calendar days apart, counted by date so a 23- or 25-hour day is still one day.
  const days = Math.round((dayOfMoment - dayStart) / 86_400_000);
  return days * MINUTES_PER_DAY + minutes;
}

/** Timed (not all-day) events of `day`, positioned for a column `24 × hourHeight` tall. */
export function layoutTimedEventsForDay(
  events: readonly CalendarEvent[],
  day: Date,
  options: TimedLayoutOptions,
): PositionedTimedEvent[] {
  const dayStart = startOfCalendarDay(day).getTime();
  const timed = calendarEventsForDate([...events], day).filter(event => !event.isAllDay);
  const byKey = new Map<string, { event: CalendarEvent; continuesBefore: boolean; continuesAfter: boolean }>();
  const intervals: TimedInterval[] = [];
  for (const event of timed) {
    const start = Date.parse(event.startAt);
    const end = Date.parse(event.endAt);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const key = calendarEventKey(event);
    // Wall-clock minutes of this day, not elapsed minutes: on the days the
    // clocks change (23 or 25 hours) elapsed time would draw every later
    // event an hour off its label.
    const startMinute = wallClockMinuteOfDay(start, dayStart);
    const endMinute = wallClockMinuteOfDay(end, dayStart);
    byKey.set(key, { event, continuesBefore: startMinute < 0, continuesAfter: endMinute > MINUTES_PER_DAY });
    intervals.push({ key, startMinute, endMinute });
  }
  return layoutTimedIntervals(intervals, options).flatMap(block => {
    const source = byKey.get(block.key);
    return source ? [{ ...block, ...source }] : [];
  });
}

/** Whether a block has room for the title and the time range on two lines. */
export function timedBlockHasTwoLines(height: number, lineHeight: number): boolean {
  return height >= lineHeight * 2 + 6;
}

/** Minute of the day under a pointer, snapped to `step` minutes. */
export function minuteAtOffset(offsetY: number, hourHeight: number, step = 15): number {
  const raw = (offsetY / hourHeight) * 60;
  return clamp(Math.round(raw / step) * step, 0, MINUTES_PER_DAY - step);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** Events shown in the all-day row of the time grid: all-day ones and timed ones lasting a day or more. */
export function isAllDayRowEvent(event: Pick<CalendarEvent, 'isAllDay' | 'startAt' | 'endAt'>): boolean {
  if (event.isAllDay) return true;
  const duration = Date.parse(event.endAt) - Date.parse(event.startAt);
  return Number.isFinite(duration) && duration >= MINUTES_PER_DAY * 60_000;
}
