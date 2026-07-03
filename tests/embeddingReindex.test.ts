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
    countForEmbedding: vi.fn(() => 50000),
    listForEmbedding: vi.fn(() => {
      throw new Error('full mailbox scan should not run during reindex startup');
    }),
    listForEmbeddingPage: vi.fn(() => []),
    listRecent: vi.fn(() => []),
    listForThread: vi.fn(() => []),
    listRecentBySender: vi.fn(() => []),
  },
  MailEmbeddingsRepo: {
    indexedHashes: vi.fn(() => {
      throw new Error('full index hash scan should not run during reindex startup');
    }),
    indexedHashesForMessageIds: vi.fn(() => ({})),
    modelStats: vi.fn(() => []),
    saveMany: vi.fn(),
    deleteByModel: vi.fn(() => 0),
    deleteOtherModels: vi.fn(() => 0),
    listForAccount: vi.fn(() => []),
    listForAccountPage: vi.fn(() => []),
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
import { createEmbeddings } from '../main/ai';

describe('embedding reindex jobs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('starts a full reindex without synchronously scanning the whole mailbox', async () => {
    const status = await AgenticService.startEmbeddingReindex(accountId);

    expect(status).toMatchObject({
      accountId,
      currentModel,
      totalMessages: 50000,
      pendingMessages: 50000,
      semanticSearchEnabled: true,
    });
    expect(status.job?.state).toBe('running');
    expect(databaseMocks.MessagesRepo.listForEmbedding).not.toHaveBeenCalled();
    expect(databaseMocks.MailEmbeddingsRepo.indexedHashes).not.toHaveBeenCalled();
  });

  it('does not perform full hash scans on the interactive semantic search path', async () => {
    const searchAccountId = 'search@example.com';
    vi.mocked(createEmbeddings).mockResolvedValue({
      model: currentModel,
      embeddings: [[1, 0]],
    });

    const results = await AgenticService.searchSemantic(searchAccountId, 'contract', 10);

    expect(results).toEqual([]);
    expect(databaseMocks.MailEmbeddingsRepo.indexedHashes).not.toHaveBeenCalled();
    expect(databaseMocks.MailEmbeddingsRepo.listForAccountPage).toHaveBeenCalled();
  });
});
