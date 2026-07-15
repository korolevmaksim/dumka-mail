import type {
  CalendarAttendee,
  CalendarAttendeeResponse,
  CalendarAccessRole,
  CalendarBusyInterval,
  CalendarEvent,
  CalendarFreeBusyResult,
  CalendarListEntry,
} from '../shared/types';

export interface GoogleCalendarAttendeeResource {
  email?: string;
  displayName?: string;
  responseStatus?: CalendarAttendeeResponse;
  optional?: boolean;
  self?: boolean;
}

export interface GoogleCalendarEventResource {
  id?: string;
  iCalUID?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
  originalStartTime?: { date?: string; dateTime?: string; timeZone?: string };
  status?: string;
  etag?: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  organizer?: { email?: string };
  creator?: { email?: string };
  recurringEventId?: string;
  recurrence?: string[];
  transparency?: CalendarEvent['transparency'];
  visibility?: CalendarEvent['visibility'];
  colorId?: string;
  attendees?: GoogleCalendarAttendeeResource[];
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method: 'email' | 'popup'; minutes: number }>;
  };
  extendedProperties?: { private?: Record<string, string | undefined> };
  updated?: string;
}

export interface GoogleCalendarListResource {
  id?: string;
  summary?: string;
  summaryOverride?: string;
  description?: string;
  primary?: boolean;
  selected?: boolean;
  accessRole?: string;
  backgroundColor?: string;
  foregroundColor?: string;
  timeZone?: string;
  deleted?: boolean;
}

interface GoogleFreeBusyCalendarResource {
  busy?: Array<{ start?: string; end?: string }>;
  errors?: Array<{ reason?: string; domain?: string }>;
}

export interface GoogleFreeBusyResource {
  calendars?: Record<string, GoogleFreeBusyCalendarResource>;
}

export function isoFromGoogleDate(value: { date?: string; dateTime?: string } | undefined, fallback: Date): { iso: string; allDay: boolean } {
  if (!value) return { iso: fallback.toISOString(), allDay: false };
  if (value.dateTime) return { iso: new Date(value.dateTime).toISOString(), allDay: false };
  if (value.date) return { iso: new Date(`${value.date}T00:00:00`).toISOString(), allDay: true };
  return { iso: fallback.toISOString(), allDay: false };
}

export function mapCalendarAttendees(attendees: GoogleCalendarAttendeeResource[] | undefined): CalendarAttendee[] {
  return (attendees || [])
    .filter((attendee): attendee is GoogleCalendarAttendeeResource & { email: string } => typeof attendee.email === 'string' && Boolean(attendee.email.trim()))
    .map(attendee => ({
      email: attendee.email,
      displayName: attendee.displayName || null,
      responseStatus: attendee.responseStatus || null,
      optional: attendee.optional === true,
    }));
}

function calendarAccessRole(value: string | undefined): CalendarAccessRole {
  switch (value) {
    case 'none':
    case 'freeBusyReader':
    case 'reader':
    case 'writer':
    case 'owner':
      return value;
    default:
      return 'reader';
  }
}

function conferenceUrlFromEvent(raw: GoogleCalendarEventResource): string | null {
  if (raw.hangoutLink) return raw.hangoutLink;
  const entryPoints = raw.conferenceData?.entryPoints || [];
  const video = entryPoints.find(entry => entry.entryPointType === 'video' && entry.uri);
  return video?.uri || null;
}

export function mapCalendarFreeBusyResult(raw: GoogleFreeBusyResource): CalendarFreeBusyResult {
  const calendars = Object.entries(raw.calendars || {}).map(([id, value]) => {
    const busy: CalendarBusyInterval[] = (value.busy || [])
      .filter((interval): interval is { start: string; end: string } => Boolean(interval.start && interval.end))
      .map(interval => ({
        calendarId: id,
        startAt: new Date(interval.start).toISOString(),
        endAt: new Date(interval.end).toISOString(),
      }));
    return { id, busy, errors: value.errors || undefined };
  });
  return { calendars, busy: calendars.flatMap(calendar => calendar.busy) };
}

export function mapCalendarEvent(raw: GoogleCalendarEventResource, accountId: string, calendarId = 'primary'): CalendarEvent {
  const start = isoFromGoogleDate(raw.start, new Date());
  const end = isoFromGoogleDate(raw.end, new Date(new Date(start.iso).getTime() + 30 * 60_000));
  return {
    id: raw.id || '',
    accountId,
    calendarId,
    iCalUID: raw.iCalUID || null,
    summary: raw.summary || '(No title)',
    description: raw.description || null,
    location: raw.location || null,
    startAt: start.iso,
    endAt: end.iso,
    isAllDay: start.allDay || end.allDay,
    startDate: raw.start?.date || null,
    endDate: raw.end?.date || null,
    timeZone: raw.start?.timeZone || raw.end?.timeZone || null,
    status: raw.status || null,
    etag: raw.etag || null,
    htmlLink: raw.htmlLink || null,
    conferenceUrl: conferenceUrlFromEvent(raw),
    organizerEmail: raw.organizer?.email || null,
    creatorEmail: raw.creator?.email || null,
    recurringEventId: raw.recurringEventId || null,
    originalStartAt: raw.originalStartTime ? isoFromGoogleDate(raw.originalStartTime, new Date(start.iso)).iso : null,
    recurrenceRules: Array.isArray(raw.recurrence) ? raw.recurrence : [],
    transparency: raw.transparency || null,
    visibility: raw.visibility || null,
    colorId: raw.colorId || null,
    selfResponseStatus: raw.attendees?.find(attendee => attendee.self)?.responseStatus || null,
    reminders: raw.reminders ? {
      useDefault: raw.reminders.useDefault !== false,
      overrides: Array.isArray(raw.reminders.overrides) ? raw.reminders.overrides : [],
    } : null,
    attendees: mapCalendarAttendees(raw.attendees),
    sourceMessageId: raw.extendedProperties?.private?.dumkaSourceMessageId || null,
    sourceThreadId: raw.extendedProperties?.private?.dumkaSourceThreadId || null,
    updatedAt: raw.updated ? new Date(raw.updated).toISOString() : new Date().toISOString(),
  };
}

export function mapCalendarListEntry(raw: GoogleCalendarListResource, accountId: string): CalendarListEntry | null {
  if (!raw?.id) return null;
  return {
    id: raw.id,
    accountId,
    summary: raw.summaryOverride || raw.summary || raw.id,
    description: raw.description || null,
    primary: raw.primary === true,
    selected: raw.selected !== false,
    accessRole: calendarAccessRole(raw.accessRole),
    backgroundColor: raw.backgroundColor || '#3b82f6',
    foregroundColor: raw.foregroundColor || '#ffffff',
    timeZone: raw.timeZone || null,
    deleted: raw.deleted === true,
    updatedAt: new Date().toISOString(),
  };
}
