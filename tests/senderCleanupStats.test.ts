import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MailThread, MessageSecurityInsight } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as {
      new (filename: string): { close: () => void };
    };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

let messageSeq = 0;

function message(partial: Partial<MailMessage> = {}): MailMessage {
  messageSeq += 1;
  return {
    id: partial.id || `msg-${messageSeq}`,
    threadId: partial.threadId || `thread-${messageSeq}`,
    accountId: partial.accountId || 'me@example.com',
    senderName: partial.senderName ?? 'Example News',
    senderEmail: partial.senderEmail || 'news@example.com',
    subject: partial.subject || 'Weekly digest',
    snippet: partial.snippet || 'Digest content',
    receivedAt: partial.receivedAt || isoDaysAgo(5),
    labelIds: partial.labelIds || ['INBOX'],
    hasAttachments: partial.hasAttachments ?? false,
    isUnread: partial.isUnread ?? false,
    to: partial.to || [],
    cc: partial.cc || [],
    bcc: partial.bcc || [],
    bodyHtml: partial.bodyHtml ?? null,
    bodyPlain: partial.bodyPlain ?? null,
    attachments: partial.attachments || [],
    headers: partial.headers || [],
    rfcMessageId: null,
    rfcReferences: null,
    rfcInReplyTo: null,
  };
}

function thread(partial: Partial<MailThread> = {}): MailThread {
  return {
    id: partial.id || 'thread-1',
    accountId: partial.accountId || 'me@example.com',
    subject: partial.subject || 'Weekly digest',
    snippet: partial.snippet || 'Digest content',
    lastMessageAt: partial.lastMessageAt || isoDaysAgo(45),
    senderNames: partial.senderNames || ['Example News'],
    senderEmail: partial.senderEmail || 'news@example.com',
    labelIds: partial.labelIds || ['INBOX'],
    hasAttachments: partial.hasAttachments ?? false,
    isUnread: partial.isUnread ?? false,
    reminderAt: partial.reminderAt ?? null,
  };
}

function insight(partial: Partial<MessageSecurityInsight> = {}): MessageSecurityInsight {
  return {
    accountId: partial.accountId || 'me@example.com',
    messageId: partial.messageId || 'msg-1',
    threadId: partial.threadId || 'sec-thread',
    riskLevel: partial.riskLevel || 'low',
    warnings: partial.warnings || [],
    trackerCount: partial.trackerCount ?? 0,
    phishingLinkCount: partial.phishingLinkCount ?? 0,
    analyzedAt: partial.analyzedAt || isoDaysAgo(1),
  };
}

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-cleanup-stats-'));
  let databaseModule: typeof import('../main/database') | null = null;

  vi.resetModules();
  process.env.HOME = home;

  try {
    databaseModule = await import('../main/database');
    return await run(databaseModule);
  } finally {
    if (databaseModule) {
      databaseModule.getDatabase().close();
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

describe('MessagesRepo.senderCleanupStats', () => {
  repositoryIt('groups senders case-insensitively with counts, unread and the 30-day window', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, ThreadsRepo }) => {
      const newest = isoDaysAgo(5);
      MessagesRepo.save([
        message({
          senderEmail: 'News@Example.COM',
          threadId: 't1',
          isUnread: true,
          receivedAt: newest,
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({ senderEmail: 'news@example.com', threadId: 't2', isUnread: false, receivedAt: isoDaysAgo(45) }),
        message({ senderEmail: 'other@example.com', senderName: 'Other', threadId: 't3', receivedAt: isoDaysAgo(1) }),
      ]);
      // other@ has no unsubscribe and no old INBOX thread → filtered out
      ThreadsRepo.save([
        thread({ id: 't1', senderEmail: 'News@Example.COM', lastMessageAt: newest, isUnread: true }),
        thread({ id: 't2', senderEmail: 'news@example.com', lastMessageAt: isoDaysAgo(45), isUnread: false }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      const news = stats.find(s => s.senderEmail === 'news@example.com');

      expect(news).toMatchObject({
        accountId: 'me@example.com',
        senderEmail: 'news@example.com',
        senderName: 'Example News',
        threadCount: 2,
        messageCount: 2,
        unreadCount: 1,
        recent30dCount: 1,
        hasUnsubscribeHeader: true,
        archiveableOldCount: 1,
        trackerCount: 0,
        maxRiskLevel: null,
        attachmentBytes: 0,
      });
      expect(news?.lastReceivedAt).toBe(newest);
      expect(stats.find(s => s.senderEmail === 'other@example.com')).toBeUndefined();
    });
  });

  repositoryIt('flags unsubscribe-capable senders via the List-Unsubscribe header', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'promo@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>, <mailto:unsubscribe@example.com>' }],
        }),
        message({ senderEmail: 'human@example.com', headers: [{ name: 'Reply-To', value: 'human@example.com' }] }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'promo@example.com')?.hasUnsubscribeHeader).toBe(true);
      // No archiveable threads and no unsubscribe → excluded entirely
      expect(stats.find(s => s.senderEmail === 'human@example.com')).toBeUndefined();
    });
  });

  repositoryIt('counts archiveable old INBOX threads including unread and excludes pure volume noise', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, ThreadsRepo }) => {
      MessagesRepo.save([
        message({ senderEmail: 'noise@example.com', threadId: 'noise-1', receivedAt: isoDaysAgo(2), isUnread: true }),
        message({ senderEmail: 'old@example.com', threadId: 'old-1', receivedAt: isoDaysAgo(60), isUnread: true }),
        message({ senderEmail: 'old@example.com', threadId: 'old-2', receivedAt: isoDaysAgo(40), isUnread: false }),
        message({ senderEmail: 'old@example.com', threadId: 'old-recent', receivedAt: isoDaysAgo(3), isUnread: true }),
      ]);
      ThreadsRepo.save([
        thread({ id: 'noise-1', senderEmail: 'noise@example.com', lastMessageAt: isoDaysAgo(2), isUnread: true }),
        thread({ id: 'old-1', senderEmail: 'old@example.com', lastMessageAt: isoDaysAgo(60), isUnread: true }),
        thread({ id: 'old-2', senderEmail: 'old@example.com', lastMessageAt: isoDaysAgo(40), isUnread: false }),
        thread({ id: 'old-recent', senderEmail: 'old@example.com', lastMessageAt: isoDaysAgo(3), isUnread: true }),
        thread({
          id: 'old-archived',
          senderEmail: 'old@example.com',
          lastMessageAt: isoDaysAgo(90),
          labelIds: ['CATEGORY_UPDATES'],
        }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'noise@example.com')).toBeUndefined();
      expect(stats.find(s => s.senderEmail === 'old@example.com')).toMatchObject({
        archiveableOldCount: 2,
        hasUnsubscribeHeader: false,
      });
    });
  });

  repositoryIt('sums tracker counts and takes the max risk level from message_security', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, MessageSecurityRepo }) => {
      MessagesRepo.save([
        message({
          id: 'sec-1',
          threadId: 'sec-thread',
          senderEmail: 'promo@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          id: 'sec-2',
          threadId: 'sec-thread',
          senderEmail: 'promo@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({ id: 'sec-3', threadId: 'plain-thread', senderEmail: 'plain@example.com' }),
      ]);
      MessageSecurityRepo.saveMany([
        insight({ messageId: 'sec-1', trackerCount: 2, riskLevel: 'medium' }),
        insight({ messageId: 'sec-2', trackerCount: 3, riskLevel: 'high' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      const promo = stats.find(s => s.senderEmail === 'promo@example.com');
      expect(promo?.trackerCount).toBe(5);
      expect(promo?.maxRiskLevel).toBe('high');
      // plain has no unsubscribe / archiveable → not listed
      expect(stats.find(s => s.senderEmail === 'plain@example.com')).toBeUndefined();
    });
  });

  repositoryIt('sums attachment bytes through the pre-aggregated json_each join', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
          attachments: [{ id: 'att-1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
        }),
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
          attachments: [
            { id: 'att-2', filename: 'image.png', mimeType: 'image/png', sizeBytes: 2500 },
            { id: 'att-3', filename: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 500 },
          ],
        }),
        message({
          senderEmail: 'files@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'files@example.com')?.attachmentBytes).toBe(4000);
    });
  });

  repositoryIt('orders actionable senders by unsubscribe, archiveable count, then volume', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, ThreadsRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'unsub@example.com',
          threadId: 'u1',
          receivedAt: isoDaysAgo(2),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({ senderEmail: 'archive-heavy@example.com', threadId: 'a1', receivedAt: isoDaysAgo(60) }),
        message({ senderEmail: 'archive-heavy@example.com', threadId: 'a2', receivedAt: isoDaysAgo(50) }),
        message({ senderEmail: 'archive-light@example.com', threadId: 'b1', receivedAt: isoDaysAgo(40) }),
        message({ senderEmail: 'noise@example.com', threadId: 'n1', receivedAt: isoDaysAgo(1) }),
      ]);
      ThreadsRepo.save([
        thread({ id: 'a1', senderEmail: 'archive-heavy@example.com', lastMessageAt: isoDaysAgo(60) }),
        thread({ id: 'a2', senderEmail: 'archive-heavy@example.com', lastMessageAt: isoDaysAgo(50) }),
        thread({ id: 'b1', senderEmail: 'archive-light@example.com', lastMessageAt: isoDaysAgo(40) }),
        thread({ id: 'n1', senderEmail: 'noise@example.com', lastMessageAt: isoDaysAgo(1) }),
      ]);

      const ordered = MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail);
      expect(ordered).toEqual([
        'unsub@example.com',
        'archive-heavy@example.com',
        'archive-light@example.com',
      ]);
    });
  });

  repositoryIt('scopes results to the requested account', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          accountId: 'me@example.com',
          senderEmail: 'mine@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          accountId: 'other@account.com',
          senderEmail: 'theirs@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.map(s => s.senderEmail)).toEqual(['mine@example.com']);
    });
  });

  repositoryIt('caps at 200 actionable senders', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      const bulk: MailMessage[] = [];
      for (let index = 0; index < 205; index += 1) {
        bulk.push(message({
          senderEmail: `bulk-${index}@example.com`,
          threadId: `bulk-thread-${index}`,
          receivedAt: isoDaysAgo(2),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }));
      }
      MessagesRepo.save(bulk);
      expect(MessagesRepo.senderCleanupStats('me@example.com')).toHaveLength(200);
    });
  });
});
