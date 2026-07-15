import { getDatabase } from './database';
import type { CalendarEvent, CalendarListEntry } from '../shared/types';
import { calendarSearchMatchQuery } from '../shared/calendarSearch';

type DatabaseHandle = ReturnType<typeof getDatabase>;

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function mapCalendarEvent(row: Record<string, unknown>): CalendarEvent {
  return {
    id: String(row.id),
    accountId: String(row.account_id),
    calendarId: String(row.calendar_id),
    iCalUID: row.ical_uid as string | null,
    summary: String(row.summary),
    description: row.description as string | null,
    location: row.location as string | null,
    startAt: String(row.start_at),
    endAt: String(row.end_at),
    isAllDay: row.is_all_day === 1,
    startDate: row.start_date as string | null,
    endDate: row.end_date as string | null,
    timeZone: row.time_zone as string | null,
    status: row.status as CalendarEvent['status'],
    etag: row.etag as string | null,
    htmlLink: row.html_link as string | null,
    conferenceUrl: row.conference_url as string | null,
    organizerEmail: row.organizer_email as string | null,
    creatorEmail: row.creator_email as string | null,
    recurringEventId: row.recurring_event_id as string | null,
    originalStartAt: row.original_start_at as string | null,
    recurrenceRules: parseJson<string[]>(row.recurrence_json as string | null, []),
    transparency: row.transparency as CalendarEvent['transparency'],
    visibility: row.visibility as CalendarEvent['visibility'],
    colorId: row.color_id as string | null,
    selfResponseStatus: row.self_response_status as CalendarEvent['selfResponseStatus'],
    reminders: parseJson<CalendarEvent['reminders']>(row.reminders_json as string | null, null),
    attendees: parseJson<CalendarEvent['attendees']>(row.attendees_json as string | null, []),
    sourceMessageId: row.source_message_id as string | null,
    sourceThreadId: row.source_thread_id as string | null,
    updatedAt: String(row.updated_at),
  };
}

function saveCalendarLists(db: DatabaseHandle, calendars: CalendarListEntry[]): void {
  const insert = db.prepare(`
    INSERT INTO calendar_lists (
      id, account_id, summary, description, is_primary, is_selected, access_role,
      background_color, foreground_color, time_zone, is_deleted, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, id) DO UPDATE SET
      summary=excluded.summary,
      description=excluded.description,
      is_primary=excluded.is_primary,
      is_selected=excluded.is_selected,
      access_role=excluded.access_role,
      background_color=excluded.background_color,
      foreground_color=excluded.foreground_color,
      time_zone=excluded.time_zone,
      is_deleted=excluded.is_deleted,
      updated_at=excluded.updated_at
  `);
  for (const calendar of calendars) {
    insert.run(
      calendar.id,
      calendar.accountId,
      calendar.summary,
      calendar.description || null,
      calendar.primary ? 1 : 0,
      calendar.selected ? 1 : 0,
      calendar.accessRole,
      calendar.backgroundColor,
      calendar.foregroundColor,
      calendar.timeZone || null,
      calendar.deleted ? 1 : 0,
      calendar.updatedAt,
    );
  }
}

function saveCalendarEvents(db: DatabaseHandle, events: CalendarEvent[]): void {
  const insert = db.prepare(`
    INSERT INTO calendar_events (
      id, account_id, calendar_id, ical_uid, summary, description, location,
      start_at, end_at, is_all_day, status, html_link, conference_url,
      organizer_email, attendees_json, source_message_id, source_thread_id, updated_at,
      start_date, end_date, time_zone, etag, creator_email, recurring_event_id,
      original_start_at, recurrence_json, transparency, visibility, color_id,
      self_response_status, reminders_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(account_id, calendar_id, id) DO UPDATE SET
      ical_uid=excluded.ical_uid,
      summary=excluded.summary,
      description=excluded.description,
      location=excluded.location,
      start_at=excluded.start_at,
      end_at=excluded.end_at,
      is_all_day=excluded.is_all_day,
      status=excluded.status,
      html_link=excluded.html_link,
      conference_url=excluded.conference_url,
      organizer_email=excluded.organizer_email,
      attendees_json=excluded.attendees_json,
      source_message_id=COALESCE(excluded.source_message_id, calendar_events.source_message_id),
      source_thread_id=COALESCE(excluded.source_thread_id, calendar_events.source_thread_id),
      updated_at=excluded.updated_at,
      start_date=excluded.start_date,
      end_date=excluded.end_date,
      time_zone=excluded.time_zone,
      etag=excluded.etag,
      creator_email=excluded.creator_email,
      recurring_event_id=excluded.recurring_event_id,
      original_start_at=excluded.original_start_at,
      recurrence_json=excluded.recurrence_json,
      transparency=excluded.transparency,
      visibility=excluded.visibility,
      color_id=excluded.color_id,
      self_response_status=excluded.self_response_status,
      reminders_json=excluded.reminders_json
  `);

  for (const event of events) {
    insert.run(
      event.id,
      event.accountId,
      event.calendarId,
      event.iCalUID || null,
      event.summary,
      event.description || null,
      event.location || null,
      event.startAt,
      event.endAt,
      event.isAllDay ? 1 : 0,
      event.status || null,
      event.htmlLink || null,
      event.conferenceUrl || null,
      event.organizerEmail || null,
      JSON.stringify(event.attendees),
      event.sourceMessageId || null,
      event.sourceThreadId || null,
      event.updatedAt,
      event.startDate || null,
      event.endDate || null,
      event.timeZone || null,
      event.etag || null,
      event.creatorEmail || null,
      event.recurringEventId || null,
      event.originalStartAt || null,
      JSON.stringify(event.recurrenceRules || []),
      event.transparency || null,
      event.visibility || null,
      event.colorId || null,
      event.selfResponseStatus || null,
      event.reminders ? JSON.stringify(event.reminders) : null,
    );
  }
}

export const CalendarListsRepo = {
  list(accountId: string): CalendarListEntry[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM calendar_lists
      WHERE account_id = ? AND is_deleted = 0
      ORDER BY is_primary DESC, summary COLLATE NOCASE ASC
    `).all(accountId) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id),
      accountId: String(row.account_id),
      summary: String(row.summary),
      description: row.description as string | null,
      primary: row.is_primary === 1,
      selected: row.is_selected === 1,
      accessRole: row.access_role as CalendarListEntry['accessRole'],
      backgroundColor: String(row.background_color),
      foregroundColor: String(row.foreground_color),
      timeZone: row.time_zone as string | null,
      deleted: row.is_deleted === 1,
      updatedAt: String(row.updated_at),
    }));
  },

  saveMany(calendars: CalendarListEntry[]): void {
    const db = getDatabase();
    db.transaction(() => saveCalendarLists(db, calendars))();
  },

  replaceForAccount(accountId: string, calendars: CalendarListEntry[]): void {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare('UPDATE calendar_lists SET is_deleted = 1, updated_at = ? WHERE account_id = ?')
        .run(new Date().toISOString(), accountId);
      saveCalendarLists(db, calendars);
    })();
  },
};

export const CalendarEventsRepo = {
  get(accountId: string, calendarId: string, eventId: string): CalendarEvent | null {
    const row = getDatabase().prepare(`
      SELECT * FROM calendar_events WHERE account_id = ? AND calendar_id = ? AND id = ?
    `).get(accountId, calendarId, eventId) as Record<string, unknown> | undefined;
    return row ? mapCalendarEvent(row) : null;
  },

  listBetween(accountId: string, startAt: string, endAt: string): CalendarEvent[] {
    const rows = getDatabase().prepare(`
      SELECT * FROM calendar_events
      WHERE account_id = ? AND end_at > ? AND start_at < ?
      ORDER BY start_at ASC, end_at ASC
    `).all(accountId, startAt, endAt) as Array<Record<string, unknown>>;
    return rows.map(mapCalendarEvent);
  },

  search(accountIds: string[], query: string, limit = 50): CalendarEvent[] {
    const matchQuery = calendarSearchMatchQuery(query);
    const uniqueAccountIds = [...new Set(accountIds.map(accountId => accountId.trim()).filter(Boolean))];
    if (!matchQuery || uniqueAccountIds.length === 0) return [];
    const safeLimit = Math.max(1, Math.min(200, Math.floor(limit)));
    const placeholders = uniqueAccountIds.map(() => '?').join(', ');
    const rows = getDatabase().prepare(`
      SELECT e.*
      FROM calendar_search
      JOIN calendar_events e
        ON e.account_id = calendar_search.account_id
       AND e.calendar_id = calendar_search.calendar_id
       AND e.id = calendar_search.event_id
      WHERE calendar_search MATCH ?
        AND e.account_id IN (${placeholders})
        AND COALESCE(e.status, '') <> 'cancelled'
      ORDER BY bm25(calendar_search), e.start_at DESC
      LIMIT ?
    `).all(matchQuery, ...uniqueAccountIds, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapCalendarEvent);
  },

  saveMany(events: CalendarEvent[]): void {
    const db = getDatabase();
    db.transaction(() => saveCalendarEvents(db, events))();
  },

  delete(accountId: string, calendarId: string, eventId: string): void {
    getDatabase()
      .prepare('DELETE FROM calendar_events WHERE account_id = ? AND calendar_id = ? AND id = ?')
      .run(accountId, calendarId, eventId);
  },

  getRangeSyncToken(accountId: string, calendarId: string, startAt: string, endAt: string): string | null {
    const row = getDatabase().prepare(`
      SELECT sync_token FROM calendar_sync_ranges
      WHERE account_id = ? AND calendar_id = ? AND start_at = ? AND end_at = ?
    `).get(accountId, calendarId, startAt, endAt) as { sync_token?: string | null } | undefined;
    return row?.sync_token || null;
  },

  clearRangeSyncToken(accountId: string, calendarId: string, startAt: string, endAt: string): void {
    getDatabase().prepare(`
      UPDATE calendar_sync_ranges SET sync_token = NULL
      WHERE account_id = ? AND calendar_id = ? AND start_at = ? AND end_at = ?
    `).run(accountId, calendarId, startAt, endAt);
  },

  replaceRange(accountId: string, calendarId: string, startAt: string, endAt: string, events: CalendarEvent[], syncToken: string | null = null): void {
    const db = getDatabase();
    db.transaction(() => {
      db.prepare(`
        DELETE FROM calendar_events
        WHERE account_id = ? AND calendar_id = ? AND end_at > ? AND start_at < ?
          AND COALESCE(status, '') <> 'pending'
      `).run(accountId, calendarId, startAt, endAt);
      saveCalendarEvents(db, events.filter(event => event.status !== 'cancelled'));
      db.prepare(`
        INSERT INTO calendar_sync_ranges (account_id, calendar_id, start_at, end_at, synced_at, sync_token)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, calendar_id, start_at, end_at) DO UPDATE SET
          synced_at=excluded.synced_at, sync_token=excluded.sync_token
      `).run(accountId, calendarId, startAt, endAt, new Date().toISOString(), syncToken);
    })();
  },

  applyRangeDelta(accountId: string, calendarId: string, startAt: string, endAt: string, events: CalendarEvent[], syncToken: string): void {
    const db = getDatabase();
    db.transaction(() => {
      for (const event of events.filter(event => event.status === 'cancelled')) {
        db.prepare('DELETE FROM calendar_events WHERE account_id = ? AND calendar_id = ? AND id = ? AND COALESCE(status, \'\') <> \'pending\'')
          .run(accountId, calendarId, event.id);
      }
      saveCalendarEvents(db, events.filter(event => event.status !== 'cancelled'));
      db.prepare(`
        INSERT INTO calendar_sync_ranges (account_id, calendar_id, start_at, end_at, synced_at, sync_token)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, calendar_id, start_at, end_at) DO UPDATE SET
          synced_at=excluded.synced_at, sync_token=excluded.sync_token
      `).run(accountId, calendarId, startAt, endAt, new Date().toISOString(), syncToken);
    })();
  },

  listNotificationCandidates(startAt: string, endAt: string, limit = 50, nowAt = new Date().toISOString()): CalendarEvent[] {
    const safeLimit = Math.max(1, Math.min(500, Math.floor(limit)));
    const rows = getDatabase().prepare(`
      SELECT e.*
      FROM calendar_events e
      LEFT JOIN calendar_notification_log n
        ON n.account_id = e.account_id AND n.calendar_id = e.calendar_id
       AND n.event_id = e.id AND n.start_at = e.start_at
      WHERE COALESCE(e.status, '') <> 'cancelled'
        AND e.start_at >= ? AND e.start_at <= ?
        AND (n.event_id IS NULL OR (n.snoozed_until IS NOT NULL AND n.snoozed_until <= ?))
      ORDER BY e.start_at ASC
      LIMIT ?
    `).all(startAt, endAt, nowAt, safeLimit) as Array<Record<string, unknown>>;
    return rows.map(mapCalendarEvent);
  },

  markNotified(event: CalendarEvent): void {
    getDatabase().prepare(`
      INSERT INTO calendar_notification_log (account_id, calendar_id, event_id, start_at, notified_at, snoozed_until)
      VALUES (?, ?, ?, ?, ?, NULL)
      ON CONFLICT(account_id, calendar_id, event_id, start_at) DO UPDATE SET
        notified_at=excluded.notified_at, snoozed_until=NULL
    `).run(event.accountId, event.calendarId, event.id, event.startAt, new Date().toISOString());
  },

  snoozeNotification(event: CalendarEvent, snoozedUntil: string): void {
    getDatabase().prepare(`
      INSERT INTO calendar_notification_log (account_id, calendar_id, event_id, start_at, notified_at, snoozed_until)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, calendar_id, event_id, start_at) DO UPDATE SET snoozed_until=excluded.snoozed_until
    `).run(event.accountId, event.calendarId, event.id, event.startAt, new Date().toISOString(), snoozedUntil);
  },
};

export interface CalendarMutationRecord {
  id: string;
  accountId: string;
  kind: 'create' | 'update' | 'delete';
  calendarId: string;
  eventId?: string | null;
  payloadJson?: string | null;
  createdAt: string;
  attemptCount: number;
  lastError?: string | null;
}

export const CalendarMutationsRepo = {
  list(): CalendarMutationRecord[] {
    const rows = getDatabase().prepare('SELECT * FROM calendar_mutations ORDER BY created_at ASC').all() as Array<Record<string, unknown>>;
    return rows.map(row => ({
      id: String(row.id),
      accountId: String(row.account_id),
      kind: row.kind as CalendarMutationRecord['kind'],
      calendarId: String(row.calendar_id),
      eventId: row.event_id as string | null,
      payloadJson: row.payload_json as string | null,
      createdAt: String(row.created_at),
      attemptCount: Number(row.attempt_count),
      lastError: row.last_error as string | null,
    }));
  },

  save(record: CalendarMutationRecord): void {
    getDatabase().prepare(`
      INSERT INTO calendar_mutations (id, account_id, kind, calendar_id, event_id, payload_json, created_at, attempt_count, last_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET attempt_count=excluded.attempt_count, last_error=excluded.last_error,
        event_id=excluded.event_id, payload_json=excluded.payload_json
    `).run(record.id, record.accountId, record.kind, record.calendarId, record.eventId || null, record.payloadJson || null, record.createdAt, record.attemptCount, record.lastError || null);
  },

  delete(id: string): void {
    getDatabase().prepare('DELETE FROM calendar_mutations WHERE id = ?').run(id);
  },
};
