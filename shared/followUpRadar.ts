import type {
  AccountID,
  FollowUpRadarItem,
  FollowUpRadarResult,
  FollowUpRadarState,
  MailMessage,
  MailThread,
  MessageID,
  ThreadID,
} from './types';

export interface FollowUpThreadInput {
  thread: MailThread;
  messages: MailMessage[];
}

export interface BuildFollowUpRadarItemInput extends FollowUpThreadInput {
  accountId: AccountID;
  now: Date;
  state?: FollowUpRadarState | null;
  thresholdHours?: number;
  /** Maximum age in hours; outbound messages older than this are excluded. */
  maxAgeHours?: number;
}

export interface BuildFollowUpRadarResultInput {
  accountId: AccountID;
  threadsWithMessages: FollowUpThreadInput[];
  states?: FollowUpRadarState[];
  now: Date;
  thresholdHours?: number;
  maxAgeHours?: number;
  maxItems?: number;
}

/** Default minimum wait before a sent thread is a follow-up candidate (2 days). */
export const DEFAULT_FOLLOW_UP_THRESHOLD_HOURS = 48;
/** Default lookback window: only sent mail from the last 30 days. */
export const DEFAULT_FOLLOW_UP_MAX_AGE_DAYS = 30;
export const DEFAULT_FOLLOW_UP_MAX_AGE_HOURS = DEFAULT_FOLLOW_UP_MAX_AGE_DAYS * 24;
const DEFAULT_THRESHOLD_HOURS = DEFAULT_FOLLOW_UP_THRESHOLD_HOURS;
const DEFAULT_MAX_AGE_HOURS = DEFAULT_FOLLOW_UP_MAX_AGE_HOURS;
const DEFAULT_MAX_ITEMS = 12;

function positiveHours(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.floor(n);
}

/** Clamp / normalize the radar age window. Ensures maxAge is always >= threshold. */
export function normalizeFollowUpAgeWindow(
  thresholdHours: number = DEFAULT_THRESHOLD_HOURS,
  maxAgeHours: number = DEFAULT_MAX_AGE_HOURS,
): { thresholdHours: number; maxAgeHours: number } {
  const safeThreshold = Math.max(1, Math.min(720, positiveHours(thresholdHours, DEFAULT_THRESHOLD_HOURS)));
  // Allow up to 2 years of lookback if the user really wants archaeology.
  const rawMax = Math.max(1, Math.min(24 * 365 * 2, positiveHours(maxAgeHours, DEFAULT_MAX_AGE_HOURS)));
  // Max age must be at least the threshold, otherwise the window is empty.
  const safeMax = Math.max(safeThreshold, rawMax);
  return { thresholdHours: safeThreshold, maxAgeHours: safeMax };
}
const ACTIVE_EXCLUDED_LABELS = new Set(['TRASH', 'SPAM']);
const ASK_TERMS = [
  'following up',
  'follow up',
  'checking in',
  'can you',
  'could you',
  'please',
  'let me know',
  'what do you think',
  'any update',
  'next step',
  '?',
];
const BULK_TERMS = ['newsletter', 'digest', 'notification', 'receipt', 'invoice'];

function hasLabel(message: Pick<MailMessage, 'labelIds'>, label: string): boolean {
  return message.labelIds.some(item => item.toUpperCase() === label);
}

function isActiveMessage(message: MailMessage): boolean {
  return !message.labelIds.some(label => ACTIVE_EXCLUDED_LABELS.has(label.toUpperCase()));
}

function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isNoReplyAddress(value: string): boolean {
  const normalized = normalizeEmail(value);
  return /(^|[._-])(no-?reply|donotreply|do-not-reply)([._-]|@)/.test(normalized);
}

function isOutbound(message: MailMessage, accountId: AccountID): boolean {
  return hasLabel(message, 'SENT') || normalizeEmail(message.senderEmail) === normalizeEmail(accountId);
}

function textHasAnyTerm(value: string, terms: readonly string[]): boolean {
  const normalized = value.toLowerCase();
  return terms.some(term => normalized.includes(term));
}

function sortedMessages(messages: MailMessage[]): MailMessage[] {
  return [...messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt));
}

function externalRecipients(message: MailMessage, accountId: AccountID) {
  const account = normalizeEmail(accountId);
  return [...message.to, ...message.cc, ...message.bcc]
    .filter(recipient => {
      const email = normalizeEmail(recipient.email);
      return Boolean(email) && email !== account;
    });
}

function recipientLine(message: MailMessage, accountId: AccountID): string {
  const recipients = externalRecipients(message, accountId);
  if (recipients.length === 0) return 'No external recipients';
  return recipients
    .slice(0, 3)
    .map(recipient => recipient.name ? `${recipient.name} <${recipient.email}>` : recipient.email)
    .join(', ') + (recipients.length > 3 ? ` +${recipients.length - 3}` : '');
}

function stateIsHidden(state: FollowUpRadarState | null | undefined, now: Date): boolean {
  if (!state) return false;
  if (state.status === 'dismissed') return true;
  if (state.status === 'snoozed') {
    const until = state.snoozedUntil ? Date.parse(state.snoozedUntil) : Number.NaN;
    return Number.isFinite(until) && until > now.getTime();
  }
  return false;
}

function priorityFor(message: MailMessage, previousInbound: MailMessage | null, ageHours: number, accountId: AccountID): { priority: number; reason: string } {
  let priority = 60;
  const reasons: string[] = [];
  const ageDays = ageHours / 24;

  if (ageDays >= 10) {
    priority += 20;
    reasons.push('waiting more than 10 days');
  } else if (ageDays >= 5) {
    priority += 10;
    reasons.push('waiting more than 5 days');
  } else {
    reasons.push(`waiting ${Math.floor(ageHours)}h`);
  }

  const sentText = `${message.subject} ${message.snippet} ${message.bodyPlain || ''}`;
  if (textHasAnyTerm(sentText, ASK_TERMS)) {
    priority += 10;
    reasons.push('sent message asks for a response');
  }

  if (previousInbound) {
    const inboundText = `${previousInbound.subject} ${previousInbound.snippet} ${previousInbound.bodyPlain || ''}`;
    if (textHasAnyTerm(inboundText, ASK_TERMS)) {
      priority += 10;
      reasons.push('previous inbound message looked actionable');
    }
  }

  const recipients = externalRecipients(message, accountId);
  if (recipients.some(recipient => isNoReplyAddress(recipient.email)) || textHasAnyTerm(sentText, BULK_TERMS)) {
    priority -= 20;
    reasons.push('bulk-looking recipient or subject');
  }

  return {
    priority: Math.max(1, Math.min(100, Math.round(priority))),
    reason: reasons.join('; '),
  };
}

export function followUpStateKey(accountId: AccountID, threadId: ThreadID, sentMessageId: MessageID): string {
  return `${normalizeEmail(accountId)}:${threadId}:${sentMessageId}`;
}

export function buildFollowUpRadarItem({
  thread,
  messages,
  accountId,
  now,
  state,
  thresholdHours = DEFAULT_THRESHOLD_HOURS,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
}: BuildFollowUpRadarItemInput): FollowUpRadarItem | null {
  if (!thread.labelIds.some(label => label.toUpperCase() === 'SENT')) return null;
  const timeline = sortedMessages(messages).filter(isActiveMessage);
  if (timeline.length === 0) return null;

  const latest = timeline[timeline.length - 1];
  if (!isOutbound(latest, accountId)) return null;
  if (externalRecipients(latest, accountId).length === 0) return null;
  if (stateIsHidden(state, now)) return null;

  const ageWindow = normalizeFollowUpAgeWindow(thresholdHours, maxAgeHours);
  const ageHours = Math.max(0, (now.getTime() - Date.parse(latest.receivedAt)) / 3_600_000);
  if (ageHours < ageWindow.thresholdHours) return null;
  if (ageHours > ageWindow.maxAgeHours) return null;

  const latestIndex = timeline.length - 1;
  const previousInbound = [...timeline.slice(0, latestIndex)]
    .reverse()
    .find(message => !isOutbound(message, accountId)) || null;
  const scored = priorityFor(latest, previousInbound, ageHours, accountId);

  return {
    id: followUpStateKey(accountId, thread.id, latest.id),
    accountId,
    threadId: thread.id,
    sentMessageId: latest.id,
    subject: thread.subject || latest.subject || '(No subject)',
    recipientLine: recipientLine(latest, accountId),
    lastSentAt: latest.receivedAt,
    ageHours: Math.round(ageHours * 10) / 10,
    priority: scored.priority,
    reason: scored.reason,
    snippet: latest.snippet || latest.bodyPlain || thread.snippet,
    thread,
    sentMessage: latest,
  };
}

export function buildFollowUpRadarResult({
  accountId,
  threadsWithMessages,
  states = [],
  now,
  thresholdHours = DEFAULT_THRESHOLD_HOURS,
  maxAgeHours = DEFAULT_MAX_AGE_HOURS,
  maxItems = DEFAULT_MAX_ITEMS,
}: BuildFollowUpRadarResultInput): FollowUpRadarResult {
  const ageWindow = normalizeFollowUpAgeWindow(thresholdHours, maxAgeHours);
  const stateByKey = new Map(states.map(state => [
    followUpStateKey(state.accountId, state.threadId, state.sentMessageId),
    state,
  ]));

  const items = threadsWithMessages
    .map(input => buildFollowUpRadarItem({
      ...input,
      accountId,
      now,
      thresholdHours: ageWindow.thresholdHours,
      maxAgeHours: ageWindow.maxAgeHours,
      state: stateByKey.get(followUpStateKey(accountId, input.thread.id, sortedMessages(input.messages).filter(isActiveMessage).at(-1)?.id || '')),
    }))
    .filter((item): item is FollowUpRadarItem => Boolean(item))
    .sort((a, b) => {
      if (a.priority === b.priority) return Date.parse(b.lastSentAt) - Date.parse(a.lastSentAt);
      return b.priority - a.priority;
    });

  return {
    accountId,
    generatedAt: now.toISOString(),
    scannedThreadCount: threadsWithMessages.length,
    candidateCount: items.length,
    items: items.slice(0, Math.max(0, maxItems)),
    warnings: ['Follow-up Radar uses locally cached sent mail. Open Sent or sync mail to improve coverage.'],
  };
}
