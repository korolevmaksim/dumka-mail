import { describe, expect, it, vi } from 'vitest';

const databaseMocks = vi.hoisted(() => ({
  MessagesRepo: {
    listForThread: vi.fn(() => []),
    listRecentBySender: vi.fn(() => []),
  },
  MessageSecurityRepo: {
    saveMany: vi.fn(),
    listForThread: vi.fn(() => []),
  },
  ThreadsRepo: {
    list: vi.fn(() => []),
  },
}));

vi.mock('../main/database', () => databaseMocks);
// The briefing now prepares its threads on the database worker; run that job
// inline so the repository mocks above still drive these assertions.
vi.mock('../main/databaseWorkerClient', async () => (
  (await import('./support/databaseWorkerClientTestDouble')).createDatabaseWorkerClientModule()
));

import { buildDailyBriefing, normalizeDailyBriefingSettings } from '../shared/dailyBriefing';
import { buildDailyBriefingForAccount } from '../main/dailyBriefingService';
import type { MailMessage, MailThread, MessageSecurityInsight } from '../shared/types';

const NOW = new Date('2026-07-03T09:00:00.000Z');
const ACCOUNT = 'me@example.com';

function thread(overrides: Partial<MailThread> = {}): MailThread {
  return {
    id: 'thread-1',
    accountId: ACCOUNT,
    subject: 'Can you review the contract?',
    snippet: 'Can you review this today?',
    lastMessageAt: '2026-07-03T08:00:00.000Z',
    senderNames: ['Alex'],
    senderEmail: 'alex@example.com',
    labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
    hasAttachments: false,
    isUnread: true,
    reminderAt: null,
    ...overrides,
  };
}

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    accountId: ACCOUNT,
    senderName: 'Alex',
    senderEmail: 'alex@example.com',
    subject: 'Can you review the contract?',
    snippet: 'Can you review this today?',
    receivedAt: '2026-07-03T08:00:00.000Z',
    labelIds: ['INBOX', 'UNREAD', 'IMPORTANT'],
    hasAttachments: false,
    isUnread: true,
    to: [{ name: 'Me', email: ACCOUNT }],
    cc: [],
    bcc: [],
    bodyPlain: 'Hi, can you review the contract today and let me know what you think?',
    bodyHtml: null,
    attachments: [],
    headers: [],
    ...overrides,
  };
}

function security(overrides: Partial<MessageSecurityInsight> = {}): MessageSecurityInsight {
  return {
    accountId: ACCOUNT,
    messageId: 'msg-risk',
    threadId: 'thread-risk',
    riskLevel: 'high',
    warnings: [{
      kind: 'suspiciousLink',
      severity: 'danger',
      title: 'Link destination mismatch',
      detail: 'Visible and actual link domains differ.',
    }],
    trackerCount: 0,
    phishingLinkCount: 1,
    analyzedAt: NOW.toISOString(),
    ...overrides,
  };
}

describe('daily briefing builder', () => {
  it('normalizes settings into bounded production values', () => {
    expect(normalizeDailyBriefingSettings({
      lookbackHours: 999,
      maxItems: 1,
      defaultReminderHour: -5,
      includeFyi: false,
      includeRiskAndNoise: false,
      useSemanticSearch: false,
    })).toEqual({
      enabled: true,
      lookbackHours: 168,
      maxItems: 3,
      includeRead: false,
      includeFyi: false,
      includeRiskAndNoise: false,
      useSemanticSearch: false,
      defaultReminderHour: 0,
    });
  });

  it('builds cited actionable categories from local mail signals', () => {
    const riskThread = thread({
      id: 'thread-risk',
      subject: 'Urgent account warning',
      snippet: 'Verify now',
      senderNames: ['Security'],
      senderEmail: 'security@example.net',
      labelIds: ['INBOX', 'UNREAD'],
    });
    const riskMessage = message({
      id: 'msg-risk',
      threadId: 'thread-risk',
      subject: riskThread.subject,
      snippet: riskThread.snippet,
      senderName: 'Security',
      senderEmail: 'security@example.net',
      bodyHtml: '<a href="http://evil.example">https://google.com</a>',
    });
    const fyiThread = thread({
      id: 'thread-fyi',
      subject: 'Weekly update',
      snippet: 'Here is the latest update',
      senderNames: ['Ops'],
      senderEmail: 'ops@example.com',
      labelIds: ['INBOX', 'UNREAD'],
      isUnread: true,
    });
    const fyiMessage = message({
      id: 'msg-fyi',
      threadId: 'thread-fyi',
      subject: fyiThread.subject,
      snippet: fyiThread.snippet,
      senderName: 'Ops',
      senderEmail: 'ops@example.com',
      bodyPlain: 'Here is the latest update for visibility.',
      to: [],
    });

    const briefing = buildDailyBriefing({
      accountId: ACCOUNT,
      threads: [thread(), riskThread, fyiThread],
      messagesByThreadId: {
        'thread-1': [message()],
        'thread-risk': [riskMessage],
        'thread-fyi': [fyiMessage],
      },
      securityByThreadId: {
        'thread-risk': [security()],
      },
      now: NOW,
      semanticSearchEnabled: false,
    });

    expect(briefing.items.map(item => item.category)).toContain('needsReply');
    expect(briefing.items.map(item => item.category)).toContain('riskOrNoise');
    expect(briefing.items.map(item => item.category)).toContain('fyi');
    expect(briefing.items[0].source.messageId).toBe('msg-risk');
    expect(briefing.items.every(item => item.source.snippet.length > 0)).toBe(true);
    expect(briefing.items.find(item => item.category === 'needsReply')?.suggestedActions).toContain('draftReply');
    expect(briefing.items.find(item => item.category === 'riskOrNoise')?.suggestedActions).toContain('applyLabel');
  });

  it('uses semantic scores to surface older read requests when enabled', () => {
    const olderThread = thread({
      id: 'thread-old',
      subject: 'Need your approval',
      snippet: 'Please approve this when you can',
      lastMessageAt: '2026-06-30T09:00:00.000Z',
      labelIds: ['INBOX'],
      isUnread: false,
    });
    const olderMessage = message({
      id: 'msg-old',
      threadId: 'thread-old',
      subject: olderThread.subject,
      snippet: olderThread.snippet,
      receivedAt: olderThread.lastMessageAt,
      labelIds: ['INBOX'],
      isUnread: false,
      bodyPlain: 'Please approve this when you can.',
    });

    const briefing = buildDailyBriefing({
      accountId: ACCOUNT,
      threads: [olderThread],
      messagesByThreadId: {
        'thread-old': [olderMessage],
      },
      semanticScoresByThreadId: {
        'thread-old': 0.42,
      },
      settings: {
        includeRead: false,
        useSemanticSearch: true,
      },
      semanticSearchEnabled: true,
      now: NOW,
    });

    expect(briefing.items).toHaveLength(1);
    expect(briefing.items[0].semanticScore).toBe(0.42);
    expect(briefing.items[0].reason).toContain('Semantic match');
    expect(briefing.coverage.semanticSearchEnabled).toBe(true);
  });

  it('records a skip warning and still builds when semantic search fails', async () => {
    databaseMocks.ThreadsRepo.list.mockReturnValue([thread()] as never[]);
    databaseMocks.MessagesRepo.listForThread.mockReturnValue([message()] as never[]);
    const searchSemantic = vi.fn().mockRejectedValue(new Error('embedding provider offline'));

    const briefing = await buildDailyBriefingForAccount({
      accountId: ACCOUNT,
      options: { nowIso: NOW.toISOString() },
      runtimeSettings: {
        semanticSearchEnabled: true,
        dailyBriefing: normalizeDailyBriefingSettings({ useSemanticSearch: true }),
      },
      searchSemantic,
    });

    expect(searchSemantic).toHaveBeenCalledTimes(1);
    expect(briefing.coverage.warnings).toContain('Semantic briefing search skipped: embedding provider offline');
    expect(briefing.items.length).toBeGreaterThan(0);
    expect(briefing.coverage.semanticMatches).toBe(0);
  });

  // buildDailyBriefingForAccount only carries the newest message per thread back
  // from the database worker, so whole-thread bodies never cross the thread
  // boundary. That is only safe while the builder reduces each thread to its
  // latest message -- this pins that contract.
  it('produces identical items from a thread whether given every message or only the latest', () => {
    const target = thread({ id: 'thread-multi' });
    const older = message({
      id: 'msg-old',
      threadId: target.id,
      receivedAt: '2026-07-01T08:00:00.000Z',
      subject: 'Older subject nobody should see',
      snippet: 'Older snippet nobody should see',
      bodyPlain: 'An earlier note with no question in it.',
    });
    const newest = message({
      id: 'msg-new',
      threadId: target.id,
      receivedAt: '2026-07-03T08:00:00.000Z',
    });
    const input = {
      accountId: ACCOUNT,
      threads: [target],
      securityByThreadId: {},
      semanticScoresByThreadId: {},
      settings: normalizeDailyBriefingSettings({}),
      semanticSearchEnabled: false,
      bodyContextIncluded: false,
      now: NOW,
    };

    const fromEveryMessage = buildDailyBriefing({
      ...input,
      messagesByThreadId: { [target.id]: [older, newest] },
    });
    const fromLatestOnly = buildDailyBriefing({
      ...input,
      messagesByThreadId: { [target.id]: [newest] },
    });

    expect(fromLatestOnly.items).toEqual(fromEveryMessage.items);
    expect(fromLatestOnly.items).toHaveLength(1);
    expect(fromLatestOnly.coverage.candidateThreadCount).toBe(fromEveryMessage.coverage.candidateThreadCount);
  });
});
