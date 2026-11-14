import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Worker } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';
import type { MailThread } from '../shared/types';
import {
  chunked,
  isSqliteBusyError,
  retryOnSqliteBusy,
  runWriteTransaction,
  sqliteBusyRetryDelay,
} from '../main/sqliteWriteGuard';
import {
  LOCAL_SAVE_FAILED_MESSAGE,
  REMOTE_ACTION_FAILED_MESSAGE,
  SEND_FAILED_MESSAGE,
  localSaveFailedErrorMessage,
  mailActionFailureMessage,
} from '../shared/mailActionErrors';

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

function busyError(code = 'SQLITE_BUSY'): Error {
  return Object.assign(new Error('database is locked'), { code });
}

describe('retryOnSqliteBusy', () => {
  it('recognises busy / locked errors only', () => {
    expect(isSqliteBusyError(busyError())).toBe(true);
    expect(isSqliteBusyError(busyError('SQLITE_BUSY_SNAPSHOT'))).toBe(true);
    expect(isSqliteBusyError(busyError('SQLITE_LOCKED'))).toBe(true);
    expect(isSqliteBusyError(new Error('Error invoking remote method \'api:modifyLabels\': SqliteError: database is locked'))).toBe(true);
    expect(isSqliteBusyError(Object.assign(new Error('UNIQUE constraint failed'), { code: 'SQLITE_CONSTRAINT_UNIQUE' }))).toBe(false);
    expect(isSqliteBusyError(new Error('fetch failed'))).toBe(false);
  });

  it('retries busy failures with short exponential backoff and returns the result', () => {
    const sleeps: number[] = [];
    let calls = 0;
    const value = retryOnSqliteBusy(() => {
      calls += 1;
      if (calls < 4) throw busyError('SQLITE_BUSY_SNAPSHOT');
      return 'ok';
    }, { sleep: ms => sleeps.push(ms) });
    expect(value).toBe('ok');
    expect(calls).toBe(4);
    expect(sleeps).toEqual([5, 10, 20]);
  });

  it('gives up after the attempt limit and well under a second of sleeping', () => {
    const sleeps: number[] = [];
    let calls = 0;
    expect(() => retryOnSqliteBusy(() => {
      calls += 1;
      throw busyError();
    }, { sleep: ms => sleeps.push(ms) })).toThrow('database is locked');
    expect(calls).toBe(8);
    expect(sleeps.reduce((sum, ms) => sum + ms, 0)).toBeLessThan(1000);
    expect(sqliteBusyRetryDelay(10)).toBe(100);
  });

  it('does not retry again once busy_timeout already blocked for the time budget', () => {
    let clock = 0;
    let calls = 0;
    expect(() => retryOnSqliteBusy(() => {
      calls += 1;
      clock += 5000; // the lock was held for the whole busy_timeout
      throw busyError();
    }, { sleep: () => undefined, now: () => clock })).toThrow();
    expect(calls).toBe(1);
  });

  it('never retries other errors', () => {
    let calls = 0;
    expect(() => retryOnSqliteBusy(() => {
      calls += 1;
      throw new Error('no such table: threads');
    }, { sleep: () => undefined })).toThrow('no such table');
    expect(calls).toBe(1);
  });

  it('splits bulk writes into chunks', () => {
    expect(chunked([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunked([], 40)).toEqual([]);
  });
});

describe('mail action failure text', () => {
  it('never shows raw IPC / SQLite text', () => {
    const ipc = new Error("Error invoking remote method 'api:modifyLabels': SqliteError: database is locked");
    expect(mailActionFailureMessage(ipc)).toBe(LOCAL_SAVE_FAILED_MESSAGE);
    expect(mailActionFailureMessage(new Error(`Error invoking remote method 'api:modifyLabels': Error: ${localSaveFailedErrorMessage()}`)))
      .toBe(LOCAL_SAVE_FAILED_MESSAGE);
    expect(mailActionFailureMessage(new Error("Error invoking remote method 'api:modifyLabels': Error: Gmail HTTP 500: {\"error\":{}}")))
      .toBe(REMOTE_ACTION_FAILED_MESSAGE);
    expect(mailActionFailureMessage(new Error('Chat HTTP 503'), 'send')).toBe(SEND_FAILED_MESSAGE);
  });

  it('keeps short human sentences thrown on purpose', () => {
    expect(mailActionFailureMessage(new Error("Error invoking remote method 'api:sendDraft': Error: Draft account does not match the sending account.")))
      .toBe('Draft account does not match the sending account.');
  });
});

describe('two SQLite connections on one file', () => {
  sqliteIt('confirms the cause: a deferred read-then-write after another commit fails immediately with SQLITE_BUSY_SNAPSHOT', () => {
    const dir = mkdtempSync(join(tmpdir(), 'dumka-busy-snapshot-'));
    const file = join(dir, 'db.sqlite');
    const a = new Sqlite!(file);
    const b = new Sqlite!(file);
    try {
      for (const db of [a, b]) {
        db.pragma('journal_mode = WAL');
        db.pragma('busy_timeout = 5000');
      }
      a.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)');
      a.prepare('INSERT INTO t (id, v) VALUES (1, ?)').run('a');

      // Deferred transaction on A reads first (takes a snapshot)…
      a.exec('BEGIN');
      a.prepare('SELECT v FROM t WHERE id = 1').get();
      // …B commits a write…
      b.prepare('INSERT INTO t (id, v) VALUES (2, ?)').run('b');
      // …so A cannot upgrade to a write; busy_timeout does not help.
      const started = Date.now();
      let code: string | undefined;
      try {
        a.prepare('UPDATE t SET v = ? WHERE id = 1').run('x');
      } catch (error) {
        code = (error as { code?: string }).code;
      }
      expect(code).toBe('SQLITE_BUSY_SNAPSHOT');
      expect(Date.now() - started).toBeLessThan(1000);
      a.exec('ROLLBACK');

      // An IMMEDIATE transaction through the guard succeeds in the same situation.
      runWriteTransaction(a, () => {
        a.prepare('SELECT v FROM t WHERE id = 1').get();
        a.prepare('UPDATE t SET v = ? WHERE id = 1').run('y');
      });
      expect((b.prepare('SELECT v FROM t WHERE id = 1').get() as { v: string }).v).toBe('y');
    } finally {
      a.close();
      b.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  sqliteIt('label updates through ThreadsRepo all succeed while another connection commits write transactions in a loop', async () => {
    const previousHome = process.env.HOME;
    const home = mkdtempSync(join(tmpdir(), 'dumka-two-connections-'));
    vi.resetModules();
    process.env.HOME = home;
    let databaseModule: typeof import('../main/database') | null = null;
    let worker: Worker | null = null;
    try {
      databaseModule = await import('../main/database');
      // Same module instance the repositories use (after resetModules).
      const guard = await import('../main/sqliteWriteGuard');
      const signal = guard.createWritePrioritySignal();
      const db = databaseModule.getDatabase();
      const accountId = 'alex.morgan@northwind.example';
      const threads: MailThread[] = Array.from({ length: 5 }, (_, index) => ({
        id: `thread-${index}`,
        accountId,
        subject: `Subject ${index}`,
        snippet: '',
        lastMessageAt: new Date(Date.UTC(2026, 10, 1, index)).toISOString(),
        senderNames: ['Jordan Lee'],
        senderEmail: 'jordan.lee@northwind.example',
        to: [],
        cc: [],
        labelIds: ['INBOX'],
        hasAttachments: false,
        isUnread: true,
      } as unknown as MailThread));
      databaseModule.ThreadsRepo.save(threads);

      // The "database worker": a second connection that keeps taking the
      // write lock, holding it ~15 ms per transaction, and committing.
      worker = new Worker(`
        const { parentPort, workerData } = require('node:worker_threads');
        const Database = require(workerData.sqlitePath);
        const db = new Database(workerData.file);
        db.pragma('busy_timeout = 5000');
        db.exec('CREATE TABLE IF NOT EXISTS bulk_writes (id INTEGER PRIMARY KEY, payload TEXT)');
        const insert = db.prepare('INSERT INTO bulk_writes (payload) VALUES (?)');
        const touch = db.prepare("UPDATE threads SET snippet = ? WHERE account_id = ? AND id = 'thread-0'");
        const cell = new Int32Array(new SharedArrayBuffer(4));
        // Mirrors yieldToInteractiveWriters() in main/sqliteWriteGuard.ts.
        const signal = new Int32Array(workerData.signal);
        const yieldToWriters = () => {
          const startedAt = Date.now();
          for (;;) {
            const waiting = Atomics.load(signal, 0);
            if (waiting <= 0) return;
            const remaining = 250 - (Date.now() - startedAt);
            if (remaining <= 0) return;
            Atomics.wait(signal, 0, waiting, remaining);
          }
        };
        let commits = 0;
        let stop = false;
        parentPort.on('message', message => { if (message === 'stop') stop = true; });
        parentPort.postMessage({ type: 'ready' });
        const loop = () => {
          const deadline = Date.now() + 40;
          while (Date.now() < deadline && !stop) {
            yieldToWriters();
            db.exec('BEGIN IMMEDIATE');
            for (let i = 0; i < 50; i += 1) insert.run('x'.repeat(200));
            touch.run(String(commits), workerData.accountId);
            Atomics.wait(cell, 0, 0, 15);
            db.exec('COMMIT');
            commits += 1;
          }
          if (stop) { db.close(); parentPort.postMessage({ type: 'done', commits }); return; }
          setImmediate(loop);
        };
        loop();
      `, { eval: true, workerData: { file: db.name, sqlitePath: require.resolve('better-sqlite3'), accountId, signal } });

      const messages: Array<{ type: string; commits?: number }> = [];
      const done = new Promise<number>((resolve, reject) => {
        worker!.on('message', (message: { type: string; commits?: number }) => {
          messages.push(message);
          if (message.type === 'done') resolve(message.commits ?? 0);
        });
        worker!.on('error', reject);
      });
      await new Promise<void>(resolve => {
        const check = () => (messages.some(message => message.type === 'ready') ? resolve() : setTimeout(check, 5));
        check();
      });
      await new Promise(resolve => setTimeout(resolve, 30));

      const failures: unknown[] = [];
      let slowest = 0;
      const updates = 60;
      for (let index = 0; index < updates; index += 1) {
        const thread = threads[index % threads.length];
        const archive = index % 2 === 0;
        const startedAt = Date.now();
        try {
          databaseModule.ThreadsRepo.updateLabels(accountId, thread.id, archive ? [] : ['INBOX'], archive ? ['INBOX'] : []);
          databaseModule.ActionLogRepo.save({
            id: `action-${index}`,
            accountId,
            threadId: thread.id,
            kind: archive ? 'markDone' : 'restoreInbox',
            status: 'completed',
            createdAt: new Date().toISOString(),
          });
        } catch (error) {
          failures.push(error);
        }
        slowest = Math.max(slowest, Date.now() - startedAt);
        // Let the other connection get back in between our writes.
        await new Promise(resolve => setTimeout(resolve, 2));
      }

      worker.postMessage('stop');
      const commits = await done;
      expect(failures).toEqual([]);
      expect(commits).toBeGreaterThan(5);
      // Interactive writes get the lock within about one bulk chunk, not a busy_timeout.
      expect(slowest).toBeLessThan(1000);
      // Every thread ends in the state of its last update.
      for (const [position, thread] of threads.entries()) {
        const lastIndex = Math.max(...Array.from({ length: updates }, (_, index) => index).filter(index => index % threads.length === position));
        const expectedInbox = lastIndex % 2 !== 0;
        expect(databaseModule.ThreadsRepo.get(accountId, thread.id)?.labelIds.includes('INBOX')).toBe(expectedInbox);
      }
      expect(databaseModule.ActionLogRepo.list(accountId).length).toBe(updates);
    } finally {
      await worker?.terminate();
      databaseModule?.getDatabase().close();
      if (previousHome === undefined) delete process.env.HOME;
      else process.env.HOME = previousHome;
      vi.resetModules();
      rmSync(home, { recursive: true, force: true });
    }
  }, 30_000);
});
