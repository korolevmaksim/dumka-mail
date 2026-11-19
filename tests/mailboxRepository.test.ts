import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailThread } from '../shared/types';

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

async function withDatabase(run: (database: typeof import('../main/database')) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-mailbox-repository-'));
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

function thread(id: string, accountId: string, labels: string[], minute: number): MailThread {
  return {
    id,
    accountId,
    subject: id,
    snippet: '',
    lastMessageAt: `2026-07-10T10:${String(minute).padStart(2, '0')}:00.000Z`,
    senderNames: ['Sender'],
    senderEmail: 'Sender@Example.com',
    to: [{ name: 'Alias', email: `${accountId.split('@')[0]}+alias@example.com` }],
    cc: [{ name: 'Copy', email: 'copy@example.com' }],
    labelIds: labels,
    hasAttachments: false,
    isUnread: false,
    reminderAt: null,
  };
}

function message(id: string, accountId: string, minute: number): MailMessage {
  return {
    id,
    threadId: 'thread-1',
    accountId,
    senderName: 'Sender',
    senderEmail: 'Sender@Example.com',
    subject: id,
    snippet: '',
    receivedAt: `2026-07-10T10:${String(minute).padStart(2, '0')}:00.000Z`,
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain: '',
    attachments: [],
    headers: [],
    rfcMessageId: null,
    rfcReferences: null,
    rfcInReplyTo: null,
  };
}

describe('mailbox repository hot paths', () => {
  repositoryIt('lists multiple accounts once and limits recent inbox rows', async () => {
    await withDatabase(({ ThreadsRepo }) => {
      ThreadsRepo.save([
        thread('a1', 'a@example.com', ['INBOX'], 1),
        thread('a2', 'a@example.com', ['SENT'], 3),
        thread('b1', 'b@example.com', ['INBOX'], 2),
      ]);
      expect(ThreadsRepo.listMany(['a@example.com', 'b@example.com']).map(item => item.id)).toEqual(['a2', 'b1', 'a1']);
      expect(ThreadsRepo.listRecentInbox('a@example.com', 1).map(item => item.id)).toEqual(['a1']);
      expect(ThreadsRepo.get('a@example.com', 'a1')).toMatchObject({
        to: [{ name: 'Alias', email: 'a+alias@example.com' }],
        cc: [{ name: 'Copy', email: 'copy@example.com' }],
      });
    });
  });

  repositoryIt('lists unread inbox threads for the badge, without postponed, read or archived ones', async () => {
    await withDatabase(async ({ ThreadsRepo, RemindersRepo }) => {
      const unread = (id: string, labels: string[], minute: number) => ({ ...thread(id, 'a@example.com', labels, minute), isUnread: true });
      ThreadsRepo.save([
        unread('new-1', ['INBOX', 'UNREAD'], 5),
        unread('new-2', ['INBOX', 'UNREAD'], 9),
        unread('postponed', ['INBOX', 'UNREAD'], 7),
        unread('due-again', ['INBOX', 'UNREAD'], 3),
        unread('archived', ['UNREAD'], 8),
        thread('read', 'a@example.com', ['INBOX'], 6),
        { ...thread('other', 'b@example.com', ['INBOX', 'UNREAD'], 4), isUnread: true },
      ]);
      const now = '2026-07-10T12:00:00.000Z';
      RemindersRepo.save('a@example.com', 'postponed', '2026-07-11T09:00:00.000Z');
      RemindersRepo.save('a@example.com', 'due-again', '2026-07-10T11:00:00.000Z');

      expect(ThreadsRepo.listUnreadInbox('a@example.com', now).map(item => item.id)).toEqual(['new-2', 'new-1', 'due-again']);
      expect(ThreadsRepo.listUnreadInbox('a@example.com', now, 1).map(item => item.id)).toEqual(['new-2']);
      expect(ThreadsRepo.listUnreadInbox('b@example.com', now).map(item => item.id)).toEqual(['other']);
      // Once the reminder's time has come the conversation counts again.
      expect(ThreadsRepo.listUnreadInbox('a@example.com', '2026-07-11T09:00:00.000Z').map(item => item.id)).toContain('postponed');
    });
  });

  repositoryIt('lists the account\'s own recent messages for the reply style, newest first and bounded', async () => {
    await withDatabase(async ({ MessagesRepo }) => {
      const sent = (id: string, minute: number, extra: Partial<MailMessage> = {}): MailMessage => ({
        ...message(id, 'a@example.com', minute),
        senderEmail: 'A@Example.com',
        labelIds: ['SENT'],
        to: [{ name: 'Priya', email: 'priya@lumenlabs.example' }],
        bodyPlain: `Body of ${id}`,
        ...extra,
      });
      MessagesRepo.save([
        sent('own-1', 1),
        sent('own-2', 5),
        // A send-as alias: another address, labelled SENT.
        sent('alias', 3, { senderEmail: 'alias@example.com' }),
        // Someone else's message, and another account's own message.
        { ...message('inbound', 'a@example.com', 4), senderEmail: 'priya@lumenlabs.example', labelIds: ['INBOX'] },
        { ...sent('other-account', 6), accountId: 'b@example.com', senderEmail: 'b@example.com' },
      ]);
      const own = MessagesRepo.listOwnRecent('a@example.com');
      expect(own.map(item => item.id)).toEqual(['own-2', 'alias', 'own-1']);
      expect(own[0]).toMatchObject({ threadId: expect.any(String), labelIds: ['SENT'], bodyPlain: 'Body of own-2', to: [{ name: 'Priya', email: 'priya@lumenlabs.example' }] });
      expect(MessagesRepo.listOwnRecent('a@example.com', 1).map(item => item.id)).toEqual(['own-2']);
      expect(MessagesRepo.listOwnRecent(' ')).toEqual([]);
    });
  });

  repositoryIt('matches sender history case-insensitively on the indexed columns', async () => {
    await withDatabase(({ MessagesRepo }) => {
      MessagesRepo.save([message('m1', 'a@example.com', 1), message('m2', 'a@example.com', 2)]);
      expect(MessagesRepo.listRecentBySender(
        'a@example.com',
        'sender@example.com',
        '2026-07-10T10:03:00.000Z',
        8,
      ).map(item => item.id)).toEqual(['m1', 'm2']);
    });
  });
});

repositoryIt('finds old thread 404s only for conversations still cached in the same account', async () => {
  await withDatabase(({ ActionLogRepo, ThreadsRepo }) => {
    const account = 'first@example.com';
    const other = 'second@example.com';
    ThreadsRepo.save([thread('stale', account, ['INBOX'], 1), thread('live', account, ['INBOX'], 2),
      thread('stale', other, ['INBOX'], 1)]);
    const record = (id: string, threadId: string, status: number) => ActionLogRepo.save({
      id, accountId: account, threadId, kind: 'markDone', status: 'failed', createdAt: new Date().toISOString(),
      failureMessage: `Error invoking remote method 'api:modifyLabels': Error: Label modification failed for thread ${threadId}: HTTP ${status} — {}`,
    });
    record('1', 'stale', 404);
    record('2', 'stale', 404);
    record('3', 'gone', 404);
    record('4', 'live', 403);
    expect(ActionLogRepo.loggedMissingThreadIds(account)).toEqual(['stale']);
    ThreadsRepo.delete(account, 'stale');
    expect(ActionLogRepo.loggedMissingThreadIds(account)).toEqual([]);
    expect(ThreadsRepo.get(other, 'stale')).not.toBeNull();
    expect(ThreadsRepo.get(account, 'live')).not.toBeNull();
  });
});
