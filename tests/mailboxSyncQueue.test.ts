import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailThread, SyncState } from '../shared/types';

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

interface Modules {
  database: typeof import('../main/database');
  queue: typeof import('../main/mailboxSyncQueue');
}

async function withDatabase(run: (modules: Modules) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-sync-queue-'));
  vi.resetModules();
  process.env.HOME = home;
  let database: Modules['database'] | null = null;
  try {
    database = await import('../main/database');
    const queue = await import('../main/mailboxSyncQueue');
    await run({ database, queue });
  } finally {
    database?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

const WORK = 'alex.morgan@northwind.example';
const HOME = 'alex@morgan-family.example';

function state(accountId: string, historyId: string): SyncState {
  return { accountId, historyId, historyBackfillPagesSynced: 3, historyBackfillThreadsSynced: 60 };
}

const at = (minute: number) => new Date(Date.UTC(2026, 10, 26, 22, minute, 0));

describe('the queue of changed conversations', () => {
  repositoryIt('stores the history cursor together with what that history changed', async () => {
    await withDatabase(({ database, queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['t1', 't2', 't3'], at(0));
      expect(database.SyncStateRepo.get(WORK)).toMatchObject({ historyId: '20', historyBackfillThreadsSynced: 60 });
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(3);
      expect(MailboxSyncQueueRepo.count(HOME)).toBe(0);
    });
  });

  repositoryIt('does not move the cursor when the list cannot be stored', async () => {
    await withDatabase(({ database, queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['t1'], at(0));
      // A thread id SQLite refuses (NOT NULL) fails the write half-way through the list.
      expect(() => MailboxSyncQueueRepo.advance(state(WORK, '30'), ['t2', null as unknown as string], at(1))).toThrow();
      expect(database.SyncStateRepo.get(WORK)?.historyId).toBe('20');
      expect(MailboxSyncQueueRepo.due(WORK, 10, at(1))).toEqual(['t1']);
    });
  });

  repositoryIt('hands out the most recently changed conversations first, a few at a time', async () => {
    await withDatabase(({ queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['old1', 'old2'], at(0));
      MailboxSyncQueueRepo.advance(state(WORK, '30'), ['new1', 'new2'], at(5));
      MailboxSyncQueueRepo.advance(state(HOME, '7'), ['other'], at(5));
      expect(MailboxSyncQueueRepo.due(WORK, 3, at(5))).toEqual(['new2', 'new1', 'old2']);
      expect(MailboxSyncQueueRepo.due(HOME, 3, at(5))).toEqual(['other']);
    });
  });

  repositoryIt('takes read conversations off the list and makes failed ones wait longer each time', async () => {
    await withDatabase(({ queue }) => {
      const { MailboxSyncQueueRepo, mailboxSyncRetryDelayMs } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['read', 'broken', 'waiting'], at(0));
      MailboxSyncQueueRepo.settle(WORK, ['read'], ['broken', 'not-queued'], at(0));
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(2);
      expect(MailboxSyncQueueRepo.due(WORK, 10, at(0))).toEqual(['waiting']);

      // Due again after the first delay, behind the conversations that never failed.
      const firstDelay = mailboxSyncRetryDelayMs(1);
      expect(MailboxSyncQueueRepo.due(WORK, 10, new Date(at(0).getTime() + firstDelay - 1))).toEqual(['waiting']);
      const dueAgain = new Date(at(0).getTime() + firstDelay);
      expect(MailboxSyncQueueRepo.due(WORK, 10, dueAgain)).toEqual(['waiting', 'broken']);

      MailboxSyncQueueRepo.settle(WORK, [], ['broken'], dueAgain);
      expect(MailboxSyncQueueRepo.due(WORK, 10, new Date(dueAgain.getTime() + firstDelay))).toEqual(['waiting']);
      expect(MailboxSyncQueueRepo.due(WORK, 10, new Date(dueAgain.getTime() + mailboxSyncRetryDelayMs(2)))).toEqual(['waiting', 'broken']);
    });
  });

  repositoryIt('is due at once again when Gmail reports a waiting conversation as changed', async () => {
    await withDatabase(({ queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['t1'], at(0));
      MailboxSyncQueueRepo.settle(WORK, [], ['t1'], at(0));
      expect(MailboxSyncQueueRepo.due(WORK, 10, at(0))).toEqual([]);
      MailboxSyncQueueRepo.advance(state(WORK, '30'), ['t1'], at(0));
      expect(MailboxSyncQueueRepo.due(WORK, 10, at(0))).toEqual(['t1']);
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(1);
    });
  });

  repositoryIt('reads a conversation that changed again in the order of its newest report', async () => {
    await withDatabase(({ queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['a', 'b', 'c'], at(0));
      // `a` changes again: Gmail lists it last, so it is the newest change.
      MailboxSyncQueueRepo.advance(state(WORK, '30'), ['d', 'a'], at(0));
      expect(MailboxSyncQueueRepo.due(WORK, 10, at(0))).toEqual(['a', 'd', 'c', 'b']);
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(4);
    });
  });

  repositoryIt('is purged with the account cache', async () => {
    await withDatabase(({ database, queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      database.AccountsRepo.save({ id: WORK, email: WORK, displayName: 'Alex', colorHex: '#000000', createdAt: at(0).toISOString() });
      MailboxSyncQueueRepo.advance(state(WORK, '20'), ['t1'], at(0));
      MailboxSyncQueueRepo.advance(state(HOME, '5'), ['t2'], at(0));
      database.AccountsRepo.delete(WORK, { purgeCache: true });
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(0);
      expect(MailboxSyncQueueRepo.count(HOME)).toBe(1);
    });
  });

  repositoryIt('lets a sync work a long list off over several passes, newest changes first', async () => {
    await withDatabase(async ({ database, queue }) => {
      const { MailboxSyncQueueRepo } = queue;
      const { MAX_THREAD_READS_PER_PASS, performMailboxSyncForAccount } = await import('../main/mailboxSync');
      database.SyncStateRepo.save(state(WORK, '10'));
      const changed = Array.from({ length: 60 }, (_, index) => `t${index + 1}`);
      const fetched: string[] = [];
      let history = [{ updatedThreadIds: changed, deletedMessageIds: {} as Record<string, string[]>, historyId: '20' }];
      const message = (threadId: string): MailMessage => ({
        id: `${threadId}-m`, threadId, accountId: WORK, senderName: 'Sender', senderEmail: 'sender@example.com', subject: threadId,
        snippet: '', receivedAt: '2026-11-26T22:00:00.000Z', labelIds: ['INBOX'], hasAttachments: false, isUnread: false,
        to: [], cc: [], bcc: [], attachments: [],
      });
      const pass = () => performMailboxSyncForAccount(WORK, {
        getSyncState: accountId => database.SyncStateRepo.get(accountId),
        saveSyncState: next => database.SyncStateRepo.save(next),
        nextSyncState: (accountId, base, historyId) => ({ ...state(accountId, historyId), ...base, historyId }),
        syncInbox: async () => { throw new Error('not used'); },
        syncIncremental: async (_email, historyId) => history.shift() ?? { updatedThreadIds: [], deletedMessageIds: {}, historyId },
        fetchThreadDetail: async (_email, threadId) => {
          fetched.push(threadId);
          // One conversation Gmail keeps failing on.
          if (threadId === 't7') throw Object.assign(new Error('HTTP 500'), { status: 500 });
          return [message(threadId)];
        },
        saveThreads: async (threads: MailThread[]) => database.ThreadsRepo.save(threads),
        saveMessages: async messages => database.MessagesRepo.save(messages),
        deleteThreads: async (accountId, threadIds) => database.ThreadsRepo.deleteMany(accountId, threadIds),
        removeDeletedMessages: async (accountId, deletions) => database.ThreadsRepo.removeDeletedMessages(accountId, deletions),
        queueThreadReads: (next, threadIds) => MailboxSyncQueueRepo.advance(next, threadIds),
        dueThreadReads: (accountId, limit) => MailboxSyncQueueRepo.due(accountId, limit),
        settleThreadReads: (accountId, done, failed) => MailboxSyncQueueRepo.settle(accountId, done, failed),
        takeThreadRead: () => true,
        listPendingActions: () => [],
        publishDelta: (accountId, upserts, deletedThreadIds) => ({ accountId, upserts, deletedThreadIds, revision: 1, completedAt: '' }),
      });

      const first = await pass();
      expect(database.SyncStateRepo.get(WORK)?.historyId).toBe('20');
      expect(fetched).toEqual(changed.slice(-MAX_THREAD_READS_PER_PASS).reverse());
      expect(first.upserts).toHaveLength(MAX_THREAD_READS_PER_PASS);
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(60 - MAX_THREAD_READS_PER_PASS);

      // New mail arrives while the old list is still being worked off: it is read first.
      history = [{ updatedThreadIds: ['fresh'], deletedMessageIds: {}, historyId: '30' }];
      await pass();
      expect(fetched[MAX_THREAD_READS_PER_PASS]).toBe('fresh');
      await pass();
      await pass();

      // Everything was read once; the failing conversation is the only one still waiting.
      expect(MailboxSyncQueueRepo.count(WORK)).toBe(1);
      expect(fetched.filter(threadId => threadId !== 't7').sort()).toEqual([...changed.filter(threadId => threadId !== 't7'), 'fresh'].sort());
      expect(database.ThreadsRepo.listMany([WORK])).toHaveLength(60);
      expect(database.SyncStateRepo.get(WORK)).toMatchObject({ historyId: '30', historyBackfillThreadsSynced: 60 });
    });
  });

  it('caps the wait of a conversation that keeps failing', async () => {
    const { mailboxSyncRetryDelayMs } = await import('../main/mailboxSyncQueue');
    expect(mailboxSyncRetryDelayMs(1)).toBe(60_000);
    expect(mailboxSyncRetryDelayMs(3)).toBe(4 * 60_000);
    expect(mailboxSyncRetryDelayMs(50)).toBe(15 * 60_000);
  });
});
