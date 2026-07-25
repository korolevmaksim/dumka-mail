import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EmbeddingResponse } from '../main/ai';
import type { SemanticSearchResult } from '../shared/types';

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

const workerClientMocks = vi.hoisted(() => ({
  semanticSearchWorkerClient: {
    search: vi.fn(async (
      _accountId: string,
      _model: string,
      _queryVector: number[],
      _limit: number,
      _requestId: number,
      _scope: string
    ): Promise<{ results: SemanticSearchResult[]; aborted: boolean; scanned: number; totalIndexed: number }> =>
      ({ results: [], aborted: false, scanned: 0, totalIndexed: 0 })),
    shutdown: vi.fn(),
  },
}));

vi.mock('../main/database', () => databaseMocks);
vi.mock('../main/semanticSearchWorkerClient', () => workerClientMocks);
// Embedding candidate collection and the briefing thread pass run on the
// database worker; execute them inline against the repository mocks above.
vi.mock('../main/databaseWorkerClient', async () => (
  (await import('./support/databaseWorkerClientTestDouble')).createDatabaseWorkerClientModule()
));
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
import { buildEmbeddingText } from '../main/mailAnalysisJobs';
import { stableTextHash } from '../shared/semantic';
import type { MailMessage } from '../shared/types';

const REINDEX_PAGE_SIZE = 256;

function pageMessage(index: number): MailMessage {
  return {
    id: `msg-${index}`,
    threadId: `thread-${index}`,
    accountId,
    senderName: 'Alex',
    senderEmail: 'alex@example.com',
    subject: `Contract revision ${index}`,
    snippet: 'Please take a look at the latest revision when you have a moment.',
    receivedAt: `2026-07-03T08:00:${String(index % 60).padStart(2, '0')}.000Z`,
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [{ name: 'Me', email: accountId }],
    cc: [],
    bcc: [],
    bodyPlain: `Body of revision ${index}: please review the attached contract changes.`,
    bodyHtml: null,
    attachments: [],
    headers: [],
  };
}

/** Hashes matching what the job computes, so every candidate is already indexed. */
function indexedHashesFor(messages: MailMessage[]): Record<string, string> {
  return Object.fromEntries(messages.map(message => [message.id, stableTextHash(buildEmbeddingText(message))]));
}

async function waitForReindexToFinish(): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const status = await AgenticService.getEmbeddingIndexStatus(accountId);
    if (status.job && status.job.state !== 'running') return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Reindex job did not finish in time');
}

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

  // Paging advances by the number of rows the page QUERY returned, not by how
  // many survived candidate filtering. A full page whose candidates are all
  // already indexed yields zero candidates; if the loop advanced on that count
  // it would re-request offset 0 forever.
  it('advances reindex paging by scanned rows even when a whole page is already indexed', async () => {
    const firstPage = Array.from({ length: REINDEX_PAGE_SIZE }, (_, index) => pageMessage(index));
    databaseMocks.MessagesRepo.listForEmbeddingPage
      .mockReturnValueOnce(firstPage as never[])
      .mockReturnValue([] as never[]);
    databaseMocks.MailEmbeddingsRepo.indexedHashesForMessageIds.mockReturnValue(
      indexedHashesFor(firstPage) as never,
    );

    await AgenticService.startEmbeddingReindex(accountId);
    await waitForReindexToFinish();

    const offsets = databaseMocks.MessagesRepo.listForEmbeddingPage.mock.calls
      .map(call => (call as unknown as [string, number, number])[2]);
    expect(offsets.slice(0, 2)).toEqual([0, REINDEX_PAGE_SIZE]);
    expect(vi.mocked(createEmbeddings)).not.toHaveBeenCalled();
    const status = await AgenticService.getEmbeddingIndexStatus(accountId);
    expect(status.job?.state).toBe('completed');
  });

  it('stops paging on a short page rather than requesting past the end', async () => {
    const shortPage = Array.from({ length: 10 }, (_, index) => pageMessage(index));
    databaseMocks.MessagesRepo.listForEmbeddingPage.mockReturnValue(shortPage as never[]);
    databaseMocks.MailEmbeddingsRepo.indexedHashesForMessageIds.mockReturnValue(
      indexedHashesFor(shortPage) as never,
    );

    await AgenticService.startEmbeddingReindex(accountId);
    await waitForReindexToFinish();

    expect(databaseMocks.MessagesRepo.listForEmbeddingPage).toHaveBeenCalledTimes(1);
  });

  it('delegates the interactive semantic search scan to the worker without main-process scans', async () => {
    const searchAccountId = 'search@example.com';
    vi.mocked(createEmbeddings).mockResolvedValue({
      model: currentModel,
      embeddings: [[1, 0]],
    });

    const outcome = await AgenticService.searchSemantic(searchAccountId, 'contract', 10);

    expect(outcome.status).toBe('ok');
    expect(outcome.results).toEqual([]);
    expect(workerClientMocks.semanticSearchWorkerClient.search)
      .toHaveBeenCalledWith(searchAccountId, currentModel, [1, 0], 10, expect.any(Number), 'interactive');
    expect(databaseMocks.MailEmbeddingsRepo.indexedHashes).not.toHaveBeenCalled();
    expect(databaseMocks.MailEmbeddingsRepo.listForAccountPage).not.toHaveBeenCalled();
  });

  it('drops semantic search results that were superseded while embedding the query', async () => {
    const searchAccountId = 'stale@example.com';
    let releaseFirstEmbedding: () => void = () => {};
    vi.mocked(createEmbeddings)
      .mockImplementationOnce(() => new Promise<EmbeddingResponse>(resolve => {
        releaseFirstEmbedding = () => resolve({ model: currentModel, embeddings: [[1, 0]] });
      }))
      .mockResolvedValueOnce({ model: currentModel, embeddings: [[0, 1]] });
    workerClientMocks.semanticSearchWorkerClient.search.mockResolvedValue({
      results: [{
        threadId: 't1',
        messageId: 'm1',
        score: 0.9,
        subject: 'Contract',
        sender: 'Ada',
        snippet: 'Signed contract attached',
        receivedAt: '2026-07-01T00:00:00.000Z',
      }],
      aborted: false,
      scanned: 1,
      totalIndexed: 1,
    });

    const first = AgenticService.searchSemantic(searchAccountId, 'contract', 10);
    const second = await AgenticService.searchSemantic(searchAccountId, 'contract draft', 10);
    releaseFirstEmbedding();

    const firstOutcome = await first;
    expect(firstOutcome.status).toBe('superseded');
    expect(firstOutcome.results).toEqual([]);
    expect(second.status).toBe('ok');
    expect(second.results).toHaveLength(1);
    expect(workerClientMocks.semanticSearchWorkerClient.search).toHaveBeenCalledTimes(1);
  });

  it('keeps interactive search and daily briefing supersession independent', async () => {
    const searchAccountId = 'scoped@example.com';
    let releaseInteractiveEmbedding: () => void = () => {};
    vi.mocked(createEmbeddings)
      .mockImplementationOnce(() => new Promise<EmbeddingResponse>(resolve => {
        releaseInteractiveEmbedding = () => resolve({ model: currentModel, embeddings: [[1, 0]] });
      }))
      .mockResolvedValue({ model: currentModel, embeddings: [[0, 1]] });

    // The briefing runs its three semantic queries while the interactive search
    // is still embedding; neither stream may supersede the other.
    const interactive = AgenticService.searchSemantic(searchAccountId, 'contract', 10);
    await AgenticService.buildDailyBriefing(searchAccountId);
    releaseInteractiveEmbedding();
    await interactive;

    const scopes = workerClientMocks.semanticSearchWorkerClient.search.mock.calls.map(call => call[5]);
    expect(scopes.filter(scope => scope === 'briefing')).toHaveLength(3);
    expect(scopes.filter(scope => scope === 'interactive')).toHaveLength(1);
  });

  it('returns no results when the worker reports an aborted scan', async () => {
    const searchAccountId = 'aborted@example.com';
    vi.mocked(createEmbeddings).mockResolvedValue({
      model: currentModel,
      embeddings: [[1, 0]],
    });
    workerClientMocks.semanticSearchWorkerClient.search.mockResolvedValue({ results: [], aborted: true, scanned: 5, totalIndexed: 10 });

    const outcome = await AgenticService.searchSemantic(searchAccountId, 'contract', 10);

    expect(outcome.status).toBe('superseded');
    expect(outcome.results).toEqual([]);
  });
});
