import { completeOpenAIDecisions } from './openAIDecisions';
// Agent preparation in the main process (design-review/SPEC.md §1 model layer, §5).
//
// The logic lives in `main/agentPrepCore.ts` and takes all of its
// dependencies as arguments; this module wires the real ones: settings and
// small indexed reads/writes on the main thread, inbox scans and message reads
// on the database worker, `completeText` for the provider, and the window for
// events. See agentPrepCore.ts for the rules.
import crypto from 'crypto';
import { AccountsRepo, AgentDraftsRepo, SettingsRepo, ThreadDecisionsRepo, ThreadsRepo } from './database';
import { databaseWorkerClient } from './databaseWorkerClient';
import { AgentPrepLookups, ThreadSummariesRepo } from './agentPrepRepository';
import { completeText, resolveTextProvider } from './aiStream';
import { buildPlainChatPrompt } from './ai';
import { SystemLogger } from './systemLogger';
import { buildMetadataOnlyThreadContext } from '../shared/aiContext';
import { createAgentPrepService, type StoredAgentSettings } from './agentPrepCore';

export { modelMayReadMail, type ModelStatus } from './agentPrepCore';

export interface AgentPrepHost {
  publish: (channel: string, payload: unknown) => void;
}

let host: AgentPrepHost | null = null;

function readStoredSettings(): StoredAgentSettings {
  try {
    const parsed = JSON.parse(SettingsRepo.get('appSettings') || '{}');
    return parsed && typeof parsed === 'object' ? parsed as StoredAgentSettings : {};
  } catch {
    return {};
  }
}

const service = createAgentPrepService({
  readSettings: readStoredSettings,
  listAccounts: () => AccountsRepo.list(),
  inboxSnapshot: (accountId, limit) => databaseWorkerClient.agentPrepInbox(accountId, limit),
  listMessagesForThread: (accountId, threadId) => databaseWorkerClient.listMessagesForThread(accountId, threadId),
  getThread: (accountId, threadId) => ThreadsRepo.get(accountId, threadId),
  upsertDecisions: records => ThreadDecisionsRepo.upsertMany(records),
  getAgentDraftForMessage: (accountId, messageId) => AgentDraftsRepo.getForMessage(accountId, messageId),
  saveAgentDraft: draft => AgentDraftsRepo.save(draft),
  hasAgentDraftForMessage: (accountId, messageId) => AgentPrepLookups.hasAgentDraftForMessage(accountId, messageId),
  userDraftThreadIds: accountId => AgentPrepLookups.userDraftThreadIds(accountId),
  getSummary: (accountId, threadId, lastMessageId, cacheKey) => ThreadSummariesRepo.get(accountId, threadId, lastMessageId, cacheKey),
  saveSummary: record => ThreadSummariesRepo.save(record),
  metadataContext: async (accountId, threadId) => {
    if (!threadId) return 'No thread open.';
    const thread = ThreadsRepo.get(accountId, threadId);
    if (!thread) return 'No thread open.';
    const messages = await databaseWorkerClient.listMessageMetadataForThread(accountId, threadId);
    return buildMetadataOnlyThreadContext(thread, messages);
  },
  buildChatPrompt: request => buildPlainChatPrompt(request),
  resolveTextProvider,
  completeText,
  completeDecisions: completeOpenAIDecisions,
  publish: (channel, payload) => host?.publish(channel, payload),
  logWarning: (scope, message, extra) => SystemLogger.warning(scope, message, extra),
  newId: () => crypto.randomUUID(),
  now: () => new Date(),
});

export const AgentPrepService = {
  ...service,
  start(nextHost: AgentPrepHost) {
    host = nextHost;
    service.start();
  },
};
