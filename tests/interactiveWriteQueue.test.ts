import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailActionLog } from '../shared/types';
import {
  createInteractiveWriteQueue,
  withBusyTimeout,
  type InteractiveWriteContention,
} from '../main/sqliteWriteGuard';
import { runJournaledMailAction } from '../renderer/src/lib/mailActionJournal';

const require = createRequire(import.meta.url);

type SqliteDatabase = import('better-sqlite3').Database;
type SqliteCtor = new (filename: string) => SqliteDatabase;

function loadSqlite(): SqliteCtor | null {
  try {
    const Database = require('better-sqlite3') as SqliteCtor;
    new Database(':memory:').close();
    return Database;
  } catch {
    return null;
  }
}

const Sqlite = loadSqlite();
const sqliteIt = Sqlite ? it : it.skip;

function busyError(): Error {
  return Object.assign(new Error('database is locked'), { code: 'SQLITE_BUSY' });
}

/** A clock that only moves when the queue waits, so deadlines are exact. */
function fakeTime() {
  const state = { now: 0, waits: [] as number[] };
  return {
    state,
    now: () => state.now,
    wait: async (ms: number) => {
      state.waits.push(ms);
      state.now += ms;
    },
  };
}

describe('createInteractiveWriteQueue', () => {
  sqliteIt('retries a busy write without blocking and resolves once the lock clears', async () => {
    const db = new Sqlite!(':memory:');
    const time = fakeTime();
    const reports: InteractiveWriteContention[] = [];
    const queue = createInteractiveWriteQueue(() => db, { ...time, onContention: report => reports.push(report) });
    let calls = 0;

    const value = await queue.run('db:saveActionLog', () => {
      calls += 1;
      if (calls < 4) throw busyError();
      return 'stored';
    });

    expect(value).toBe('stored');
    expect(calls).toBe(4);
    expect(time.state.waits).toEqual([20, 40, 80]);
    expect(reports).toEqual([{ label: 'db:saveActionLog', attempts: 4, waitedMs: 140, recovered: true }]);
    expect(queue.size).toBe(0);
    db.close();
  });

  sqliteIt('runs each write as one transaction, so a busy attempt leaves nothing behind', async () => {
    const db = new Sqlite!(':memory:');
    db.exec('CREATE TABLE journal (id TEXT PRIMARY KEY)');
    const queue = createInteractiveWriteQueue(() => db, fakeTime());
    let calls = 0;

    await queue.run('write', () => {
      calls += 1;
      db.prepare('INSERT INTO journal (id) VALUES (?)').run(`row-${calls}`);
      if (calls === 1) throw busyError();
    });

    expect((db.prepare('SELECT id FROM journal').all() as Array<{ id: string }>).map(row => row.id)).toEqual(['row-2']);
    db.close();
  });

  sqliteIt('keeps the order writes were asked for while the first one is still waiting', async () => {
    const db = new Sqlite!(':memory:');
    const queue = createInteractiveWriteQueue(() => db, fakeTime());
    const order: string[] = [];
    let firstCalls = 0;

    const first = queue.run('first', () => {
      firstCalls += 1;
      order.push(`first:${firstCalls}`);
      if (firstCalls < 3) throw busyError();
    });
    const second = queue.run('second', () => { order.push('second'); });
    expect(queue.size).toBe(2);
    await Promise.all([first, second]);

    expect(order).toEqual(['first:1', 'first:2', 'first:3', 'second']);
    db.close();
  });

  sqliteIt('gives up with the busy error once the deadline passed, then keeps serving later writes', async () => {
    const db = new Sqlite!(':memory:');
    const time = fakeTime();
    const reports: InteractiveWriteContention[] = [];
    const queue = createInteractiveWriteQueue(() => db, {
      ...time,
      deadlineMs: 500,
      onContention: report => reports.push(report),
    });
    let locked = true;
    let calls = 0;
    const write = () => {
      calls += 1;
      if (locked) throw busyError();
      return 'stored';
    };

    const first = queue.run('first', write);
    const second = queue.run('second', write);

    await expect(first).rejects.toThrow('database is locked');
    // The waits add up to the deadline exactly; the last attempt lands on it.
    expect(time.state.waits.reduce((sum, ms) => sum + ms, 0)).toBe(500);
    // Queued at the same moment, so its deadline passed too: one attempt, no further wait.
    await expect(second).rejects.toThrow('database is locked');
    expect(time.state.waits.reduce((sum, ms) => sum + ms, 0)).toBe(500);
    expect(reports.map(report => [report.label, report.recovered])).toEqual([['first', false], ['second', false]]);

    locked = false;
    const before = calls;
    await expect(queue.run('third', write)).resolves.toBe('stored');
    expect(calls).toBe(before + 1);
    expect(queue.size).toBe(0);
    db.close();
  });

  sqliteIt('does not retry an error that is not a lock', async () => {
    const db = new Sqlite!(':memory:');
    const time = fakeTime();
    const queue = createInteractiveWriteQueue(() => db, time);
    let calls = 0;

    await expect(queue.run('write', () => {
      calls += 1;
      throw Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' });
    })).rejects.toThrow('UNIQUE constraint failed');

    expect(calls).toBe(1);
    expect(time.state.waits).toEqual([]);
    db.close();
  });

  sqliteIt('waits for the lock only briefly per attempt and restores the connection busy_timeout', async () => {
    const db = new Sqlite!(':memory:');
    db.pragma('busy_timeout = 5000');
    const seen: number[] = [];
    const queue = createInteractiveWriteQueue(() => db, { ...fakeTime(), attemptBusyTimeoutMs: 120 });

    await queue.run('write', () => { seen.push(Number(db.pragma('busy_timeout', { simple: true }))); });
    expect(seen).toEqual([120]);
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);

    expect(() => withBusyTimeout(db, 10, () => { throw new Error('boom'); })).toThrow('boom');
    expect(db.pragma('busy_timeout', { simple: true })).toBe(5000);
    db.close();
  });
});

// The incident: another connection held the write lock for longer than the
// synchronous guard waits, `db:saveActionLog` failed with "database is locked"
// and the trash action stopped before Gmail. These run the real path: the
// repository, the queue behind `db:saveActionLog`, and the renderer's journal
// sequence, against a database file locked by a second connection.
describe('mail action journal under a held database lock', () => {
  interface Fixture {
    database: typeof import('../main/database');
    guard: typeof import('../main/sqliteWriteGuard');
    holder: Worker;
    /** Resolves once the other connection holds the write lock. */
    lock(): Promise<void>;
    /** Resolves once the other connection committed. */
    release(): Promise<void>;
  }

  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  async function fixture(): Promise<Fixture> {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'dumka-journal-lock-'));
    vi.resetModules();
    process.env.HOME = home;
    const database = await import('../main/database');
    // Same module instance the repositories use (after resetModules).
    const guard = await import('../main/sqliteWriteGuard');
    const db = database.getDatabase();

    // The other writer: takes the write lock and keeps it until told to commit.
    const holder = new Worker(`
      const { parentPort, workerData } = require('node:worker_threads');
      const Database = require(workerData.sqlitePath);
      const db = new Database(workerData.file);
      db.pragma('busy_timeout = 5000');
      db.exec('CREATE TABLE IF NOT EXISTS bulk_writes (id INTEGER PRIMARY KEY, payload TEXT)');
      parentPort.on('message', message => {
        if (message === 'lock') {
          db.exec('BEGIN IMMEDIATE');
          db.prepare('INSERT INTO bulk_writes (payload) VALUES (?)').run('x');
          parentPort.postMessage('locked');
        } else if (message === 'release') {
          db.exec('COMMIT');
          parentPort.postMessage('released');
        }
      });
      parentPort.postMessage('ready');
    `, { eval: true, workerData: { file: db.name, sqlitePath: require.resolve('better-sqlite3') } });

    const next = (expected: string) => new Promise<void>((resolve, reject) => {
      const onMessage = (message: string) => {
        if (message !== expected) return;
        holder.off('message', onMessage);
        resolve();
      };
      holder.on('message', onMessage);
      holder.once('error', reject);
    });
    await next('ready');

    cleanup = async () => {
      await holder.terminate();
      database.getDatabase().close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      vi.resetModules();
      rmSync(home, { recursive: true, force: true });
    };

    return {
      database,
      guard,
      holder,
      lock: () => { const locked = next('locked'); holder.postMessage('lock'); return locked; },
      release: () => { const released = next('released'); holder.postMessage('release'); return released; },
    };
  }

  function trashAction(id: string): MailActionLog {
    return {
      id,
      accountId: 'alex.morgan@northwind.example',
      threadId: 'thread-1',
      kind: 'moveToTrash',
      status: 'queued',
      createdAt: new Date().toISOString(),
      payloadJson: null,
    };
  }

  sqliteIt('the synchronous guard alone fails with "database is locked" once the lock outlasts its budget', async () => {
    const { database, lock, release } = await fixture();
    // The production value is 5000 ms; a short one makes the same thing happen quickly.
    database.getDatabase().pragma('busy_timeout = 20');
    await lock();

    expect(() => database.ActionLogRepo.save(trashAction('sync-write'))).toThrow('database is locked');

    await release();
    expect(database.ActionLogRepo.get('sync-write')).toBeNull();
  });

  sqliteIt('a trash action goes on by itself once the lock clears and reaches Gmail exactly once', async () => {
    const { database, guard, lock, release } = await fixture();
    const reports: InteractiveWriteContention[] = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      onContention: report => reports.push(report),
    });
    const gmail = vi.fn(async () => ({ offline: false }));
    const log = trashAction('clears');
    await lock();

    // One Delete: the action as the renderer runs it, with `db:saveActionLog`
    // served by the queue as in main/index.ts.
    const action = runJournaledMailAction({
      log,
      saveActionLog: entry => queue.run('db:saveActionLog', () => database.ActionLogRepo.save(entry)),
      mutate: gmail,
    });

    // Longer than the synchronous guard would have waited (see the test above).
    await new Promise(resolve => setTimeout(resolve, 600));
    expect(gmail).not.toHaveBeenCalled();
    expect(database.ActionLogRepo.get('clears')).toBeNull();

    await release();

    await expect(action).resolves.toEqual({ status: 'completed' });
    expect(gmail).toHaveBeenCalledTimes(1);
    expect(database.ActionLogRepo.get('clears')).toMatchObject({ status: 'completed', kind: 'moveToTrash' });
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ label: 'db:saveActionLog', recovered: true });
    expect(reports[0].attempts).toBeGreaterThan(1);
  });

  sqliteIt('several actions pressed during the lock are all stored, in order, once it clears', async () => {
    const { database, guard, lock, release } = await fixture();
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, { attemptBusyTimeoutMs: 20 });
    const gmailOrder: string[] = [];
    await lock();

    const actions = ['a', 'b', 'c', 'd'].map(id => runJournaledMailAction({
      log: trashAction(id),
      saveActionLog: entry => queue.run('db:saveActionLog', () => database.ActionLogRepo.save(entry)),
      mutate: async () => {
        gmailOrder.push(id);
        return { offline: false };
      },
    }));
    await new Promise(resolve => setTimeout(resolve, 300));
    expect(gmailOrder).toEqual([]);

    await release();

    expect((await Promise.all(actions)).map(outcome => outcome.status)).toEqual(['completed', 'completed', 'completed', 'completed']);
    expect(gmailOrder).toEqual(['a', 'b', 'c', 'd']);
    for (const id of ['a', 'b', 'c', 'd']) {
      expect(database.ActionLogRepo.get(id)?.status).toBe('completed');
    }
  });

  sqliteIt('a lock that outlasts the bounded wait fails the action before Gmail and is recorded afterwards', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const { database, guard, lock, release } = await fixture();
    const reports: InteractiveWriteContention[] = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      deadlineMs: 300,
      onContention: report => reports.push(report),
    });
    const gmail = vi.fn(async () => ({ offline: false }));
    const settled = vi.fn();
    const log = trashAction('persists');
    await lock();

    const startedAt = Date.now();
    const outcome = await runJournaledMailAction({
      log,
      saveActionLog: entry => queue.run('db:saveActionLog', () => database.ActionLogRepo.save(entry)),
      mutate: gmail,
      onJournalSettled: settled,
      settleRetryDelaysMs: [50, 50, 50, 50, 50, 50, 50, 50],
    });
    const waitedMs = Date.now() - startedAt;

    expect(outcome.status).toBe('notSaved');
    expect(gmail).not.toHaveBeenCalled();
    expect(waitedMs).toBeGreaterThanOrEqual(280);
    expect(waitedMs).toBeLessThan(2000);
    expect(log.status).toBe('failed');
    expect(reports[0]).toMatchObject({ label: 'db:saveActionLog', recovered: false });

    // The lock goes away later: the failure reaches the journal, Gmail is still untouched.
    await release();
    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1), { timeout: 5000, interval: 20 });
    expect(database.ActionLogRepo.get('persists')).toMatchObject({ status: 'failed', failureMessage: 'database is locked' });
    expect(gmail).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
