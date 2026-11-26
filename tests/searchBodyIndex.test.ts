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

  repositoryIt('records the update in the same write as the settings that ask for it', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo, SettingsRepo } = database;
      MessagesRepo.save([message(1), message(2)]);
      const settings = (includeBodiesInSearchIndex: boolean) => JSON.stringify({ privacy: { includeBodiesInSearchIndex } });
      SearchRepo.saveAppSettingsStartingBodyIndexUpdate(settings(false));
      expect(SettingsRepo.get('appSettings')).toBe(settings(false));
      expect(SearchRepo.bodyIndexUpdatePending()).toBe(true);
      runToEnd(database, 10);
      expect(hits(database, 'budget')).toBe(0);
      SearchRepo.saveAppSettingsStartingBodyIndexUpdate(settings(true));
      runToEnd(database, 10);
      expect(hits(database, 'budget')).toBe(2);
    });
  });

  repositoryIt('indexes a message that is saved during an update as the stored setting says', async () => {
    await withDatabase(database => {
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([message(1), message(2)]);
      SearchRepo.saveAppSettingsStartingBodyIndexUpdate(JSON.stringify({ privacy: { includeBodiesInSearchIndex: false } }));
      // Mail that was fetched before the switch and is written after it.
      MessagesRepo.save([message(3)]);
      expect(hits(database, 'budget')).toBe(2);
      runToEnd(database, 10);
      // Written after the update finished, it is still left out.
      MessagesRepo.save([message(4)]);
      expect(hits(database, 'budget')).toBe(0);
      expect(hits(database, 'invoice')).toBe(4);

      SearchRepo.saveAppSettingsStartingBodyIndexUpdate(JSON.stringify({ privacy: { includeBodiesInSearchIndex: true } }));
      MessagesRepo.save([message(5)]);
      expect(hits(database, 'budget')).toBe(1);
      runToEnd(database, 10);
      expect(hits(database, 'budget')).toBe(5);
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
  function makeJob(options: { steps?: number; failAt?: number[]; unreadable?: boolean } = {}) {
    let pending = false;
    let left = 0;
    let calls = 0;
    let afterLastStep: (() => void) | null = null;
    const published: SearchIndexStatus[] = [];
    const warnings: string[] = [];
    const retries: Array<() => void> = [];
    const job = new SearchBodyIndexJob({
      pending: () => {
        if (options.unreadable) throw new Error('disk I/O error');
        return pending;
      },
      runChunk: async () => {
        calls += 1;
        if (options.failAt?.includes(calls)) throw new Error('Database worker did not answer');
        if (!pending) return { done: true };
        left -= 1;
        if (left > 0) return { done: false };
        pending = false;
        const interleave = afterLastStep;
        afterLastStep = null;
        interleave?.();
        return { done: true };
      },
      publish: status => { published.push(status); },
      warn: message => { warnings.push(message); },
      sleep: async () => undefined,
      retryLater: run => { retries.push(run); },
    });
    /** What the database holds: an update with `steps` steps left. */
    const store = () => { pending = true; left = options.steps ?? 3; };
    return {
      job, published, warnings, retries, store, calls: () => calls,
      /** What the settings handler does: one write records the update, then the job is told. */
      record: () => { store(); job.recorded(); },
      /** Runs `action` after the worker committed the last step, before the loop hears of it. */
      whenLastStepCommitted: (action: () => void) => { afterLastStep = action; },
      /** The worker commits the step that ends the update, and its answer is lost. */
      finishInDatabase: () => { pending = false; },
    };
  }

  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('runs steps until the update is done and reports the start and the end', async () => {
    const h = makeJob();
    h.record();
    expect(h.job.status()).toEqual({ updating: true });
    await settle();
    expect(h.calls()).toBe(3);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
    expect(h.job.status()).toEqual({ updating: false });
  });

  it('reports nothing at startup when no update was left unfinished', async () => {
    const h = makeJob();
    h.job.resume();
    await settle();
    expect(h.calls()).toBe(1);
    expect(h.published).toEqual([]);
  });

  it('continues an update that was interrupted by quitting', async () => {
    const h = makeJob({ steps: 3 });
    h.store();
    h.job.resume();
    await settle();
    expect(h.calls()).toBe(3);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('keeps one loop when the setting changes while it runs', async () => {
    const h = makeJob({ steps: 2 });
    h.record();
    // The first step is under way; the new record starts the count again.
    h.record();
    h.job.resume();
    await settle();
    expect(h.calls()).toBe(3);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('runs an update that was recorded while the last step of the previous one was on its way back', async () => {
    const h = makeJob({ steps: 2 });
    h.whenLastStepCommitted(() => h.record());
    h.record();
    await settle();
    // Two steps each, and one more that finds nothing left.
    expect(h.calls()).toBe(4);
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
    expect(h.job.status()).toEqual({ updating: false });
  });

  it('tries again later after a failed step and stays "updating" meanwhile', async () => {
    const h = makeJob({ failAt: [2] });
    h.record();
    await settle();
    expect(h.warnings).toHaveLength(1);
    expect(h.job.status()).toEqual({ updating: true });
    expect(h.published).toEqual([{ updating: true }]);
    expect(h.retries).toHaveLength(1);
    h.retries[0]();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('says "updating" from the moment an update is recorded, even when its first step fails', async () => {
    const h = makeJob({ failAt: [1], unreadable: true });
    h.record();
    expect(h.job.status()).toEqual({ updating: true });
    await settle();
    expect(h.job.status()).toEqual({ updating: true });
    expect(h.published).toEqual([{ updating: true }]);
  });

  it('learns of an interrupted update from the record when the first step after a start fails', async () => {
    const h = makeJob({ failAt: [1] });
    h.store();
    h.job.resume();
    await settle();
    expect(h.job.status()).toEqual({ updating: true });
    h.retries[0]();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });

  it('claims no update at startup when neither a step nor the record can say', async () => {
    const h = makeJob({ failAt: [1], unreadable: true });
    h.job.resume();
    await settle();
    expect(h.job.status()).toEqual({ updating: false });
    expect(h.warnings).toHaveLength(2);
    expect(h.retries).toHaveLength(1);
  });

  it('reports the end when the last step finished the update but its answer was lost', async () => {
    const h = makeJob({ steps: 1, failAt: [1] });
    h.record();
    h.finishInDatabase();
    await settle();
    expect(h.job.status()).toEqual({ updating: true });
    h.retries[0]();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
    expect(h.retries).toHaveLength(1);
  });

  it('starts at once when an update is recorded while a retry is waiting', async () => {
    const h = makeJob({ steps: 2, failAt: [1] });
    h.record();
    await settle();
    expect(h.retries).toHaveLength(1);
    h.record();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
    // The retry that was waiting finds nothing to do and reports nothing.
    h.retries[0]();
    await settle();
    expect(h.published).toEqual([{ updating: true }, { updating: false }]);
  });
});
