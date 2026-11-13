import type { CalendarEvent, CalendarEventRecurrence, CalendarListEntry, Recipient } from '../../../shared/types';
import type { CalendarConflict } from '../../../shared/calendarAvailability';
import { formatDateTime, formatDuration, formatTimeRange, formatWeekdayDay } from '../../../shared/dateFormat';
import {
  localDateInputValue,
  localTimeInputValue,
  type NaturalLanguageCalendarEventDraft,
} from '../../../shared/calendarCreate';

export const RECURRENCE_OPTIONS: Array<{ value: CalendarEventRecurrence; label: string }> = [
  { value: 'none', label: 'Does not repeat' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
];

export const EVENT_COLOR_OPTIONS = [
  ['1', 'Lavender'], ['2', 'Sage'], ['3', 'Grape'], ['4', 'Flamingo'], ['5', 'Banana'], ['6', 'Tangerine'],
  ['7', 'Peacock'], ['8', 'Graphite'], ['9', 'Blueberry'], ['10', 'Basil'], ['11', 'Tomato'],
] as const;

export function nextCalendarDateInput(value: string, days = 1): string {
  const date = new Date(`${value}T12:00:00`);
  if (!Number.isFinite(date.getTime())) return value;
  date.setDate(date.getDate() + days);
  return localDateInputValue(date);
}

function recurrenceLabel(recurrence: CalendarEventRecurrence): string | null {
  return RECURRENCE_OPTIONS.find(option => option.value === recurrence)?.label || null;
}

export function conflictTimeLabel(conflict: CalendarConflict, now: Date = new Date()): string {
  const anchor = new Date(conflict.occurrenceStartAt || conflict.overlapStartAt);
  return `${formatWeekdayDay(anchor, now)} · ${formatTimeRange(conflict.overlapStartAt, conflict.overlapEndAt, now)}`;
}

export function quickDraftLabel(draft: NaturalLanguageCalendarEventDraft, now: Date = new Date()): string {
  const date = new Date(`${draft.date}T${draft.startTime}:00`);
  return [
    draft.title,
    formatDateTime(date, now),
    formatDuration(draft.durationMinutes),
    draft.recurrence !== 'none' ? recurrenceLabel(draft.recurrence) : null,
    draft.location,
    draft.attendees.length > 0 ? `${draft.attendees.length} guest${draft.attendees.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
}

/**
 * Reads a typed clock time: "14:30", "1430", "930", "9", "9.30" → "HH:MM"
 * (24-hour). Returns null when it is not a valid time.
 */
export function parseClockInput(value: string): string | null {
  const text = value.trim();
  const match = /^(\d{1,2})[:.h](\d{2})$/.exec(text)
    || /^(\d{1,2})(\d{2})$/.exec(text)
    || /^(\d{1,2})$/.exec(text);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = match[2] === undefined ? 0 : Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

/** Quarter-hour times of a day ("00:00" … "23:45") for the time field's suggestions. */
export function quarterHourTimes(): string[] {
  return Array.from({ length: 96 }, (_, index) => `${String(Math.floor(index / 4)).padStart(2, '0')}:${String((index % 4) * 15).padStart(2, '0')}`);
}

/** End time of a timed event, "14:45", from a date input, a start time and minutes. */
export function eventEndClock(date: string, startTime: string, durationMinutes: number, now: Date = new Date()): string | null {
  const start = new Date(`${date}T${startTime}:00`);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(durationMinutes)) return null;
  const end = new Date(start.getTime() + durationMinutes * 60_000);
  return formatTimeRange(start, end, now).split(/\u2013| \u2013 /).pop()?.trim() || null;
}

export function formDefaultsFromEvent(event: CalendarEvent, fallbackDurationMinutes: number) {
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  const durationMs = end.getTime() - start.getTime();
  return {
    date: localDateInputValue(start),
    startTime: localTimeInputValue(start),
    durationMinutes: Number.isFinite(durationMs) && durationMs > 0
      ? Math.max(15, Math.round(durationMs / 60_000))
      : Math.max(15, Math.floor(fallbackDurationMinutes || 30)),
  };
}

export function attendeeRecipients(event: CalendarEvent | null | undefined, initialAttendees: string[] = []): Recipient[] {
  const recipients = event
    ? event.attendees.map(attendee => ({ name: attendee.displayName?.trim() || '', email: attendee.email.trim() }))
    : initialAttendees.map(email => ({ name: '', email: email.trim() }));
  const seen = new Set<string>();
  return recipients.filter(recipient => {
    const key = recipient.email.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function calendarSelectionKey(calendar: Pick<CalendarListEntry, 'accountId' | 'id'>): string {
  return JSON.stringify([calendar.accountId, calendar.id]);
}

export function initialCalendarSelection(
  calendars: CalendarListEntry[],
  event: CalendarEvent | null | undefined,
  defaultAccountId: string,
  defaultCalendarId: string | null | undefined,
): string {
  const writableCalendars = calendars.filter(calendar => calendar.accessRole === 'writer' || calendar.accessRole === 'owner');
  const exactEventCalendar = event
    ? writableCalendars.find(calendar => calendar.accountId === event.accountId && calendar.id === event.calendarId)
    : null;
  const accountCalendars = writableCalendars.filter(calendar => calendar.accountId === defaultAccountId);
  const selected = exactEventCalendar
    || accountCalendars.find(calendar => calendar.id === defaultCalendarId)
    || accountCalendars.find(calendar => calendar.primary)
    || accountCalendars[0]
    || writableCalendars.find(calendar => calendar.id === defaultCalendarId)
    || writableCalendars.find(calendar => calendar.primary)
    || writableCalendars[0];
  return selected ? calendarSelectionKey(selected) : '';
}

export function sameBusyInterval(startA: string, endA: string, startB: string, endB: string): boolean {
  const toleranceMs = 60_000;
  return Math.abs(new Date(startA).getTime() - new Date(startB).getTime()) <= toleranceMs
    && Math.abs(new Date(endA).getTime() - new Date(endB).getTime()) <= toleranceMs;
}
