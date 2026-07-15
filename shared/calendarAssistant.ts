import type { CalendarEvent } from './types';

export const CALENDAR_SEARCH_TOOL_NAME = 'searchCalendar';
export const CALENDAR_FREE_SLOTS_TOOL_NAME = 'findCalendarFreeSlots';
export const CALENDAR_ASSISTANT_PRIVACY_NOTE = 'Read from the local Dumka Calendar cache. No remote calendar search was performed.';

export interface CalendarAssistantSource {
  accountId: string;
  calendarId: string;
  eventId: string;
  summary: string;
  startAt: string;
  endAt: string;
  isAllDay: boolean;
  location?: string | null;
}

export interface CalendarAssistantSlot {
  startAt: string;
  endAt: string;
}

export function calendarAssistantSource(event: CalendarEvent): CalendarAssistantSource {
  return {
    accountId: event.accountId,
    calendarId: event.calendarId,
    eventId: event.id,
    summary: event.summary,
    startAt: event.startAt,
    endAt: event.endAt,
    isAllDay: event.isAllDay,
    location: event.location || null,
  };
}

export function findCalendarFreeSlots(
  events: CalendarEvent[],
  startAt: string,
  endAt: string,
  durationMinutes: number,
  maxSlots = 8,
): CalendarAssistantSlot[] {
  const startMs = Date.parse(startAt);
  const endMs = Date.parse(endAt);
  const durationMs = Math.max(15, Math.min(480, Math.floor(durationMinutes))) * 60_000;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || endMs - startMs > 31 * 86_400_000) return [];
  const busy = events
    .filter(event => event.status !== 'cancelled' && event.transparency !== 'transparent')
    .map(event => ({ start: Math.max(startMs, Date.parse(event.startAt)), end: Math.min(endMs, Date.parse(event.endAt)) }))
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((left, right) => left.start - right.start);
  const merged: Array<{ start: number; end: number }> = [];
  for (const interval of busy) {
    const previous = merged.at(-1);
    if (previous && interval.start <= previous.end) previous.end = Math.max(previous.end, interval.end);
    else merged.push({ ...interval });
  }
  const slots: CalendarAssistantSlot[] = [];
  let cursor = startMs;
  for (const interval of merged) {
    if (interval.start - cursor >= durationMs) slots.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(cursor + durationMs).toISOString() });
    cursor = Math.max(cursor, interval.end);
    if (slots.length >= maxSlots) return slots;
  }
  if (endMs - cursor >= durationMs) slots.push({ startAt: new Date(cursor).toISOString(), endAt: new Date(cursor + durationMs).toISOString() });
  return slots.slice(0, Math.max(1, Math.min(20, maxSlots)));
}
