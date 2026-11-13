import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailThread, ThreadDecisionRecord } from '../shared/types';
import { fixtureMessages, MAILING_LIST_POSTS, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    const database = new Database(':memory:');
    database.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;
const accountId = WORK_ACCOUNT.email;

async function withDatabase(run: (database: typeof import('../main/database')) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-thread-decisions-'));
  vi.resetModules();
  process.env.HOME = home;
  let databaseModule: typeof import('../main/database') | null = null;
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

function fixture(key: string) {
  const spec = [...WORK_INBOX, ...MAILING_LIST_POSTS].find(thread => thread.key === key);
  if (!spec) throw new Error(key);
  const messages = fixtureMessages(spec);
  const thread = buildMailThreadFromMessages(accountId, key, messages) as MailThread;
  return { messages, thread };
}

function record(threadId: string, partial: Partial<ThreadDecisionRecord> = {}): ThreadDecisionRecord {
  return {
    accountId,
    threadId,
    lastMessageId: `${threadId}-m0`,
    decision: 'reply',
    reason: 'Asks a question',
    source: 'model',
    laterAt: null,
    model: 'test-model',
    createdAt: '2026-10-10T12:00:00.000Z',
    ...partial,
  };
}

describe('thread signals persistence', () => {
  repositoryIt('round-trips signals and keeps them when a thread is saved without', async () => {
    await withDatabase(({ ThreadsRepo }) => {
      const { thread } = fixture('dispatch-212');
      ThreadsRepo.save([thread]);
      expect(ThreadsRepo.get(accountId, 'dispatch-212')?.signals).toEqual(thread.signals);

      const { signals: _signals, ...withoutSignals } = thread;
      ThreadsRepo.save([{ ...withoutSignals, isUnread: false }]);
      const reloaded = ThreadsRepo.get(accountId, 'dispatch-212');
      expect(reloaded?.isUnread).toBe(false);
      expect(reloaded?.signals).toEqual(thread.signals);
    });
  });

  repositoryIt('fills in_inbox and inbox signals in resumable chunks, then marks the pass done', async () => {
    await withDatabase(async ({ getDatabase, MessagesRepo, ThreadsRepo }) => {
      const migrations = await import('../main/migrations');
      const keys = ['invite-weekly', 'linkedin-requests', 'nw-1432', 'list-discussion'];
      for (const key of keys) {
        const { messages, thread } = fixture(key);
        MessagesRepo.save(messages);
        const { signals: _signals, ...legacy } = thread;
        if (key === 'list-discussion') {
          // Stored by the old rule, which counted `Precedence: list` as bulk.
          ThreadsRepo.save([{ ...thread, signals: { ...thread.signals!, isBulk: true } }]);
        } else {
          ThreadsRepo.save([key === 'nw-1432' ? { ...legacy, labelIds: ['CATEGORY_UPDATES'] } : legacy]);
        }
      }
      expect(ThreadsRepo.get(accountId, 'invite-weekly')?.signals).toBeUndefined();

      // An install from before `in_inbox`: no flags, no done marker.
      const db = getDatabase();
      db.prepare('UPDATE threads SET in_inbox = NULL').run();
      db.prepare('DELETE FROM settings WHERE key = ?').run(migrations.THREAD_MAINTENANCE_DONE_KEY);
      // Startup does no heavy work: the marker stays unset while rows exist.
      migrations.runMigrations(db);
      expect(migrations.isThreadMaintenanceDone(db)).toBe(false);
      // Readers fall back to the label JSON meanwhile.
      expect(ThreadsRepo.listRecentInbox(accountId, 10).map(thread => thread.id).sort())
        .toEqual(['invite-weekly', 'linkedin-requests', 'list-discussion']);

      const updated: string[] = [];
      let chunks = 0;
      for (;;) {
        const result = ThreadsRepo.runMaintenanceChunk(2);
        chunks += 1;
        updated.push(...result.signalsUpdated.map(entry => entry.threadId));
        if (result.done) break;
        expect(chunks).toBeLessThan(10);
      }
      expect(chunks).toBe(3);
      expect(migrations.isThreadMaintenanceDone(db)).toBe(true);
      expect(updated.sort()).toEqual(['invite-weekly', 'linkedin-requests', 'list-discussion']);

      expect(ThreadsRepo.get(accountId, 'invite-weekly')?.signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: true });
      expect(ThreadsRepo.get(accountId, 'linkedin-requests')?.signals).toMatchObject({ hasOneClickUnsubscribe: true, isBulk: true });
      expect(ThreadsRepo.get(accountId, 'list-discussion')?.signals).toMatchObject({ isBulk: false });
      expect(ThreadsRepo.get(accountId, 'nw-1432')?.signals).toBeUndefined();
      const flags = db.prepare('SELECT id, in_inbox FROM threads ORDER BY id').all();
      expect(flags).toEqual([
        { id: 'invite-weekly', in_inbox: 1 },
        { id: 'linkedin-requests', in_inbox: 1 },
        { id: 'list-discussion', in_inbox: 1 },
        { id: 'nw-1432', in_inbox: 0 },
      ]);
      // Done: further chunks are no-ops, and reads use the indexed column.
      expect(ThreadsRepo.runMaintenanceChunk(2)).toMatchObject({ done: true, scanned: 0 });
      expect(migrations.inboxThreadPredicate(db, 't')).toBe('t.in_inbox = 1');
    });
  });

  repositoryIt('keeps in_inbox in step with every label write', async () => {
    await withDatabase(({ getDatabase, ThreadsRepo }) => {
      const db = getDatabase();
      const { thread } = fixture('pilot-date');
      ThreadsRepo.save([thread]);
      const flag = () => (db.prepare('SELECT in_inbox FROM threads WHERE id = ?').get('pilot-date') as { in_inbox: number }).in_inbox;
      expect(flag()).toBe(1);
      ThreadsRepo.updateLabels(accountId, 'pilot-date', [], ['INBOX']);
      expect(flag()).toBe(0);
      expect(ThreadsRepo.listRecentInbox(accountId, 10)).toEqual([]);
      ThreadsRepo.updateLabels(accountId, 'pilot-date', ['INBOX'], []);
      expect(flag()).toBe(1);
      ThreadsRepo.save([{ ...thread, labelIds: ['SENT'] }]);
      expect(flag()).toBe(0);
      expect(ThreadsRepo.countInbox([accountId])).toEqual({ [accountId]: 0 });
    });
  });

  repositoryIt('uses the inbox index for the agent-prep read', async () => {
    await withDatabase(({ getDatabase }) => {
      const db = getDatabase();
      const plan = db.prepare(`EXPLAIN QUERY PLAN SELECT t.id FROM threads t WHERE t.account_id = ? AND t.in_inbox = 1 ORDER BY t.last_message_at DESC LIMIT 100`)
        .all(accountId) as { detail: string }[];
      expect(plan.map(row => row.detail).join(' ')).toMatch(/idx_threads_account_inbox/);
    });
  });
});

describe('ThreadDecisionsRepo', () => {
  repositoryIt('upserts, lists, deletes and purges', async () => {
    await withDatabase(({ ThreadDecisionsRepo, ThreadsRepo }) => {
      ThreadDecisionsRepo.upsertMany([
        record('pilot-date'),
        record('pr-482', { decision: 'later', laterAt: '2026-10-11T07:00:00.000Z' }),
        record('other', { accountId: 'other@x.example' }),
        // Invalid rows are skipped.
        record('bad', { decision: 'archive' as ThreadDecisionRecord['decision'] }),
      ]);
      expect(ThreadDecisionsRepo.listForAccount(accountId).map(row => row.threadId).sort()).toEqual(['pilot-date', 'pr-482']);

      ThreadDecisionsRepo.upsertMany([record('pilot-date', { decision: 'read', reason: 'Refreshed', lastMessageId: 'pilot-date-m1' })]);
      expect(ThreadDecisionsRepo.listForAccount(accountId).filter(row => row.threadId === 'pilot-date'))
        .toEqual([expect.objectContaining({ decision: 'read', reason: 'Refreshed', source: 'model', lastMessageId: 'pilot-date-m1' })]);

      ThreadDecisionsRepo.deleteForThread(accountId, 'pilot-date');
      expect(ThreadDecisionsRepo.listForAccount(accountId).map(row => row.threadId)).toEqual(['pr-482']);

      ThreadsRepo.save([fixture('pr-482').thread]);
      ThreadsRepo.delete(accountId, 'pr-482');
      expect(ThreadDecisionsRepo.listForAccount(accountId)).toEqual([]);

      ThreadDecisionsRepo.upsertMany([record('a'), record('b')]);
      ThreadDecisionsRepo.purgeAccount(accountId);
      expect(ThreadDecisionsRepo.listForAccount(accountId)).toEqual([]);
      expect(ThreadDecisionsRepo.listForAccount('other@x.example')).toHaveLength(1);
    });
  });

  repositoryIt('keeps a user correction and a model row side by side', async () => {
    await withDatabase(({ ThreadDecisionsRepo }) => {
      const bySource = () => Object.fromEntries(ThreadDecisionsRepo.listForAccount(accountId)
        .filter(row => row.threadId === 'pilot-date')
        .map(row => [row.source, row]));

      ThreadDecisionsRepo.upsertMany([record('pilot-date', { decision: 'reply', reason: 'Asks about the 24th' })]);
      ThreadDecisionsRepo.upsertMany([record('pilot-date', { decision: 'read', source: 'user', model: null, reason: '' })]);
      expect(bySource()).toMatchObject({
        model: { decision: 'reply', reason: 'Asks about the 24th', model: 'test-model' },
        user: { decision: 'read', model: null },
      });

      // A model refresh never touches the user row…
      ThreadDecisionsRepo.upsertMany([record('pilot-date', { decision: 'read', reason: 'FYI only', lastMessageId: 'pilot-date-m1' })]);
      expect(bySource().user).toMatchObject({ decision: 'read', source: 'user', lastMessageId: 'pilot-date-m0' });
      expect(bySource().model).toMatchObject({ decision: 'read', reason: 'FYI only', lastMessageId: 'pilot-date-m1' });

      // …and a new correction never touches the model row.
      ThreadDecisionsRepo.upsertMany([record('pilot-date', { decision: 'later', source: 'user', model: null, laterAt: '2026-10-11T07:00:00.000Z' })]);
      expect(bySource().model).toMatchObject({ decision: 'read', reason: 'FYI only' });
      expect(bySource().user).toMatchObject({ decision: 'later', laterAt: '2026-10-11T07:00:00.000Z' });

      ThreadDecisionsRepo.deleteForThread(accountId, 'pilot-date', 'user');
      expect(Object.keys(bySource())).toEqual(['model']);
    });
  });

  repositoryIt('rebuilds a legacy (account, thread) keyed table and keeps its rows', async () => {
    await withDatabase(async ({ getDatabase, ThreadDecisionsRepo }) => {
      const db = getDatabase();
      db.exec(`
        DROP TABLE thread_decisions;
        CREATE TABLE thread_decisions (
          account_id TEXT NOT NULL, thread_id TEXT NOT NULL, last_message_id TEXT, decision TEXT NOT NULL,
          reason TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, later_at TEXT, model TEXT, created_at TEXT NOT NULL,
          PRIMARY KEY (account_id, thread_id)
        );
      `);
      db.prepare(`INSERT INTO thread_decisions VALUES (?, 'pilot-date', 'pilot-date-m0', 'read', '', 'user', NULL, NULL, '2026-10-10T12:00:00.000Z')`).run(accountId);

      const { runMigrations } = await import('../main/migrations');
      runMigrations(db);
      runMigrations(db);

      const keyColumns = (db.pragma('table_info(thread_decisions)') as { name: string; pk: number }[])
        .filter(column => column.pk > 0).map(column => column.name);
      expect(keyColumns).toEqual(['account_id', 'thread_id', 'source']);
      expect(ThreadDecisionsRepo.listForAccount(accountId)).toEqual([expect.objectContaining({ threadId: 'pilot-date', source: 'user', decision: 'read' })]);
      ThreadDecisionsRepo.upsertMany([record('pilot-date')]);
      expect(ThreadDecisionsRepo.listForAccount(accountId).map(row => row.source).sort()).toEqual(['model', 'user']);
    });
  });

  repositoryIt('caches summaries per last message', async () => {
    await withDatabase(async () => {
      const { ThreadSummariesRepo } = await import('../main/agentPrepRepository');
      ThreadSummariesRepo.save({ accountId, threadId: 'onboarding-feedback', lastMessageId: 'm13', bullets: ['One.', 'Two.'], model: 'test-model', createdAt: '2026-10-10T12:00:00.000Z' });
      expect(ThreadSummariesRepo.get(accountId, 'onboarding-feedback', 'm13')?.bullets).toEqual(['One.', 'Two.']);
      expect(ThreadSummariesRepo.get(accountId, 'onboarding-feedback', 'm14')).toBeNull();
      ThreadSummariesRepo.save({ accountId, threadId: 'onboarding-feedback', lastMessageId: 'm14', bullets: ['Three.'], model: 'test-model', createdAt: '2026-10-10T13:00:00.000Z' });
      expect(ThreadSummariesRepo.get(accountId, 'onboarding-feedback', 'm13')).toBeNull();
      expect(ThreadSummariesRepo.get(accountId, 'onboarding-feedback', 'm14')?.bullets).toEqual(['Three.']);
      ThreadSummariesRepo.purgeAccount(accountId);
      expect(ThreadSummariesRepo.get(accountId, 'onboarding-feedback', 'm14')).toBeNull();
    });
  });

  repositoryIt('is cleared when an account is removed with its cache', async () => {
    await withDatabase(({ AccountsRepo, ThreadDecisionsRepo }) => {
      AccountsRepo.save({ id: accountId, email: accountId, displayName: 'Alex', colorHex: '#000000', createdAt: '2026-10-10T00:00:00.000Z' });
      ThreadDecisionsRepo.upsertMany([record('pilot-date')]);
      AccountsRepo.delete(accountId, { purgeCache: true });
      expect(ThreadDecisionsRepo.listForAccount(accountId)).toEqual([]);
    });
  });
});

describe('purging per-thread and per-account rows', () => {
  repositoryIt('removes summaries and sender-rule archives with the thread and with the account', async () => {
    await withDatabase(async ({ AccountsRepo, ThreadDecisionsRepo, ThreadsRepo }) => {
      const { ThreadSummariesRepo } = await import('../main/agentPrepRepository');
      const { SenderRulesRepo } = await import('../main/senderRulesRepository');
      AccountsRepo.save({ id: accountId, email: accountId, displayName: 'Alex', colorHex: '#000000', createdAt: '2026-01-01T00:00:00.000Z' } as never);
      for (const key of ['dispatch-212', 'pilot-date']) {
        ThreadsRepo.save([fixture(key).thread]);
        ThreadSummariesRepo.save({ accountId, threadId: key, lastMessageId: `${key}-m0`, bullets: ['One'], model: 'm', createdAt: '2026-10-10T12:00:00.000Z' });
        SenderRulesRepo.recordConfirmation({ actionId: `a-${key}`, accountId, threadId: key, senderEmail: `${key}@x.example`, archivedAt: '2026-10-10T12:00:00.000Z' });
      }
      ThreadDecisionsRepo.upsertMany([record('dispatch-212'), record('pilot-date')]);
      expect(ThreadDecisionsRepo.listForThreads(accountId, ['pilot-date', 'missing']).map(row => row.threadId)).toEqual(['pilot-date']);

      ThreadsRepo.delete(accountId, 'dispatch-212');
      expect(ThreadSummariesRepo.get(accountId, 'dispatch-212', 'dispatch-212-m0')).toBeNull();
      expect(ThreadSummariesRepo.get(accountId, 'pilot-date', 'pilot-date-m0')).not.toBeNull();
      // The bring-back can no longer match a thread that is gone.
      expect(SenderRulesRepo.recordBringBack(accountId, 'dispatch-212', new Date('2026-10-10T13:00:00.000Z'))).toBeNull();

      // Default purge (no options) removes the remaining summary too.
      AccountsRepo.delete(accountId);
      expect(ThreadSummariesRepo.get(accountId, 'pilot-date', 'pilot-date-m0')).toBeNull();
      expect(ThreadsRepo.get(accountId, 'pilot-date')).toBeNull();
    });
  });
});

describe('thread maintenance (second review)', () => {
  repositoryIt('recomputes stale bulk signals on archived threads too, but leaves archived rows without signals', async () => {
    await withDatabase(async ({ getDatabase, MessagesRepo, ThreadsRepo }) => {
      const migrations = await import('../main/migrations');
      const post = fixture('list-discussion');
      MessagesRepo.save(post.messages);
      // Archived, with signals stored under the old rule.
      ThreadsRepo.save([{ ...post.thread, labelIds: ['CATEGORY_FORUMS'], signals: { ...post.thread.signals!, isBulk: true } }]);
      const legacy = fixture('nw-1432');
      MessagesRepo.save(legacy.messages);
      const { signals: _signals, ...withoutSignals } = legacy.thread;
      ThreadsRepo.save([{ ...withoutSignals, labelIds: ['CATEGORY_UPDATES'] }]);

      const db = getDatabase();
      db.prepare('DELETE FROM settings WHERE key = ?').run(migrations.THREAD_MAINTENANCE_DONE_KEY);
      while (!ThreadsRepo.runMaintenanceChunk(10).done) { /* walk */ }
      expect(ThreadsRepo.get(accountId, 'list-discussion')?.signals).toMatchObject({ isBulk: false });
      expect(ThreadsRepo.get(accountId, 'nw-1432')?.signals).toBeUndefined();

      expect(migrations.storedSignalsNeedRecompute(null, false)).toBe(false);
      expect(migrations.storedSignalsNeedRecompute(null, true)).toBe(true);
      expect(migrations.storedSignalsNeedRecompute(JSON.stringify({ isBulk: true }), false)).toBe(true);
      expect(migrations.storedSignalsNeedRecompute(JSON.stringify({ hasCalendarInvite: true }), false)).toBe(true);
      expect(migrations.storedSignalsNeedRecompute(JSON.stringify({ hasCalendarInvite: true, inviteStateKnown: false }), true)).toBe(false);
    });
  });

  repositoryIt('clears the done marker at startup when unflagged rows reappear', async () => {
    await withDatabase(async ({ getDatabase, ThreadsRepo }) => {
      const migrations = await import('../main/migrations');
      const db = getDatabase();
      ThreadsRepo.save([fixture('pilot-date').thread]);
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(migrations.THREAD_MAINTENANCE_DONE_KEY, 'x');
      migrations.runMigrations(db);
      expect(migrations.isThreadMaintenanceDone(db)).toBe(true);

      // An older build wrote a row without in_inbox.
      db.prepare('UPDATE threads SET in_inbox = NULL').run();
      migrations.runMigrations(db);
      expect(migrations.isThreadMaintenanceDone(db)).toBe(false);
      const plan = db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM threads WHERE in_inbox IS NULL LIMIT 1').all() as { detail: string }[];
      expect(plan.map(row => row.detail).join(' ')).toMatch(/idx_threads_in_inbox_unset/);
      while (!ThreadsRepo.runMaintenanceChunk(10).done) { /* walk */ }
      expect(db.prepare('SELECT in_inbox FROM threads').all()).toEqual([{ in_inbox: 1 }]);
    });
  });
});


repositoryIt('ignores old summaries when the summary configuration cache key changes', async () => {
  await withDatabase(async ({ AccountsRepo }) => {
    const { ThreadSummariesRepo } = await import('../main/agentPrepRepository');
    AccountsRepo.save({ id: accountId, email: accountId, displayName: 'Alex', colorHex: '#000000', createdAt: '2026-10-10T00:00:00.000Z' });
    const record = { accountId, threadId: 'summary-config', lastMessageId: 'm1', bullets: ['Old summary'], model: 'test-model', createdAt: '2026-10-10T00:00:00.000Z' };
    ThreadSummariesRepo.save(record);
    expect(ThreadSummariesRepo.get(accountId, record.threadId, 'm1', 'config-a')).toBeNull();
    ThreadSummariesRepo.save({ ...record, cacheKey: 'config-a' });
    expect(ThreadSummariesRepo.get(accountId, record.threadId, 'm1', 'config-a')?.bullets).toEqual(['Old summary']);
    expect(ThreadSummariesRepo.get(accountId, record.threadId, 'm1', 'config-b')).toBeNull();
    ThreadSummariesRepo.save({ ...record, cacheKey: 'config-b', bullets: ['New summary'] });
    expect(ThreadSummariesRepo.get(accountId, record.threadId, 'm1', 'config-b')?.bullets).toEqual(['New summary']);
    expect(ThreadSummariesRepo.get(accountId, record.threadId, 'm1', 'config-a')).toBeNull();
  });
});
