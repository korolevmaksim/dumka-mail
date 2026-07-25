// In-process stand-in for `main/databaseWorkerClient`.
//
// The real client is only a transport across the worker thread boundary; the
// work itself lives in `main/mailAnalysisJobs` and `main/repositories`. Tests
// mock it with this double so the same jobs run inline against whatever
// `../main/database` mock the test installed, keeping repository-level
// assertions meaningful without spawning a worker.
import { MessagesRepo } from '../../main/database';
import {
  collectBriefingThreadBatch,
  collectPendingEmbeddingCandidates,
  saveEmbeddingVectors,
  selectBriefingThreads,
  threadSecurityInsights,
  type BriefingThreadSelection,
  type EmbeddingCandidateSource,
  type ThreadSecurityMode,
} from '../../main/mailAnalysisJobs';
import type { MailEmbeddingRow } from '../../main/database';

export function createDatabaseWorkerClientDouble() {
  return {
    listMessagesForThread: async (accountId: string, threadId: string) =>
      MessagesRepo.listForThread(accountId, threadId),
    threadSecurityInsights: async (
      accountId: string,
      threadId: string,
      mode: ThreadSecurityMode = 'refresh',
      knownMessageCount?: number,
    ) => threadSecurityInsights(accountId, threadId, mode, knownMessageCount),
    embeddingCandidates: async (accountId: string, model: string, source: EmbeddingCandidateSource) =>
      collectPendingEmbeddingCandidates(accountId, model, source),
    saveEmbeddingVectors: async (rows: MailEmbeddingRow[]) => saveEmbeddingVectors(rows),
    briefingThreadContext: async (accountId: string, selection: BriefingThreadSelection) => {
      const threads = selectBriefingThreads(accountId, selection);
      const batch = collectBriefingThreadBatch(accountId, threads.map(thread => thread.id));
      return { threads, ...batch };
    },
    shutdown: () => undefined,
  };
}

export function createDatabaseWorkerClientModule() {
  return { databaseWorkerClient: createDatabaseWorkerClientDouble() };
}
