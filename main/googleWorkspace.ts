import crypto from 'crypto';
import {
  CalendarAttendee,
  CalendarAttendeeResponse,
  CalendarBusyInterval,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventUpdateInput,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResult,
  CalendarInvite,
  ContactCard,
  ContactGroup
} from '../shared/types';
import { calendarTimeZoneForCreate, recurrenceRuleForCalendarCreate } from '../shared/calendarCreate';
import { fetchWithTimeout, getAccessToken } from './gmail';

function googleApiError(prefix: string, responseText: string): Error {
  return new Error(`${prefix}: ${responseText}`);
}

function isoFromGoogleDate(value: { date?: string; dateTime?: string } | undefined, fallback: Date): { iso: string; allDay: boolean } {
  if (!value) return { iso: fallback.toISOString(), allDay: false };
  if (value.dateTime) return { iso: new Date(value.dateTime).toISOString(), allDay: false };
  if (value.date) return { iso: new Date(`${value.date}T00:00:00`).toISOString(), allDay: true };
  return { iso: fallback.toISOString(), allDay: false };
}

function mapAttendees(attendees: any[] | undefined): CalendarAttendee[] {
  return (attendees || [])
    .filter(attendee => typeof attendee.email === 'string' && attendee.email.trim())
    .map(attendee => ({
      email: attendee.email,
      displayName: attendee.displayName || null,
      responseStatus: attendee.responseStatus || null,
      optional: attendee.optional === true
    }));
}

function conferenceUrlFromEvent(raw: any): string | null {
  if (raw.hangoutLink) return raw.hangoutLink;
  const entryPoints = raw.conferenceData?.entryPoints || [];
  const video = entryPoints.find((entry: any) => entry.entryPointType === 'video' && entry.uri);
  return video?.uri || null;
}

function uniqueCalendarIds(ids: string[]): string[] {
  return [...new Set(ids.map(id => id.trim()).filter(Boolean))];
}

function mapFreeBusyResult(raw: any): CalendarFreeBusyResult {
  const calendars = Object.entries(raw.calendars || {}).map(([id, value]: [string, any]) => {
    const busy: CalendarBusyInterval[] = (value.busy || [])
      .filter((interval: any) => interval.start && interval.end)
      .map((interval: any) => ({
        calendarId: id,
        startAt: new Date(interval.start).toISOString(),
        endAt: new Date(interval.end).toISOString(),
      }));
    return {
      id,
      busy,
      errors: value.errors || undefined,
    };
  });
  return {
    calendars,
    busy: calendars.flatMap(calendar => calendar.busy),
  };
}

function mapCalendarEvent(raw: any, accountId: string, calendarId = 'primary'): CalendarEvent {
  const start = isoFromGoogleDate(raw.start, new Date());
  const end = isoFromGoogleDate(raw.end, new Date(new Date(start.iso).getTime() + 30 * 60_000));
  return {
    id: raw.id,
    accountId,
    calendarId,
    iCalUID: raw.iCalUID || null,
    summary: raw.summary || '(No title)',
    description: raw.description || null,
    location: raw.location || null,
    startAt: start.iso,
    endAt: end.iso,
    isAllDay: start.allDay || end.allDay,
    status: raw.status || null,
    htmlLink: raw.htmlLink || null,
    conferenceUrl: conferenceUrlFromEvent(raw),
    organizerEmail: raw.organizer?.email || null,
    attendees: mapAttendees(raw.attendees),
    updatedAt: raw.updated ? new Date(raw.updated).toISOString() : new Date().toISOString()
  };
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

function inviteInsertBody(invite: CalendarInvite, attendees: any[]) {
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

function mapContact(person: any, accountId: string): ContactCard | null {
  const email = person.emailAddresses?.find((entry: any) => entry.value)?.value;
  if (!email) return null;
  const displayName = person.names?.find((entry: any) => entry.displayName)?.displayName || email;
  const phoneNumbers = (person.phoneNumbers || []).map((entry: any) => entry.value).filter(Boolean);
  const organizations = (person.organizations || [])
    .map((entry: any) => [entry.title, entry.name].filter(Boolean).join(' · '))
    .filter(Boolean);
  const groupIds = (person.memberships || [])
    .map((entry: any) => entry.contactGroupMembership?.contactGroupResourceName)
    .filter(Boolean);

  return {
    id: person.resourceName || email,
    accountId,
    resourceName: person.resourceName || null,
    etag: person.etag || null,
    displayName,
    email,
    photoUrl: person.photos?.find((entry: any) => entry.url)?.url || null,
    phoneNumbers,
    organizations,
    notes: person.biographies?.find((entry: any) => entry.value)?.value || null,
    groupIds,
    updatedAt: new Date().toISOString()
  };
}

export const GoogleWorkspaceService = {
  async listPrimaryCalendarEvents(email: string, startAt: string, endAt: string): Promise<CalendarEvent[]> {
    const accessToken = await getAccessToken(email);
    const params = new URLSearchParams({
      timeMin: startAt,
      timeMax: endAt,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '100',
      showDeleted: 'false'
    });
    const res = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });

    if (!res.ok) throw googleApiError('Calendar events fetch error', await res.text());
    const data = await res.json() as { items?: any[] };
    return (data.items || []).map(event => mapCalendarEvent(event, email));
  },

  async queryCalendarFreeBusy(email: string, input: CalendarFreeBusyRequest): Promise<CalendarFreeBusyResult> {
    const accessToken = await getAccessToken(email);
    const calendarIds = uniqueCalendarIds(['primary', ...input.attendees]);
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
    return mapFreeBusyResult(await res.json());
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
    const recurrence = recurrenceRuleForCalendarCreate(input.recurrence);
    const timeZone = calendarTimeZoneForCreate(input.recurrence, input.timeZone);
    const body = {
      summary: input.summary || '(No title)',
      description: input.description || undefined,
      location: input.location || undefined,
      start: { dateTime: input.startAt, timeZone },
      end: { dateTime: input.endAt, timeZone },
      attendees: (input.attendees || [])
        .map(attendeeEmail => attendeeEmail.trim())
        .filter(Boolean)
        .map(attendeeEmail => ({ email: attendeeEmail })),
      recurrence,
      conferenceData: createMeet
        ? { createRequest: { requestId: `dumka-${crypto.randomUUID()}` } }
        : undefined
    };
    const params = new URLSearchParams({ sendUpdates: 'none' });
    if (createMeet) params.set('conferenceDataVersion', '1');
    const res = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${params.toString()}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });

    if (!res.ok) throw googleApiError('Calendar event create error', await res.text());
    return mapCalendarEvent(await res.json(), email);
  },

  async updateCalendarEvent(email: string, input: CalendarEventUpdateInput): Promise<CalendarEvent> {
    const accessToken = await getAccessToken(email);
    const calendarId = input.calendarId || 'primary';
    const addMeet = input.conferenceProvider === 'googleMeet';
    const timeZone = calendarTimeZoneForCreate(input.recurrence, input.timeZone);
    const body = {
      summary: input.summary || '(No title)',
      description: input.description || undefined,
      location: input.location || '',
      start: { dateTime: input.startAt, timeZone },
      end: { dateTime: input.endAt, timeZone },
      attendees: (input.attendees || [])
        .map(attendeeEmail => attendeeEmail.trim())
        .filter(Boolean)
        .map(attendeeEmail => ({ email: attendeeEmail })),
      conferenceData: addMeet
        ? { createRequest: { requestId: `dumka-${crypto.randomUUID()}` } }
        : undefined
    };
    const params = new URLSearchParams({ sendUpdates: 'none' });
    if (addMeet) params.set('conferenceDataVersion', '1');
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(input.eventId)}?${params.toString()}`,
      {
        method: 'PATCH',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
      }
    );

    if (!res.ok) throw googleApiError('Calendar event update error', await res.text());
    return mapCalendarEvent(await res.json(), email, calendarId);
  },

  async deleteCalendarEvent(email: string, eventId: string, calendarId = 'primary'): Promise<void> {
    const accessToken = await getAccessToken(email);
    const res = await fetchWithTimeout(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}?sendUpdates=none`,
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
    const found = await findRes.json() as { items?: any[] };
    const event = (found.items || [])[0];

    if (event?.id) {
      const attendees = mapAttendees(event.attendees);
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

  async addInviteToCalendar(email: string, invite: CalendarInvite): Promise<CalendarEvent> {
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
    const found = await findRes.json() as { items?: any[] };
    const existing = (found.items || [])[0];
    if (existing?.id) return mapCalendarEvent(existing, email);

    const importedParams = new URLSearchParams({
      privateExtendedProperty: `dumkaImportedInviteUid=${invite.uid}`,
      singleEvents: 'true',
      maxResults: '10'
    });
    const importedRes = await fetchWithTimeout(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${importedParams.toString()}`, {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!importedRes.ok) throw googleApiError('Calendar imported invite lookup error', await importedRes.text());
    const imported = await importedRes.json() as { items?: any[] };
    const importedEvent = (imported.items || [])[0];
    if (importedEvent?.id) return mapCalendarEvent(importedEvent, email);

    const insertBody = inviteInsertBody(invite, invite.attendees.map(attendee => ({ ...attendee })));
    const insertRes = await fetchWithTimeout('https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=none', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(insertBody)
    });
    if (!insertRes.ok) throw googleApiError('Calendar event add error', await insertRes.text());
    return mapCalendarEvent(await insertRes.json(), email);
  },

  async listContacts(email: string): Promise<{ contacts: ContactCard[]; groups: ContactGroup[] }> {
    const accessToken = await getAccessToken(email);
    const contacts: ContactCard[] = [];
    let pageToken = '';

    do {
      const params = new URLSearchParams({
        personFields: 'names,emailAddresses,photos,phoneNumbers,organizations,biographies,memberships',
        pageSize: '500',
        sortOrder: 'FIRST_NAME_ASCENDING'
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetchWithTimeout(`https://people.googleapis.com/v1/people/me/connections?${params.toString()}`, {
        headers: { 'Authorization': `Bearer ${accessToken}` }
      });
      if (!res.ok) throw googleApiError('Google Contacts fetch error', await res.text());
      const data = await res.json() as { connections?: any[]; nextPageToken?: string };
      for (const person of data.connections || []) {
        const contact = mapContact(person, email);
        if (contact) contacts.push(contact);
      }
      pageToken = data.nextPageToken || '';
    } while (pageToken);

    const groupsRes = await fetchWithTimeout('https://people.googleapis.com/v1/contactGroups?pageSize=200', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    if (!groupsRes.ok) throw googleApiError('Google Contact groups fetch error', await groupsRes.text());
    const groupsData = await groupsRes.json() as { contactGroups?: any[] };
    const groups = (groupsData.contactGroups || []).map(group => ({
      id: group.resourceName,
      accountId: email,
      name: group.name || group.formattedName || group.resourceName,
      memberCount: Number(group.memberCount || 0),
      updatedAt: new Date().toISOString()
    }));

    return { contacts, groups };
  }
};
