import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { SearchBodyIndexJob } from '../main/searchBodyIndexJob';
import type { MailMessage, SearchIndexStatus } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

type DatabaseModule = typeof import('../main/database');

async function withDatabase(run: (database: DatabaseModule) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-search-body-index-'));
  vi.resetModules();
  process.env.HOME = home;
  let databaseModule: DatabaseModule | null = null;
  try {
    databaseModule = await import('../main/database');
    await run(databaseModule);
  } finally {
    databaseModule?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

const WORK = 'alex.morgan@northwind.example';

function message(index: number, bodyPlain: string | null = `quarterly budget review ${index}`): MailMessage {
  return {
    id: `18f2c404b7e3d${String(index).padStart(3, '0')}`,
    threadId: `thread${index}`,
    accountId: WORK,
    senderName: 'Priya',
    senderEmail: 'priya@lumenlabs.example',
    subject: `Invoice ${index}`,
    snippet: '',
    receivedAt: '2026-07-10T10:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain,
    attachments: [],
    headers: [],
    rfcMessageId: null,
    rfcReferences: null,
    rfcInReplyTo: null,
  };
}

function runToEnd({ SearchRepo }: DatabaseModule, limit: number): number {
  let steps = 0;
  while (!SearchRepo.runBodyIndexUpdateChunk(limit).done) steps += 1;
  return steps;
}

const hits = ({ SearchRepo }: DatabaseModule, query: string) => SearchRepo.search(WORK, query).length;

describe('bringing the search index in line with "search the text of messages"', () => {
  repositoryIt('takes the text of every message out of search, a few rows per step', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([1, 2, 3, 4, 5].map(index => message(index)));
      expect(hits(database, 'budget')).toBe(5);

      SearchRepo.startBodyIndexUpdate(false);
      expect(SearchRepo.bodyIndexUpdatePending()).toBe(true);
      expect(SearchRepo.runBodyIndexUpdateChunk(2)).toEqual({ done: false });
      // Two rows are done, the rest still has its text, and the update is remembered.
      expect(hits(database, 'budget')).toBe(3);
      expect(SearchRepo.bodyIndexUpdatePending()).toBe(true);

      expect(runToEnd(database, 2)).toBe(2);
      expect(hits(database, 'budget')).toBe(0);
      expect(hits(database, 'invoice')).toBe(5);
      expect(SearchRepo.bodyIndexUpdatePending()).toBe(false);
      expect(SearchRepo.runBodyIndexUpdateChunk()).toEqual({ done: true });
    });
  });

  repositoryIt('puts the text back from the stored messages', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([message(1), message(2), message(3, null)], { indexBodies: false });
      expect(hits(database, 'budget')).toBe(0);
      SearchRepo.startBodyIndexUpdate(true);
      runToEnd(database, 2);
      expect(hits(database, 'budget')).toBe(2);
      expect(hits(database, 'invoice')).toBe(3);
    });
  });

  repositoryIt('follows the latest choice when the setting is changed while an update runs', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([1, 2, 3, 4].map(index => message(index)));
      SearchRepo.startBodyIndexUpdate(false);
      SearchRepo.runBodyIndexUpdateChunk(2);
      expect(hits(database, 'budget')).toBe(2);
      // Switched back on: the rows already emptied get their text again.
      SearchRepo.startBodyIndexUpdate(true);
      runToEnd(database, 2);
      expect(hits(database, 'budget')).toBe(4);
    });
  });

  repositoryIt('leaves rows alone that are already as the setting wants them', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([1, 2, 3].map(index => message(index)));
      const db = database.getDatabase();
      const prepare = db.prepare.bind(db);
      let rewritten = 0;
      const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        const statement = prepare(sql);
        if (!/^\s*UPDATE mail_search/i.test(sql)) return statement;
        return { run: (...args: unknown[]) => {
          const result = statement.run(...args);
          rewritten += result.changes;
          return result;
        } };
      }) as typeof db.prepare);
      try {
        SearchRepo.startBodyIndexUpdate(true);
        runToEnd(database, 10);
        expect(rewritten).toBe(0);
        SearchRepo.startBodyIndexUpdate(false);
        runToEnd(database, 10);
        expect(rewritten).toBe(3);
      } finally {
        spy.mockRestore();
      }
    });
  });

  repositoryIt('reaches each row by its rowid instead of reading the search table from the start', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([1, 2, 3].map(index => message(index)));
      const db = database.getDatabase();
      const prepare = db.prepare.bind(db);
      const prepared: string[] = [];
      const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
        prepared.push(sql);
        return prepare(sql);
      }) as typeof db.prepare);
      try {
        for (const enabled of [false, true]) {
          SearchRepo.startBodyIndexUpdate(enabled);
          runToEnd(database, 10);
        }
      } finally {
        spy.mockRestore();
      }
      const plans = prepared
        .filter(sql => /mail_search/.test(sql))
        .map(sql => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array.from(sql.matchAll(/\?/g), () => 1)) as Array<{ detail: string }>)
          .map(row => row.detail));
      expect(plans.length).toBeGreaterThanOrEqual(3);
      for (const plan of plans) {
        // A full-text table lists every access as a scan; after the colon stands how it finds its rows.
        for (const step of plan.filter(detail => detail.includes('mail_search VIRTUAL TABLE'))) expect(step).toMatch(/INDEX \d+:=$/);
        for (const step of plan.filter(detail => detail.includes('mail_search_content'))) expect(step).toMatch(/^SEARCH /);
      }
    });
  });
});

describe('SearchBodyIndexJob', () => {
  function makeJob(options: { steps?: number; failAt?: number } = {}) {
    let pending = false;
    let left = options.steps ?? 3;
    let calls = 0;
    const published: SearchIndexStatus[] = [];
    const warnings: string[] = [];
    const retries: Array<() => void> = [];
    const started: boolean[] = [];
    const job = new SearchBodyIndexJob({
      start: enabled => { started.push(enabled); pending = true; left = options.steps ?? 3; },
      pending: () => pending,
      runChunk: async () => {
        calls += 1;
        if (options.failAt === calls) throw new Error('Database worker did not answer');
        left -= 1;
        if (left > 0) return { done: false };
        pending = false;
        return { done: true };
      },
      publish: status => { published.push(status); },
      warn: message => { warnings.push(message); },
      sleep: async () => undefined,
      retryLater: run => { retries.push(run); },
    });
    return { job, published, warnings, retries, started, calls: () => calls, setPending: (value: boolean) => { pending = value; } };
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('runs steps until the update is done and reports the start and the end', async () => {
    const h = makeJob();
    h.job.request(false);
    expect(h.job.status()).toEqual({ updating: true });
    await settle();
    expect(h.started).toEqual([false]);
    expect(h.calls()).toBe(3);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
    expect(h.job.status()).toEqual({ updating: false });
  });

  it('does nothing when no update is recorded', async () => {
    const h = makeJob();
    h.job.resume();
    await settle();
    expect(h.calls()).toBe(0);
    expect(h.published).toEqual([]);
  });

  it('continues an update that was recorded before the app was quit', async () => {
    const h = makeJob({ steps: 2 });
    h.setPending(true);
    h.job.resume();
    await settle();
    expect(h.calls()).toBe(2);
    expect(h.started).toEqual([]);
  });

  it('keeps one loop when the setting changes while it runs', async () => {
    const h = makeJob({ steps: 2 });
    h.job.request(false);
    h.job.request(true);
    h.job.resume();
    await settle();
    expect(h.started).toEqual([false, true]);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('records the update later when it could not be recorded, unless the choice changed meanwhile', async () => {
    const published: SearchIndexStatus[] = [];
    const retries: Array<() => void> = [];
    const started: boolean[] = [];
    let locked = true;
    let pending = false;
    const job = new SearchBodyIndexJob({
      start: enabled => {
        if (locked) throw new Error('database is locked');
        started.push(enabled);
        pending = true;
      },
      pending: () => pending,
      runChunk: async () => { pending = false; return { done: true }; },
      publish: status => { published.push(status); },
      warn: () => undefined,
      sleep: async () => undefined,
      retryLater: run => { retries.push(run); },
    });
    job.request(false);
    job.request(true);
    expect(started).toEqual([]);
    locked = false;
    for (const retry of retries.splice(0)) retry();
    await settle();
    // Only the latest choice is recorded.
    expect(started).toEqual([true]);
    expect(published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('tries again later after a failed step and stays "updating" meanwhile', async () => {
    const h = makeJob({ failAt: 2 });
    h.job.request(true);
    await settle();
    expect(h.warnings).toHaveLength(1);
    expect(h.job.status()).toEqual({ updating: true });
    expect(h.published).toEqual([{ updating: true }]);
    expect(h.retries).toHaveLength(1);
    h.retries[0]();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });
});
