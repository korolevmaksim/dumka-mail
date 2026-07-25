import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MAIL_SECURITY_ANALYSIS_VERSION } from '../shared/mailSecurity';
import type { MailMessage, MessageSecurityInsight } from '../shared/types';

const ACCOUNT = 'me@example.com';
const THREAD = 'thread-1';

const databaseMocks = vi.hoisted(() => ({
  SettingsRepo: { get: vi.fn(() => '{}') },
  MessagesRepo: {
    listForThread: vi.fn(() => [] as unknown[]),
    listRecentBySender: vi.fn(() => [] as unknown[]),
  },
  MessageSecurityRepo: {
    listForThread: vi.fn(() => [] as unknown[]),
    saveMany: vi.fn(),
  },
  AgentDraftsRepo: {
    getForMessage: vi.fn(),
    getReadyForThread: vi.fn(() => null),
    save: vi.fn(),
    setStatus: vi.fn(),
  },
  MailEmbeddingsRepo: {
    indexedHashesForMessageIds: vi.fn(() => ({})),
    modelStats: vi.fn(() => []),
    saveMany: vi.fn(),
  },
  AccountsRepo: { list: vi.fn(() => []) },
  DraftsRepo: { list: vi.fn(() => []) },
  ThreadsRepo: { list: vi.fn(() => []), get: vi.fn(() => null), listRecentInbox: vi.fn(() => []) },
  UnsubscribedSendersRepo: { list: vi.fn(() => []), save: vi.fn() },
}));

vi.mock('../main/database', () => databaseMocks);
vi.mock('../main/ai', () => ({
  completeAI: vi.fn(),
  createEmbeddings: vi.fn(),
  getAIProviderDescriptor: vi.fn(),
}));
vi.mock('../main/gmail', () => ({
  GmailSyncService: { sendDraft: vi.fn(), modifyLabels: vi.fn() },
}));
vi.mock('../main/semanticSearchWorkerClient', () => ({
  semanticSearchWorkerClient: { search: vi.fn(), shutdown: vi.fn() },
}));
vi.mock('../main/databaseWorkerClient', async () => (
  (await import('./support/databaseWorkerClientTestDouble')).createDatabaseWorkerClientModule()
));

import { AgenticService } from '../main/agentic';

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'msg-1',
    threadId: THREAD,
    accountId: ACCOUNT,
    senderName: 'Alex',
    senderEmail: 'alex@example.com',
    subject: 'Contract',
    snippet: 'Please review',
    receivedAt: '2026-07-03T08:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: true,
    to: [{ name: 'Me', email: ACCOUNT }],
    cc: [],
    bcc: [],
    bodyPlain: 'Please review the contract.',
    bodyHtml: null,
    attachments: [],
    headers: [],
    ...overrides,
  };
}

/** What `mapMessageMetadataRow` produces: every body field nulled out. */
function metadataOnlyMessage(): MailMessage {
  return message({ bodyPlain: null, bodyHtml: null, attachments: [] });
}

function staleInsight(): MessageSecurityInsight {
  return {
    accountId: ACCOUNT,
    messageId: 'msg-1',
    threadId: THREAD,
    riskLevel: 'low',
    warnings: [],
    trackerCount: 0,
    phishingLinkCount: 0,
    analysisVersion: MAIL_SECURITY_ANALYSIS_VERSION - 1,
    analyzedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('getThreadInsights security analysis gating', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    databaseMocks.MessagesRepo.listForThread.mockReturnValue([message()] as never[]);
    databaseMocks.MessagesRepo.listRecentBySender.mockReturnValue([] as never[]);
    databaseMocks.MessageSecurityRepo.listForThread.mockReturnValue([staleInsight()] as never[]);
  });

  // `api:getThreadAgentInsights` hands this method metadata-only messages. That
  // has always meant "return whatever is cached, never analyze" -- the decision
  // must follow what the CALLER holds, not what the database worker could read.
  it('does not analyze when the caller supplies metadata-only messages', async () => {
    const insights = await AgenticService.getThreadInsights(ACCOUNT, THREAD, [metadataOnlyMessage()]);

    expect(databaseMocks.MessageSecurityRepo.saveMany).not.toHaveBeenCalled();
    expect(databaseMocks.MessagesRepo.listRecentBySender).not.toHaveBeenCalled();
    expect(insights.securityInsights).toHaveLength(1);
  });

  it('analyzes when the caller supplies full message bodies and the cache is stale', async () => {
    await AgenticService.getThreadInsights(ACCOUNT, THREAD, [message()]);

    expect(databaseMocks.MessageSecurityRepo.saveMany).toHaveBeenCalledTimes(1);
  });

  it('analyzes when no messages are supplied and the cache is stale', async () => {
    await AgenticService.getThreadInsights(ACCOUNT, THREAD);

    expect(databaseMocks.MessageSecurityRepo.saveMany).toHaveBeenCalledTimes(1);
  });

  // `api:getThreadReaderPayload` has just loaded the thread when it calls this,
  // and passes its message count along. With a current cache the guard must be
  // settled from that count alone -- re-reading every body_html here would
  // double the I/O cost of opening a thread.
  it('leaves a current cache untouched without re-reading the thread', async () => {
    databaseMocks.MessageSecurityRepo.listForThread.mockReturnValue([
      { ...staleInsight(), analysisVersion: MAIL_SECURITY_ANALYSIS_VERSION },
    ] as never[]);

    await AgenticService.getThreadInsights(ACCOUNT, THREAD, [message()]);

    expect(databaseMocks.MessageSecurityRepo.saveMany).not.toHaveBeenCalled();
    expect(databaseMocks.MessagesRepo.listForThread).not.toHaveBeenCalled();
  });
});
