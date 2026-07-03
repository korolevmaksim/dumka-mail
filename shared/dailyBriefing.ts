import type {
  DailyBriefing,
  DailyBriefingAction,
  DailyBriefingCategory,
  DailyBriefingCoverage,
  DailyBriefingItem,
  DailyBriefingSettings,
  MailMessage,
  MailSecurityRiskLevel,
  MailThread,
  MessageSecurityInsight,
} from './types';
import { htmlToText } from './aiContext';
import { MailSignalClassifier } from './classifier';

export const DEFAULT_DAILY_BRIEFING_SETTINGS: DailyBriefingSettings = {
  enabled: true,
  lookbackHours: 24,
  maxItems: 12,
  includeRead: false,
  includeFyi: true,
  includeRiskAndNoise: true,
  useSemanticSearch: true,
  defaultReminderHour: 9,
};

export interface DailyBriefingBuildInput {
  accountId: string;
  threads: MailThread[];
  messagesByThreadId: Record<string, MailMessage[]>;
  securityByThreadId?: Record<string, MessageSecurityInsight[]>;
  semanticScoresByThreadId?: Record<string, number>;
  settings?: Partial<DailyBriefingSettings>;
  semanticSearchEnabled?: boolean;
  bodyContextIncluded?: boolean;
  now?: Date;
  warnings?: string[];
}

interface CandidateItem {
  item: DailyBriefingItem;
  lastMessageAt: number;
}

function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, Math.round(parsed)));
}

export function normalizeDailyBriefingSettings(input?: Partial<DailyBriefingSettings> | null): DailyBriefingSettings {
  return {
    enabled: input?.enabled !== false,
    lookbackHours: clampInteger(input?.lookbackHours, DEFAULT_DAILY_BRIEFING_SETTINGS.lookbackHours, 1, 168),
    maxItems: clampInteger(input?.maxItems, DEFAULT_DAILY_BRIEFING_SETTINGS.maxItems, 3, 40),
    includeRead: input?.includeRead === true,
    includeFyi: input?.includeFyi !== false,
    includeRiskAndNoise: input?.includeRiskAndNoise !== false,
    useSemanticSearch: input?.useSemanticSearch !== false,
    defaultReminderHour: clampInteger(input?.defaultReminderHour, DEFAULT_DAILY_BRIEFING_SETTINGS.defaultReminderHour, 0, 23),
  };
}

function latestMessage(messages: MailMessage[]): MailMessage | null {
  if (messages.length === 0) return null;
  return [...messages]
    .sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt))
    .at(-1) || null;
}

function hasLabel(labels: string[], label: string): boolean {
  const target = label.toUpperCase();
  return labels.some(item => item.toUpperCase() === target);
}

function isInboxThread(thread: MailThread): boolean {
  return hasLabel(thread.labelIds as string[], 'INBOX')
    && !hasLabel(thread.labelIds as string[], 'SPAM')
    && !hasLabel(thread.labelIds as string[], 'TRASH');
}

function bodyText(message: MailMessage): string {
  const plain = (message.bodyPlain || '').trim();
  if (plain) return plain;
  if (message.bodyHtml?.trim()) return htmlToText(message.bodyHtml);
  return message.snippet || '';
}

function compactText(value: string, maxLength: number): string {
  const compacted = value.replace(/\s+/g, ' ').trim();
  if (compacted.length <= maxLength) return compacted;
  return `${compacted.slice(0, Math.max(0, maxLength - 1)).trimEnd()}...`;
}

function firstNameOrSender(message: MailMessage, thread: MailThread): string {
  return message.senderName || thread.senderNames[0] || message.senderEmail || thread.senderEmail;
}

function isInbound(message: MailMessage, accountId: string): boolean {
  return message.senderEmail.trim().toLowerCase() !== accountId.trim().toLowerCase();
}

function isDirectlyAddressed(message: MailMessage, accountId: string): boolean {
  const self = accountId.trim().toLowerCase();
  if (!self) return false;
  return [...(message.to || []), ...(message.cc || [])]
    .some(recipient => recipient.email.trim().toLowerCase() === self);
}

function looksLikeActionRequest(thread: MailThread, message: MailMessage): boolean {
  const text = `${thread.subject} ${thread.snippet} ${bodyText(message).slice(0, 1600)}`.toLowerCase();
  return text.includes('?') ||
    /\b(can|could|would|will)\s+you\b/.test(text) ||
    /\bplease\b/.test(text) ||
    /\blet me know\b/.test(text) ||
    /\bwhat do you think\b/.test(text) ||
    /\bare you available\b/.test(text) ||
    /\bdoes this work\b/.test(text) ||
    /\bneed your\b/.test(text) ||
    /\bwaiting for\b/.test(text) ||
    /\bfollow(?:ing)? up\b/.test(text) ||
    /\bthoughts\b/.test(text) ||
    /\bapprove\b/.test(text) ||
    /\breview\b/.test(text);
}

function worstRiskLevel(insights: MessageSecurityInsight[]): MailSecurityRiskLevel | null {
  if (insights.some(item => item.riskLevel === 'high')) return 'high';
  if (insights.some(item => item.riskLevel === 'medium')) return 'medium';
  if (insights.some(item => item.riskLevel === 'low')) return 'low';
  return null;
}

function riskPriority(risk: MailSecurityRiskLevel | null, trackerCount: number, phishingLinkCount: number): number {
  if (risk === 'high') return 100;
  if (phishingLinkCount > 0) return 94;
  if (risk === 'medium') return 88;
  if (trackerCount > 0) return 66;
  return 0;
}

function suggestedActions(category: DailyBriefingCategory): DailyBriefingAction[] {
  if (category === 'needsReply') return ['openThread', 'draftReply', 'setReminder'];
  if (category === 'waitingOnMe') return ['openThread', 'draftReply', 'setReminder'];
  if (category === 'riskOrNoise') return ['openThread', 'archive', 'applyLabel'];
  return ['openThread', 'archive', 'setReminder'];
}

function categoryTitle(category: DailyBriefingCategory): string {
  if (category === 'needsReply') return 'Needs reply';
  if (category === 'waitingOnMe') return 'Waiting on me';
  if (category === 'riskOrNoise') return 'Risk or noise';
  return 'FYI';
}

function chooseCategory({
  thread,
  message,
  settings,
  semanticScore,
  securityInsights,
  accountId,
  now,
}: {
  thread: MailThread;
  message: MailMessage;
  settings: DailyBriefingSettings;
  semanticScore: number;
  securityInsights: MessageSecurityInsight[];
  accountId: string;
  now: Date;
}): { category: DailyBriefingCategory | null; reason: string; priority: number } {
  const risk = worstRiskLevel(securityInsights);
  const trackerCount = securityInsights.reduce((sum, item) => sum + item.trackerCount, 0);
  const phishingLinkCount = securityInsights.reduce((sum, item) => sum + item.phishingLinkCount, 0);
  const noise = MailSignalClassifier.isLowPriorityAutomation(thread) || MailSignalClassifier.isMarketingAutomation(thread);
  const inbound = isInbound(message, accountId);
  const actionRequest = inbound && looksLikeActionRequest(thread, message);
  const direct = isDirectlyAddressed(message, accountId);
  const important = MailSignalClassifier.isImportantCandidate(thread);
  const ageHours = Math.max(0, (now.getTime() - Date.parse(thread.lastMessageAt)) / 3600000);

  if (settings.includeRiskAndNoise && (risk === 'high' || risk === 'medium' || phishingLinkCount > 0)) {
    return {
      category: 'riskOrNoise',
      reason: risk === 'high' || phishingLinkCount > 0 ? 'Security-sensitive message needs review.' : 'Suspicious or privacy-relevant message.',
      priority: riskPriority(risk, trackerCount, phishingLinkCount),
    };
  }

  if (inbound && (direct || important) && actionRequest && (thread.isUnread || semanticScore >= 0.28)) {
    return {
      category: 'needsReply',
      reason: direct ? 'Direct request appears to need your response.' : 'Important thread appears to need a response.',
      priority: 92 + Math.min(8, Math.round(semanticScore * 10)),
    };
  }

  if (inbound && actionRequest && ageHours >= 8) {
    return {
      category: 'waitingOnMe',
      reason: ageHours >= 24 ? 'Request has been waiting more than a day.' : 'Request has been waiting several hours.',
      priority: 82 + Math.min(10, Math.floor(ageHours / 12)),
    };
  }

  if (settings.includeRiskAndNoise && noise) {
    return {
      category: 'riskOrNoise',
      reason: trackerCount > 0 ? 'Automated or bulk mail with tracking signals.' : 'Automated or low-signal inbox noise.',
      priority: Math.max(52, riskPriority(risk, trackerCount, phishingLinkCount)),
    };
  }

  if (semanticScore >= 0.32 && inbound) {
    return {
      category: actionRequest ? 'needsReply' : 'waitingOnMe',
      reason: 'Semantic briefing search matched this thread.',
      priority: 78 + Math.min(12, Math.round(semanticScore * 20)),
    };
  }

  if (settings.includeFyi && thread.isUnread) {
    return {
      category: 'fyi',
      reason: 'Unread message looks informational.',
      priority: 46 + (important ? 14 : 0),
    };
  }

  if (settings.includeRead && settings.includeFyi && inbound && ageHours <= settings.lookbackHours) {
    return {
      category: 'fyi',
      reason: 'Recent read message included by briefing settings.',
      priority: 32,
    };
  }

  return { category: null, reason: '', priority: 0 };
}

function buildItem(
  thread: MailThread,
  message: MailMessage,
  category: DailyBriefingCategory,
  reason: string,
  priority: number,
  settings: DailyBriefingSettings,
  securityInsights: MessageSecurityInsight[],
  semanticScore: number,
): DailyBriefingItem {
  const sender = firstNameOrSender(message, thread);
  const snippet = compactText(message.snippet || bodyText(message), 220);
  const risk = worstRiskLevel(securityInsights);
  const trackerCount = securityInsights.reduce((sum, item) => sum + item.trackerCount, 0);
  const phishingLinkCount = securityInsights.reduce((sum, item) => sum + item.phishingLinkCount, 0);
  const categoryLabel = categoryTitle(category);
  const semanticNote = settings.useSemanticSearch && semanticScore > 0
    ? ` Semantic match ${semanticScore.toFixed(2)}.`
    : '';

  return {
    id: `daily:${thread.accountId}:${thread.id}:${message.id}`,
    accountId: thread.accountId,
    threadId: thread.id,
    category,
    title: `${categoryLabel}: ${thread.subject || '(no subject)'}`,
    summary: snippet || thread.snippet || '(No preview cached)',
    reason: `${reason}${semanticNote}`.trim(),
    priority: Math.max(1, Math.min(100, Math.round(priority))),
    source: {
      accountId: message.accountId,
      threadId: message.threadId,
      messageId: message.id,
      subject: message.subject || thread.subject,
      sender,
      senderEmail: message.senderEmail,
      snippet,
      receivedAt: message.receivedAt,
      evidence: reason,
    },
    suggestedActions: suggestedActions(category),
    semanticScore: semanticScore > 0 ? Number(semanticScore.toFixed(4)) : null,
    riskLevel: risk,
    trackerCount,
    phishingLinkCount,
    isUnread: thread.isUnread,
    receivedAt: message.receivedAt,
  };
}

export function buildDailyBriefing(input: DailyBriefingBuildInput): DailyBriefing {
  const now = input.now || new Date();
  const settings = normalizeDailyBriefingSettings(input.settings);
  const lookbackMs = settings.lookbackHours * 3600000;
  const sinceMs = now.getTime() - lookbackMs;
  const semanticScores = input.semanticScoresByThreadId || {};
  const securityByThreadId = input.securityByThreadId || {};
  const candidates: CandidateItem[] = [];
  let candidateThreadCount = 0;

  for (const thread of input.threads) {
    if (!isInboxThread(thread)) continue;
    if (!settings.includeRead && !thread.isUnread) {
      const score = semanticScores[thread.id] || 0;
      if (score < 0.32) continue;
    }

    const lastMessageMs = Date.parse(thread.lastMessageAt);
    const withinLookback = Number.isFinite(lastMessageMs) && lastMessageMs >= sinceMs;
    const score = semanticScores[thread.id] || 0;
    if (!withinLookback && !thread.isUnread && score < 0.32) continue;

    candidateThreadCount += 1;

    const messages = input.messagesByThreadId[thread.id] || [];
    const message = latestMessage(messages);
    if (!message) continue;

    const securityInsights = securityByThreadId[thread.id] || [];
    const selected = chooseCategory({
      thread,
      message,
      settings,
      semanticScore: score,
      securityInsights,
      accountId: input.accountId,
      now,
    });
    if (!selected.category) continue;

    const item = buildItem(
      thread,
      message,
      selected.category,
      selected.reason,
      selected.priority,
      settings,
      securityInsights,
      score,
    );
    candidates.push({ item, lastMessageAt: lastMessageMs || 0 });
  }

  const items = candidates
    .sort((a, b) => {
      if (a.item.priority === b.item.priority) return b.lastMessageAt - a.lastMessageAt;
      return b.item.priority - a.item.priority;
    })
    .slice(0, settings.maxItems)
    .map(candidate => candidate.item);

  const generatedAt = now.toISOString();
  const coverage: DailyBriefingCoverage = {
    accountId: input.accountId,
    generatedAt,
    lookbackHours: settings.lookbackHours,
    candidateThreadCount,
    includedItemCount: items.length,
    semanticSearchEnabled: Boolean(input.semanticSearchEnabled && settings.useSemanticSearch),
    semanticMatches: Object.keys(semanticScores).length,
    bodyContextIncluded: input.bodyContextIncluded === true,
    warnings: input.warnings || [],
  };

  return {
    id: `daily:${input.accountId}:${generatedAt}`,
    accountId: input.accountId,
    title: 'Daily Briefing',
    generatedAt,
    items,
    coverage,
    settings,
  };
}
