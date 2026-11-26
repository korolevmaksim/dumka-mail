import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { mailSearchIdQuery } from '../main/mailSearchIndex';
import type { MailMessage, MailThread } from '../shared/types';

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

type DatabaseModule = typeof import('../main/database');

async function withDatabase(run: (database: DatabaseModule) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-thread-delete-'));
  vi.resetModules();
  process.env.HOME = home;
  let databaseModule: DatabaseModule | null = null;
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

const WORK = 'alex.morgan@northwind.example';
const HOME = 'alex@morgan-family.example';

function thread(id: string, accountId: string): MailThread {
  return {
    id,
    accountId,
    subject: `Subject of ${id}`,
    snippet: '',
    lastMessageAt: '2026-07-10T10:00:00.000Z',
    senderNames: ['Sender'],
    senderEmail: 'sender@example.com',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    reminderAt: null,
  };
}

function message(id: string, threadId: string, accountId: string, bodyPlain = 'quarterly budget review'): MailMessage {
  return {
    id,
    threadId,
    accountId,
    senderName: 'Sender',
    senderEmail: 'sender@example.com',
    subject: `Subject of ${threadId}`,
    snippet: '',
    receivedAt: '2026-07-10T10:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain,
    attachments: [],
    headers: [],
    rfcMessageId: null,
    rfcReferences: null,
    rfcInReplyTo: null,
  };
}

/** Two accounts that share a conversation id, plus a second conversation in the first. */
function seed({ ThreadsRepo, MessagesRepo, MailEmbeddingsRepo, RemindersRepo }: DatabaseModule) {
  ThreadsRepo.save([thread('18f2c404b7e3d012', WORK), thread('18f2c404b7e3d099', WORK), thread('18f2c404b7e3d012', HOME)]);
  MessagesRepo.save([
    message('18f2c404b7e3d0a1', '18f2c404b7e3d012', WORK),
    message('18f2c404b7e3d0a2', '18f2c404b7e3d012', WORK),
    message('18f2c404b7e3d0b1', '18f2c404b7e3d099', WORK),
    message('18f2c404b7e3d0a1', '18f2c404b7e3d012', HOME),
  ]);
  const embedding = (accountId: string, messageId: string, threadId: string) => ({
    accountId, messageId, threadId, model: 'test-model', textHash: 'hash', vector: [0.1, 0.2],
    subject: '', sender: '', snippet: '', receivedAt: '2026-07-10T10:00:00.000Z', indexedAt: '2026-07-10T10:00:00.000Z',
  });
  MailEmbeddingsRepo.saveMany([
    embedding(WORK, '18f2c404b7e3d0a1', '18f2c404b7e3d012'),
    embedding(WORK, '18f2c404b7e3d0a2', '18f2c404b7e3d012'),
    embedding(WORK, '18f2c404b7e3d0b1', '18f2c404b7e3d099'),
    embedding(HOME, '18f2c404b7e3d0a1', '18f2c404b7e3d012'),
  ]);
  RemindersRepo.save(WORK, '18f2c404b7e3d012', '2026-07-11T09:00:00.000Z');
}

function counts({ getDatabase }: DatabaseModule, accountId: string, threadId: string) {
  const db = getDatabase();
  const count = (sql: string) => (db.prepare(sql).get(accountId, threadId) as { count: number }).count;
  return {
    threads: count('SELECT COUNT(*) AS count FROM threads WHERE account_id = ? AND id = ?'),
    messages: count('SELECT COUNT(*) AS count FROM messages WHERE account_id = ? AND thread_id = ?'),
    search: count('SELECT COUNT(*) AS count FROM mail_search WHERE account_id = ? AND thread_id = ?'),
    embeddings: count('SELECT COUNT(*) AS count FROM mail_embeddings WHERE account_id = ? AND thread_id = ?'),
    reminders: count('SELECT COUNT(*) AS count FROM thread_reminders WHERE account_id = ? AND thread_id = ?'),
  };
}

/** The statements `run` prepares, each with the plan SQLite chose for it. */
function plansOf(database: DatabaseModule, run: () => void): Array<{ sql: string; plan: string[] }> {
  const db = database.getDatabase();
  const prepared: string[] = [];
  const prepare = db.prepare.bind(db);
  const spy = vi.spyOn(db, 'prepare').mockImplementation(((sql: string) => {
    prepared.push(sql);
    return prepare(sql);
  }) as typeof db.prepare);
  try {
    run();
  } finally {
    spy.mockRestore();
  }
  return prepared
    .filter(sql => /^\s*(DELETE|UPDATE|SELECT)\b/i.test(sql))
    .map(sql => ({
      sql: sql.replace(/\s+/g, ' ').trim(),
      plan: (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...Array.from(sql.matchAll(/\?/g), () => 'x')) as Array<{ detail: string }>)
        .map(row => row.detail),
    }));
}

/**
 * A step that reads a whole table, or every row of the account. A full-text
 * lookup is listed as a scan too, with the index it uses after the colon.
 */
function readsWholeTable(detail: string): boolean {
  if (/\(account_id=\?\)\s*$/.test(detail)) return true;
  if (!detail.startsWith('SCAN')) return false;
  return !/^SCAN mail_search VIRTUAL TABLE INDEX \d+:M/.test(detail);
}

describe('removing a conversation from the local cache', () => {
  repositoryIt('removes everything stored for it and nothing of another conversation or account', async () => {
    await withDatabase(database => {
      seed(database);
      database.ThreadsRepo.delete(WORK, '18f2c404b7e3d012');
      expect(counts(database, WORK, '18f2c404b7e3d012')).toEqual({ threads: 0, messages: 0, search: 0, embeddings: 0, reminders: 0 });
      expect(counts(database, WORK, '18f2c404b7e3d099')).toMatchObject({ threads: 1, messages: 1, search: 1, embeddings: 1 });
      expect(counts(database, HOME, '18f2c404b7e3d012')).toMatchObject({ threads: 1, messages: 1, search: 1, embeddings: 1 });
      // The other conversation is still found by its text.
      expect(database.SearchRepo.search(WORK, 'budget').map(hit => hit.threadId)).toEqual(['18f2c404b7e3d099']);
    });
  });

  repositoryIt('finds every row through an index instead of reading a whole table', async () => {
    await withDatabase(database => {
      seed(database);
      const plans = plansOf(database, () => database.ThreadsRepo.delete(WORK, '18f2c404b7e3d012'));
      // One statement per table that holds rows of a conversation.
      expect(plans.length).toBeGreaterThanOrEqual(12);
      expect(plans.filter(entry => entry.plan.some(readsWholeTable))).toEqual([]);
    });
  });

  repositoryIt('removes many conversations in one call', async () => {
    await withDatabase(database => {
      seed(database);
      database.ThreadsRepo.deleteMany(WORK, ['18f2c404b7e3d012', '18f2c404b7e3d099', 'never-stored']);
      expect(counts(database, WORK, '18f2c404b7e3d012')).toMatchObject({ threads: 0, messages: 0, search: 0, embeddings: 0 });
      expect(counts(database, WORK, '18f2c404b7e3d099')).toMatchObject({ threads: 0, messages: 0, search: 0, embeddings: 0 });
      expect(counts(database, HOME, '18f2c404b7e3d012')).toMatchObject({ threads: 1, messages: 1, search: 1, embeddings: 1 });
    });
  });

  repositoryIt('removes search rows of ids that are not single words', async () => {
    await withDatabase(database => {
      const { ThreadsRepo, MessagesRepo } = database;
      const ids = ['thread-1', 'thread-10', 'draft "quoted" id', '---', 'nul\0inside'];
      ThreadsRepo.save(ids.map(id => thread(id, WORK)));
      MessagesRepo.save(ids.map((id, index) => message(`m${index}`, id, WORK)));
      ThreadsRepo.delete(WORK, 'thread-1');
      expect(counts(database, WORK, 'thread-1').search).toBe(0);
      // `thread-1` is the beginning of `thread-10` as words; the comparison keeps it.
      expect(counts(database, WORK, 'thread-10').search).toBe(1);
      ThreadsRepo.delete(WORK, 'draft "quoted" id');
      ThreadsRepo.delete(WORK, '---');
      ThreadsRepo.delete(WORK, 'nul\0inside');
      expect(counts(database, WORK, 'draft "quoted" id').search).toBe(0);
      expect(counts(database, WORK, '---').search).toBe(0);
      expect(counts(database, WORK, 'nul\0inside').search).toBe(0);
      expect(counts(database, WORK, 'thread-10').search).toBe(1);
    });
  });
});

describe('removing the messages Gmail deleted for good', () => {
  repositoryIt('removes one message and keeps the conversation and its other message', async () => {
    await withDatabase(database => {
      seed(database);
      const outcome = database.ThreadsRepo.removeDeletedMessages(WORK, [
        { threadId: '18f2c404b7e3d012', messageIds: ['18f2c404b7e3d0a1'], alsoChanged: false },
      ]);
      expect(outcome).toEqual({ removedThreadIds: [], remainingThreadIds: ['18f2c404b7e3d012'] });
      expect(counts(database, WORK, '18f2c404b7e3d012')).toEqual({ threads: 1, messages: 1, search: 1, embeddings: 1, reminders: 1 });
      expect(database.MessagesRepo.listForThread(WORK, '18f2c404b7e3d012').map(item => item.id)).toEqual(['18f2c404b7e3d0a2']);
      // The same message id in the other account is another message.
      expect(counts(database, HOME, '18f2c404b7e3d012')).toMatchObject({ threads: 1, messages: 1, search: 1, embeddings: 1 });
    });
  });

  repositoryIt('removes the conversation with its last message, unless it was changed as well', async () => {
    await withDatabase(database => {
      seed(database);
      const outcome = database.ThreadsRepo.removeDeletedMessages(WORK, [
        { threadId: '18f2c404b7e3d012', messageIds: ['18f2c404b7e3d0a1', '18f2c404b7e3d0a2'], alsoChanged: false },
        { threadId: '18f2c404b7e3d099', messageIds: ['18f2c404b7e3d0b1'], alsoChanged: true },
        { threadId: 'never-stored', messageIds: ['unknown'], alsoChanged: false },
      ]);
      expect(outcome).toEqual({
        removedThreadIds: ['18f2c404b7e3d012', 'never-stored'],
        remainingThreadIds: ['18f2c404b7e3d099'],
      });
      expect(counts(database, WORK, '18f2c404b7e3d012')).toEqual({ threads: 0, messages: 0, search: 0, embeddings: 0, reminders: 0 });
      expect(counts(database, WORK, '18f2c404b7e3d099')).toMatchObject({ threads: 1, messages: 0, search: 0, embeddings: 0 });
    });
  });

  repositoryIt('finds every row through an index', async () => {
    await withDatabase(database => {
      seed(database);
      const plans = plansOf(database, () => database.ThreadsRepo.removeDeletedMessages(WORK, [
        { threadId: '18f2c404b7e3d012', messageIds: ['18f2c404b7e3d0a1'], alsoChanged: false },
      ]));
      expect(plans.length).toBeGreaterThanOrEqual(5);
      expect(plans.filter(entry => entry.plan.some(readsWholeTable))).toEqual([]);
    });
  });
});

describe('storing search vectors', () => {
  repositoryIt('drops the vector of a message whose conversation was removed meanwhile', async () => {
    await withDatabase(async database => {
      seed(database);
      const { saveEmbeddingVectors } = await import('../main/mailAnalysisJobs');
      const vector = (messageId: string, threadId: string) => ({
        accountId: WORK, messageId, threadId, model: 'next-model', textHash: 'hash', vector: [0.3],
        subject: '', sender: '', snippet: '', receivedAt: '2026-07-10T10:00:00.000Z', indexedAt: '2026-07-10T10:00:00.000Z',
      });
      database.ThreadsRepo.delete(WORK, '18f2c404b7e3d012');
      saveEmbeddingVectors([
        vector('18f2c404b7e3d0a1', '18f2c404b7e3d012'),
        vector('18f2c404b7e3d0b1', '18f2c404b7e3d099'),
      ]);
      expect(counts(database, WORK, '18f2c404b7e3d012').embeddings).toBe(0);
      expect(counts(database, WORK, '18f2c404b7e3d099').embeddings).toBe(2);
    });
  });
});

describe('re-indexing a message for search', () => {
  repositoryIt('replaces the search row of a message that is saved again', async () => {
    await withDatabase(database => {
      seed(database);
      const { MessagesRepo, SearchRepo } = database;
      MessagesRepo.save([message('18f2c404b7e3d0b1', '18f2c404b7e3d099', WORK, 'travel itinerary')]);
      expect(counts(database, WORK, '18f2c404b7e3d099').search).toBe(1);
      expect(SearchRepo.search(WORK, 'itinerary').map(hit => hit.messageId)).toEqual(['18f2c404b7e3d0b1']);
      expect(SearchRepo.search(WORK, 'budget').map(hit => hit.threadId)).toEqual(['18f2c404b7e3d012', '18f2c404b7e3d012']);
      // The same message id in the other account keeps its own row.
      expect(counts(database, HOME, '18f2c404b7e3d012').search).toBe(1);
    });
  });

  repositoryIt('does not read the whole search table for each saved message', async () => {
    await withDatabase(database => {
      seed(database);
      const plans = plansOf(database, () => database.MessagesRepo.save([message('18f2c404b7e3d0b1', '18f2c404b7e3d099', WORK)]));
      const searchDeletes = plans.filter(entry => /^DELETE FROM mail_search/i.test(entry.sql));
      expect(searchDeletes.length).toBeGreaterThan(0);
      expect(searchDeletes.filter(entry => entry.plan.some(readsWholeTable))).toEqual([]);
    });
  });
});

describe('the plan check itself', () => {
  repositoryIt('recognises the statements that used to read everything', async () => {
    await withDatabase(database => {
      const db = database.getDatabase();
      const plan = (sql: string) => (db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all('x', 'x') as Array<{ detail: string }>).map(row => row.detail);
      expect(plan('DELETE FROM mail_search WHERE account_id = ? AND thread_id = ?').some(readsWholeTable)).toBe(true);
      expect(plan('DELETE FROM mail_embeddings WHERE account_id = ? AND thread_id = ?').some(readsWholeTable)).toBe(true);
    });
  });
});

describe('mailSearchIdQuery', () => {
  it('looks the id up as a phrase in its own column', () => {
    expect(mailSearchIdQuery('thread_id', '18f2c404b7e3d012')).toBe('thread_id : "18f2c404b7e3d012"');
    expect(mailSearchIdQuery('message_id', 'a "b" c')).toBe('message_id : "a ""b"" c"');
  });

  it('has no index lookup for an id without a letter or digit', () => {
    expect(mailSearchIdQuery('thread_id', '---')).toBeNull();
    expect(mailSearchIdQuery('thread_id', '')).toBeNull();
    expect(mailSearchIdQuery('thread_id', 'nul\0inside')).toBeNull();
  });
});
