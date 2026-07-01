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
import { completeAI, createEmbeddings, getAIProviderDescriptor, getEmbeddingModelName } from './ai';
import { GmailSyncService } from './gmail';
import {
  analyzeMessageSecurity,
  parseUnsubscribeCandidate,
  shouldGenerateAgentDraft,
} from '../shared/mailSecurity';
import { buildThreadContext, htmlToText } from '../shared/aiContext';
import { buildEmbeddingIndexKey, normalizeEmbeddingSettings } from '../shared/embeddingProviders';
import { cosineSimilarity, normalizeEmbeddingText, stableTextHash } from '../shared/semantic';
import type {
  AgentDraftSuggestion,
  AgentRulesSettings,
  AIEmbeddingSettings,
  AIProviderPreference,
  AISettings,
  Draft,
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
const activeEmbeddingAccounts = new Set<string>();

function readAgentSettings(): RuntimeAgentSettings {
  try {
    const raw = SettingsRepo.get('appSettings');
    const parsed = raw ? JSON.parse(raw) : {};
    return {
      provider: parsed?.ai?.provider || 'automatic',
      allowMailBodyContext: parsed?.ai?.allowMailBodyContext === true,
      proactiveDraftsEnabled: parsed?.ai?.proactiveDraftsEnabled === true,
      semanticSearchEnabled: parsed?.ai?.semanticSearchEnabled === true,
      embeddings: normalizeEmbeddingSettings(parsed?.ai?.embeddings),
      agentRules: normalizeAgentRules(parsed?.ai?.agentRules),
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
    embeddings: settings.embeddings,
    agentRules: settings.agentRules,
    suggestDrafts: settings.suggestDrafts,
    suggestAutoArchive: true,
    suggestLabels: true,
    translationEnabled: true,
    personalizationNotes: settings.personalizationNotes,
  };
}

async function generateDraftForThread(thread: MailThread, messages: MailMessage[]): Promise<AgentDraftSuggestion | null> {
  const settings = readAgentSettings();
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
  if (activeEmbeddingAccounts.has(accountId)) return 0;
  activeEmbeddingAccounts.add(accountId);

  try {
    const settings = readAgentSettings().embeddings;
    const model = await getEmbeddingModelName(settings);
    const indexedHashes = MailEmbeddingsRepo.indexedHashes(accountId, model);
    const candidates = MessagesRepo.listRecent(accountId, maxMessages * 3)
      .map(message => ({ message, text: buildEmbeddingText(message) }))
      .filter(item => item.text.length >= 20)
      .map(item => ({ ...item, textHash: stableTextHash(item.text) }))
      .filter(item => indexedHashes[item.message.id] !== item.textHash)
      .slice(0, maxMessages);

    if (candidates.length === 0) return 0;

    const batchSize = 16;
    let indexed = 0;
    for (let index = 0; index < candidates.length; index += batchSize) {
      const batch = candidates.slice(index, index + batchSize);
      const response = await createEmbeddings(batch.map(item => item.text), {
        settings,
        purpose: 'document',
      });
      const now = new Date().toISOString();
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
        indexedAt: now,
      })));
      indexed += batch.length;
    }

    return indexed;
  } catch (err) {
    console.warn('[Agentic] Semantic indexing skipped:', err);
    return 0;
  } finally {
    activeEmbeddingAccounts.delete(accountId);
  }
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

      if (readAgentSettings().semanticSearchEnabled) {
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

  async searchSemantic(accountId: string, query: string, limit = 60): Promise<SemanticSearchResult[]> {
    const trimmed = normalizeEmbeddingText(query, 1000);
    if (!trimmed) return [];
    const settings = readAgentSettings();
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
