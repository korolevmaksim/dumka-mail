import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { CalendarEvent, CalendarListEntry } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

async function withIsolatedDatabase<T>(run: (database: typeof import('../main/database')) => Promise<T> | T): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-calendar-repo-'));
  let database: typeof import('../main/database') | null = null;
  vi.resetModules();
  process.env.HOME = home;
  try {
    database = await import('../main/database');
    return await run(database);
  } finally {
    database?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME; else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

const accountId = 'me@example.com';

function calendar(id: string, primary = false): CalendarListEntry {
  return { id, accountId, summary: id, primary, selected: true, accessRole: primary ? 'owner' : 'reader', backgroundColor: primary ? '#3367d6' : '#0f9d58', foregroundColor: '#ffffff', timeZone: 'Europe/Warsaw', updatedAt: '2026-07-01T00:00:00.000Z' };
}

function event(id: string, calendarId: string, startAt: string): CalendarEvent {
  return {
    id, accountId, calendarId, iCalUID: `${id}@example.com`, summary: id,
    startAt, endAt: new Date(new Date(startAt).getTime() + 30 * 60_000).toISOString(), isAllDay: false,
    timeZone: 'Europe/Warsaw', status: 'confirmed', etag: `etag-${id}`, recurringEventId: null,
    recurrenceRules: [], transparency: 'opaque', visibility: 'default', colorId: '2', selfResponseStatus: 'accepted',
    reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] }, attendees: [], updatedAt: '2026-07-01T00:00:00.000Z',
  };
}

describe('calendar repositories', () => {
  repositoryIt('persists calendar metadata and expanded event fields', async () => {
    await withIsolatedDatabase(({ CalendarEventsRepo, CalendarListsRepo }) => {
      CalendarListsRepo.saveMany([calendar('primary', true), calendar('team@example.com')]);
      CalendarEventsRepo.saveMany([event('event-1', 'team@example.com', '2026-07-15T08:00:00.000Z')]);
      expect(CalendarListsRepo.list(accountId).map(item => item.id)).toEqual(['primary', 'team@example.com']);
      expect(CalendarEventsRepo.get(accountId, 'team@example.com', 'event-1')).toMatchObject({
        etag: 'etag-event-1', timeZone: 'Europe/Warsaw', colorId: '2', selfResponseStatus: 'accepted',
        reminders: { useDefault: false, overrides: [{ method: 'popup', minutes: 10 }] },
      });
    });
  });

  repositoryIt('reconciles only the refreshed calendar range', async () => {
    await withIsolatedDatabase(({ CalendarEventsRepo }) => {
      CalendarEventsRepo.saveMany([
        event('old-in-range', 'primary', '2026-07-15T08:00:00.000Z'),
        event('outside', 'primary', '2026-09-15T08:00:00.000Z'),
        event('other-calendar', 'team@example.com', '2026-07-15T08:00:00.000Z'),
      ]);
      CalendarEventsRepo.replaceRange(accountId, 'primary', '2026-07-01T00:00:00.000Z', '2026-08-01T00:00:00.000Z', [
        event('fresh', 'primary', '2026-07-20T08:00:00.000Z'),
      ]);
      expect(CalendarEventsRepo.get(accountId, 'primary', 'old-in-range')).toBeNull();
      expect(CalendarEventsRepo.get(accountId, 'primary', 'fresh')).not.toBeNull();
      expect(CalendarEventsRepo.get(accountId, 'primary', 'outside')).not.toBeNull();
      expect(CalendarEventsRepo.get(accountId, 'team@example.com', 'other-calendar')).not.toBeNull();
    });
  });

  repositoryIt('keeps pending calendar mutations durable', async () => {
    await withIsolatedDatabase(({ CalendarMutationsRepo }) => {
      CalendarMutationsRepo.save({ id: 'mutation-1', accountId, kind: 'create', calendarId: 'primary', eventId: 'local-1', payloadJson: '{"summary":"Queued"}', createdAt: '2026-07-15T08:00:00.000Z', attemptCount: 0 });
      expect(CalendarMutationsRepo.list()).toEqual([expect.objectContaining({ id: 'mutation-1', kind: 'create', eventId: 'local-1', attemptCount: 0 })]);
      CalendarMutationsRepo.save({ ...CalendarMutationsRepo.list()[0], attemptCount: 1, lastError: 'offline' });
      expect(CalendarMutationsRepo.list()[0]).toMatchObject({ attemptCount: 1, lastError: 'offline' });
    });
  });
});
