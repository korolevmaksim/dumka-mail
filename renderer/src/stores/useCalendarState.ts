import { useCallback, useEffect, useState } from 'react';
import type {
  CalendarAttendeeResponse,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResult,
  CalendarInvite,
  CalendarListEntry,
  Draft,
  GoogleIntegrationStatus,
  MailActionLog,
} from '../../../shared/types';

export interface CalendarEventRange {
  startAt: string;
  endAt: string;
}

interface UseCalendarStateOptions {
  primaryEmail: string;
  activeDraft: Draft | null;
  defaultMeetingDurationMinutes: number;
  loadActionLog: () => Promise<void>;
  updateDraftBody: (body: string, bodyHtml?: string | null) => void;
  onIntegrationStatus: (status: GoogleIntegrationStatus) => void;
}

function replaceCalendarsForAccount(current: CalendarListEntry[], accountId: string, next: CalendarListEntry[]): CalendarListEntry[] {
  return [...current.filter(calendar => calendar.accountId !== accountId), ...next];
}

function replaceCalendarRange(current: CalendarEvent[], next: CalendarEvent[], accountId: string, range: CalendarEventRange): CalendarEvent[] {
  const startMs = new Date(range.startAt).getTime();
  const endMs = new Date(range.endAt).getTime();
  const outsideRange = current.filter(event => {
    if (event.accountId !== accountId) return true;
    const eventStart = new Date(event.startAt).getTime();
    const eventEnd = new Date(event.endAt).getTime();
    return !Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= startMs || eventStart >= endMs;
  });
  return Array.from(new Map([...outsideRange, ...next]
    .map(event => [`${event.accountId}\0${event.calendarId}\0${event.id}`, event])).values())
    .sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt));
}

export function defaultCalendarAgendaRange(): CalendarEventRange {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 42);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function useCalendarState(options: UseCalendarStateOptions) {
  const [calendarEvents, setCalendarEvents] = useState<CalendarEvent[]>([]);
  const [calendarLists, setCalendarLists] = useState<CalendarListEntry[]>([]);

  const upsertCalendarEvent = useCallback((event: CalendarEvent) => {
    setCalendarEvents(current => [
      ...current.filter(existing => !(existing.accountId === event.accountId && existing.calendarId === event.calendarId && existing.id === event.id)),
      event,
    ].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)));
  }, []);

  const loadCachedRange = useCallback(async (email: string, range: CalendarEventRange = defaultCalendarAgendaRange()) => {
    const [events, calendars] = await Promise.all([
      window.electronAPI.listCalendarEvents(email, range.startAt, range.endAt),
      window.electronAPI.listCalendars(email),
    ]);
    setCalendarEvents(current => replaceCalendarRange(current, events, email, range));
    setCalendarLists(current => replaceCalendarsForAccount(current, email, calendars));
    return { events, calendars };
  }, []);

  const clearCalendarCache = useCallback(() => {
    setCalendarEvents([]);
    setCalendarLists([]);
  }, []);

  const syncCalendarAgenda = useCallback(async (email?: string, range: CalendarEventRange = defaultCalendarAgendaRange()) => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) return [];
    await loadCachedRange(targetEmail, range);
    const events = await window.electronAPI.syncCalendarEvents(targetEmail, range.startAt, range.endAt);
    setCalendarEvents(current => replaceCalendarRange(current, events, targetEmail, range));
    const calendars = await window.electronAPI.listCalendars(targetEmail);
    setCalendarLists(current => replaceCalendarsForAccount(current, targetEmail, calendars));
    options.onIntegrationStatus(await window.electronAPI.getGoogleIntegrationStatus(targetEmail));
    return events;
  }, [loadCachedRange, options.onIntegrationStatus, options.primaryEmail]);

  const syncCalendarLists = useCallback(async (email?: string): Promise<CalendarListEntry[]> => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) return [];
    const cached = await window.electronAPI.listCalendars(targetEmail);
    if (cached.length > 0) setCalendarLists(current => replaceCalendarsForAccount(current, targetEmail, cached));
    const calendars = await window.electronAPI.syncCalendarLists(targetEmail);
    setCalendarLists(current => replaceCalendarsForAccount(current, targetEmail, calendars));
    return calendars;
  }, [options.primaryEmail]);

  useEffect(() => window.electronAPI.onCalendarChanged(({ accountId }) => {
    void syncCalendarAgenda(accountId).catch(error => console.error('Failed to refresh calendar after mutation reconciliation:', error));
    void options.loadActionLog();
  }), [options.loadActionLog, syncCalendarAgenda]);

  const queryCalendarFreeBusy = useCallback(async (input: CalendarFreeBusyRequest, email?: string): Promise<CalendarFreeBusyResult> => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before checking calendar availability.');
    return window.electronAPI.queryCalendarFreeBusy(targetEmail, input);
  }, [options.primaryEmail]);

  const respondToCalendarInvite = useCallback(async (invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, email?: string) => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before responding to invitations.');
    await window.electronAPI.respondToCalendarInvite(targetEmail, invite, responseStatus, crypto.randomUUID());
    await syncCalendarAgenda(targetEmail);
    await options.loadActionLog();
  }, [options.loadActionLog, options.primaryEmail, syncCalendarAgenda]);

  const respondToCalendarEvent = useCallback(async (event: CalendarEvent, responseStatus: CalendarAttendeeResponse): Promise<CalendarEvent> => {
    const updated = await window.electronAPI.respondToCalendarEvent(
      event.accountId,
      event.calendarId,
      event.id,
      responseStatus,
      crypto.randomUUID(),
    );
    upsertCalendarEvent(updated);
    await options.loadActionLog();
    return updated;
  }, [options.loadActionLog, upsertCalendarEvent]);

  const addCalendarEvent = useCallback(async (invite: CalendarInvite, email?: string) => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before adding calendar events.');
    await window.electronAPI.addCalendarEvent(targetEmail, invite, crypto.randomUUID());
    await syncCalendarAgenda(targetEmail);
    await options.loadActionLog();
  }, [options.loadActionLog, options.primaryEmail, syncCalendarAgenda]);

  const createCalendarEvent = useCallback(async (input: CalendarEventCreateInput, email?: string): Promise<CalendarEvent> => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before creating calendar events.');
    const event = await window.electronAPI.createCalendarEvent(targetEmail, input, crypto.randomUUID());
    upsertCalendarEvent(event);
    await options.loadActionLog();
    return event;
  }, [options.loadActionLog, options.primaryEmail, upsertCalendarEvent]);

  const updateCalendarEvent = useCallback(async (input: CalendarEventUpdateInput, email?: string): Promise<CalendarEvent> => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before updating calendar events.');
    try {
      const event = await window.electronAPI.updateCalendarEvent(targetEmail, input, crypto.randomUUID());
      setCalendarEvents(current => [
        ...current.filter(existing => !(
          existing.accountId === event.accountId
          && existing.id === input.eventId
          && (existing.calendarId === event.calendarId || existing.calendarId === input.originalCalendarId)
        )),
        event,
      ].sort((left, right) => Date.parse(left.startAt) - Date.parse(right.startAt)));
      return event;
    } finally {
      await options.loadActionLog();
    }
  }, [options.loadActionLog, options.primaryEmail]);

  const deleteCalendarEvent = useCallback(async (event: CalendarEvent, email?: string, deleteOptions?: CalendarEventDeleteOptions): Promise<void> => {
    const targetEmail = email || options.primaryEmail;
    if (!targetEmail) throw new Error('Connect a Gmail account before deleting calendar events.');
    await window.electronAPI.deleteCalendarEvent(targetEmail, event.calendarId || 'primary', event.id, crypto.randomUUID(), deleteOptions);
    setCalendarEvents(current => current.filter(existing => !(existing.accountId === event.accountId && existing.calendarId === event.calendarId && existing.id === event.id)));
    await options.loadActionLog();
  }, [options.loadActionLog, options.primaryEmail]);

  const resolveCalendarConflict = useCallback(async (action: MailActionLog, strategy: 'local' | 'remote') => {
    const payload = action.payloadJson ? JSON.parse(action.payloadJson) as { conflict?: boolean; input?: CalendarEventUpdateInput } : {};
    if (!payload.conflict || !payload.input) throw new Error('Calendar conflict details are unavailable.');
    if (strategy === 'local') await updateCalendarEvent({ ...payload.input, etag: null }, action.accountId);
    else await syncCalendarAgenda(action.accountId);
    await window.electronAPI.saveActionLog({ ...action, status: 'completed', completedAt: new Date().toISOString(), failureMessage: null });
    await options.loadActionLog();
  }, [options.loadActionLog, syncCalendarAgenda, updateCalendarEvent]);

  const createGoogleMeetDraftEvent = useCallback(async (): Promise<CalendarEvent | null> => {
    const draft = options.activeDraft;
    if (!draft) return null;
    const event = await window.electronAPI.createGoogleMeetDraftEvent(draft.accountId, {
      summary: draft.subject || 'Meeting',
      attendees: [...draft.to, ...draft.cc].map(recipient => recipient.email).filter(Boolean),
      durationMinutes: options.defaultMeetingDurationMinutes,
    });
    const link = event.conferenceUrl || event.htmlLink;
    if (link) {
      const plain = `${draft.bodyPlain.trimEnd()}\n\nGoogle Meet: ${link}`.trimStart();
      const htmlLink = `<p>Google Meet: <a href="${link}" target="_blank">${link}</a></p>`;
      options.updateDraftBody(plain, draft.bodyHtml ? `${draft.bodyHtml}${htmlLink}` : null);
    }
    await syncCalendarAgenda(draft.accountId);
    return event;
  }, [options.activeDraft, options.defaultMeetingDurationMinutes, options.updateDraftBody, syncCalendarAgenda]);

  return {
    calendarEvents,
    calendarLists,
    loadCachedRange,
    clearCalendarCache,
    syncCalendarAgenda,
    syncCalendarLists,
    queryCalendarFreeBusy,
    respondToCalendarInvite,
    respondToCalendarEvent,
    addCalendarEvent,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    resolveCalendarConflict,
    createGoogleMeetDraftEvent,
  };
}
