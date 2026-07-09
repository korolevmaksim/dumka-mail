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
