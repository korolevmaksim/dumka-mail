import type { MailThread, MailTriagePlan, MailTriagePlanItem, TriageRecommendation } from './types';
import { AutomationRulePreviewBuilder } from './triagePlanner';

const RECOMMENDATIONS = new Set<TriageRecommendation>([
  'reply',
  'reviewAttachment',
  'readNow',
  'setReminder',
  'markDoneCandidate',
]);

export function buildAITriageContext(threads: MailThread[]): string {
  return threads.slice(0, 24).map((thread, index) => {
    const labels = thread.labelIds.length > 0 ? thread.labelIds.join(',') : 'none';
    return [
      `${index + 1}. threadId=${thread.id}`,
      `subject=${thread.subject || '(no subject)'}`,
      `sender=${thread.senderNames[0] || thread.senderEmail}`,
      `senderEmail=${thread.senderEmail}`,
      `snippet=${thread.snippet || ''}`,
      `lastMessageAt=${thread.lastMessageAt}`,
      `isUnread=${thread.isUnread}`,
      `hasAttachments=${thread.hasAttachments}`,
      `labels=${labels}`,
    ].join('\n');
  }).join('\n\n');
}

export function buildAITriageInstruction(intent: MailTriagePlan['intent']): string {
  const focus = intent === 'automationCleanup'
    ? 'Prioritize low-signal automation, notifications, digests, receipts, security codes, and cleanup candidates.'
    : 'Prioritize messages that need user attention, replies, attachment review, reminders, or quick read/archive decisions.';

  return `${focus}
Return JSON only, with this exact shape:
{"items":[{"threadId":"...","recommendation":"reply|reviewAttachment|readNow|setReminder|markDoneCandidate","reason":"short human reason","priority":1-100}]}
Use only threadId values from the provided context. Include at most 8 items. Do not include markdown, prose, or extra keys.`;
}

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim();
  const withoutFence = trimmed
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();
  const start = withoutFence.indexOf('{');
  const end = withoutFence.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('AI triage response did not contain a JSON object.');
  }
  return JSON.parse(withoutFence.slice(start, end + 1));
}

function normalizePriority(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(100, Math.round(parsed)));
}

export function parseAITriagePlanItems(responseText: string, threads: MailThread[]): MailTriagePlanItem[] {
  const parsed = extractJsonObject(responseText) as { items?: unknown };
  if (!Array.isArray(parsed.items)) {
    throw new Error('AI triage response did not include an items array.');
  }

  const threadsById = new Map(threads.map(thread => [thread.id, thread]));
  const seen = new Set<string>();
  const items: MailTriagePlanItem[] = [];

  for (const raw of parsed.items) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const threadId = typeof item.threadId === 'string' ? item.threadId : '';
    const thread = threadsById.get(threadId);
    if (!thread || seen.has(threadId)) continue;

    const recommendation = typeof item.recommendation === 'string' && RECOMMENDATIONS.has(item.recommendation as TriageRecommendation)
      ? item.recommendation as TriageRecommendation
      : null;
    if (!recommendation) continue;

    const reason = typeof item.reason === 'string' && item.reason.trim()
      ? item.reason.trim().slice(0, 180)
      : 'AI triage recommendation';

    seen.add(threadId);
    items.push({
      threadId,
      subject: thread.subject,
      sender: thread.senderNames[0] || thread.senderEmail,
      recommendation,
      reason,
      priority: normalizePriority(item.priority, 50),
      automationRuleIds: AutomationRulePreviewBuilder.matchingRuleIds(thread),
    });
  }

  if (items.length === 0) {
    throw new Error('AI triage response did not contain valid thread recommendations.');
  }

  return items
    .sort((a, b) => b.priority - a.priority)
    .slice(0, 8);
}

export function buildAITriagePlanFromResponse({
  accountId,
  sourceTitle,
  generatedAt,
  sourceThreadCount,
  intent,
  automationRulePreview,
  responseText,
  threads,
}: {
  accountId: string;
  sourceTitle: string;
  generatedAt: string;
  sourceThreadCount: number;
  intent: MailTriagePlan['intent'];
  automationRulePreview: MailTriagePlan['automationRulePreview'];
  responseText: string;
  threads: MailThread[];
}): MailTriagePlan {
  return {
    accountId,
    sourceTitle,
    generatedAt,
    sourceThreadCount,
    items: parseAITriagePlanItems(responseText, threads),
    intent,
    automationRulePreview,
  };
}
