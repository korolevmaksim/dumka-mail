import type { CalendarEvent, CalendarListEntry, CalendarWorkspaceView } from './types';

export interface CalendarDateRange {
  startAt: string;
  endAt: string;
}

export interface CalendarMonthDay {
  date: Date;
  key: string;
  inMonth: boolean;
  isToday: boolean;
}

export interface PositionedCalendarEvent {
  event: CalendarEvent;
  topPercent: number;
  heightPercent: number;
  column: number;
  columnCount: number;
}

export interface CalendarAllDaySpan {
  event: CalendarEvent;
  startColumn: number;
  endColumn: number;
  lane: number;
}

export interface CalendarQuickAddResult {
  summary: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
}

const DAY_MS = 86_400_000;

export function calendarDateKey(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

export function addCalendarDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

export function startOfCalendarWeek(date: Date, weekStartsOn: 0 | 1): Date {
  const start = startOfCalendarDay(date);
  const offset = (start.getDay() - weekStartsOn + 7) % 7;
  start.setDate(start.getDate() - offset);
  return start;
}

export function calendarViewRange(
  anchor: Date,
  view: CalendarWorkspaceView,
  weekStartsOn: 0 | 1 = 1,
): CalendarDateRange {
  let start: Date;
  let end: Date;
  switch (view) {
    case 'day':
      start = startOfCalendarDay(anchor);
      end = addCalendarDays(start, 1);
      break;
    case 'week':
      start = startOfCalendarWeek(anchor, weekStartsOn);
      end = addCalendarDays(start, 7);
      break;
    case 'agenda':
      start = startOfCalendarDay(anchor);
      end = addCalendarDays(start, 31);
      break;
    case 'quarter': {
      const quarterMonth = Math.floor(anchor.getMonth() / 3) * 3;
      start = new Date(anchor.getFullYear(), quarterMonth, 1);
      end = new Date(anchor.getFullYear(), quarterMonth + 3, 1);
      break;
    }
    case 'year':
      start = new Date(anchor.getFullYear(), 0, 1);
      end = new Date(anchor.getFullYear() + 1, 0, 1);
      break;
    case 'month':
    default:
      start = startOfCalendarWeek(new Date(anchor.getFullYear(), anchor.getMonth(), 1), weekStartsOn);
      end = addCalendarDays(start, 42);
      break;
  }
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function calendarMonthDays(anchor: Date, weekStartsOn: 0 | 1 = 1): CalendarMonthDay[] {
  const month = anchor.getMonth();
  const start = startOfCalendarWeek(new Date(anchor.getFullYear(), month, 1), weekStartsOn);
  const todayKey = calendarDateKey(new Date());
  return Array.from({ length: 42 }, (_, index) => {
    const date = addCalendarDays(start, index);
    const key = calendarDateKey(date);
    return { date, key, inMonth: date.getMonth() === month, isToday: key === todayKey };
  });
}

function eventStart(event: CalendarEvent): Date {
  if (event.isAllDay && event.startDate) return new Date(`${event.startDate}T00:00:00`);
  return new Date(event.startAt);
}

function eventEnd(event: CalendarEvent): Date {
  if (event.isAllDay && event.endDate) return new Date(`${event.endDate}T00:00:00`);
  return new Date(event.endAt);
}

export function calendarEventOverlapsDay(event: CalendarEvent, day: Date): boolean {
  const start = eventStart(event);
  const end = eventEnd(event);
  const dayStart = startOfCalendarDay(day);
  const dayEnd = addCalendarDays(dayStart, 1);
  return start < dayEnd && end > dayStart;
}

export function calendarEventsForDate(events: CalendarEvent[], day: Date): CalendarEvent[] {
  return events
    .filter(event => event.status !== 'cancelled' && calendarEventOverlapsDay(event, day))
    .sort((left, right) => {
      if (left.isAllDay !== right.isAllDay) return left.isAllDay ? -1 : 1;
      return eventStart(left).getTime() - eventStart(right).getTime();
    });
}

export function layoutCalendarAllDayLanes(events: CalendarEvent[], days: Date[]): CalendarAllDaySpan[] {
  const candidates = events
    .filter(event => event.status !== 'cancelled')
    .map(event => ({
      event,
      columns: days.flatMap((day, index) => calendarEventOverlapsDay(event, day) ? [index] : []),
    }))
    .filter(item => item.columns.length > 0 && (item.event.isAllDay || item.columns.length > 1))
    .map(item => ({
      event: item.event,
      startColumn: item.columns[0],
      endColumn: item.columns[item.columns.length - 1],
    }))
    .sort((left, right) => left.startColumn - right.startColumn || right.endColumn - left.endColumn || left.event.id.localeCompare(right.event.id));

  const spans: CalendarAllDaySpan[] = [];
  for (const candidate of candidates) {
    const usedLanes = new Set(spans
      .filter(span => span.endColumn >= candidate.startColumn && span.startColumn <= candidate.endColumn)
      .map(span => span.lane));
    let lane = 0;
    while (usedLanes.has(lane)) lane += 1;
    spans.push({ ...candidate, lane });
  }
  return spans;
}

export function filterCalendarEvents(
  events: CalendarEvent[],
  calendars: CalendarListEntry[],
  hiddenCalendarIds: string[],
  query: string,
): CalendarEvent[] {
  const hidden = new Set(hiddenCalendarIds);
  const activeKeys = new Set(calendars.filter(calendar => calendar.selected && !calendar.deleted).map(calendar => `${calendar.accountId}:${calendar.id}`));
  const normalizedQuery = query.trim().toLocaleLowerCase();
  return events.filter(event => {
    if (event.status === 'cancelled' || hidden.has(event.calendarId) || hidden.has(`${event.accountId}:${event.calendarId}`)) return false;
    if (activeKeys.size > 0 && !activeKeys.has(`${event.accountId}:${event.calendarId}`)) return false;
    if (!normalizedQuery) return true;
    return [event.summary, event.description, event.location, event.organizerEmail, ...event.attendees.map(item => item.email)]
      .filter(Boolean)
      .some(value => String(value).toLocaleLowerCase().includes(normalizedQuery));
  });
}

export function layoutTimedCalendarEvents(
  events: CalendarEvent[],
  day: Date,
  dayStartHour = 0,
  dayEndHour = 24,
): PositionedCalendarEvent[] {
  const dayStart = startOfCalendarDay(day);
  dayStart.setHours(dayStartHour);
  const dayEnd = startOfCalendarDay(day);
  dayEnd.setHours(dayEndHour);
  const visibleMinutes = Math.max(60, (dayEnd.getTime() - dayStart.getTime()) / 60_000);
  const timed = calendarEventsForDate(events, day)
    .filter(event => !event.isAllDay)
    .map(event => ({ event, start: Math.max(eventStart(event).getTime(), dayStart.getTime()), end: Math.min(eventEnd(event).getTime(), dayEnd.getTime()) }))
    .filter(item => item.end > item.start)
    .sort((left, right) => left.start - right.start || right.end - left.end);

  const positioned: Array<PositionedCalendarEvent & { start: number; end: number }> = [];
  for (const item of timed) {
    const overlapping = positioned.filter(previous => previous.end > item.start && previous.start < item.end);
    const used = new Set(overlapping.map(previous => previous.column));
    let column = 0;
    while (used.has(column)) column += 1;
    positioned.push({
      event: item.event,
      start: item.start,
      end: item.end,
      column,
      columnCount: 1,
      topPercent: ((item.start - dayStart.getTime()) / 60_000 / visibleMinutes) * 100,
      heightPercent: Math.max(1.8, ((item.end - item.start) / 60_000 / visibleMinutes) * 100),
    });
  }

  for (const current of positioned) {
    const cluster = positioned.filter(other => other.end > current.start && other.start < current.end);
    current.columnCount = Math.max(1, ...cluster.map(other => other.column + 1));
  }
  return positioned.map(({ start: _start, end: _end, ...item }) => item);
}

function nextWeekday(anchor: Date, weekday: number): Date {
  const date = startOfCalendarDay(anchor);
  let offset = (weekday - date.getDay() + 7) % 7;
  if (offset === 0) offset = 7;
  return addCalendarDays(date, offset);
}

export function parseCalendarQuickAdd(
  input: string,
  now = new Date(),
  defaultDurationMinutes = 30,
): CalendarQuickAddResult | null {
  let text = input.trim();
  if (!text) return null;
  let day = startOfCalendarDay(now);
  const lower = text.toLocaleLowerCase();
  if (/\btomorrow\b/.test(lower)) day = addCalendarDays(day, 1);
  const weekdayNames = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
  const weekday = weekdayNames.findIndex(name => new RegExp(`\\b${name}\\b`, 'i').test(text));
  if (weekday >= 0) day = nextWeekday(now, weekday);

  const timeMatch = text.match(/(?:\bat\s*)?\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i);
  const allDay = /\ball[ -]?day\b/i.test(text);
  let hour = 9;
  let minute = 0;
  if (timeMatch && !allDay) {
    hour = Number(timeMatch[1]);
    minute = Number(timeMatch[2] || 0);
    const meridiem = timeMatch[3]?.toLocaleLowerCase();
    if (meridiem === 'pm' && hour < 12) hour += 12;
    if (meridiem === 'am' && hour === 12) hour = 0;
    if (hour > 23 || minute > 59) return null;
  }

  const durationMatch = text.match(/\bfor\s+(\d+)\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/i);
  const duration = durationMatch
    ? Number(durationMatch[1]) * (/^h/i.test(durationMatch[2]) ? 60 : 1)
    : defaultDurationMinutes;
  text = text
    .replace(/\b(today|tomorrow|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/gi, '')
    .replace(/\ball[ -]?day\b/gi, '')
    .replace(/\bfor\s+\d+\s*(m|min|mins|minutes|h|hr|hrs|hours)\b/gi, '')
    .replace(timeMatch?.[0] || /$^/, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const start = new Date(day);
  if (!allDay) start.setHours(hour, minute, 0, 0);
  const end = allDay ? addCalendarDays(start, 1) : new Date(start.getTime() + Math.max(5, duration) * 60_000);
  return { summary: text || 'New event', startAt: start.toISOString(), endAt: end.toISOString(), isAllDay: allDay };
}

export function calendarNavigationDate(anchor: Date, view: CalendarWorkspaceView, direction: -1 | 1): Date {
  const next = new Date(anchor);
  if (view === 'day') next.setDate(next.getDate() + direction);
  else if (view === 'week' || view === 'agenda') next.setDate(next.getDate() + direction * 7);
  else if (view === 'month') next.setMonth(next.getMonth() + direction);
  else if (view === 'quarter') next.setMonth(next.getMonth() + direction * 3);
  else next.setFullYear(next.getFullYear() + direction);
  return next;
}

export function calendarEventDurationMinutes(event: CalendarEvent): number {
  return Math.max(1, Math.round((eventEnd(event).getTime() - eventStart(event).getTime()) / 60_000));
}

export function moveCalendarEventToDate(event: CalendarEvent, date: Date): { startAt: string; endAt: string; startDate?: string; endDate?: string } {
  const duration = eventEnd(event).getTime() - eventStart(event).getTime();
  if (event.isAllDay) {
    const startDate = calendarDateKey(date);
    const days = Math.max(1, Math.round(duration / DAY_MS));
    return { startAt: startOfCalendarDay(date).toISOString(), endAt: addCalendarDays(startOfCalendarDay(date), days).toISOString(), startDate, endDate: calendarDateKey(addCalendarDays(date, days)) };
  }
  const previous = eventStart(event);
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate(), previous.getHours(), previous.getMinutes());
  return { startAt: start.toISOString(), endAt: new Date(start.getTime() + duration).toISOString() };
}
