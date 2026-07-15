import crypto from 'crypto';
import {
  CalendarAttendeeResponse,
  CalendarAttendee,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
  CalendarListEntry,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResult,
  CalendarInvite
} from '../shared/types';
import { calendarTimeZoneForCreate, recurrenceRuleForCalendarCreate } from '../shared/calendarCreate';
import { fetchWithTimeout, getAccessToken } from './gmail';
import { GoogleContactsService } from './googleContacts';
import {
  isoFromGoogleDate,
  mapCalendarAttendees,
  mapCalendarEvent,
  mapCalendarFreeBusyResult,
  mapCalendarListEntry,
  type GoogleCalendarAttendeeResource,
  type GoogleCalendarEventResource,
  type GoogleCalendarListResource,
  type GoogleFreeBusyResource,
} from './googleCalendarMapper';

export { mapCalendarEvent, mapCalendarListEntry } from './googleCalendarMapper';

function googleApiError(prefix: string, responseText: string): Error {
  return new Error(`${prefix}: ${responseText}`);
}

function uniqueCalendarIds(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))];
}

function calendarEventTimes(input: CalendarEventCreateInput): { start: Record<string, string>; end: Record<string, string> } {
  if (input.isAllDay) {
    const startDate = input.startDate || inviteDateBoundary(input.startAt);
    const endDate = input.endDate || inviteDateBoundary(input.endAt);
    return { start: { date: startDate }, end: { date: endDate } };
  }
  const timeZone = calendarTimeZoneForCreate(input.recurrence, input.timeZone);
  return {
    start: { dateTime: input.startAt, ...(timeZone ? { timeZone } : {}) },
    end: { dateTime: input.endAt, ...(timeZone ? { timeZone } : {}) },
  };
}

function mergedCalendarAttendees(input: string[], existing: GoogleCalendarAttendeeResource[] = []): GoogleCalendarAttendeeResource[] {
  const byEmail = new Map<string, GoogleCalendarAttendeeResource>();
  for (const attendee of existing) {
    if (attendee.email) byEmail.set(attendee.email.toLowerCase(), attendee);
  }
  const merged = input
    .map(email => email.trim())
    .filter(Boolean)
    .map(email => ({ ...(byEmail.get(email.toLowerCase()) || {}), email }));
  const requestedEmails = new Set(merged.map(attendee => attendee.email.toLowerCase()));
  for (const attendee of existing) {
    if (attendee.self && attendee.email && !requestedEmails.has(attendee.email.toLowerCase())) {
      merged.push({ ...attendee, email: attendee.email });
    }
  }
  return merged;
}

function calendarEventWriteBody(
  input: CalendarEventCreateInput,
  includeRecurrence: boolean,
  existingAttendees: GoogleCalendarAttendeeResource[] = [],
) {
  const times = calendarEventTimes(input);
  const createMeet = input.conferenceProvider === 'googleMeet';
  return {
    summary: input.summary || '(No title)',
    description: input.description || undefined,
    location: input.location || undefined,
    start: times.start,
    end: times.end,
    attendees: mergedCalendarAttendees(input.attendees || [], existingAttendees),
    recurrence: includeRecurrence
      ? (input.recurrenceRules?.length ? input.recurrenceRules : recurrenceRuleForCalendarCreate(input.recurrence))
      : undefined,
    transparency: input.transparency || undefined,
    visibility: input.visibility || undefined,
    colorId: input.colorId || undefined,
    reminders: input.reminders ? {
      useDefault: input.reminders.useDefault,
      overrides: input.reminders.useDefault ? undefined : input.reminders.overrides,
    } : undefined,
    conferenceData: createMeet
      ? { createRequest: { requestId: `dumka-${crypto.randomUUID()}` } }
      : undefined,
  };
}

function attachLocalMailSource(event: CalendarEvent, input: CalendarEventCreateInput): CalendarEvent {
  return {
    ...event,
    sourceMessageId: input.sourceMessageId || null,
    sourceThreadId: input.sourceThreadId || null,
  };
}

function googleUntilValue(boundaryIso: string): string {
  const date = new Date(new Date(boundaryIso).getTime() - 1000);
  if (!Number.isFinite(date.getTime())) throw new Error('Recurring event boundary is invalid.');
  return date.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

export function recurrenceBeforeBoundary(rules: string[], boundaryIso: string, isAllDay = false): string[] {
  const until = isAllDay
    ? inviteDateBoundary(new Date(new Date(boundaryIso).getTime() - 86_400_000).toISOString()).replace(/-/g, '')
    : googleUntilValue(boundaryIso);
  return rules.map(rule => rule.toUpperCase().startsWith('RRULE:')
    ? `${rule.replace(/;(?:COUNT|UNTIL)=[^;]+/gi, '')};UNTIL=${until}`
    : rule);
}

export function recurrenceWithoutEnd(rules: string[]): string[] {
  return rules.map(rule => rule.replace(/;(?:COUNT|UNTIL)=[^;]+/gi, ''));
}

async function fetchRawCalendarEvent(accessToken: string, calendarId: string, eventId: string): Promise<GoogleCalendarEventResource> {
  const response = await fetchWithTimeout(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { headers: { 'Authorization': `Bearer ${accessToken}` } },
  );
  if (!response.ok) throw googleApiError('Calendar recurring event fetch error', await response.text());
  return response.json() as Promise<GoogleCalendarEventResource>;
}

function inviteDateBoundary(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function inviteEventTime(invite: CalendarInvite): { start: Record<string, string>; end: Record<string, string> } {
  if (invite.isAllDay) {
    return {
      start: { date: invite.startDate || inviteDateBoundary(invite.startAt) },
      end: { date: invite.endDate || inviteDateBoundary(invite.endAt) },
    };
  }
  if (invite.timeZone) {
    return {
      start: { dateTime: invite.startAt, timeZone: invite.timeZone },
      end: { dateTime: invite.endAt, timeZone: invite.timeZone },
    };
  }
  return {
    start: { dateTime: invite.startAt },
    end: { dateTime: invite.endAt },
  };
}

function inviteInsertBody(invite: CalendarInvite, attendees: CalendarAttendee[]) {
  const time = inviteEventTime(invite);
  return {
    summary: invite.summary || '(No title)',
    description: invite.description || undefined,
    location: invite.location || undefined,
    start: time.start,
    end: time.end,
    attendees,
    recurrence: invite.recurrenceRules && invite.recurrenceRules.length > 0 ? invite.recurrenceRules : undefined,
    extendedProperties: {
      private: { dumkaImportedInviteUid: invite.uid }
    }
  };
}

function nextRoundedStart(durationMinutes: number): { start: Date; end: Date } {
  const start = new Date();
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const end = new Date(start.getTime() + Math.max(15, durationMinutes) * 60_000);
  return { start, end };
}

export class GoogleCalendarSyncTokenExpiredError extends Error {
  constructor() {
    super('Google Calendar sync token expired.');
    this.name = 'GoogleCalendarSyncTokenExpiredError';
  }
}

async function fetchCalendarEventChanges(
  email: string,
  calendarId: string,
  startAt: string,
  endAt: string,
  syncToken?: string | null,
): Promise<{ events: CalendarEvent[]; nextSyncToken: string | null }> {
  const accessToken = await getAccessToken(email);
  const events: CalendarEvent[] = [];
  let pageToken = '';
  let nextSyncToken: string | null = null;
  do {
    const params = syncToken
      ? new URLSearchParams({ syncToken, showDeleted: 'true', singleEvents: 'true', maxResults: '2500' })
      : new URLSearchParams({
        timeMin: startAt,
        timeMax: endAt,
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '2500',
        showDeleted: 'true',
      });
    if (pageToken) params.set('pageToken', pageToken);
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`,
      { headers: { 'Authorization': `Bearer ${accessToken}` } },
    );
    if (response.status === 410 && syncToken) throw new GoogleCalendarSyncTokenExpiredError();
    if (!response.ok) throw googleApiError(`Calendar events fetch error (${calendarId})`, await response.text());
    const data = await response.json() as { items?: GoogleCalendarEventResource[]; nextPageToken?: string; nextSyncToken?: string };
    events.push(...(data.items || []).map(event => mapCalendarEvent(event, email, calendarId)));
    pageToken = data.nextPageToken || '';
    if (data.nextSyncToken) nextSyncToken = data.nextSyncToken;
  } while (pageToken);
  return { events, nextSyncToken: nextSyncToken || syncToken || null };
}

export const GoogleWorkspaceService = {
  async listCalendars(email: string): Promise<CalendarListEntry[]> {
    const accessToken = await getAccessToken(email);
    const calendars: CalendarListEntry[] = [];
    let pageToken = '';
    do {
      const params = new URLSearchParams({ maxResults: '250', showDeleted: 'true', showHidden: 'true' });
      if (pageToken) params.set('pageToken', pageToken);
      const res = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!res.ok) throw googleApiError('Calendar list fetch error', await res.text());
      const data = await res.json() as { items?: GoogleCalendarListResource[]; nextPageToken?: string };
      for (const raw of data.items || []) {
        const calendar = mapCalendarListEntry(raw, email);
        if (calendar) calendars.push(calendar);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);
    return calendars;
  },

  async listCalendarEvents(email: string, calendarId: string, startAt: string, endAt: string): Promise<CalendarEvent[]> {
    return (await fetchCalendarEventChanges(email, calendarId, startAt, endAt)).events;
  },

  async syncCalendarEvents(email: string, calendarId: string, startAt: string, endAt: string, syncToken?: string | null): Promise<{ events: CalendarEvent[]; nextSyncToken: string | null }> {
    return fetchCalendarEventChanges(email, calendarId, startAt, endAt, syncToken);
  },

  async listPrimaryCalendarEvents(email: string, startAt: string, endAt: string): Promise<CalendarEvent[]> {
    return this.listCalendarEvents(email, 'primary', startAt, endAt);
  },

  async queryCalendarFreeBusy(email: string, input: CalendarFreeBusyRequest): Promise<CalendarFreeBusyResult> {
    const accessToken = await getAccessToken(email);
    const calendarIds = uniqueCalendarIds(['primary', ...(input.calendarIds || []), ...input.attendees]);
    const body = {
      timeMin: input.timeMin,
      timeMax: input.timeMax,
      timeZone: input.timeZone || undefined,
      items: calendarIds.map(id => ({ id }))
    };
    const res = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/freeBusy', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw googleApiError('Calendar free/busy query error', await res.text());
    return mapCalendarFreeBusyResult(await res.json() as GoogleFreeBusyResource);
  },

  async createGoogleMeetDraftEvent(
    email: string,
    input: { summary: string; attendees: string[]; durationMinutes: number }
  ): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const { start, end } = nextRoundedStart(input.durationMinutes);
    const body = {
      summary: input.summary || 'Meeting',
      start: { dateTime: start.toISOString() },
      end: { dateTime: end.toISOString() },
      attendees: input.attendees.map(attendeeEmail => ({ email: attendeeEmail })),
      conferenceData: {
        createRequest: {
          requestId: `dumka-${crypto.randomUUID()}`
        }
      }
    };
    const res = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/calendars/primary/events?conferenceDataVersion=1&sendUpdates=none', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw googleApiError('Google Meet event create error', await res.text());
    return mapCalendarEvent(await res.json(), email);
  },

  async createCalendarEvent(email: string, input: CalendarEventCreateInput): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const createMeet = input.conferenceProvider === 'googleMeet';
    const calendarId = input.calendarId || 'primary';
    const body = calendarEventWriteBody(input, true);
    const params = new URLSearchParams({ sendUpdates: input.sendUpdates || 'none' });
    if (createMeet) params.set('conferenceDataVersion', '1');
    const res = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw googleApiError('Calendar event create error', await res.text());
    return attachLocalMailSource(mapCalendarEvent(await res.json(), email, calendarId), input);
  },

  async updateCalendarEvent(email: string, input: CalendarEventUpdateInput): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const calendarId = input.calendarId || 'primary';
    const originalCalendarId = input.originalCalendarId || calendarId;
    const scope = input.mutationScope || 'single';
    if (originalCalendarId !== calendarId) {
      if (scope !== 'single' || input.recurringEventId) {
        throw new Error('Recurring events must stay on their current calendar. Duplicate the event to move it safely.');
      }
      const updated = await this.updateCalendarEvent(email, {
        ...input,
        calendarId: originalCalendarId,
        originalCalendarId,
      });
      const params = new URLSearchParams({ destination: calendarId, sendUpdates: input.sendUpdates || 'none' });
      const movedResponse = await fetchWithTimeout(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(originalCalendarId)}/events/${encodeURIComponent(updated.id)}/move?${params.toString()}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${accessToken}`,
            ...(updated.etag ? { 'If-Match': updated.etag } : {}),
          },
        },
      );
      if (!movedResponse.ok) {
        if (movedResponse.status === 412) throw new Error('Calendar conflict: this event changed remotely. Refresh the calendar and review your move.');
        throw googleApiError('Calendar event move error', await movedResponse.text());
      }
      return attachLocalMailSource(
        mapCalendarEvent(await movedResponse.json() as GoogleCalendarEventResource, email, calendarId),
        input,
      );
    }
    if (scope === 'following') {
      if (!input.recurringEventId || !input.originalStartAt) throw new Error('This-and-following updates require recurring event identity.');
      const master = await fetchRawCalendarEvent(accessToken, calendarId, input.recurringEventId);
      const originalRules = Array.isArray(master.recurrence) ? master.recurrence : [];
      if (originalRules.length === 0) throw new Error('Recurring event rules are missing.');
      const masterResponse = await fetchWithTimeout(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.recurringEventId)}?sendUpdates=${input.sendUpdates || 'none'}`,
        {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ recurrence: recurrenceBeforeBoundary(originalRules, input.originalStartAt, input.isAllDay) }),
        },
      );
      if (!masterResponse.ok) throw googleApiError('Calendar series split error', await masterResponse.text());
      try {
        return await this.createCalendarEvent(email, {
          ...input,
          calendarId,
          recurrenceRules: recurrenceWithoutEnd(originalRules),
        });
      } catch (error) {
        await fetchWithTimeout(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.recurringEventId)}?sendUpdates=none`,
          { method: 'PATCH', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recurrence: originalRules }) },
        ).catch(() => undefined);
        throw error;
      }
    }
    const targetEventId = scope === 'series' && input.recurringEventId ? input.recurringEventId : input.eventId;
    let writeInput: CalendarEventUpdateInput = input;
    if (scope === 'series' && input.recurringEventId && input.originalStartAt) {
      const master = await fetchRawCalendarEvent(accessToken, calendarId, input.recurringEventId);
      const masterStart = isoFromGoogleDate(master.start, new Date(input.originalStartAt));
      const inputStartMs = new Date(input.startAt).getTime();
      const originalStartMs = new Date(input.originalStartAt).getTime();
      const masterStartMs = new Date(masterStart.iso).getTime();
      const inputDurationMs = Math.max(60_000, new Date(input.endAt).getTime() - inputStartMs);
      if (Number.isFinite(inputStartMs) && Number.isFinite(originalStartMs) && Number.isFinite(masterStartMs)) {
        const adjustedStart = new Date(masterStartMs + (inputStartMs - originalStartMs));
        writeInput = {
          ...input,
          startAt: adjustedStart.toISOString(),
          endAt: new Date(adjustedStart.getTime() + inputDurationMs).toISOString(),
          startDate: input.isAllDay ? inviteDateBoundary(adjustedStart.toISOString()) : input.startDate,
          endDate: input.isAllDay ? inviteDateBoundary(new Date(adjustedStart.getTime() + inputDurationMs).toISOString()) : input.endDate,
        };
      }
    }
    const addMeet = input.conferenceProvider === 'googleMeet';
    const existingEvent = await fetchRawCalendarEvent(accessToken, calendarId, targetEventId);
    const body = calendarEventWriteBody(writeInput, true, existingEvent.attendees);
    const params = new URLSearchParams({ sendUpdates: input.sendUpdates || 'none' });
    if (addMeet) params.set('conferenceDataVersion', '1');
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(input.etag && scope === 'single' ? { 'If-Match': input.etag } : {}),
        },
        body: JSON.stringify(body)
      }
    );

    if (!res.ok) {
      const responseText = await res.text();
      if (res.status === 412) throw new Error('Calendar conflict: this event changed remotely. Refresh the calendar and review your edit.');
      throw googleApiError('Calendar event update error', responseText);
    }
    return attachLocalMailSource(mapCalendarEvent(await res.json(), email, calendarId), input);
  },

  async respondToCalendarEvent(
    email: string,
    calendarId: string,
    eventId: string,
    responseStatus: CalendarAttendeeResponse,
  ): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const raw = await fetchRawCalendarEvent(accessToken, calendarId, eventId);
    const attendeeIndex = (raw.attendees || []).findIndex(attendee => attendee.self || attendee.email?.toLowerCase() === email.toLowerCase());
    if (attendeeIndex < 0) throw new Error('This calendar event does not include the current account as an attendee.');
    const attendees = [...(raw.attendees || [])];
    attendees[attendeeIndex] = { ...attendees[attendeeIndex], responseStatus };
    const response = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=all`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          ...(raw.etag ? { 'If-Match': raw.etag } : {}),
        },
        body: JSON.stringify({ attendees }),
      },
    );
    if (!response.ok) throw googleApiError('Calendar RSVP update error', await response.text());
    return mapCalendarEvent(await response.json() as GoogleCalendarEventResource, email, calendarId);
  },

  async deleteCalendarEvent(email: string, eventId: string, calendarId = 'primary', options: CalendarEventDeleteOptions = {}): Promise<void> {
    const accessToken = await getAccessToken(email);
    const scope = options.mutationScope || 'single';
    if (scope === 'following') {
      if (!options.recurringEventId || !options.originalStartAt) throw new Error('This-and-following deletion requires recurring event identity.');
      const master = await fetchRawCalendarEvent(accessToken, calendarId, options.recurringEventId);
      const recurrence = Array.isArray(master.recurrence) ? master.recurrence : [];
      if (recurrence.length === 0) throw new Error('Recurring event rules are missing.');
      const response = await fetchWithTimeout(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(options.recurringEventId)}?sendUpdates=${options.sendUpdates || 'all'}`,
        { method: 'PATCH', headers: { 'Authorization': `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ recurrence: recurrenceBeforeBoundary(recurrence, options.originalStartAt, options.isAllDay) }) },
      );
      if (!response.ok) throw googleApiError('Calendar following events delete error', await response.text());
      return;
    }
    const targetEventId = scope === 'series' && options.recurringEventId ? options.recurringEventId : eventId;
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(targetEventId)}?sendUpdates=${options.sendUpdates || 'all'}`,
      {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${accessToken}` }
      }
    );

    if (!res.ok && res.status !== 404 && res.status !== 410) {
      throw googleApiError('Calendar event delete error', await res.text());
    }
  },

  async respondToInvite(email: string, invite: CalendarInvite, responseStatus: CalendarAttendeeResponse): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const findParams = new URLSearchParams({
      iCalUID: invite.uid,
      singleEvents: 'true',
      maxResults: '10'
    });
    const findRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${findParams.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!findRes.ok) throw googleApiError('Calendar invite lookup error', await findRes.text());
    const found = await findRes.json() as { items?: GoogleCalendarEventResource[] };
    const event = (found.items || [])[0];

    if (event?.id) {
      const attendees = mapCalendarAttendees(event.attendees);
      const nextAttendees = attendees.some(attendee => attendee.email.toLowerCase() === email.toLowerCase())
        ? attendees.map(attendee => attendee.email.toLowerCase() === email.toLowerCase() ? { ...attendee, responseStatus } : attendee)
        : [...attendees, { email, responseStatus }];

      const patchRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events/${encodeURIComponent(event.id)}?sendUpdates=all`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ attendees: nextAttendees })
      });
      if (!patchRes.ok) throw googleApiError('Calendar RSVP update error', await patchRes.text());
      return mapCalendarEvent(await patchRes.json(), email);
    }

    const insertBody = inviteInsertBody(invite, [
      ...invite.attendees.map(attendee => ({ ...attendee })),
      { email, responseStatus }
    ]);
    const insertRes = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(insertBody)
    });
    if (!insertRes.ok) throw googleApiError('Calendar invite insert error', await insertRes.text());
    return mapCalendarEvent(await insertRes.json(), email);
  },

  async addInviteToCalendar(email: string, invite: CalendarInvite, calendarId = 'primary'): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const findParams = new URLSearchParams({
      iCalUID: invite.uid,
      singleEvents: 'true',
      maxResults: '10'
    });
    const findRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${findParams.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!findRes.ok) throw googleApiError('Calendar invite lookup error', await findRes.text());
    const found = await findRes.json() as { items?: GoogleCalendarEventResource[] };
    const existing = (found.items || [])[0];
    if (existing?.id) return mapCalendarEvent(existing, email, calendarId);

    const importedParams = new URLSearchParams({
      privateExtendedProperty: `dumkaImportedInviteUid=${invite.uid}`,
      singleEvents: 'true',
      maxResults: '10'
    });
    const importedRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?${importedParams.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!importedRes.ok) throw googleApiError('Calendar imported invite lookup error', await importedRes.text());
    const imported = await importedRes.json() as { items?: GoogleCalendarEventResource[] };
    const importedEvent = (imported.items || [])[0];
    if (importedEvent?.id) return mapCalendarEvent(importedEvent, email, calendarId);

    const insertBody = inviteInsertBody(invite, invite.attendees.map(attendee => ({ ...attendee })));
    const insertRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?sendUpdates=none`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(insertBody)
    });
    if (!insertRes.ok) throw googleApiError('Calendar event add error', await insertRes.text());
    return mapCalendarEvent(await insertRes.json(), email, calendarId);
  },

  listContacts: GoogleContactsService.listContacts,
};
