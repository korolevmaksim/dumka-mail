// Write coordination between the better-sqlite3 connections that share the WAL
// database: the Electron main thread (interactive writes: labels, action log,
// drafts, reminders, settings, decisions), the database worker thread (bulk
// writes: sync/backfill pages, FTS, embeddings) and the semantic search worker
// (the one-time embedding vector migration).
//
// Why this exists: a deferred transaction that has already read and then tries
// to write after the other connection committed fails with SQLITE_BUSY_SNAPSHOT
// immediately (busy_timeout is not consulted), and a long bulk transaction can
// outlast busy_timeout. So:
//   1. every write runs in an IMMEDIATE transaction (takes the write lock up
//      front, never upgrades a stale snapshot),
//   2. a small bounded retry absorbs the remaining SQLITE_BUSY / LOCKED cases,
//   3. bulk writers commit in small chunks and, between chunks, yield to an
//      interactive writer that announced itself through a shared counter,
//   4. a write that stands in front of a remote call (the action journal, the
//      optimistic label change) waits in the interactive write queue at the
//      end of this file instead of failing when 1-3 were not enough.

import { isMainThread } from 'worker_threads';
import type Database from 'better-sqlite3';

const BUSY_CODES = new Set([
  'SQLITE_BUSY',
  'SQLITE_BUSY_SNAPSHOT',
  'SQLITE_BUSY_RECOVERY',
  'SQLITE_BUSY_TIMEOUT',
  'SQLITE_LOCKED',
  'SQLITE_LOCKED_SHAREDCACHE',
  'SQLITE_LOCKED_VTAB',
]);

export function isSqliteBusyError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' && BUSY_CODES.has(code)) return true;
  const message = error instanceof Error ? error.message : '';
  return /database is locked|database table is locked|SQLITE_BUSY|SQLITE_LOCKED/i.test(message);
}

export interface SqliteBusyRetryOptions {
  /** Total attempts including the first one. */
  attempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** Give up once this much time was spent sleeping between attempts. */
  sleepBudgetMs?: number;
  /**
   * Give up once this much wall time passed in total. A lock held past
   * busy_timeout already blocked us that long; retrying it again would only
   * freeze the caller longer. Immediate SQLITE_BUSY_SNAPSHOT retries fit easily.
   */
  timeBudgetMs?: number;
  now?: () => number;
  sleep?: (ms: number) => void;
  onRetry?: (attempt: number, error: unknown) => void;
}

export const DEFAULT_SQLITE_BUSY_RETRY: Required<Omit<SqliteBusyRetryOptions, 'sleep' | 'onRetry' | 'now'>> = {
  attempts: 8,
  baseDelayMs: 5,
  maxDelayMs: 100,
  // 5+10+20+40+80+100+100 = 355 ms of sleeping at most.
  sleepBudgetMs: 400,
  timeBudgetMs: 2000,
};

const sleepCell = new Int32Array(new SharedArrayBuffer(4));

/** Synchronous sleep (better-sqlite3 is synchronous; Atomics.wait is allowed in Node threads). */
export function sleepSync(ms: number): void {
  if (ms <= 0) return;
  Atomics.wait(sleepCell, 0, 0, ms);
}

export function sqliteBusyRetryDelay(attempt: number, options: SqliteBusyRetryOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_SQLITE_BUSY_RETRY.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULT_SQLITE_BUSY_RETRY.maxDelayMs;
  return Math.min(max, base * 2 ** Math.max(0, attempt - 1));
}

/** Runs `fn`, retrying only SQLITE_BUSY / SQLITE_LOCKED failures with short backoff. */
export function retryOnSqliteBusy<T>(fn: () => T, options: SqliteBusyRetryOptions = {}): T {
  const attempts = Math.max(1, options.attempts ?? DEFAULT_SQLITE_BUSY_RETRY.attempts);
  const budget = options.sleepBudgetMs ?? DEFAULT_SQLITE_BUSY_RETRY.sleepBudgetMs;
  const timeBudget = options.timeBudgetMs ?? DEFAULT_SQLITE_BUSY_RETRY.timeBudgetMs;
  const sleep = options.sleep ?? sleepSync;
  const now = options.now ?? Date.now;
  const startedAt = now();
  let slept = 0;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return fn();
    } catch (error) {
      if (!isSqliteBusyError(error) || attempt >= attempts) throw error;
      const delay = sqliteBusyRetryDelay(attempt, options);
      if (slept + delay > budget || now() - startedAt + delay > timeBudget) throw error;
      options.onRetry?.(attempt, error);
      sleep(delay);
      slept += delay;
    }
  }
}

// === Interactive-writer priority (shared between main thread and worker) ===

let prioritySignal: Int32Array | null = null;

/**
 * Main thread: the shared counter, created once and passed to every worker
 * that writes (via workerData), so they all yield to the same announcements.
 */
export function createWritePrioritySignal(): SharedArrayBuffer {
  if (prioritySignal) return prioritySignal.buffer as SharedArrayBuffer;
  const buffer = new SharedArrayBuffer(4);
  prioritySignal = new Int32Array(buffer);
  return buffer;
}

/** Worker thread: attach the counter received through workerData. */
export function attachWritePrioritySignal(buffer: SharedArrayBuffer | null | undefined): void {
  prioritySignal = buffer ? new Int32Array(buffer) : null;
}

function announceInteractiveWrite(): () => void {
  const signal = prioritySignal;
  if (!signal) return () => undefined;
  Atomics.add(signal, 0, 1);
  return () => {
    Atomics.sub(signal, 0, 1);
    Atomics.notify(signal, 0);
  };
}

/**
 * Bulk writer: if an interactive write is waiting, pause (bounded) so it can
 * take the write lock between our chunks; otherwise return immediately.
 */
export function yieldToInteractiveWriters(maxWaitMs = 250): void {
  const signal = prioritySignal;
  if (!signal) return;
  const startedAt = Date.now();
  for (;;) {
    const waiting = Atomics.load(signal, 0);
    if (waiting <= 0) return;
    const remaining = maxWaitMs - (Date.now() - startedAt);
    if (remaining <= 0) return;
    Atomics.wait(signal, 0, waiting, remaining);
  }
}

export interface WriteTransactionOptions {
  /** Bulk chunk (worker): yield to interactive writers first. Defaults to "not on the main thread". */
  bulk?: boolean;
  retry?: SqliteBusyRetryOptions;
}

/**
 * Runs `fn` inside an IMMEDIATE transaction with the bounded busy retry.
 * Nested calls (already inside a transaction) run `fn` directly so an outer
 * transaction is never retried half-way.
 */
export function runWriteTransaction<T>(db: Database.Database, fn: () => T, options: WriteTransactionOptions = {}): T {
  if (db.inTransaction) return fn();
  const bulk = options.bulk ?? !isMainThread;
  if (bulk) {
    yieldToInteractiveWriters();
    return retryOnSqliteBusy(() => db.transaction(fn).immediate(), options.retry);
  }
  const done = announceInteractiveWrite();
  try {
    return retryOnSqliteBusy(() => db.transaction(fn).immediate(), options.retry);
  } finally {
    done();
  }
}

/** Splits `items` into consecutive chunks of `size`. */
export function chunked<T>(items: readonly T[], size: number): T[][] {
  const step = Math.max(1, Math.floor(size));
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += step) chunks.push(items.slice(index, index + step));
  return chunks;
}

/**
 * Wraps the listed repository methods so each call is one guarded write
 * transaction. Methods keep their `this` and return values.
 */
export function guardRepositoryWrites<R extends object>(
  repo: R,
  methods: ReadonlyArray<keyof R & string>,
  getDb: () => Database.Database,
): R {
  for (const name of methods) {
    const original = (repo as Record<string, unknown>)[name];
    if (typeof original !== 'function') continue;
    (repo as Record<string, unknown>)[name] = function guardedWrite(this: unknown, ...args: unknown[]) {
      return runWriteTransaction(getDb(), () => (original as (...a: unknown[]) => unknown).apply(repo, args));
    };
  }
  return repo;
}

// === Interactive write queue (asynchronous, main thread) ===
//
// The synchronous guard can only wait by blocking its thread, so it is bounded
// tightly: when the lock is held past busy_timeout its first attempt has
// already used the whole time budget and the write fails with "database is
// locked". For a write that stands in front of a remote call that failure
// drops the person's action. Such writes wait here instead:
//   - one at a time, in the order they were asked for, so a later action never
//     overtakes an earlier one and waiting writes do not compete with each other,
//   - each attempt blocks the thread only briefly, and between attempts the
//     event loop runs, so the window stays responsive while the lock is held,
//   - bulk writers see the announcement for the whole wait and pause between
//     their chunks,
//   - the wait is bounded: past the deadline the busy error is returned and the
//     caller reports the failed save. No attempt blocks past the deadline: its
//     lock wait is capped at the time left, and a write that reaches the front
//     already expired gets one attempt that does not wait at all, so a backlog
//     behind a held lock drains without blocking the thread again.
// Only SQLITE_BUSY / SQLITE_LOCKED is retried; each attempt is one IMMEDIATE
// transaction, so a failed attempt left nothing behind.

export interface InteractiveWriteContention {
  label: string;
  attempts: number;
  waitedMs: number;
  /** False when the deadline passed and the busy error was returned. */
  recovered: boolean;
}

export interface InteractiveWriteQueueOptions {
  /** Give up once a write has waited this long since it was queued. */
  deadlineMs?: number;
  /** How long one attempt may block the thread waiting for the lock. */
  attemptBusyTimeoutMs?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  now?: () => number;
  wait?: (ms: number) => Promise<void>;
  /** Called once for every write that needed more than one attempt. */
  onContention?: (report: InteractiveWriteContention) => void;
}

export const DEFAULT_INTERACTIVE_WRITE_QUEUE = {
  deadlineMs: 15_000,
  attemptBusyTimeoutMs: 150,
  baseDelayMs: 20,
  // Below the 250 ms a bulk writer pauses for an announced interactive write.
  maxDelayMs: 100,
} as const;

export interface InteractiveWriteQueue {
  /** Runs `fn` as one write transaction once the writes queued before it settled. */
  run<T>(label: string, fn: () => T, options?: { deadlineMs?: number }): Promise<T>;
  /** Writes waiting or in progress. */
  readonly size: number;
}

/** Runs `fn` with the connection's busy_timeout set to `ms`, then restores it. */
export function withBusyTimeout<T>(db: Database.Database, ms: number, fn: () => T): T {
  const previous = Number(db.pragma('busy_timeout', { simple: true }));
  const next = Math.max(0, Math.floor(ms));
  if (!Number.isFinite(previous) || previous === next) return fn();
  db.pragma(`busy_timeout = ${next}`);
  try {
    return fn();
  } finally {
    db.pragma(`busy_timeout = ${previous}`);
  }
}

export function createInteractiveWriteQueue(
  getDb: () => Database.Database,
  options: InteractiveWriteQueueOptions = {},
): InteractiveWriteQueue {
  const defaultDeadlineMs = options.deadlineMs ?? DEFAULT_INTERACTIVE_WRITE_QUEUE.deadlineMs;
  const attemptBusyTimeoutMs = options.attemptBusyTimeoutMs ?? DEFAULT_INTERACTIVE_WRITE_QUEUE.attemptBusyTimeoutMs;
  const delays: SqliteBusyRetryOptions = {
    baseDelayMs: options.baseDelayMs ?? DEFAULT_INTERACTIVE_WRITE_QUEUE.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_INTERACTIVE_WRITE_QUEUE.maxDelayMs,
  };
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)));
  let tail: Promise<unknown> = Promise.resolve();
  let size = 0;

  const report = (contention: InteractiveWriteContention) => {
    try {
      options.onContention?.(contention);
    } catch {
      // Reporting must never fail the write it describes.
    }
  };

  const attempt = <T>(fn: () => T, busyTimeoutMs: number): T => {
    const db = getDb();
    return withBusyTimeout(db, busyTimeoutMs, () => (
      runWriteTransaction(db, fn, { bulk: false, retry: { attempts: 1 } })
    ));
  };

  async function settle<T>(label: string, fn: () => T, queuedAt: number, deadlineMs: number): Promise<T> {
    const done = announceInteractiveWrite();
    try {
      for (let attempts = 1; ; attempts += 1) {
        try {
          const remainingMs = deadlineMs - (now() - queuedAt);
          const value = attempt(fn, Math.max(0, Math.min(attemptBusyTimeoutMs, remainingMs)));
          if (attempts > 1) report({ label, attempts, waitedMs: now() - queuedAt, recovered: true });
          return value;
        } catch (error) {
          if (!isSqliteBusyError(error)) throw error;
          const waitedMs = now() - queuedAt;
          if (waitedMs >= deadlineMs) {
            report({ label, attempts, waitedMs, recovered: false });
            throw error;
          }
          // Capped at the time left, so the last attempt lands on the deadline.
          await wait(Math.max(1, Math.min(sqliteBusyRetryDelay(attempts, delays), deadlineMs - waitedMs)));
        }
      }
    } finally {
      done();
    }
  }

  return {
    run<T>(label: string, fn: () => T, runOptions: { deadlineMs?: number } = {}): Promise<T> {
      // The deadline counts from here: writes stuck behind a held lock all
      // give up on time instead of each waiting a full deadline in turn.
      const queuedAt = now();
      const deadlineMs = runOptions.deadlineMs ?? defaultDeadlineMs;
      size += 1;
      const task = tail.then(() => settle(label, fn, queuedAt, deadlineMs));
      const finished = task.finally(() => { size -= 1; });
      tail = finished.then(() => undefined, () => undefined);
      return finished;
    },
    get size() {
      return size;
    },
  };
}
