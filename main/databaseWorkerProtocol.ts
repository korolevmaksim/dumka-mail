// The single source of truth for the database worker's message contract.
//
// `databaseWorkerClient` (main process) and `databaseWorker` (worker thread) both
// import from here so a new operation cannot be added to one side only: the two
// used to carry hand-maintained copies of this union, and a drift between them
// would have compiled cleanly and failed at runtime.
//
// Type-only module — nothing here is emitted, so importing it does not pull
// `worker_threads` or the repositories into either bundle.
import type { MailEmbeddingRow } from './database';
import type {
  BriefingThreadSelection,
  EmbeddingCandidateSource,
  ThreadSecurityMode,
} from './mailAnalysisJobs';
import type { MailMessage, MailThread } from '../shared/types';

export type DatabaseWorkerPayload =
  | { type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean; indexBodies?: boolean }
  | { type: 'saveThreads'; threads: MailThread[] }
  | { type: 'listThreads'; accountIds: string[] }
  | { type: 'listMessagesForThread'; accountId: string; threadId: string }
  | { type: 'listMessageMetadataForThread'; accountId: string; threadId: string }
  | { type: 'recentSenderMessages'; accountId: string; senderEmail: string; limit: number }
  | { type: 'senderCleanupStats'; accountId: string }
  | {
      type: 'threadSecurityInsights';
      accountId: string;
      threadId: string;
      mode: ThreadSecurityMode;
      knownMessageCount?: number;
    }
  | { type: 'embeddingCandidates'; accountId: string; model: string; source: EmbeddingCandidateSource }
  | { type: 'saveEmbeddingVectors'; rows: MailEmbeddingRow[] }
  | { type: 'selectBriefingThreads'; accountId: string; selection: BriefingThreadSelection }
  | { type: 'briefingThreadBatch'; accountId: string; threadIds: string[] };

/** A payload as the worker receives it, correlated back to its pending promise. */
export type DatabaseWorkerRequest = DatabaseWorkerPayload & { id: number };

export type DatabaseWorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: { name: string; message: string; stack?: string } };
