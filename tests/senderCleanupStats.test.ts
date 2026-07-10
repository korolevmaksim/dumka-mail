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
  repositoryIt('returns the newest bounded messages for a sender case-insensitively', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({ id: 'latest-1', senderEmail: 'News@Example.COM', receivedAt: isoDaysAgo(1) }),
        message({ id: 'latest-2', senderEmail: 'news@example.com', receivedAt: isoDaysAgo(2) }),
        message({ id: 'latest-3', senderEmail: 'news@example.com', receivedAt: isoDaysAgo(3) }),
        message({ id: 'other-1', senderEmail: 'other@example.com', receivedAt: isoDaysAgo(0) }),
      ]);

      expect(MessagesRepo.listLatestBySender('me@example.com', ' NEWS@example.com ', 2).map(item => item.id)).toEqual([
        'latest-1',
        'latest-2',
      ]);
    });
  });

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

  repositoryIt('persists account-scoped Cleanup exclusions with normalized sender identity', async () => {
    await withIsolatedDatabase(async ({ CleanupExclusionsRepo }) => {
      const saved = CleanupExclusionsRepo.save({
        accountId: 'me@example.com',
        senderEmail: ' News@Example.COM ',
        senderName: 'Example News',
        excludedAt: '2026-07-10T12:00:00.000Z',
      });
      CleanupExclusionsRepo.save({
        accountId: 'other@example.com',
        senderEmail: 'news@example.com',
        senderName: 'Other account news',
        excludedAt: '2026-07-10T13:00:00.000Z',
      });

      expect(saved.senderEmail).toBe('news@example.com');
      expect(CleanupExclusionsRepo.list(['me@example.com'])).toEqual([saved]);
      expect(CleanupExclusionsRepo.list(['me@example.com', 'other@example.com'])).toHaveLength(2);

      CleanupExclusionsRepo.delete('me@example.com', ' NEWS@EXAMPLE.COM ');
      expect(CleanupExclusionsRepo.list(['me@example.com'])).toEqual([]);
      expect(CleanupExclusionsRepo.list(['other@example.com'])).toHaveLength(1);
    });
  });

  repositoryIt('filters explicit Cleanup exclusions before results and restores them after deletion', async () => {
    await withIsolatedDatabase(async ({ CleanupExclusionsRepo, MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'keep@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          senderEmail: 'show@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
      ]);

      CleanupExclusionsRepo.save({
        accountId: 'me@example.com',
        senderEmail: 'KEEP@example.com',
        senderName: 'Keep',
        excludedAt: new Date().toISOString(),
      });
      expect(MessagesRepo.senderCleanupStats('me@example.com').map(item => item.senderEmail)).toEqual([
        'show@example.com',
      ]);

      CleanupExclusionsRepo.delete('me@example.com', 'keep@example.com');
      expect(MessagesRepo.senderCleanupStats('me@example.com').map(item => item.senderEmail).sort()).toEqual([
        'keep@example.com',
        'show@example.com',
      ]);
    });
  });

  repositoryIt('excludes senders marked as unsubscribed even when List-Unsubscribe headers remain', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, ThreadsRepo, UnsubscribedSendersRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'Promo@News.COM',
          threadId: 'promo-1',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          senderEmail: 'still@example.com',
          threadId: 'still-1',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({ senderEmail: 'old-only@example.com', threadId: 'old-1', receivedAt: isoDaysAgo(60) }),
      ]);
      ThreadsRepo.save([
        thread({ id: 'old-1', senderEmail: 'old-only@example.com', lastMessageAt: isoDaysAgo(60) }),
      ]);

      expect(MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail).sort()).toEqual([
        'old-only@example.com',
        'promo@news.com',
        'still@example.com',
      ]);

      UnsubscribedSendersRepo.mark('me@example.com', 'Promo@News.COM', {
        threadId: 'promo-1',
        method: 'httpPost',
      });
      // Case-insensitive identity: upper/mixed-case mark matches lower-cased sender_key.
      expect(UnsubscribedSendersRepo.has('me@example.com', 'promo@news.com')).toBe(true);

      const after = MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail).sort();
      expect(after).toEqual([
        'old-only@example.com',
        'still@example.com',
      ]);
      expect(after).not.toContain('promo@news.com');
    });
  });

  repositoryIt('excludes archiveable-only senders once they are marked unsubscribed', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, ThreadsRepo, UnsubscribedSendersRepo }) => {
      MessagesRepo.save([
        message({ senderEmail: 'bulk@example.com', threadId: 'bulk-old', receivedAt: isoDaysAgo(60) }),
      ]);
      ThreadsRepo.save([
        thread({ id: 'bulk-old', senderEmail: 'bulk@example.com', lastMessageAt: isoDaysAgo(60) }),
      ]);

      expect(MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail)).toEqual([
        'bulk@example.com',
      ]);

      UnsubscribedSendersRepo.mark('me@example.com', 'bulk@example.com');
      expect(MessagesRepo.senderCleanupStats('me@example.com')).toEqual([]);
    });
  });

  repositoryIt('re-surfaces unsubscribed senders after grace when enough post-unsub mail arrives', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, UnsubscribedSendersRepo }) => {
      const unsubscribedAt = isoDaysAgo(20);
      MessagesRepo.save([
        message({
          id: 'pre-1',
          senderEmail: 'nag@example.com',
          threadId: 'nag-pre',
          receivedAt: isoDaysAgo(25),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        // During grace (within 7 days of unsub) — must not count.
        message({
          id: 'grace-1',
          senderEmail: 'nag@example.com',
          threadId: 'nag-grace',
          receivedAt: isoDaysAgo(18),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        // After grace — need ≥2 to resurface.
        message({
          id: 'post-1',
          senderEmail: 'nag@example.com',
          threadId: 'nag-post-1',
          receivedAt: isoDaysAgo(5),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          id: 'post-2',
          senderEmail: 'nag@example.com',
          threadId: 'nag-post-2',
          receivedAt: isoDaysAgo(2),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          senderEmail: 'quiet@example.com',
          threadId: 'quiet-1',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
      ]);

      UnsubscribedSendersRepo.mark('me@example.com', 'nag@example.com', {
        unsubscribedAt,
        method: 'httpPost',
      });
      UnsubscribedSendersRepo.mark('me@example.com', 'quiet@example.com', {
        unsubscribedAt,
        method: 'httpPost',
      });

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      const nag = stats.find(s => s.senderEmail === 'nag@example.com');
      expect(nag).toMatchObject({
        previouslyUnsubscribed: true,
        postUnsubscribeMessageCount: 2,
        hasUnsubscribeHeader: true,
      });
      expect(stats.find(s => s.senderEmail === 'quiet@example.com')).toBeUndefined();
    });
  });

  repositoryIt('does not re-surface on a single post-grace message', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, UnsubscribedSendersRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'once@example.com',
          threadId: 'once-pre',
          receivedAt: isoDaysAgo(30),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
        message({
          senderEmail: 'once@example.com',
          threadId: 'once-post',
          receivedAt: isoDaysAgo(2),
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>' }],
        }),
      ]);
      UnsubscribedSendersRepo.mark('me@example.com', 'once@example.com', {
        unsubscribedAt: isoDaysAgo(20),
      });

      expect(MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail)).not.toContain(
        'once@example.com',
      );
    });
  });
});
