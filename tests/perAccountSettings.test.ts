import { afterEach, describe, expect, it, vi } from 'vitest';

const currentModel = 'gemini:gemini-embedding-001:dim=default:https://generativelanguage.googleapis.com/v1beta';

const databaseMocks = vi.hoisted(() => ({
  SettingsRepo: {
    get: vi.fn(),
  },
  MessagesRepo: {
    countForEmbedding: vi.fn(() => 1500),
    listForEmbedding: vi.fn(),
  },
  MailEmbeddingsRepo: {
    indexedHashes: vi.fn(),
    modelStats: vi.fn(() => [
      { model: currentModel, count: 1200, lastIndexedAt: '2026-07-03T09:00:00.000Z' },
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

// Import target under test (must be imported after mocking database)
import { AgenticService } from '../main/agentic';
import { SettingsRepo, MailEmbeddingsRepo } from '../main/database';

describe('per-account settings resolution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('falls back to global settings when no per-account overrides are specified', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(JSON.stringify({
      ai: {
        semanticSearchEnabled: true,
        embeddings: {
          provider: 'gemini',
          model: 'gemini-embedding-001',
          baseURL: '',
          dimensions: null,
        },
      },
    }));

    vi.mocked(MailEmbeddingsRepo.modelStats).mockReturnValue([
      { model: 'gemini:gemini-embedding-001:dim=default:https://generativelanguage.googleapis.com/v1beta', count: 1200, lastIndexedAt: '2026-07-03T09:00:00.000Z' },
    ]);

    const status = await AgenticService.getEmbeddingIndexStatus('test@example.com');
    expect(status.semanticSearchEnabled).toBe(true);
    expect(status.currentModel).toContain('gemini:gemini-embedding-001');
  });

  it('uses per-account override when specified', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(JSON.stringify({
      ai: {
        semanticSearchEnabled: false,
        embeddings: {
          provider: 'openAI',
          model: 'text-embedding-3-small',
          baseURL: 'https://api.openai.com/v1',
          dimensions: null,
        },
        embeddingsByAccount: {
          'test@example.com': {
            provider: 'gemini',
            model: 'gemini-embedding-2',
            baseURL: 'https://custom-gemini.com',
            dimensions: 768,
          },
        },
        semanticSearchEnabledByAccount: {
          'test@example.com': true,
        },
      },
    }));

    vi.mocked(MailEmbeddingsRepo.modelStats).mockImplementation((accountId) => {
      if (accountId === 'test@example.com') {
        return [
          { model: 'gemini:gemini-embedding-2:dim=768:https://generativelanguage.googleapis.com/v1beta', count: 500, lastIndexedAt: '2026-07-03T09:00:00.000Z' },
        ];
      }
      return [
        { model: 'openAI:text-embedding-3-small:dim=default:https://api.openai.com/v1', count: 100, lastIndexedAt: '2026-07-03T09:00:00.000Z' },
      ];
    });

    const status = await AgenticService.getEmbeddingIndexStatus('test@example.com');
    expect(status.semanticSearchEnabled).toBe(true);
    expect(status.currentModel).toContain('gemini:gemini-embedding-2:dim=768:https://generativelanguage.googleapis.com/v1beta');

    // Verification that other accounts still use global fallback settings
    const otherStatus = await AgenticService.getEmbeddingIndexStatus('other@example.com');
    expect(otherStatus.semanticSearchEnabled).toBe(false);
    expect(otherStatus.currentModel).toContain('openAI:text-embedding-3-small');
  });
});
