import { beforeEach, describe, expect, it, vi } from 'vitest';

const { fetchWithTimeout } = vi.hoisted(() => ({ fetchWithTimeout: vi.fn() }));

vi.mock('../main/gmail', () => ({
  getAccessToken: vi.fn(async () => 'access-token'),
  fetchWithTimeout,
}));

import { GoogleCalendarSyncTokenExpiredError, GoogleWorkspaceService } from '../main/googleWorkspace';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('Google Calendar range synchronization', () => {
  beforeEach(() => fetchWithTimeout.mockReset());

  it('paginates a full range and keeps the final sync token', async () => {
    fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: 'one', summary: 'One', start: { dateTime: '2026-07-15T10:00:00Z' }, end: { dateTime: '2026-07-15T11:00:00Z' } }],
        nextPageToken: 'page-2',
      }))
      .mockResolvedValueOnce(jsonResponse({
        items: [{ id: 'two', summary: 'Two', start: { dateTime: '2026-07-16T10:00:00Z' }, end: { dateTime: '2026-07-16T11:00:00Z' } }],
        nextSyncToken: 'sync-final',
      }));

    const result = await GoogleWorkspaceService.syncCalendarEvents('me@example.com', 'primary', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z');
    expect(result.events.map(event => event.id)).toEqual(['one', 'two']);
    expect(result.nextSyncToken).toBe('sync-final');
    expect(String(fetchWithTimeout.mock.calls[1][0])).toContain('pageToken=page-2');
  });

  it('surfaces an expired incremental token for full-range recovery', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ error: { code: 410 } }, 410));
    await expect(GoogleWorkspaceService.syncCalendarEvents(
      'me@example.com',
      'primary',
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      'expired-token',
    )).rejects.toBeInstanceOf(GoogleCalendarSyncTokenExpiredError);
  });

  it('uses only Google-supported parameters with an incremental sync token', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({ items: [], nextSyncToken: 'next-token' }));
    await GoogleWorkspaceService.syncCalendarEvents(
      'me@example.com',
      'primary',
      '2026-07-01T00:00:00.000Z',
      '2026-08-01T00:00:00.000Z',
      'current-token',
    );
    const url = new URL(String(fetchWithTimeout.mock.calls[0][0]));
    expect(url.searchParams.get('syncToken')).toBe('current-token');
    expect(url.searchParams.has('timeMin')).toBe(false);
    expect(url.searchParams.has('timeMax')).toBe(false);
    expect(url.searchParams.has('orderBy')).toBe(false);
  });

  it('preserves guest RSVP metadata while editing an event', async () => {
    const raw = {
      id: 'event-1',
      etag: 'etag-1',
      summary: 'Planning',
      start: { dateTime: '2026-07-15T10:00:00Z' },
      end: { dateTime: '2026-07-15T11:00:00Z' },
      attendees: [
        { email: 'ada@example.com', responseStatus: 'accepted' },
        { email: 'grace@example.com', responseStatus: 'tentative' },
      ],
    };
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse(raw)).mockResolvedValueOnce(jsonResponse(raw));
    await GoogleWorkspaceService.updateCalendarEvent('me@example.com', {
      eventId: 'event-1',
      calendarId: 'primary',
      summary: 'Planning updated',
      startAt: '2026-07-15T10:00:00Z',
      endAt: '2026-07-15T11:00:00Z',
      attendees: ['ada@example.com', 'grace@example.com'],
      etag: 'etag-1',
    });
    const request = fetchWithTimeout.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { attendees: Array<{ email: string; responseStatus?: string }> };
    expect(body.attendees).toEqual([
      { email: 'ada@example.com', responseStatus: 'accepted' },
      { email: 'grace@example.com', responseStatus: 'tentative' },
    ]);
    expect((request.headers as Record<string, string>)['If-Match']).toBe('etag-1');
  });

  it('retains the current attendee when the editable guest field omits it', async () => {
    const raw = {
      id: 'event-1',
      etag: 'etag-1',
      summary: 'Planning',
      start: { dateTime: '2026-07-15T10:00:00Z' },
      end: { dateTime: '2026-07-15T11:00:00Z' },
      attendees: [
        { email: 'me@example.com', self: true, responseStatus: 'accepted' },
        { email: 'ada@example.com', responseStatus: 'tentative' },
      ],
    };
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse(raw)).mockResolvedValueOnce(jsonResponse(raw));
    await GoogleWorkspaceService.updateCalendarEvent('me@example.com', {
      eventId: 'event-1',
      calendarId: 'primary',
      summary: 'Planning updated',
      startAt: '2026-07-15T10:00:00Z',
      endAt: '2026-07-15T11:00:00Z',
      attendees: ['ada@example.com'],
      etag: 'etag-1',
    });
    const request = fetchWithTimeout.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { attendees: Array<{ email: string; self?: boolean; responseStatus?: string }> };
    expect(body.attendees).toEqual([
      { email: 'ada@example.com', responseStatus: 'tentative' },
      { email: 'me@example.com', self: true, responseStatus: 'accepted' },
    ]);
  });

  it('updates then moves a non-recurring event to another writable calendar', async () => {
    const raw = {
      id: 'event-1',
      etag: 'etag-1',
      summary: 'Planning',
      start: { dateTime: '2026-07-15T10:00:00Z' },
      end: { dateTime: '2026-07-15T11:00:00Z' },
      attendees: [],
    };
    const updated = { ...raw, etag: 'etag-2', summary: 'Planning updated' };
    fetchWithTimeout
      .mockResolvedValueOnce(jsonResponse(raw))
      .mockResolvedValueOnce(jsonResponse(updated))
      .mockResolvedValueOnce(jsonResponse(updated));

    const result = await GoogleWorkspaceService.updateCalendarEvent('me@example.com', {
      eventId: 'event-1',
      originalCalendarId: 'primary',
      calendarId: 'team@example.com',
      summary: 'Planning updated',
      startAt: '2026-07-15T10:00:00Z',
      endAt: '2026-07-15T11:00:00Z',
      attendees: [],
      etag: 'etag-1',
      sendUpdates: 'none',
    });

    expect(String(fetchWithTimeout.mock.calls[0][0])).toContain('/calendars/primary/events/event-1');
    expect(String(fetchWithTimeout.mock.calls[1][0])).toContain('/calendars/primary/events/event-1?');
    const moveUrl = new URL(String(fetchWithTimeout.mock.calls[2][0]));
    expect(moveUrl.pathname).toContain('/calendars/primary/events/event-1/move');
    expect(moveUrl.searchParams.get('destination')).toBe('team@example.com');
    expect((fetchWithTimeout.mock.calls[2][1] as RequestInit).method).toBe('POST');
    expect(result).toMatchObject({ id: 'event-1', calendarId: 'team@example.com', summary: 'Planning updated' });
  });

  it('rejects cross-calendar moves for recurring instances', async () => {
    await expect(GoogleWorkspaceService.updateCalendarEvent('me@example.com', {
      eventId: 'instance-1',
      recurringEventId: 'series-1',
      originalCalendarId: 'primary',
      calendarId: 'team@example.com',
      summary: 'Planning',
      startAt: '2026-07-15T10:00:00Z',
      endAt: '2026-07-15T11:00:00Z',
    })).rejects.toThrow('Recurring events must stay');
    expect(fetchWithTimeout).not.toHaveBeenCalled();
  });

  it('updates the current attendee response from a cached calendar event', async () => {
    const raw = {
      id: 'event-1',
      etag: 'etag-2',
      summary: 'Planning',
      start: { dateTime: '2026-07-15T10:00:00Z' },
      end: { dateTime: '2026-07-15T11:00:00Z' },
      attendees: [
        { email: 'me@example.com', self: true, responseStatus: 'needsAction' },
        { email: 'ada@example.com', responseStatus: 'accepted' },
      ],
    };
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse(raw)).mockResolvedValueOnce(jsonResponse({
      ...raw,
      attendees: [{ ...raw.attendees[0], responseStatus: 'accepted' }, raw.attendees[1]],
    }));
    const result = await GoogleWorkspaceService.respondToCalendarEvent('me@example.com', 'primary', 'event-1', 'accepted');
    const request = fetchWithTimeout.mock.calls[1][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as { attendees: Array<{ email: string; responseStatus?: string }> };
    expect(body.attendees[0]).toMatchObject({ email: 'me@example.com', responseStatus: 'accepted' });
    expect(body.attendees[1]).toMatchObject({ email: 'ada@example.com', responseStatus: 'accepted' });
    expect(result.selfResponseStatus).toBe('accepted');
  });

  it('keeps mail linkage local instead of uploading thread identifiers to Google', async () => {
    fetchWithTimeout.mockResolvedValueOnce(jsonResponse({
      id: 'event-from-mail',
      summary: 'Customer call',
      start: { dateTime: '2026-07-15T10:00:00Z' },
      end: { dateTime: '2026-07-15T11:00:00Z' },
    }));
    const event = await GoogleWorkspaceService.createCalendarEvent('me@example.com', {
      summary: 'Customer call',
      startAt: '2026-07-15T10:00:00Z',
      endAt: '2026-07-15T11:00:00Z',
      sourceThreadId: 'private-thread-id',
      sourceMessageId: 'private-message-id',
    });
    const request = fetchWithTimeout.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(String(request.body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('extendedProperties');
    expect(event).toMatchObject({ sourceThreadId: 'private-thread-id', sourceMessageId: 'private-message-id' });
  });
});
