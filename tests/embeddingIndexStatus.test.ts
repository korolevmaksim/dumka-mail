import { beforeEach, describe, expect, it, vi } from 'vitest';

const accountId = 'me@example.com';
const currentModel = 'openAI:text-embedding-3-small:dim=default:https://api.openai.com/v1';

const databaseMocks = vi.hoisted(() => ({
  SettingsRepo: {
    get: vi.fn(() => JSON.stringify({
      ai: {
        semanticSearchEnabled: true,
        embeddings: {
          provider: 'openAI',
          model: 'text-embedding-3-small',
          baseURL: 'https://api.openai.com/v1',
          dimensions: null,
        },
      },
    })),
  },
  MessagesRepo: {
    countForEmbedding: vi.fn(() => 1500),
    listForEmbedding: vi.fn(() => {
      throw new Error('listForEmbedding should not run for index status');
    }),
  },
  MailEmbeddingsRepo: {
    indexedHashes: vi.fn(() => {
      throw new Error('indexedHashes should not run for index status');
    }),
    modelStats: vi.fn(() => [
      { model: currentModel, count: 1200, lastIndexedAt: '2026-07-03T09:00:00.000Z' },
      { model: 'old-model', count: 100, lastIndexedAt: '2026-07-02T09:00:00.000Z' },
    ]),
  },
  AccountsRepo: { list: vi.fn(() => []) },
  AgentDraftsRepo: {
    getForMessage: vi.fn(),
    getReadyForThread: vi.fn(),
    save: vi.fn(),
    setStatus: vi.fn(),
  },
  DraftsRepo: { list: vi.fn(() => []) },
  MessageSecurityRepo: {
    saveMany: vi.fn(),
    listForThread: vi.fn(() => []),
  },
  ThreadsRepo: {
    list: vi.fn(() => []),
    updateLabels: vi.fn(),
  },
}));

vi.mock('../main/database', () => databaseMocks);
vi.mock('../main/ai', () => ({
  completeAI: vi.fn(),
  createEmbeddings: vi.fn(),
  getAIProviderDescriptor: vi.fn(),
}));
vi.mock('../main/gmail', () => ({
  GmailSyncService: {
    sendDraft: vi.fn(),
    modifyLabels: vi.fn(),
  },
}));

import { AgenticService } from '../main/agentic';

describe('embedding index status', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses aggregate counts instead of scanning message bodies for settings status', async () => {
    const status = await AgenticService.getEmbeddingIndexStatus(accountId);

    expect(status).toMatchObject({
      accountId,
      currentModel,
      totalMessages: 1500,
      indexedMessages: 1200,
      pendingMessages: 300,
      staleMessages: 0,
      otherIndexedMessages: 100,
      semanticSearchEnabled: true,
    });
    expect(databaseMocks.MessagesRepo.countForEmbedding).toHaveBeenCalledWith(accountId, 100000);
    expect(databaseMocks.MessagesRepo.listForEmbedding).not.toHaveBeenCalled();
    expect(databaseMocks.MailEmbeddingsRepo.indexedHashes).not.toHaveBeenCalled();
  });
});
