import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    modelStats: vi.fn(() => []),
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
vi.mock('../main/semanticSearchWorkerClient', () => ({
  semanticSearchWorkerClient: { search: vi.fn() },
}));

// Import target under test (must be imported after mocking database)
import { AgenticService } from '../main/agentic';
import { createEmbeddings } from '../main/ai';
import { SettingsRepo } from '../main/database';
import { semanticSearchWorkerClient } from '../main/semanticSearchWorkerClient';

const mockedCreateEmbeddings = vi.mocked(createEmbeddings);

const ENABLED_SETTINGS = JSON.stringify({
  ai: {
    semanticSearchEnabled: true,
    embeddings: { provider: 'openAI', model: 'text-embedding-3-small', baseURL: null, dimensions: null },
  },
});

describe('searchSemantic outcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disabled when semantic search is off', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(JSON.stringify({ ai: { semanticSearchEnabled: false } }));
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome).toEqual({ status: 'disabled', results: [], coverage: null });
  });

  it('returns error with the provider message when embedding the query fails', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockRejectedValue(new Error('401 invalid key'));
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('error');
    expect(outcome.errorMessage).toContain('401 invalid key');
    expect(outcome.results).toEqual([]);
  });

  it('returns ok with results and coverage', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockResolvedValue({ model: 'text-embedding-3-small', embeddings: [[1, 0]] });
    vi.mocked(semanticSearchWorkerClient.search).mockResolvedValue({
      results: [{ threadId: 't1', messageId: 'm1', score: 0.9, subject: 's', sender: 'x', snippet: 'sn', receivedAt: '2026-07-01T00:00:00.000Z' }],
      aborted: false,
      scanned: 120,
      totalIndexed: 300,
    });
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('ok');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.coverage).toEqual({ scanned: 120, totalIndexed: 300 });
  });

  it('returns superseded when the scan was aborted by a newer request', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockResolvedValue({ model: 'text-embedding-3-small', embeddings: [[1, 0]] });
    vi.mocked(semanticSearchWorkerClient.search).mockResolvedValue({ results: [], aborted: true, scanned: 10, totalIndexed: 300 });
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('superseded');
  });

  it('surfaces a briefing skip warning when semantic search errors', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockRejectedValue(new Error('401 invalid key'));
    const briefing = await AgenticService.buildDailyBriefing('a@x.com');
    expect(briefing.coverage.warnings).toContain('Semantic briefing search skipped: 401 invalid key');
  });
});
