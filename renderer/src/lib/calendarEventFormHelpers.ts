import type { CalendarEvent, CalendarEventRecurrence } from '../../../shared/types';
import type { CalendarConflict } from '../../../shared/calendarAvailability';
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

function recurrenceLabel(recurrence: CalendarEventRecurrence): string | null {
  return RECURRENCE_OPTIONS.find(option => option.value === recurrence)?.label || null;
}

function timeRangeLabel(startAt: string, endAt: string): string {
  const start = new Date(startAt);
  const end = new Date(endAt);
  return `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function conflictTimeLabel(conflict: CalendarConflict): string {
  const anchor = new Date(conflict.occurrenceStartAt || conflict.overlapStartAt);
  const day = anchor.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${timeRangeLabel(conflict.overlapStartAt, conflict.overlapEndAt)}`;
}

export function quickDraftLabel(draft: NaturalLanguageCalendarEventDraft): string {
  const date = new Date(`${draft.date}T${draft.startTime}:00`);
  const when = `${date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
  return [
    draft.title,
    when,
    `${draft.durationMinutes}m`,
    draft.recurrence !== 'none' ? recurrenceLabel(draft.recurrence) : null,
    draft.location,
    draft.attendees.length > 0 ? `${draft.attendees.length} guest${draft.attendees.length === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ');
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

export function attendeeInputValue(event: CalendarEvent | null | undefined): string {
  return (event?.attendees || [])
    .map(attendee => attendee.email)
    .filter(Boolean)
    .join(', ');
}

export function sameBusyInterval(startA: string, endA: string, startB: string, endB: string): boolean {
  const toleranceMs = 60_000;
  return Math.abs(new Date(startA).getTime() - new Date(startB).getTime()) <= toleranceMs
    && Math.abs(new Date(endA).getTime() - new Date(endB).getTime()) <= toleranceMs;
}
