import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MailActionLog } from '../shared/types';
import type { MailThread } from '../shared/types';
import {
  createInteractiveWriteQueue,
  runWriteTransaction,
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
    // How long each attempt was allowed to block waiting for the lock.
    const lockWaits: number[] = [];
    const write = () => {
      calls += 1;
      lockWaits.push(Number(db.pragma('busy_timeout', { simple: true })));
      if (locked) throw busyError();
      return 'stored';
    };

    const first = queue.run('first', write);
    const second = queue.run('second', write);

    await expect(first).rejects.toThrow('database is locked');
    // The waits add up to the deadline exactly; the last attempt lands on it.
    expect(time.state.waits.reduce((sum, ms) => sum + ms, 0)).toBe(500);
    await expect(second).rejects.toThrow('database is locked');
    // No attempt may block past the deadline: the lock wait shrinks to the
    // time left and the attempt on the deadline does not wait at all. The
    // second write was queued at the same moment, so it had expired when its
    // turn came: one attempt that does not block (the last 0), no further wait.
    expect(lockWaits).toEqual([150, 150, 150, 150, 150, 150, 60, 0, 0]);
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

  /** A queue whose waits between attempts end only when the test says so. */
  function heldQueue(db: SqliteDatabase) {
    const resume: Array<() => void> = [];
    const queue = createInteractiveWriteQueue(() => db, {
      wait: () => new Promise<void>(resolve => { resume.push(resolve); }),
    });
    return { queue, resumeAll: () => { for (const next of resume.splice(0)) next(); } };
  }

  sqliteIt('a synchronous write lands the waiting writes first, so an older queued write is never applied on top of it', async () => {
    const db = new Sqlite!(':memory:');
    const { queue, resumeAll } = heldQueue(db);
    const order: string[] = [];
    let locked = true;
    const queued = (name: string) => () => {
      if (locked) throw busyError();
      order.push(name);
      return name;
    };

    const first = queue.run('older-1', queued('older-1'));
    const second = queue.run('older-2', queued('older-2'));
    // The first write tried, found the lock and is now between attempts.
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(queue.size).toBe(2);

    // The lock clears and a synchronous writer (a notification action, a
    // sender-rule archive) runs before the queue's next attempt.
    locked = false;
    runWriteTransaction(db, () => { order.push('newer'); }, { bulk: false });

    expect(order).toEqual(['older-1', 'older-2', 'newer']);
    expect(queue.size).toBe(0);
    await expect(first).resolves.toBe('older-1');
    await expect(second).resolves.toBe('older-2');

    // The queue's own next attempt finds nothing left and writes nothing twice.
    resumeAll();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(order).toEqual(['older-1', 'older-2', 'newer']);
    db.close();
  });

  sqliteIt('a synchronous write fails with the busy error instead of overtaking while the lock is still held', async () => {
    const db = new Sqlite!(':memory:');
    const { queue, resumeAll } = heldQueue(db);
    const order: string[] = [];
    let locked = true;

    const older = queue.run('older', () => {
      if (locked) throw busyError();
      order.push('older');
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(() => runWriteTransaction(db, () => { order.push('newer'); }, { bulk: false })).toThrow('database is locked');
    expect(order).toEqual([]);
    expect(queue.size).toBe(1);

    locked = false;
    resumeAll();
    await older;
    expect(order).toEqual(['older']);
    db.close();
  });

  sqliteIt('a rollback runs ahead of the waiting writes instead of landing them first', async () => {
    const db = new Sqlite!(':memory:');
    const { queue, resumeAll } = heldQueue(db);
    const order: string[] = [];
    let locked = true;

    const newer = queue.run('newer', () => {
      if (locked) throw busyError();
      order.push('newer');
    });
    await new Promise(resolve => setTimeout(resolve, 0));

    locked = false;
    runWriteTransaction(db, () => { order.push('rollback of an older write'); }, { bulk: false, aheadOfQueue: true });
    expect(order).toEqual(['rollback of an older write']);
    expect(queue.size).toBe(1);

    resumeAll();
    await newer;
    expect(order).toEqual(['rollback of an older write', 'newer']);
    db.close();
  });

  sqliteIt('a write asked for ahead of the queue waits in front of the ordinary writes', async () => {
    const db = new Sqlite!(':memory:');
    const { queue, resumeAll } = heldQueue(db);
    const order: string[] = [];
    let locked = true;
    const write = (name: string) => () => {
      if (locked) throw busyError();
      order.push(name);
    };

    const writes = [
      queue.run('newer-1', write('newer-1')),
      queue.run('newer-2', write('newer-2')),
    ];
    await new Promise(resolve => setTimeout(resolve, 0));
    writes.push(queue.run('park-1', write('park-1'), { aheadOfQueue: true }));
    writes.push(queue.run('park-2', write('park-2'), { aheadOfQueue: true }));

    locked = false;
    resumeAll();
    await Promise.all(writes);

    expect(order).toEqual(['park-1', 'park-2', 'newer-1', 'newer-2']);
    db.close();
  });

  sqliteIt('runs onRejected when a write is given up, before the next waiting write has its turn', async () => {
    const db = new Sqlite!(':memory:');
    const time = fakeTime();
    const queue = createInteractiveWriteQueue(() => db, time);
    const order: string[] = [];
    let locked = true;

    const newer = queue.run('newer', () => {
      if (locked) throw busyError();
      order.push('newer');
    }, { deadlineMs: 10_000 });
    const park = queue.run('park', () => { throw busyError(); }, {
      aheadOfQueue: true,
      deadlineMs: 100,
      onRejected: () => {
        order.push('rollback');
        // The lock clears at this very moment: the newer write must still come after.
        locked = false;
      },
    });

    await expect(park).rejects.toThrow('database is locked');
    await newer;
    expect(order).toEqual(['rollback', 'newer']);

    // Also for an error that is not a lock.
    const failed = queue.run('park', () => { throw new Error('disk full'); }, { onRejected: () => { order.push('rollback-2'); } });
    const after = queue.run('after', () => { order.push('after'); });
    await expect(failed).rejects.toThrow('disk full');
    await after;
    expect(order).toEqual(['rollback', 'newer', 'rollback-2', 'after']);
    db.close();
  });

  sqliteIt('a write queued and followed by a synchronous write in the same tick keeps its place', async () => {
    const db = new Sqlite!(':memory:');
    const queue = createInteractiveWriteQueue(() => db, fakeTime());
    const order: string[] = [];

    const queuedWrite = queue.run('queued', () => { order.push('queued'); });
    runWriteTransaction(db, () => { order.push('synchronous'); }, { bulk: false });
    await queuedWrite;

    expect(order).toEqual(['queued', 'synchronous']);
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

  sqliteIt('a newer synchronous label write is not undone by an older one that was waiting for the lock', async () => {
    const { database, guard, lock, release } = await fixture();
    const accountId = 'alex.morgan@northwind.example';
    database.ThreadsRepo.save([{
      id: 'thread-1',
      accountId,
      subject: 'Quarterly plan',
      snippet: '',
      lastMessageAt: new Date(Date.UTC(2026, 10, 17)).toISOString(),
      senderNames: ['Jordan Lee'],
      senderEmail: 'jordan.lee@northwind.example',
      to: [],
      cc: [],
      labelIds: ['INBOX'],
      hasAttachments: false,
      isUnread: false,
    } as unknown as MailThread]);
    // The queue stays between two attempts until the test lets it go on, so
    // the order below does not depend on timers.
    const resume: Array<() => void> = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      wait: () => new Promise<void>(resolve => { resume.push(resolve); }),
    });
    await lock();

    // Older: "mark unread" from the window, as api:modifyLabels queues it.
    const older = queue.run('api:modifyLabels', () => database.ThreadsRepo.updateLabels(accountId, 'thread-1', ['UNREAD'], []));
    await vi.waitFor(() => expect(resume).toHaveLength(1));
    expect(queue.size).toBe(1);

    // The lock clears; before the queue's next attempt a notification's
    // "Mark read" writes the same thread synchronously.
    await release();
    guard.runWriteTransaction(
      database.getDatabase(),
      () => database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']),
      { bulk: false },
    );
    for (const next of resume.splice(0)) next();
    await older;

    // The person's latest choice stands.
    expect(database.ThreadsRepo.get(accountId, 'thread-1')?.labelIds).toEqual(['INBOX']);
  });

  sqliteIt('the rollback of an older action does not undo a newer one that was waiting for the lock', async () => {
    const { database, guard, lock, release } = await fixture();
    const accountId = 'alex.morgan@northwind.example';
    // The older "mark read" is already stored (no UNREAD); Gmail has not answered yet.
    database.ThreadsRepo.save([{
      id: 'thread-1',
      accountId,
      subject: 'Quarterly plan',
      snippet: '',
      lastMessageAt: new Date(Date.UTC(2026, 10, 17)).toISOString(),
      senderNames: ['Jordan Lee'],
      senderEmail: 'jordan.lee@northwind.example',
      to: [],
      cc: [],
      labelIds: ['INBOX'],
      hasAttachments: false,
      isUnread: false,
    } as unknown as MailThread]);
    const resume: Array<() => void> = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      wait: () => new Promise<void>(resolve => { resume.push(resolve); }),
    });
    await lock();

    // Newer: a second "mark read" of the same thread, waiting for the lock.
    const newer = queue.run('api:modifyLabels', () => database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']));
    await vi.waitFor(() => expect(resume).toHaveLength(1));

    // The lock clears and Gmail rejects the older action: its rollback puts
    // UNREAD back, as rollbackLocalLabels in main/index.ts does.
    await release();
    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], []);
    expect(queue.size).toBe(1);
    for (const next of resume.splice(0)) next();
    await newer;

    // The newer action was applied after the rollback, so the thread is read.
    expect(database.ThreadsRepo.get(accountId, 'thread-1')?.labelIds).toEqual(['INBOX']);
  });

  sqliteIt('a replayed action that Gmail rejects is failed and rolled back ahead of a newer waiting write', async () => {
    const { database, guard, lock, release } = await fixture();
    const { reconcilePendingActions } = await import('../main/actionReconciler');
    const accountId = 'alex.morgan@northwind.example';
    // A parked "mark read": stored locally (no UNREAD), not yet in Gmail.
    database.ThreadsRepo.save([{
      id: 'thread-1',
      accountId,
      subject: 'Quarterly plan',
      snippet: '',
      lastMessageAt: new Date(Date.UTC(2026, 10, 17)).toISOString(),
      senderNames: ['Jordan Lee'],
      senderEmail: 'jordan.lee@northwind.example',
      to: [],
      cc: [],
      labelIds: ['INBOX'],
      hasAttachments: false,
      isUnread: false,
    } as unknown as MailThread]);
    database.ActionLogRepo.save({
      id: 'parked',
      accountId,
      threadId: 'thread-1',
      kind: 'markRead',
      status: 'pending_sync',
      createdAt: new Date().toISOString(),
      payloadJson: null,
    });
    const resume: Array<() => void> = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      wait: () => new Promise<void>(resolve => { resume.push(resolve); }),
    });
    let rejectGmail: (error: Error) => void = () => undefined;
    const gmailAnswer = new Promise<never>((_resolve, reject) => { rejectGmail = reject; });
    const unused = async () => ({});

    // The reconciler as main/index.ts wires it.
    const replay = reconcilePendingActions({
      actionLog: database.ActionLogRepo,
      threads: {
        get: (account, threadId) => database.ThreadsRepo.get(account, threadId),
        updateLabels: (account, threadId, add, remove) => database.ThreadsRepo.rollbackLabels(account, threadId, add, remove),
      },
      runRollback: fn => guard.runRollbackTransaction(database.getDatabase(), fn),
      drafts: { get: () => null, delete: () => undefined },
      gmail: { modifyLabels: () => gmailAnswer, trashThread: unused, untrashThread: unused, sendDraft: unused },
      buildForwardDraft: () => ({}),
      buildAutoReplyDraft: () => ({}),
      logger: { log: () => undefined, error: () => undefined },
    });
    await vi.waitFor(() => expect(database.ActionLogRepo.get('parked')?.status).toBe('running'));

    // While Gmail has not answered, a newer "mark read" of the thread waits for the lock.
    await lock();
    const newer = queue.run('api:modifyLabels', () => database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']));
    await vi.waitFor(() => expect(resume).toHaveLength(1));
    await release();

    // Gmail rejects the parked action for good.
    rejectGmail(new Error('HTTP 400: invalid label'));
    await replay;
    expect(database.ActionLogRepo.get('parked')).toMatchObject({ status: 'failed', failureMessage: 'HTTP 400: invalid label' });
    expect(queue.size).toBe(1);

    for (const next of resume.splice(0)) next();
    await newer;
    // The newer action landed after the rollback: the thread is read.
    expect(database.ThreadsRepo.get(accountId, 'thread-1')?.labelIds).toEqual(['INBOX']);
  });

  sqliteIt('an action that cannot be parked is rolled back before a newer waiting write of the same thread', async () => {
    const { database, guard, lock, release } = await fixture();
    const accountId = 'alex.morgan@northwind.example';
    // The older "mark read" is stored (no UNREAD); its Gmail request is in flight.
    database.ThreadsRepo.save([{
      id: 'thread-1',
      accountId,
      subject: 'Quarterly plan',
      snippet: '',
      lastMessageAt: new Date(Date.UTC(2026, 10, 17)).toISOString(),
      senderNames: ['Jordan Lee'],
      senderEmail: 'jordan.lee@northwind.example',
      to: [],
      cc: [],
      labelIds: ['INBOX'],
      hasAttachments: false,
      isUnread: false,
    } as unknown as MailThread]);
    const resume: Array<() => void> = [];
    const queue = guard.createInteractiveWriteQueue(database.getDatabase, {
      attemptBusyTimeoutMs: 20,
      wait: () => new Promise<void>(resolve => { resume.push(resolve); }),
    });
    await lock();

    // Newer: a second "mark read" of the same thread waits for the lock.
    const newer = queue.run('api:modifyLabels', () => database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']));
    await vi.waitFor(() => expect(resume).toHaveLength(1));

    // The older request fails with a network error and is parked, as
    // api:modifyLabels does it; the parking write cannot be stored.
    const park = queue.run('api:modifyLabels:park', () => { throw new Error('disk full'); }, {
      aheadOfQueue: true,
      onRejected: () => database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], []),
    });
    park.catch(() => undefined);

    await release();
    for (const next of resume.splice(0)) next();
    await expect(park).rejects.toThrow('disk full');
    await newer;

    // Rolled back first, then the newer action: the thread is read.
    expect(database.ThreadsRepo.get(accountId, 'thread-1')?.labelIds).toEqual(['INBOX']);
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
