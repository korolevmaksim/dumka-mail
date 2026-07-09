import crypto from 'crypto';
import {
  DraftsRepo,
  MessagesRepo,
  ReplyPipelineRepo,
  SettingsRepo,
  ThreadsRepo,
} from './database';
import { completeAI, getAIProviderDescriptor } from './ai';
import { buildThreadContext } from '../shared/aiContext';
import { resolveAIModelForPurpose } from '../shared/aiModelPurpose';
import { startReply } from '../shared/compose';
import { buildInitialDraftBodyWithSignature, plainTextToHtmlFragment } from '../shared/draftHtml';
import { planReplyPipelineMessageReplay } from './replyPipelineReplay';
import {
  advanceReplyPipelineForTime,
  canPrepareReplyPipelineDraft,
  detectDraftPlaceholders,
  markReplyPipelineDraftReady,
  markReplyPipelineSent,
  reconcileReplyPipelineCandidate,
  resolveReplyPipelineForInbound,
  snoozeReplyPipelineState,
} from '../shared/replyPipeline';
import type {
  AISettings,
  AppSettings,
  ComposeSettings,
  Draft,
  MailMessage,
  ProfileSettings,
  ReplyPipelineCandidate,
  ReplyPipelineState,
} from '../shared/types';

const DEFAULT_FOLLOW_UP_HOURS = 48;

function nowIso(now = new Date()): string {
  return now.toISOString();
}

function readAppSettings(): Partial<AppSettings> {
  try {
    const raw = SettingsRepo.get('appSettings');
    return raw ? JSON.parse(raw) as Partial<AppSettings> : {};
  } catch {
    return {};
  }
}

function emptyComposeSettings(): ComposeSettings {
  return {
    defaultSignature: '',
    defaultSignatureHtml: '',
    signatureFormat: 'plain',
    signaturesByAccount: {},
    autoSaveDrafts: true,
    spellCheck: true,
    autocorrect: true,
    smartCompose: true,
    alwaysReplyAll: false,
    sendUndoDelay: 10,
    defaultFontSize: 'normal',
  };
}

function emptyProfileSettings(): ProfileSettings {
  return { fullName: '', role: '', company: '', timezone: 'UTC' };
}

function isOutbound(message: MailMessage, accountId: string): boolean {
  const self = accountId.trim().toLowerCase();
  return message.labelIds.some(label => label.toUpperCase() === 'SENT')
    || message.senderEmail.trim().toLowerCase() === self;
}

function latestMessage(messages: MailMessage[]): MailMessage | null {
  return [...messages]
    .filter(message => !message.labelIds.some(label => ['SPAM', 'TRASH'].includes(label.toUpperCase())))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .at(-1) || null;
}

function latestOutboundMessage(messages: MailMessage[], accountId: string): MailMessage | null {
  return [...messages]
    .filter(message => !message.labelIds.some(label => ['SPAM', 'TRASH'].includes(label.toUpperCase())))
    .filter(message => isOutbound(message, accountId))
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .at(-1) || null;
}

function deterministicBody(state: ReplyPipelineState): string {
  return state.sourceKind === 'outbound'
    ? 'Following up on this.'
    : '[Add your reply here]';
}

function aiSettings(settings: Partial<AppSettings>): AISettings | null {
  return settings.ai && typeof settings.ai === 'object' ? settings.ai as AISettings : null;
}

function shouldUseAutomation(settings: Partial<AppSettings>): settings is Partial<AppSettings> & { ai: AISettings } {
  const ai = aiSettings(settings);
  return Boolean(
    ai
    && ai.proactiveDraftsEnabled
    && ai.suggestDrafts
    && ai.allowMailBodyContext
    && ai.provider !== 'disabled'
  );
}

async function generateDraftBody(
  state: ReplyPipelineState,
  messages: MailMessage[],
  settings: Partial<AppSettings>,
): Promise<{ body: string; origin: 'automation' | 'template' }> {
  if (!shouldUseAutomation(settings)) {
    return { body: deterministicBody(state), origin: 'template' };
  }

  const thread = ThreadsRepo.get(state.accountId, state.threadId);
  if (!thread) return { body: deterministicBody(state), origin: 'template' };

  try {
    const overrideModel = resolveAIModelForPurpose('automation', {
      interactiveModel: settings.ai.globalDefaultModel,
      automationModel: settings.ai.automationModel,
    });
    const descriptor = await getAIProviderDescriptor(settings.ai.provider, overrideModel);
    if (descriptor.preference === 'disabled') {
      return { body: deterministicBody(state), origin: 'template' };
    }

    const instruction = state.sourceKind === 'outbound'
      ? 'Write a concise, polite follow-up to the latest sent email. Return only the editable email body. Do not invent facts, recipients, dates, or availability.'
      : 'Write a concise, complete reply to the latest inbound email. Return only the editable email body. Use a short bracketed placeholder when a required fact is unknown.';
    const response = await completeAI({
      action: 'replyPipelineDraft',
      context: buildThreadContext(thread, messages, settings.ai),
      conversationHistory: [],
      userInstruction: instruction,
    }, settings.ai.provider, overrideModel);
    const body = response.text
      .replace(/^subject\s*:\s.*$/gim, '')
      .replace(/^draft\s*:\s*/i, '')
      .trim();
    if (body.length >= 8) return { body, origin: 'automation' };
  } catch (error) {
    console.warn('[Reply Pipeline] Automation draft failed; using template:', error);
  }

  return { body: deterministicBody(state), origin: 'template' };
}

function buildDraft(
  state: ReplyPipelineState,
  source: MailMessage,
  responseBody: string,
  settings: Partial<AppSettings>,
): Draft {
  const seed = startReply(source, state.accountId, settings.compose?.alwaysReplyAll === true);
  const responsePlain = responseBody.trim();
  const combinedPlain = responsePlain ? `${responsePlain}${seed.body}` : seed.body;
  const combinedHtml = `${responsePlain ? plainTextToHtmlFragment(responsePlain) : ''}${seed.bodyHtml || ''}`;
  const body = buildInitialDraftBodyWithSignature(
    combinedPlain,
    settings.compose || emptyComposeSettings(),
    settings.profile || emptyProfileSettings(),
    state.accountId,
    combinedHtml,
  );
  return {
    id: crypto.randomUUID(),
    accountId: state.accountId,
    threadId: state.threadId,
    to: seed.to,
    cc: seed.cc,
    bcc: [],
    subject: seed.subject,
    bodyPlain: body.bodyPlain,
    bodyHtml: body.bodyHtml,
    attachments: [],
    replyMessageId: seed.replyMessageId,
    replyReferences: seed.replyReferences,
    updatedAt: nowIso(),
  };
}

function refreshState(state: ReplyPipelineState, now: Date): ReplyPipelineState {
  let next = advanceReplyPipelineForTime(state, now);
  if (next.status === 'draftReady' && (!next.draftId || !DraftsRepo.get(next.draftId))) {
    next = {
      ...next,
      status: next.sourceKind === 'outbound' ? 'due' : 'needsReply',
      draftId: null,
      draftOrigin: null,
      hasPlaceholders: false,
      updatedAt: nowIso(now),
    };
  }
  return next;
}

export const ReplyPipelineService = {
  reconcileCandidates(candidates: ReplyPipelineCandidate[], at = new Date()): ReplyPipelineState[] {
    const normalized: ReplyPipelineState[] = [];
    for (const candidate of candidates) {
      const current = ReplyPipelineRepo.get(candidate.accountId, candidate.threadId);
      const next = reconcileReplyPipelineCandidate(current, candidate, at);
      if (next) {
        ReplyPipelineRepo.save(next);
        normalized.push(next);
      }
    }
    return normalized;
  },

  list(accountIds: string[], at = new Date()): ReplyPipelineState[] {
    const states = ReplyPipelineRepo.list(accountIds);
    return states.map(state => {
      const next = refreshState(state, at);
      if (next !== state) ReplyPipelineRepo.save(next);
      return next;
    });
  },

  async prepareDraft(accountId: string, threadId: string): Promise<{ state: ReplyPipelineState; draft: Draft; placeholders: string[] }> {
    let current = ReplyPipelineRepo.get(accountId, threadId);
    if (!current) throw new Error('Reply Pipeline item not found.');
    if (!canPrepareReplyPipelineDraft(current)) {
      throw new Error(`Reply Pipeline item is already ${current.status}.`);
    }

    if (current.draftId) {
      const existing = DraftsRepo.get(current.draftId);
      if (existing) {
        const placeholders = detectDraftPlaceholders(existing.bodyPlain, existing.bodyHtml);
        current = ReplyPipelineService.refreshDraftPlaceholders(accountId, existing.id, existing.bodyPlain, existing.bodyHtml) || current;
        return { state: current, draft: existing, placeholders };
      }
    }

    const messages = MessagesRepo.listForThread(accountId, threadId);
    const source = current.sourceKind === 'outbound'
      ? latestOutboundMessage(messages, accountId)
        || messages.find(message => message.id === current.sourceMessageId)
        || latestMessage(messages)
      : messages.find(message => message.id === current.sourceMessageId) || latestMessage(messages);
    if (!source) throw new Error('Reply Pipeline source message is missing from the local cache.');

    const settings = readAppSettings();
    const generated = await generateDraftBody(current, messages, settings);
    const draft = buildDraft(current, source, generated.body, settings);
    const placeholders = detectDraftPlaceholders(draft.bodyPlain, draft.bodyHtml);
    DraftsRepo.save(draft);
    const next = markReplyPipelineDraftReady(current, draft.id, generated.origin, placeholders.length > 0, new Date());
    ReplyPipelineRepo.save(next);
    return { state: next, draft, placeholders };
  },

  refreshDraftPlaceholders(accountId: string, draftId: string, bodyPlain: string, bodyHtml?: string | null): ReplyPipelineState | null {
    const current = ReplyPipelineRepo.findByDraftId(accountId, draftId);
    if (!current) return null;
    const hasPlaceholders = detectDraftPlaceholders(bodyPlain, bodyHtml).length > 0;
    if (current.hasPlaceholders === hasPlaceholders) return null;
    const next = { ...current, hasPlaceholders, updatedAt: nowIso() };
    ReplyPipelineRepo.save(next);
    return next;
  },

  refreshDraftPlaceholdersBestEffort(
    accountId: string,
    draftId: string,
    bodyPlain: string,
    bodyHtml: string | null | undefined,
    logger: Pick<Console, 'error'> = console,
  ): ReplyPipelineState | null {
    try {
      return ReplyPipelineService.refreshDraftPlaceholders(accountId, draftId, bodyPlain, bodyHtml);
    } catch (error) {
      logger.error('[Reply Pipeline] Failed to refresh draft placeholder state:', error);
      return null;
    }
  },

  snooze(accountId: string, threadId: string, untilIso: string): ReplyPipelineState {
    const current = ReplyPipelineRepo.get(accountId, threadId);
    if (!current) throw new Error('Reply Pipeline item not found.');
    const until = new Date(untilIso);
    if (!Number.isFinite(until.getTime()) || until.getTime() <= Date.now()) {
      throw new Error('Snooze time must be in the future.');
    }
    const next = snoozeReplyPipelineState(current, until, new Date());
    ReplyPipelineRepo.save(next);
    return next;
  },

  suppress(accountId: string, threadId: string): ReplyPipelineState {
    const current = ReplyPipelineRepo.get(accountId, threadId);
    if (!current) throw new Error('Reply Pipeline item not found.');
    const next = { ...current, status: 'suppressed' as const, resumeStatus: null, snoozedUntil: null, updatedAt: nowIso() };
    ReplyPipelineRepo.save(next);
    return next;
  },

  resolve(accountId: string, threadId: string, reason = 'Resolved manually.'): ReplyPipelineState {
    const current = ReplyPipelineRepo.get(accountId, threadId);
    if (!current) throw new Error('Reply Pipeline item not found.');
    const at = nowIso();
    const next = { ...current, status: 'resolved' as const, resolvedAt: at, reason, resumeStatus: null, snoozedUntil: null, updatedAt: at };
    ReplyPipelineRepo.save(next);
    return next;
  },

  markSentByDraft(accountId: string, draftId: string, sentAt = new Date()): ReplyPipelineState | null {
    const current = ReplyPipelineRepo.findByDraftId(accountId, draftId);
    if (!current) return null;
    const settings = readAppSettings();
    const threshold = Math.max(1, Math.floor(settings.inbox?.followUpThresholdHours || DEFAULT_FOLLOW_UP_HOURS));
    const next = markReplyPipelineSent(
      current,
      sentAt,
      new Date(sentAt.getTime() + threshold * 3_600_000),
    );
    ReplyPipelineRepo.save(next);
    return next;
  },

  markSentByDraftBestEffort(
    accountId: string,
    draftId: string,
    sentAt = new Date(),
    logger: Pick<Console, 'error'> = console,
  ): ReplyPipelineState | null {
    try {
      return ReplyPipelineService.markSentByDraft(accountId, draftId, sentAt);
    } catch (error) {
      logger.error('[Reply Pipeline] Failed to update lifecycle after confirmed send:', error);
      return null;
    }
  },

  processNewMessages(messages: MailMessage[]): ReplyPipelineState[] {
    const updated: ReplyPipelineState[] = [];
    const events = planReplyPipelineMessageReplay(
      messages,
      (accountId, threadId) => ReplyPipelineRepo.get(accountId, threadId),
      message => isOutbound(message, message.accountId),
    );
    for (const { message, canonicalPendingSend } of events) {
      try {
        const current = ReplyPipelineRepo.get(message.accountId, message.threadId);
        if (!current) continue;
        if (isOutbound(message, message.accountId)) {
          const previousActivityAt = current.status === 'resolved'
            ? current.resolvedAt || current.updatedAt
            : current.status === 'suppressed'
              ? current.updatedAt
              : current.waitingSince || current.sourceReceivedAt;
          const messageAt = Date.parse(message.receivedAt);
          const previousAt = Date.parse(previousActivityAt);
          const canCanonicalizeConfirmedSend = current.sourceMessageId.startsWith('pending-send:')
            && canonicalPendingSend;
          if (!canCanonicalizeConfirmedSend && messageAt <= previousAt) continue;
          const settings = readAppSettings();
          const threshold = Math.max(1, Math.floor(settings.inbox?.followUpThresholdHours || DEFAULT_FOLLOW_UP_HOURS));
          const sentAt = new Date(message.receivedAt);
          const next = {
            ...markReplyPipelineSent(
              current,
              sentAt,
              new Date(sentAt.getTime() + threshold * 3_600_000),
            ),
            sourceMessageId: message.id,
            sourceReceivedAt: message.receivedAt,
            sourceKind: 'outbound' as const,
          };
          ReplyPipelineRepo.save(next);
          updated.push(next);
          continue;
        }
        const next = resolveReplyPipelineForInbound(current, message);
        if (next && next !== current) {
          ReplyPipelineRepo.save(next);
          updated.push(next);
        }
      } catch (error) {
        console.error(`[Reply Pipeline] Failed to reconcile message ${message.id}:`, error);
      }
    }
    return updated;
  },
};
