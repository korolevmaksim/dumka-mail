// The conversations a mailbox sync still has to read from Gmail.
//
// Gmail's history only names the conversations that changed; each one is then
// read in full, and Gmail allows about fifty such reads a minute per account.
// The history cursor used to move only after every conversation of a pass had
// been read. After a long break (hundreds of changed conversations) that never
// happened: each pass started from the top, ran out of quota at the same
// place and left the cursor where it was.
//
// Now the cursor moves as soon as the history has been listed, in the same
// write that stores the list here. Passes then work the list off a few
// conversations at a time, across restarts, and a conversation that keeps
// failing waits longer and longer instead of holding up the rest.
import { getDatabase, SyncStateRepo } from './database';
import { guardRepositoryWrites } from './sqliteWriteGuard';
import type { SyncState } from '../shared/types';

const RETRY_BASE_MS = 60_000;
const RETRY_MAX_MS = 15 * 60_000;

/**
 * How long a conversation waits after its `attempts`-th failed read: one
 * minute (the next pass), then twice as long each time, up to a quarter of an
 * hour. A failure is often the network and not the conversation, so the wait
 * stays short enough to pass unnoticed.
 */
export function mailboxSyncRetryDelayMs(attempts: number): number {
  return Math.min(RETRY_BASE_MS * 2 ** Math.min(Math.max(attempts, 1) - 1, 10), RETRY_MAX_MS);
}

export const MailboxSyncQueueRepo = {
  /**
   * Stores `state` (the history cursor) together with the conversations the
   * history up to that cursor reported as changed. A conversation that is
   * already waiting is due again at once: it changed since its last attempt.
   */
  advance(state: SyncState, threadIds: string[], now: Date = new Date()): void {
    const db = getDatabase();
    // Replacing the row also gives it a new place in the order of this list:
    // `due` hands out the latest of a batch first.
    const queue = db.prepare(`
      INSERT OR REPLACE INTO mailbox_sync_queue (account_id, thread_id, queued_at, attempts, retry_at)
      VALUES (?, ?, ?, 0, NULL)
    `);
    const queuedAt = now.toISOString();
    db.transaction(() => {
      for (const threadId of threadIds) queue.run(state.accountId, threadId, queuedAt);
      SyncStateRepo.save(state);
    })();
  },

  /**
   * The conversations to read next: never-failed ones first, and among those
   * the most recently changed, so new mail does not wait behind old changes.
   */
  due(accountId: string, limit: number, now: Date = new Date()): string[] {
    const rows = getDatabase().prepare(`
      SELECT thread_id FROM mailbox_sync_queue
      WHERE account_id = ? AND (retry_at IS NULL OR retry_at <= ?)
      ORDER BY attempts ASC, queued_at DESC, rowid DESC
      LIMIT ?
    `).all(accountId, now.toISOString(), Math.max(1, Math.floor(limit))) as Array<{ thread_id: string }>;
    return rows.map(row => row.thread_id);
  },

  count(accountId: string): number {
    const row = getDatabase().prepare('SELECT COUNT(*) AS count FROM mailbox_sync_queue WHERE account_id = ?')
      .get(accountId) as { count: number };
    return Number(row.count);
  },

  /** Removes the conversations that were read and makes the failed ones wait. */
  settle(accountId: string, done: string[], failed: string[], now: Date = new Date()): void {
    if (done.length === 0 && failed.length === 0) return;
    const db = getDatabase();
    const remove = db.prepare('DELETE FROM mailbox_sync_queue WHERE account_id = ? AND thread_id = ?');
    const attemptsOf = db.prepare('SELECT attempts FROM mailbox_sync_queue WHERE account_id = ? AND thread_id = ?');
    const postpone = db.prepare(`
      UPDATE mailbox_sync_queue SET attempts = ?, retry_at = ?
      WHERE account_id = ? AND thread_id = ?
    `);
    db.transaction(() => {
      for (const threadId of done) remove.run(accountId, threadId);
      for (const threadId of failed) {
        const row = attemptsOf.get(accountId, threadId) as { attempts: number } | undefined;
        if (!row) continue;
        const attempts = row.attempts + 1;
        postpone.run(attempts, new Date(now.getTime() + mailboxSyncRetryDelayMs(attempts)).toISOString(), accountId, threadId);
      }
    })();
  },
};

guardRepositoryWrites(MailboxSyncQueueRepo, ['advance', 'settle'], getDatabase);
