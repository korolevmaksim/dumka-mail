// The local writes around a remote call, for every action the main process
// runs (the window's `api:modifyLabels` / `api:sendDraft`, notification
// buttons, mail rules, sender rules). All of them go through one interactive
// write queue (sqliteWriteGuard.ts), so a held database lock delays an action
// instead of dropping it, and the order of the writes stays the order the
// actions were asked for.
//
// Three kinds of write, by where they stand relative to the remote call:
//   begin    - before it. If it cannot be stored in time the action stops:
//              nothing was sent, the caller reports the failed save.
//   settle   - after it. The remote side already has (or refused) the change,
//              so the outcome must reach the journal: it waits much longer and
//              never throws. A row left `running` is replayed on the next launch.
//   rollback - undoes an optimistic change together with its bookkeeping. It
//              waits in front of the writes already waiting, which are all
//              newer than the change it undoes, and never throws.

import { getDatabase } from './database';
import {
  createInteractiveWriteQueue,
  type InteractiveWriteContention,
  type InteractiveWriteOptions,
  type InteractiveWriteQueue,
} from './sqliteWriteGuard';

/** How long the outcome of a remote call keeps waiting for the lock. */
export const SETTLE_DEADLINE_MS = 120_000;

export interface LocalWriteFailure {
  kind: 'settle' | 'rollback';
  label: string;
  error: unknown;
}

export interface LocalWriteListeners {
  /** A write had to wait for the lock (it was stored, or given up). */
  onContention?: (report: InteractiveWriteContention) => void;
  /** A settle or rollback write could not be stored at all. */
  onFailure?: (failure: LocalWriteFailure) => void;
}

export interface LocalWrites {
  readonly queue: InteractiveWriteQueue;
  /** A write the remote call depends on. Rejects when it could not be stored in time. */
  begin<T>(label: string, fn: () => T, options?: InteractiveWriteOptions): Promise<T>;
  /** The outcome of a remote call that already happened. Resolves to whether it was stored. */
  settle(label: string, fn: () => void): Promise<boolean>;
  /** Undoes an optimistic change (and writes what belongs to that). Resolves to whether it was stored. */
  rollback(label: string, fn: () => void): Promise<boolean>;
  setListeners(listeners: LocalWriteListeners): void;
}

export function createLocalWrites(queue: InteractiveWriteQueue, initial: LocalWriteListeners = {}): LocalWrites {
  let listeners = initial;

  const failed = (failure: LocalWriteFailure): false => {
    console.error(`[Local Database] A ${failure.kind} write could not be stored (${failure.label}).`, failure.error);
    try {
      listeners.onFailure?.(failure);
    } catch {
      // Reporting must never fail the caller.
    }
    return false;
  };

  return {
    queue,
    begin: (label, fn, options) => queue.run(label, fn, options),
    settle: (label, fn) => queue.run(label, fn, { deadlineMs: SETTLE_DEADLINE_MS })
      .then(() => true, error => failed({ kind: 'settle', label, error })),
    rollback: (label, fn) => queue.run(label, fn, { aheadOfQueue: true })
      .then(() => true, error => failed({ kind: 'rollback', label, error })),
    setListeners(next) {
      listeners = next;
    },
  };
}

let contentionListener: ((report: InteractiveWriteContention) => void) | undefined;

/** The queue and the three writes of the app's database. */
export const localWrites: LocalWrites = (() => {
  const queue = createInteractiveWriteQueue(getDatabase, {
    onContention: report => contentionListener?.(report),
  });
  const writes = createLocalWrites(queue);
  const setListeners = writes.setListeners;
  writes.setListeners = listeners => {
    contentionListener = listeners.onContention;
    setListeners(listeners);
  };
  return writes;
})();
