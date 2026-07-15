import type { CalendarEvent, CalendarEventCreateInput, CalendarEventUpdateInput, CalendarWorkspaceView } from '../../../shared/types';

export function calendarWorkspaceTitle(anchor: Date, view: CalendarWorkspaceView): string {
  if (view === 'day') return anchor.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'week' || view === 'agenda') return anchor.toLocaleDateString([], { month: 'long', day: 'numeric', year: 'numeric' });
  if (view === 'quarter') return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`;
  if (view === 'year') return String(anchor.getFullYear());
  return anchor.toLocaleDateString([], { month: 'long', year: 'numeric' });
}

export function restoredCalendarAnchor(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date();
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : new Date();
}

export function localCalendarDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function resolveCalendarAccountScope(persistedScope: string, accountEmails: string[]): string {
  if (persistedScope === 'unified') return 'unified';
  if (accountEmails.includes(persistedScope)) return persistedScope;
  return accountEmails.length > 0 ? 'unified' : '';
}

export function calendarEventFormKey(mode: 'create' | 'edit', event: CalendarEvent | null, session: number): string {
  return `${mode}:${event?.accountId || 'new'}:${event?.id || 'draft'}:${session}`;
}

export function secondaryCalendarTimeLabel(timeZone: string): string | null {
  if (!timeZone) return null;
  try {
    const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone });
    return `${time} ${timeZone.split('/').pop()?.replaceAll('_', ' ') || timeZone}`;
  } catch {
    return null;
  }
}

export function calendarEventUpdateInput(
  event: CalendarEvent,
  patch: Partial<Pick<CalendarEventUpdateInput, 'startAt' | 'endAt' | 'startDate' | 'endDate'>> = {},
): CalendarEventUpdateInput {
  return {
    eventId: event.id,
    calendarId: event.calendarId,
    summary: event.summary,
    description: event.description,
    location: event.location,
    startAt: patch.startAt || event.startAt,
    endAt: patch.endAt || event.endAt,
    attendees: event.attendees.map(attendee => attendee.email),
    conferenceProvider: 'none',
    recurrence: 'none',
    timeZone: event.timeZone,
    isAllDay: event.isAllDay,
    startDate: patch.startDate || event.startDate,
    endDate: patch.endDate || event.endDate,
    sendUpdates: 'all',
    transparency: event.transparency || 'opaque',
    visibility: event.visibility || 'default',
    colorId: event.colorId,
    reminders: event.reminders || undefined,
    recurringEventId: event.recurringEventId,
    originalStartAt: event.originalStartAt,
    mutationScope: 'single',
    etag: event.etag,
  };
}

export function calendarDuplicateInput(event: CalendarEvent, calendarId: string): CalendarEventCreateInput {
  return {
    calendarId,
    summary: `${event.summary} copy`,
    description: event.description,
    location: event.location,
    startAt: event.startAt,
    endAt: event.endAt,
    attendees: event.attendees.map(attendee => attendee.email),
    conferenceProvider: 'none',
    timeZone: event.timeZone,
    isAllDay: event.isAllDay,
    startDate: event.startDate,
    endDate: event.endDate,
    sendUpdates: 'none',
    transparency: event.transparency || 'opaque',
    visibility: event.visibility || 'default',
    colorId: event.colorId,
    reminders: event.reminders || undefined,
    sourceThreadId: event.sourceThreadId,
    sourceMessageId: event.sourceMessageId,
  };
}
