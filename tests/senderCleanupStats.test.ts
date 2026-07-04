import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MessageSecurityInsight } from '../shared/types';

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
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      const newest = isoDaysAgo(5);
      MessagesRepo.save([
        message({ senderEmail: 'News@Example.COM', threadId: 't1', isUnread: true, receivedAt: newest }),
        message({ senderEmail: 'news@example.com', threadId: 't2', isUnread: false, receivedAt: isoDaysAgo(45) }),
        message({ senderEmail: 'other@example.com', senderName: 'Other', threadId: 't3', receivedAt: isoDaysAgo(1) }),
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
        hasUnsubscribeHeader: false,
        trackerCount: 0,
        maxRiskLevel: null,
        attachmentBytes: 0,
      });
      expect(news?.lastReceivedAt).toBe(newest);
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
      expect(stats.find(s => s.senderEmail === 'human@example.com')?.hasUnsubscribeHeader).toBe(false);
    });
  });

  repositoryIt('sums tracker counts and takes the max risk level from message_security', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, MessageSecurityRepo }) => {
      MessagesRepo.save([
        message({ id: 'sec-1', threadId: 'sec-thread', senderEmail: 'promo@example.com' }),
        message({ id: 'sec-2', threadId: 'sec-thread', senderEmail: 'promo@example.com' }),
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
      expect(stats.find(s => s.senderEmail === 'plain@example.com')?.maxRiskLevel).toBeNull();
    });
  });

  repositoryIt('sums attachment bytes through the pre-aggregated json_each join', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          attachments: [{ id: 'att-1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
        }),
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          attachments: [
            { id: 'att-2', filename: 'image.png', mimeType: 'image/png', sizeBytes: 2500 },
            { id: 'att-3', filename: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 500 },
          ],
        }),
        message({ senderEmail: 'files@example.com' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'files@example.com')?.attachmentBytes).toBe(4000);
    });
  });

  repositoryIt('orders by 30-day volume then message count and caps at 200 senders', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({ senderEmail: 'a@example.com', threadId: 'a1', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'a@example.com', threadId: 'a2', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'b@example.com', threadId: 'b1', receivedAt: isoDaysAgo(1) }),
        message({ senderEmail: 'b@example.com', threadId: 'b2', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'b@example.com', threadId: 'b3', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'c@example.com', threadId: 'c1', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'c@example.com', threadId: 'c2', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'c@example.com', threadId: 'c3', receivedAt: isoDaysAgo(60) }),
        message({ senderEmail: 'c@example.com', threadId: 'c4', receivedAt: isoDaysAgo(90) }),
      ]);

      const ordered = MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail);
      expect(ordered).toEqual(['b@example.com', 'c@example.com', 'a@example.com']);

      const bulk: MailMessage[] = [];
      for (let index = 0; index < 205; index += 1) {
        bulk.push(message({
          senderEmail: `bulk-${index}@example.com`,
          threadId: `bulk-thread-${index}`,
          receivedAt: isoDaysAgo(2),
        }));
      }
      MessagesRepo.save(bulk);

      expect(MessagesRepo.senderCleanupStats('me@example.com')).toHaveLength(200);
    });
  });

  repositoryIt('scopes results to the requested account', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({ accountId: 'me@example.com', senderEmail: 'mine@example.com' }),
        message({ accountId: 'other@account.com', senderEmail: 'theirs@example.com' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.map(s => s.senderEmail)).toEqual(['mine@example.com']);
    });
  });
});
