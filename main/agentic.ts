import crypto from 'crypto';
import {
  AccountsRepo,
  AgentDraftsRepo,
  DraftsRepo,
  MailEmbeddingsRepo,
  MessagesRepo,
  MessageSecurityRepo,
  SettingsRepo,
  ThreadsRepo,
} from './database';
import { completeAI, createEmbeddings, getAIProviderDescriptor } from './ai';
import { GmailSyncService } from './gmail';
import {
  analyzeMessageSecurity,
  parseUnsubscribeCandidate,
  shouldGenerateAgentDraft,
} from '../shared/mailSecurity';
import { buildThreadContext, htmlToText } from '../shared/aiContext';
import { normalizeDailyBriefingSettings } from '../shared/dailyBriefing';
import { buildDailyBriefingForAccount } from './dailyBriefingService';
import { buildEmbeddingIndexKey, normalizeEmbeddingSettings } from '../shared/embeddingProviders';
import { cosineSimilarity, normalizeEmbeddingText, stableTextHash } from '../shared/semantic';
import type {
  AgentDraftSuggestion,
  AgentRulesSettings,
  AIEmbeddingSettings,
  AIProviderPreference,
  AISettings,
  DailyBriefing,
  DailyBriefingBuildOptions,
  DailyBriefingSettings,
  Draft,
  EmbeddingIndexJobStatus,
  EmbeddingIndexReindexOptions,
  EmbeddingIndexStatus,
  MailMessage,
  MailThread,
  SemanticSearchResult,
  ThreadAgentInsights,
  UnsubscribeCandidate,
  UnsubscribeMethod,
} from '../shared/types';

interface RuntimeAgentSettings {
  provider: AIProviderPreference;
  allowMailBodyContext: boolean;
  proactiveDraftsEnabled: boolean;
  semanticSearchEnabled: boolean;
  embeddings: AIEmbeddingSettings;
  agentRules: AgentRulesSettings;
  dailyBriefing: DailyBriefingSettings;
  suggestDrafts: boolean;
  replyTone: AISettings['replyTone'];
  personalizationNotes: string;
}

const DEFAULT_AGENT_RULES: AgentRulesSettings = {
  proactiveDraftTrigger: 'directOrActionRequest',
  blockBulkAndAutomated: true,
  maxDraftSourceWords: 6000,
};

function normalizeAgentRules(input: Partial<AgentRulesSettings> | undefined): AgentRulesSettings {
  const trigger = input?.proactiveDraftTrigger === 'directOnly' ? 'directOnly' : 'directOrActionRequest';
  const maxDraftSourceWords = Number.isInteger(input?.maxDraftSourceWords) && Number(input?.maxDraftSourceWords) > 0
    ? Math.max(200, Math.min(20000, Number(input?.maxDraftSourceWords)))
    : DEFAULT_AGENT_RULES.maxDraftSourceWords;
  return {
    proactiveDraftTrigger: trigger,
    blockBulkAndAutomated: input?.blockBulkAndAutomated !== false,
    maxDraftSourceWords,
  };
}

const activeDraftThreads = new Set<string>();
const activeRecentEmbeddingAccounts = new Set<string>();
const embeddingIndexJobs = new Map<string, EmbeddingIndexJobStatus>();
const EMBEDDING_BATCH_SIZE = 16;
const EMBEDDING_FULL_INDEX_LIMIT = 100000;

interface EmbeddingCandidate {
  message: MailMessage;
  text: string;
  textHash: string;
}

function readAgentSettings(accountId?: string): RuntimeAgentSettings {
  try {
    const raw = SettingsRepo.get('appSettings');
    const parsed = raw ? JSON.parse(raw) : {};
    let embeddings = normalizeEmbeddingSettings(parsed?.ai?.embeddings);
    let semanticSearchEnabled = parsed?.ai?.semanticSearchEnabled === true;

    if (accountId) {
      const normId = accountId.trim().toLowerCase();
      if (parsed?.ai?.embeddingsByAccount?.[normId]) {
        embeddings = normalizeEmbeddingSettings(parsed.ai.embeddingsByAccount[normId]);
      }
      if (parsed?.ai?.semanticSearchEnabledByAccount && normId in parsed.ai.semanticSearchEnabledByAccount) {
        semanticSearchEnabled = parsed.ai.semanticSearchEnabledByAccount[normId] === true;
      }
    }

    return {
      provider: parsed?.ai?.provider || 'automatic',
      allowMailBodyContext: parsed?.ai?.allowMailBodyContext === true,
      proactiveDraftsEnabled: parsed?.ai?.proactiveDraftsEnabled === true,
      semanticSearchEnabled,
      embeddings,
      agentRules: normalizeAgentRules(parsed?.ai?.agentRules),
      dailyBriefing: normalizeDailyBriefingSettings(parsed?.ai?.dailyBriefing),
      suggestDrafts: parsed?.ai?.suggestDrafts === true,
      replyTone: parsed?.ai?.replyTone || 'direct',
      personalizationNotes: parsed?.ai?.personalizationNotes || '',
    };
  } catch {
    return {
      provider: 'automatic',
      allowMailBodyContext: true,
      proactiveDraftsEnabled: false,
      semanticSearchEnabled: false,
      embeddings: normalizeEmbeddingSettings(null),
      agentRules: DEFAULT_AGENT_RULES,
      dailyBriefing: normalizeDailyBriefingSettings(null),
      suggestDrafts: false,
      replyTone: 'direct',
      personalizationNotes: '',
    };
  }
}

function latestMessage(messages: MailMessage[]): MailMessage | null {
  if (messages.length === 0) return null;
  return [...messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)).at(-1) || null;
}

function existingDraftForThread(accountId: string, threadId: string): Draft | null {
  return DraftsRepo.list(accountId).find(draft => draft.threadId === threadId) || null;
}

function buildEmbeddingText(message: MailMessage): string {
  const body = (message.bodyPlain || (message.bodyHtml ? htmlToText(message.bodyHtml) : '') || message.snippet || '').trim();
  return normalizeEmbeddingText([
    `Subject: ${message.subject}`,
    `From: ${message.senderName || message.senderEmail} <${message.senderEmail}>`,
    `Received: ${message.receivedAt}`,
    `Snippet: ${message.snippet}`,
    body,
  ].filter(Boolean).join('\n'));
}

function nowISO(): string {
  return new Date().toISOString();
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRunningEmbeddingJob(accountId: string): boolean {
  return embeddingIndexJobs.get(accountId)?.state === 'running';
}

function currentEmbeddingModel(settings: AIEmbeddingSettings): string {
  return buildEmbeddingIndexKey(normalizeEmbeddingSettings(settings));
}

function buildEmbeddingCandidates(messages: MailMessage[]): EmbeddingCandidate[] {
  return messages
    .map(message => ({ message, text: buildEmbeddingText(message) }))
    .filter(item => item.text.length >= 20)
    .map(item => ({ ...item, textHash: stableTextHash(item.text) }));
}

function selectPendingEmbeddingCandidates(candidates: EmbeddingCandidate[], indexedHashes: Record<string, string>): EmbeddingCandidate[] {
  return candidates.filter(item => indexedHashes[item.message.id] !== item.textHash);
}

async function pauseBetweenEmbeddingBatches(): Promise<void> {
  await new Promise(resolve => setTimeout(resolve, 0));
}

async function saveEmbeddingBatch(settings: AIEmbeddingSettings, batch: EmbeddingCandidate[]): Promise<number> {
  const response = await createEmbeddings(batch.map(item => item.text), {
    settings,
    purpose: 'document',
  });
  if (response.embeddings.length !== batch.length) {
    throw new Error(`Embedding provider returned ${response.embeddings.length} vectors for ${batch.length} messages.`);
  }

  const indexedAt = nowISO();
  MailEmbeddingsRepo.saveMany(batch.map((item, batchIndex) => ({
    accountId: item.message.accountId,
    messageId: item.message.id,
    threadId: item.message.threadId,
    model: response.model,
    textHash: item.textHash,
    vector: response.embeddings[batchIndex],
    subject: item.message.subject,
    sender: item.message.senderName || item.message.senderEmail,
    snippet: item.message.snippet,
    receivedAt: item.message.receivedAt,
    indexedAt,
  })));

  return batch.length;
}

function embeddingJobSnapshot(job: EmbeddingIndexJobStatus | undefined): EmbeddingIndexJobStatus | null {
  return job ? { ...job } : null;
}

function cleanDraftText(text: string): string {
  return text
    .replace(/^subject\s*:\s.*$/gim, '')
    .replace(/^draft\s*:\s*/i, '')
    .trim();
}

function aiSettingsForContext(settings: RuntimeAgentSettings): AISettings {
  return {
    provider: settings.provider,
    globalDefaultModel: '',
    fallback: { isEnabled: true, orderText: '' },
    providerConfigurations: [],
    promptShortcuts: [],
    replyTone: settings.replyTone,
    allowMailBodyContext: settings.allowMailBodyContext,
    savePromptHistory: false,
    proactiveDraftsEnabled: settings.proactiveDraftsEnabled,
    semanticSearchEnabled: settings.semanticSearchEnabled,
    externalToolsEnabled: false,
    embeddings: settings.embeddings,
    agentRules: settings.agentRules,
    dailyBriefing: settings.dailyBriefing,
    suggestDrafts: settings.suggestDrafts,
    suggestAutoArchive: true,
    suggestLabels: true,
    translationEnabled: true,
    personalizationNotes: settings.personalizationNotes,
  };
}

async function generateDraftForThread(thread: MailThread, messages: MailMessage[]): Promise<AgentDraftSuggestion | null> {
  const settings = readAgentSettings(thread.accountId);
  if (!settings.proactiveDraftsEnabled || !settings.suggestDrafts || !settings.allowMailBodyContext) return null;

  const latest = latestMessage(messages);
  if (!latest) return null;
  if (!shouldGenerateAgentDraft(latest, thread.accountId, settings.agentRules)) return null;
  if (existingDraftForThread(thread.accountId, thread.id)) return null;
  if (AgentDraftsRepo.getForMessage(thread.accountId, latest.id)) return null;

  const key = `${thread.accountId}:${thread.id}`;
  if (activeDraftThreads.has(key)) return null;
  activeDraftThreads.add(key);

  try {
    const descriptor = await getAIProviderDescriptor(settings.provider);
    if (descriptor.preference === 'disabled') return null;

    const tone = settings.replyTone === 'direct'
      ? 'Use a direct, clear tone.'
      : settings.replyTone === 'concise'
        ? 'Keep it concise and skimmable.'
        : settings.replyTone === 'warm'
          ? 'Use a warm but still professional tone.'
          : 'Use a formal professional tone.';
    const personalization = settings.personalizationNotes.trim()
      ? `\nUser writing preferences:\n${settings.personalizationNotes.trim()}`
      : '';

    const response = await completeAI({
      action: 'proactiveDraftReply',
      context: buildThreadContext(thread, messages, aiSettingsForContext(settings)),
      conversationHistory: [],
      userInstruction: [
        'Write a complete ready-to-edit reply to the latest inbound message in this email thread.',
        tone,
        'Do not include a subject line, quoted original text, markdown fences, or any preamble.',
        'If the sender asks for a meeting, propose a concrete next step without inventing calendar availability.',
        'If facts are missing, include a short bracketed placeholder instead of guessing.',
        personalization,
      ].join('\n'),
    }, settings.provider);

    const bodyPlain = cleanDraftText(response.text);
    if (bodyPlain.length < 8) return null;

    const now = new Date().toISOString();
    const draft: AgentDraftSuggestion = {
      id: crypto.randomUUID(),
      accountId: thread.accountId,
      threadId: thread.id,
      messageId: latest.id,
      subject: thread.subject,
      bodyPlain,
      status: 'ready',
      confidence: 0.78,
      reason: 'Latest inbound message appears to need a reply.',
      model: descriptor.model,
      createdAt: now,
      updatedAt: now,
    };
    AgentDraftsRepo.save(draft);
    return draft;
  } catch (err) {
    console.warn('[Agentic] Proactive draft generation skipped:', err);
    return null;
  } finally {
    activeDraftThreads.delete(key);
  }
}

function analyzeThreadMessages(accountId: string, messages: MailMessage[]): void {
  const insights = messages.map(message => {
    const previous = MessagesRepo.listRecentBySender(accountId, message.senderEmail, message.receivedAt, 8);
    return analyzeMessageSecurity(message, previous);
  });
  MessageSecurityRepo.saveMany(insights);
}

async function indexRecentMessages(accountId: string, maxMessages = 40): Promise<number> {
  if (isRunningEmbeddingJob(accountId)) return 0;
  if (activeRecentEmbeddingAccounts.has(accountId)) return 0;
  activeRecentEmbeddingAccounts.add(accountId);

  try {
    const settings = readAgentSettings(accountId).embeddings;
    const model = currentEmbeddingModel(settings);
    const indexedHashes = MailEmbeddingsRepo.indexedHashes(accountId, model);
    const candidates = selectPendingEmbeddingCandidates(
      buildEmbeddingCandidates(MessagesRepo.listRecent(accountId, maxMessages * 3)),
      indexedHashes
    )
      .slice(0, maxMessages);

    if (candidates.length === 0) return 0;

    let indexed = 0;
    for (let index = 0; index < candidates.length; index += EMBEDDING_BATCH_SIZE) {
      const batch = candidates.slice(index, index + EMBEDDING_BATCH_SIZE);
      indexed += await saveEmbeddingBatch(settings, batch);
      await pauseBetweenEmbeddingBatches();
    }

    return indexed;
  } catch (err) {
    console.warn('[Agentic] Semantic indexing skipped:', err);
    return 0;
  } finally {
    activeRecentEmbeddingAccounts.delete(accountId);
  }
}

async function getEmbeddingIndexStatusForAccount(accountId: string): Promise<EmbeddingIndexStatus> {
  const settings = readAgentSettings(accountId);
  const model = currentEmbeddingModel(settings.embeddings);
  const modelStats = MailEmbeddingsRepo.modelStats(accountId);
  const models = modelStats.map(item => ({
    model: item.model,
    count: item.count,
    lastIndexedAt: item.lastIndexedAt,
    isCurrent: item.model === model,
  }));
  const otherIndexedMessages = modelStats
    .filter(item => item.model !== model)
    .reduce((sum, item) => sum + item.count, 0);
  const job = embeddingIndexJobs.get(accountId);

  if (job?.state === 'running') {
    const currentIndexedCount = modelStats.find(item => item.model === model)?.count || 0;
    const jobPendingMessages = Math.max(0, job.total - job.processed);
    return {
      accountId,
      currentModel: model,
      totalMessages: Math.max(currentIndexedCount + jobPendingMessages, job.total),
      indexedMessages: currentIndexedCount,
      pendingMessages: jobPendingMessages,
      staleMessages: 0,
      otherIndexedMessages,
      models,
      job: embeddingJobSnapshot(job),
      semanticSearchEnabled: settings.semanticSearchEnabled,
    };
  }

  // This status is read when AI Config mounts, so keep it aggregate-only.
  // Explicit reindex actions still perform the full hash audit before indexing.
  const totalMessages = MessagesRepo.countForEmbedding(accountId, EMBEDDING_FULL_INDEX_LIMIT);
  const indexedMessages = Math.min(modelStats.find(item => item.model === model)?.count || 0, totalMessages);
  const pendingMessages = Math.max(0, totalMessages - indexedMessages);

  return {
    accountId,
    currentModel: model,
    totalMessages,
    indexedMessages,
    pendingMessages,
    staleMessages: 0,
    otherIndexedMessages,
    models,
    job: embeddingJobSnapshot(job),
    semanticSearchEnabled: settings.semanticSearchEnabled,
  };
}

async function runEmbeddingReindexJob(
  job: EmbeddingIndexJobStatus,
  settings: AIEmbeddingSettings,
  candidates: EmbeddingCandidate[]
): Promise<void> {
  try {
    for (let index = 0; index < candidates.length; index += EMBEDDING_BATCH_SIZE) {
      if (job.cancelRequested) break;

      const batch = candidates.slice(index, index + EMBEDDING_BATCH_SIZE);
      try {
        job.indexed += await saveEmbeddingBatch(settings, batch);
        job.processed += batch.length;
      } catch (err) {
        job.failed += batch.length;
        job.processed += batch.length;
        throw err;
      }
      job.updatedAt = nowISO();
      await pauseBetweenEmbeddingBatches();
    }

    job.state = job.cancelRequested ? 'cancelled' : 'completed';
  } catch (err) {
    job.state = 'failed';
    job.error = toErrorMessage(err);
    console.warn('[Agentic] Embedding reindex failed:', err);
  } finally {
    const finishedAt = nowISO();
    job.updatedAt = finishedAt;
    job.completedAt = finishedAt;
  }
}

async function startEmbeddingReindexForAccount(
  accountId: string,
  options: EmbeddingIndexReindexOptions = {}
): Promise<EmbeddingIndexStatus> {
  const runningJob = embeddingIndexJobs.get(accountId);
  if (runningJob?.state === 'running') {
    return getEmbeddingIndexStatusForAccount(accountId);
  }

  const settings = readAgentSettings(accountId);
  if (!settings.semanticSearchEnabled) {
    throw new Error('Semantic search is disabled. Enable it before indexing mail.');
  }

  const embeddingSettings = settings.embeddings;
  const model = currentEmbeddingModel(embeddingSettings);
  if (options.clearCurrent) {
    MailEmbeddingsRepo.deleteByModel(accountId, model);
  }
  if (options.clearOther) {
    MailEmbeddingsRepo.deleteOtherModels(accountId, model);
  }

  const candidates = buildEmbeddingCandidates(MessagesRepo.listForEmbedding(accountId, EMBEDDING_FULL_INDEX_LIMIT));
  const indexedHashes = MailEmbeddingsRepo.indexedHashes(accountId, model);
  const pendingCandidates = selectPendingEmbeddingCandidates(candidates, indexedHashes);
  const startedAt = nowISO();
  const job: EmbeddingIndexJobStatus = {
    state: pendingCandidates.length > 0 ? 'running' : 'completed',
    accountId,
    model,
    total: pendingCandidates.length,
    processed: 0,
    indexed: 0,
    failed: 0,
    startedAt,
    updatedAt: startedAt,
    completedAt: pendingCandidates.length > 0 ? null : startedAt,
    error: null,
    cancelRequested: false,
  };
  embeddingIndexJobs.set(accountId, job);

  if (pendingCandidates.length > 0) {
    void runEmbeddingReindexJob(job, embeddingSettings, pendingCandidates);
  }

  return getEmbeddingIndexStatusForAccount(accountId);
}

async function cancelEmbeddingReindexForAccount(accountId: string): Promise<EmbeddingIndexStatus> {
  const job = embeddingIndexJobs.get(accountId);
  if (job?.state === 'running') {
    job.cancelRequested = true;
    job.updatedAt = nowISO();
  }
  return getEmbeddingIndexStatusForAccount(accountId);
}

async function deleteEmbeddingIndexForAccount(accountId: string, model: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> {
  const job = embeddingIndexJobs.get(accountId);
  if (job?.state === 'running') {
    throw new Error('Stop the active embedding index job before deleting indexes.');
  }

  const deleted = MailEmbeddingsRepo.deleteByModel(accountId, model);
  return {
    deleted,
    status: await getEmbeddingIndexStatusForAccount(accountId),
  };
}

async function deleteOtherEmbeddingIndexesForAccount(accountId: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> {
  const job = embeddingIndexJobs.get(accountId);
  if (job?.state === 'running') {
    throw new Error('Stop the active embedding index job before deleting indexes.');
  }

  const model = currentEmbeddingModel(readAgentSettings(accountId).embeddings);
  const deleted = MailEmbeddingsRepo.deleteOtherModels(accountId, model);
  return {
    deleted,
    status: await getEmbeddingIndexStatusForAccount(accountId),
  };
}

function chooseUnsubscribeCandidate(messages: MailMessage[]): UnsubscribeCandidate | null {
  for (const message of [...messages].reverse()) {
    const candidate = parseUnsubscribeCandidate(message);
    if (candidate) return candidate;
  }
  return null;
}

async function performUnsubscribe(accountId: string, method: UnsubscribeMethod): Promise<string> {
  if (method.kind === 'httpPost') {
    const res = await fetch(method.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'List-Unsubscribe=One-Click',
    });
    if (!res.ok) {
      throw new Error(`Unsubscribe HTTP ${res.status}: ${await res.text()}`);
    }
    return 'httpPost';
  }

  if (method.kind === 'mailto' && method.email) {
    await GmailSyncService.sendDraft(accountId, {
      to: [{ name: '', email: method.email }],
      cc: [],
      bcc: [],
      subject: method.subject || 'unsubscribe',
      bodyPlain: method.body || 'unsubscribe',
      bodyHtml: null,
      attachments: [],
    });
    return 'mailto';
  }

  throw new Error('This sender does not expose a safe one-click unsubscribe method.');
}

async function processThreadInternal(accountId: string, threadId: string): Promise<void> {
  const thread = ThreadsRepo.list(accountId).find(item => item.id === threadId);
  if (!thread) return;
  const messages = MessagesRepo.listForThread(accountId, threadId);
  analyzeThreadMessages(accountId, messages);
  await generateDraftForThread(thread, messages);
}

async function searchSemanticInternal(accountId: string, query: string, limit = 60): Promise<SemanticSearchResult[]> {
  const trimmed = normalizeEmbeddingText(query, 1000);
  if (!trimmed) return [];
  const settings = readAgentSettings(accountId);
  if (!settings.semanticSearchEnabled) return [];

  await indexRecentMessages(accountId, 80);
  const queryEmbedding = await createEmbeddings([trimmed], {
    settings: settings.embeddings,
    purpose: 'query',
  });
  const rows = MailEmbeddingsRepo.listForAccount(accountId, queryEmbedding.model, 12000);
  return rows
    .map(row => ({
      row,
      score: cosineSimilarity(queryEmbedding.embeddings[0], row.vector),
    }))
    .filter(item => item.score > 0.14)
    .sort((a, b) => b.score - a.score)
    .slice(0, Math.max(1, Math.min(200, limit)))
    .map(item => ({
      threadId: item.row.threadId,
      messageId: item.row.messageId,
      score: Number(item.score.toFixed(4)),
      subject: item.row.subject,
      sender: item.row.sender,
      snippet: item.row.snippet,
      receivedAt: item.row.receivedAt,
    }));
}

export const AgenticService = {
  async processThread(accountId: string, threadId: string): Promise<void> {
    await processThreadInternal(accountId, threadId);
  },

  async processNewMessages(messages: MailMessage[]): Promise<void> {
    const groups = new Map<string, { accountId: string; threadId: string }>();
    for (const message of messages) {
      groups.set(`${message.accountId}:${message.threadId}`, {
        accountId: message.accountId,
        threadId: message.threadId,
      });
    }

    for (const group of groups.values()) {
      await processThreadInternal(group.accountId, group.threadId);
    }
  },

  async runBackgroundPass(maxThreadsPerAccount = 8): Promise<void> {
    for (const account of AccountsRepo.list()) {
      const recentThreads = ThreadsRepo.list(account.email)
        .filter(thread => thread.labelIds.some(label => label.toUpperCase() === 'INBOX'))
        .slice(0, maxThreadsPerAccount);

      for (const thread of recentThreads) {
        await processThreadInternal(account.email, thread.id);
      }

      if (readAgentSettings(account.email).semanticSearchEnabled) {
        await indexRecentMessages(account.email, 30);
      }
    }
  },

  async getThreadInsights(accountId: string, threadId: string): Promise<ThreadAgentInsights> {
    const messages = MessagesRepo.listForThread(accountId, threadId);
    if (messages.length > 0) {
      analyzeThreadMessages(accountId, messages);
    }

    return {
      accountId,
      threadId,
      draftSuggestion: AgentDraftsRepo.getReadyForThread(accountId, threadId),
      securityInsights: MessageSecurityRepo.listForThread(accountId, threadId),
      unsubscribeCandidate: chooseUnsubscribeCandidate(messages),
    };
  },

  async dismissDraftSuggestion(id: string): Promise<void> {
    AgentDraftsRepo.setStatus(id, 'dismissed');
  },

  async markDraftSuggestionApplied(id: string): Promise<void> {
    AgentDraftsRepo.setStatus(id, 'applied');
  },

  async getEmbeddingIndexStatus(accountId: string): Promise<EmbeddingIndexStatus> {
    return getEmbeddingIndexStatusForAccount(accountId);
  },

  async startEmbeddingReindex(accountId: string, options?: EmbeddingIndexReindexOptions): Promise<EmbeddingIndexStatus> {
    return startEmbeddingReindexForAccount(accountId, options);
  },

  async cancelEmbeddingReindex(accountId: string): Promise<EmbeddingIndexStatus> {
    return cancelEmbeddingReindexForAccount(accountId);
  },

  async deleteEmbeddingIndex(accountId: string, model: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> {
    return deleteEmbeddingIndexForAccount(accountId, model);
  },

  async deleteOtherEmbeddingIndexes(accountId: string): Promise<{ deleted: number; status: EmbeddingIndexStatus }> {
    return deleteOtherEmbeddingIndexesForAccount(accountId);
  },

  async searchSemantic(accountId: string, query: string, limit = 60): Promise<SemanticSearchResult[]> {
    return searchSemanticInternal(accountId, query, limit);
  },

  async buildDailyBriefing(accountId: string, options?: DailyBriefingBuildOptions): Promise<DailyBriefing> {
    const runtimeSettings = readAgentSettings(accountId);
    return buildDailyBriefingForAccount({
      accountId,
      options,
      runtimeSettings: {
        semanticSearchEnabled: runtimeSettings.semanticSearchEnabled,
        dailyBriefing: runtimeSettings.dailyBriefing,
      },
      searchSemantic: searchSemanticInternal,
    });
  },

  async testEmbeddingConfig(settings: AIEmbeddingSettings): Promise<{ model: string; dimensions: number; provider: AIEmbeddingSettings['provider'] }> {
    const normalized = normalizeEmbeddingSettings(settings);
    const response = await createEmbeddings(['Dumka Mail semantic search test'], {
      settings: normalized,
      purpose: 'test',
    });
    const vector = response.embeddings[0] || [];
    return {
      model: buildEmbeddingIndexKey(normalized),
      dimensions: vector.length,
      provider: normalized.provider,
    };
  },

  async unsubscribeThread(accountId: string, threadId: string): Promise<{ method: string; archived: boolean }> {
    const messages = MessagesRepo.listForThread(accountId, threadId);
    const candidate = chooseUnsubscribeCandidate(messages);
    if (!candidate?.recommendedMethod) {
      throw new Error('No safe unsubscribe method found for this thread.');
    }

    const method = await performUnsubscribe(accountId, candidate.recommendedMethod);
    ThreadsRepo.updateLabels(accountId, threadId, [], ['INBOX']);
    await GmailSyncService.modifyLabels(accountId, threadId, [], ['INBOX']);
    return { method, archived: true };
  },
};
