// Write coordination between the two better-sqlite3 connections that share the
// WAL database: the Electron main thread (interactive writes: labels, action
// log, drafts, reminders, settings, decisions) and the database worker thread
// (bulk writes: sync/backfill pages, FTS, embeddings).
//
// Why this exists: a deferred transaction that has already read and then tries
// to write after the other connection committed fails with SQLITE_BUSY_SNAPSHOT
// immediately (busy_timeout is not consulted), and a long bulk transaction can
// outlast busy_timeout. So:
//   1. every write runs in an IMMEDIATE transaction (takes the write lock up
//      front, never upgrades a stale snapshot),
//   2. a small bounded retry absorbs the remaining SQLITE_BUSY / LOCKED cases,
//   3. bulk writers commit in small chunks and, between chunks, yield to an
//      interactive writer that announced itself through a shared counter.

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

/** Main thread: create the shared counter and pass it to the worker via workerData. */
export function createWritePrioritySignal(): SharedArrayBuffer {
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
