import { createRequire } from 'node:module';
import { describe, expect, it, vi } from 'vitest';
import type { MailActionLog } from '../shared/types';
import { createInteractiveWriteQueue } from '../main/sqliteWriteGuard';
import { SETTLE_DEADLINE_MS, createLocalWrites, type LocalWriteFailure } from '../main/localWrites';
import { runLocalLabelAction, type LocalLabelActionDeps } from '../main/localLabelAction';

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

const NETWORK_ERROR = Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' });
const PERMANENT_ERROR = new Error('HTTP 400: invalid label');

/**
 * Local writes over an in-memory database, with a clock that moves only when
 * a write waits. With `heldWaits` a wait ends only when the test calls
 * `resume`, so the test decides what happens between two attempts.
 */
function harness(options: { heldWaits?: boolean } = {}) {
  const db = new Sqlite!(':memory:');
  const clock = { now: 0 };
  const failures: LocalWriteFailure[] = [];
  const held: Array<() => void> = [];
  const queue = createInteractiveWriteQueue(() => db, {
    now: () => clock.now,
    wait: ms => new Promise<void>(resolve => {
      clock.now += ms;
      if (options.heldWaits) held.push(resolve);
      else resolve();
    }),
  });
  const resume = () => { for (const next of held.splice(0)) next(); };
  // The pauses before a kept outcome is tried again end only when the test says so.
  const pauses: Array<() => void> = [];
  const writes = createLocalWrites(queue, { onFailure: failure => failures.push(failure) }, {
    pause: () => new Promise<void>(resolve => { pauses.push(resolve); }),
  });
  const steps: string[] = [];
  // While true every write finds the database locked.
  const lock = { held: false };
  const guard = () => { if (lock.held) throw busyError(); };
  const deps: LocalLabelActionDeps = {
    writes,
    threads: {
      updateLabels: (_account, _thread, add, remove) => { guard(); steps.push(`labels +[${add}] -[${remove}]`); },
    },
    rollbacks: {
      track: (actionId, change) => { steps.push(`track ${actionId} +[${change.added}] -[${change.removed}]`); },
      forget: actionId => { steps.push(`forget ${actionId}`); },
      rollback: (action, plan) => { guard(); steps.push(`rollback ${action.id} +[${plan.add}] -[${plan.remove}]`); },
    },
    actionLog: { save: log => { guard(); steps.push(`journal:${log.status}`); } },
    isRetryableRemoteError: error => error === NETWORK_ERROR,
    now: () => new Date('2026-11-17T19:24:14.000Z'),
  };
  return { db, clock, failures, queue, writes, steps, lock, deps, held, resume, pauses };
}

function archive(runRemote: () => Promise<unknown>, onLocalChange?: () => void) {
  const log: MailActionLog & { threadId: string } = {
    id: 'action-1',
    accountId: 'alex.morgan@northwind.example',
    threadId: 'thread-1',
    kind: 'markDone',
    status: 'running',
    createdAt: '2026-11-17T19:24:14.000Z',
    payloadJson: JSON.stringify({ source: 'notification' }),
  };
  return { label: 'notification', log, addLabelIds: [], removeLabelIds: ['INBOX'], runRemote, onLocalChange };
}

describe('runLocalLabelAction', () => {
  sqliteIt('writes the label change with its journal entry, calls Gmail once, then records completed', async () => {
    const h = harness();
    const gmail = vi.fn(async () => { h.steps.push('gmail'); });
    const changed = vi.fn();

    await expect(runLocalLabelAction(h.deps, archive(gmail, changed))).resolves.toBe('completed');

    expect(h.steps).toEqual([
      'labels +[] -[INBOX]', 'journal:running', 'track action-1 +[] -[INBOX]',
      'gmail', 'forget action-1', 'journal:completed',
    ]);
    expect(gmail).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
    h.db.close();
  });

  sqliteIt('waits for a held lock, then goes on by itself', async () => {
    const h = harness({ heldWaits: true });
    const gmail = vi.fn(async () => { h.steps.push('gmail'); });
    h.lock.held = true;

    const running = runLocalLabelAction(h.deps, archive(gmail));
    // It found the lock and is between two attempts.
    await vi.waitFor(() => expect(h.held).toHaveLength(1));
    expect(gmail).not.toHaveBeenCalled();
    h.lock.held = false;
    h.resume();

    await expect(running).resolves.toBe('completed');
    expect(h.steps.filter(step => !/^(track|forget) /.test(step))).toEqual(['labels +[] -[INBOX]', 'journal:running', 'gmail', 'journal:completed']);
    expect(h.queue.size).toBe(0);
    h.db.close();
  });

  sqliteIt('rejects without calling Gmail when the first write cannot be stored in time', async () => {
    const h = harness();
    const gmail = vi.fn(async () => undefined);
    h.lock.held = true;

    await expect(runLocalLabelAction(h.deps, archive(gmail))).rejects.toThrow('database is locked');

    expect(gmail).not.toHaveBeenCalled();
    expect(h.steps).toEqual([]);
    h.db.close();
  });

  sqliteIt('parks the action on a network error', async () => {
    const h = harness();

    await expect(runLocalLabelAction(h.deps, archive(async () => { throw NETWORK_ERROR; }))).resolves.toBe('parked');

    // The plan is kept: a parked action can still be rejected when it is replayed.
    expect(h.steps).toEqual(['labels +[] -[INBOX]', 'journal:running', 'track action-1 +[] -[INBOX]', 'journal:pending_sync']);
    h.db.close();
  });

  sqliteIt('rolls back and records the failure when Gmail rejects the change', async () => {
    const h = harness();
    const changed = vi.fn();

    await expect(runLocalLabelAction(h.deps, archive(async () => { throw PERMANENT_ERROR; }, changed))).resolves.toBe('failed');

    expect(h.steps).toEqual([
      'labels +[] -[INBOX]', 'journal:running', 'track action-1 +[] -[INBOX]',
      'rollback action-1 +[INBOX] -[]', 'journal:failed',
    ]);
    expect(changed).toHaveBeenCalledTimes(2);
    h.db.close();
  });

  sqliteIt('rolls back only what the action changed, and names the action so newer ones are respected', async () => {
    const h = harness();
    // The thread was already out of the inbox: the archive changed nothing.
    h.deps.threads.updateLabels = () => ({ added: [], removed: [] });

    await expect(runLocalLabelAction(h.deps, archive(async () => { throw PERMANENT_ERROR; }))).resolves.toBe('failed');

    expect(h.steps).toEqual(['journal:running', 'track action-1 +[] -[]', 'rollback action-1 +[] -[]', 'journal:failed']);
    h.db.close();
  });

  sqliteIt('stays completed and never repeats the Gmail call when the outcome cannot be recorded', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = harness();
    const gmail = vi.fn(async () => {
      // Gmail took the change; the database is locked right after.
      h.lock.held = true;
    });

    await expect(runLocalLabelAction(h.deps, archive(gmail))).resolves.toBe('completed');

    expect(gmail).toHaveBeenCalledTimes(1);
    // It kept trying for the long settle deadline, not the short one.
    expect(h.clock.now).toBeGreaterThanOrEqual(SETTLE_DEADLINE_MS);
    expect(h.failures.map(failure => [failure.kind, failure.label, failure.retrying])).toEqual([['settle', 'notification:completed', true]]);
    expect(h.steps).not.toContain('journal:completed');

    // The outcome was not dropped: once the database can be written again it
    // is stored, so the row does not stay `running` and get replayed.
    await vi.waitFor(() => expect(h.pauses).toHaveLength(1));
    h.lock.held = false;
    h.pauses.shift()!();
    await vi.waitFor(() => expect(h.steps).toContain('journal:completed'));
    expect(gmail).toHaveBeenCalledTimes(1);
    expect(h.pauses).toHaveLength(0);
    errors.mockRestore();
    h.db.close();
  });
});

describe('createLocalWrites', () => {
  sqliteIt('puts a rollback in front of the writes that are already waiting', async () => {
    const h = harness({ heldWaits: true });
    const order: string[] = [];
    h.lock.held = true;
    const write = (name: string) => () => {
      if (h.lock.held) throw busyError();
      order.push(name);
    };

    const newer = h.writes.begin('newer', write('newer'));
    await vi.waitFor(() => expect(h.held).toHaveLength(1));
    const rollback = h.writes.rollback('rollback', write('rollback'));
    h.lock.held = false;
    h.resume();

    await expect(rollback).resolves.toBe(true);
    await newer;
    expect(order).toEqual(['rollback', 'newer']);
    h.db.close();
  });

  sqliteIt('never rejects from settle or rollback, and reports what could not be stored', async () => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const h = harness();

    await expect(h.writes.settle('outcome', () => { throw new Error('disk full'); })).resolves.toBe(false);
    await expect(h.writes.rollback('undo', () => { throw new Error('disk full'); })).resolves.toBe(false);
    await expect(h.writes.begin('first', () => { throw new Error('disk full'); })).rejects.toThrow('disk full');

    // Not a lock: there is nothing to wait for, so nothing is tried again.
    expect(h.failures.map(failure => [failure.kind, failure.label, failure.retrying])).toEqual([['settle', 'outcome', false], ['rollback', 'undo', false]]);
    expect(h.pauses).toHaveLength(0);
    errors.mockRestore();
    h.db.close();
  });
});
