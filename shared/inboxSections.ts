// Inbox-as-decision-sections (design-review/SPEC.md §2): the pure pieces the
// renderer needs on top of `shared/decision.ts` — resolving a thread against
// its stored model/user records, section labels, group-action batches, and
// the suggested Later time. No React / Electron imports.
import {
  applyUserCorrection,
  decideByRules,
  isBatchEligible,
  isDecision,
  normalizeDecisionReason,
  isDecisionRecordCurrent,
  resolveThreadDecision,
  type DecisionContext,
  type DecisionEntry,
  type DecisionThread,
} from './decision';
import { isAIProviderUnavailable } from './aiErrors';
import type { AIProviderDescriptor, Decision, ThreadDecision, ThreadDecisionRecord } from './types';

/** Cached decision records of one thread (`thread_decisions` rows, split by source). */
export interface StoredDecisions {
  model?: ThreadDecisionRecord;
  user?: ThreadDecisionRecord;
}

/** `{ [accountId]: { [threadId]: StoredDecisions } }` */
export type ThreadDecisionMap = Record<string, Record<string, StoredDecisions>>;

/** True only when an AI provider is actually configured (not disabled, not missing a key). */
export function hasDecisionModel(descriptor: Pick<AIProviderDescriptor, 'preference' | 'status'> | null | undefined): boolean {
  if (!descriptor) return false;
  return !isAIProviderUnavailable(descriptor);
}

/**
 * Places loaded rows into the per-account map. The table keeps one row per
 * thread and source, so a model row and a user correction coexist.
 */
export function indexDecisionRecords(records: readonly ThreadDecisionRecord[]): Record<string, StoredDecisions> {
  const byThread: Record<string, StoredDecisions> = {};
  for (const record of records) {
    if (record.source !== 'model' && record.source !== 'user') continue;
    const stored = byThread[record.threadId] || (byThread[record.threadId] = {});
    stored[record.source] = record;
  }
  return byThread;
}

/**
 * The thread's decision with the strongest applicable record: a current user
 * correction, else a current model record, else the rules. A correction made
 * on a thread without a known last message id (older cache rows carry no
 * signals) applies while the thread still has no id.
 */
export function resolveInboxDecision(
  thread: DecisionThread,
  context: DecisionContext,
  stored?: StoredDecisions | null,
): ThreadDecision {
  const lastMessageId = thread.signals?.lastMessageId || null;
  const user = stored?.user;
  if (user) {
    if (isDecisionRecordCurrent(user, lastMessageId)) return resolveThreadDecision(thread, context, user);
    if (!user.lastMessageId && !lastMessageId) {
      return applyUserCorrection(decideByRules(thread, context), user.decision, { laterAt: user.laterAt, reason: user.reason });
    }
  }
  return resolveThreadDecision(thread, context, stored?.model || null);
}

/** The `thread_decisions` row for a manual move (`V`). */
export function buildUserCorrection(
  thread: { accountId: string; id: string; signals?: { lastMessageId: string | null } | null },
  decision: Decision,
  options: { now?: Date; laterAt?: string | null } = {},
): ThreadDecisionRecord {
  const now = options.now || new Date();
  return {
    accountId: thread.accountId,
    threadId: thread.id,
    lastMessageId: thread.signals?.lastMessageId || null,
    decision,
    reason: '',
    source: 'user',
    laterAt: decision === 'later' ? (options.laterAt ?? defaultLaterTime(now).toISOString()) : null,
    model: null,
    createdAt: now.toISOString(),
  };
}

const MAX_ID_LENGTH = 512;

function boundedString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH && !value.includes('\0') ? value : null;
}

/**
 * Validates a renderer-supplied correction before it is written. Only
 * `source: 'user'` rows are accepted over IPC; anything malformed is null.
 */
export function normalizeUserDecisionRecord(value: unknown): ThreadDecisionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const accountId = boundedString(raw.accountId);
  const threadId = boundedString(raw.threadId);
  if (!accountId || !threadId || raw.source !== 'user' || !isDecision(raw.decision)) return null;
  const lastMessageId = raw.lastMessageId === null || raw.lastMessageId === undefined ? null : boundedString(raw.lastMessageId);
  if (raw.lastMessageId && !lastMessageId) return null;
  let laterAt: string | null = null;
  if (raw.decision === 'later' && typeof raw.laterAt === 'string') {
    const time = Date.parse(raw.laterAt);
    laterAt = Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  const createdTime = typeof raw.createdAt === 'string' ? Date.parse(raw.createdAt) : NaN;
  return {
    accountId,
    threadId,
    lastMessageId,
    decision: raw.decision,
    reason: typeof raw.reason === 'string' ? normalizeDecisionReason(raw.reason) : '',
    source: 'user',
    laterAt,
    model: null,
    createdAt: Number.isFinite(createdTime) ? new Date(createdTime).toISOString() : new Date().toISOString(),
  };
}

export const SECTION_LABELS: Record<Decision, string> = {
  reply: 'Reply',
  read: 'Read',
  event: 'Event',
  later: 'Later',
  clear: 'Clear',
  unsubscribe: 'Unsubscribe',
  people: 'People',
  automated: 'Automated, not sorted',
};

/** Sections shown as one collapsed row until opened (SPEC §2). */
export const COLLAPSED_BY_DEFAULT: readonly Decision[] = ['clear', 'unsubscribe'];

export function isCollapsibleSection(decision: Decision): boolean {
  return COLLAPSED_BY_DEFAULT.includes(decision);
}

/** Rows in these sections use the two-line layout (second line = reason). */
export function isTwoLineSection(decision: Decision): boolean {
  return decision === 'reply' || decision === 'people';
}

export function threadEntryKey(thread: { accountId: string; id: string }): string {
  return `${thread.accountId.trim().toLowerCase()}:${thread.id}`;
}

// --- Later time ----------------------------------------------------------------

/** Default suggestion for Later: tomorrow 09:00 local time. */
export function defaultLaterTime(now: Date = new Date()): Date {
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 9, 0, 0, 0);
  return next;
}

/** The decision's own `laterAt` when it is a valid future time, else tomorrow 09:00. */
export function laterTimeFor(decision: Pick<ThreadDecision, 'laterAt'>, now: Date = new Date()): Date {
  const suggested = decision.laterAt ? Date.parse(decision.laterAt) : NaN;
  if (Number.isFinite(suggested) && suggested > now.getTime()) return new Date(suggested);
  return defaultLaterTime(now);
}

/** "Tomorrow 09:00" / "Wed 17:00" / "12 Dec 09:00" for chips and section actions. */
export function formatLaterChip(at: Date, now: Date = new Date()): string {
  const time = `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
  const days = Math.round((startOfDay(at) - startOfDay(now)) / (24 * 60 * 60 * 1000));
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Tomorrow ${time}`;
  if (days > 1 && days < 7) return `${at.toLocaleDateString('en-US', { weekday: 'short' })} ${time}`;
  return `${at.getDate()} ${at.toLocaleDateString('en-US', { month: 'short' })} ${time}`;
}

// --- Group batches -------------------------------------------------------------

export interface GroupBatchInput<T extends { lastMessageAt: string; accountId: string; id: string }> {
  entries: readonly DecisionEntry<T>[];
  /** Thread keys captured when the group was opened; `null` = not frozen (every current row). */
  frozenKeys: ReadonlySet<string> | null;
  /** Rows the user unchecked. */
  excludedKeys?: ReadonlySet<string>;
}

/**
 * The rows a group action (`⇧E` on Clear, `⇧H` on Later) acts on. Enforces
 * the safety rules itself, independent of what the UI shows: protected and
 * non-batchable decisions never join, threads that arrived after the group was
 * opened are left out, and unchecked rows are skipped.
 */
export function selectGroupBatch<T extends { lastMessageAt: string; accountId: string; id: string }>(
  input: GroupBatchInput<T>,
): DecisionEntry<T>[] {
  return input.entries.filter(entry => {
    if (!isBatchEligible(entry.decision)) return false;
    const key = threadEntryKey(entry.thread);
    if (input.frozenKeys && !input.frozenKeys.has(key)) return false;
    if (input.excludedKeys?.has(key)) return false;
    return true;
  });
}

/** Unsubscribe review: checked, frozen, never protected, and actually decided `unsubscribe`. */
export function selectUnsubscribeBatch<T extends { lastMessageAt: string; accountId: string; id: string }>(
  input: GroupBatchInput<T>,
): DecisionEntry<T>[] {
  return input.entries.filter(entry => {
    if (entry.decision.protected || entry.decision.decision !== 'unsubscribe') return false;
    const key = threadEntryKey(entry.thread);
    if (input.frozenKeys && !input.frozenKeys.has(key)) return false;
    if (input.excludedKeys?.has(key)) return false;
    return true;
  });
}

export interface LaterPlanItem<T> {
  thread: T;
  at: Date;
}

/** `⇧H`: every eligible Later row with its suggested time. */
export function planLaterBatch<T extends { lastMessageAt: string; accountId: string; id: string }>(
  input: GroupBatchInput<T>,
  now: Date = new Date(),
): LaterPlanItem<T>[] {
  return selectGroupBatch(input)
    .filter(entry => entry.decision.decision === 'later')
    .map(entry => ({ thread: entry.thread, at: laterTimeFor(entry.decision, now) }));
}

/** `⇧E`: every eligible Clear row. */
export function planClearBatch<T extends { lastMessageAt: string; accountId: string; id: string }>(
  input: GroupBatchInput<T>,
): T[] {
  return selectGroupBatch(input)
    .filter(entry => entry.decision.decision === 'clear')
    .map(entry => entry.thread);
}

/** One section action label for the Later header, e.g. "All to tomorrow 09:00". */
export function laterSectionActionLabel(
  entries: readonly DecisionEntry<{ lastMessageAt: string; accountId: string; id: string }>[],
  now: Date = new Date(),
): string {
  const times = new Set(entries.map(entry => laterTimeFor(entry.decision, now).getTime()));
  if (times.size === 1) {
    const [only] = Array.from(times);
    return `All to ${formatLaterChip(new Date(only), now).replace(/^Tomorrow/, 'tomorrow').replace(/^Today/, 'today')}`;
  }
  return 'All to their suggested times';
}

// --- Sender summaries ------------------------------------------------------------

function senderLabel(thread: { senderNames: string[]; senderEmail: string }): string {
  const name = thread.senderNames.find(value => value.trim())?.trim();
  return name || thread.senderEmail || 'Unknown sender';
}

/** "CodeForge 2, Trackline, Status" — distinct senders in first-seen order with counts. */
export function summarizeSenders(threads: readonly { senderNames: string[]; senderEmail: string }[]): string {
  const counts = new Map<string, number>();
  for (const thread of threads) {
    const label = senderLabel(thread);
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return Array.from(counts, ([label, count]) => (count > 1 ? `${label} ${count}` : label)).join(', ');
}

// --- "Prepared for you" ----------------------------------------------------------

export interface PreparedLine {
  decision: Decision;
  count: number;
  text: string;
  /** Key that acts on the section, as shown (`↩` opens the first row). Empty when only a button acts. */
  keys: string[];
}

function many(count: number, one: string, other: string): string {
  return count === 1 ? one : other;
}

/**
 * One line per non-empty section, claiming only what this mode does: without
 * a model there are no drafts, summaries or Later suggestions.
 */
export function preparedLines(
  sections: readonly { decision: Decision; entries: readonly DecisionEntry<{ lastMessageAt: string; accountId: string; id: string; senderEmail: string }>[] }[],
  now: Date = new Date(),
): PreparedLine[] {
  return sections.filter(section => section.entries.length > 0).map(section => {
    const count = section.entries.length;
    switch (section.decision) {
      case 'people':
        return { decision: 'people', count, text: many(count, 'conversation from a person', 'conversations from people'), keys: ['↩'] };
      case 'reply':
        return { decision: 'reply', count, text: many(count, 'conversation waiting for your reply', 'conversations waiting for your reply'), keys: ['↩'] };
      case 'read':
        return { decision: 'read', count, text: many(count, 'message to read, nothing to answer', 'messages to read, nothing to answer'), keys: ['↩'] };
      case 'event':
        return { decision: 'event', count, text: many(count, 'invitation waiting for your answer', 'invitations waiting for your answer'), keys: ['↩'] };
      case 'automated':
        return { decision: 'automated', count, text: many(count, 'automated message, not sorted', 'automated messages, not sorted'), keys: ['↩'] };
      case 'later':
        return {
          decision: 'later',
          count,
          text: `${many(count, 'conversation', 'conversations')} to come back to: ${laterSectionActionLabel(section.entries, now).replace(/^All to /, '')}`,
          keys: ['⇧', 'H'],
        };
      case 'clear':
        return { decision: 'clear', count, text: many(count, 'routine conversation ready to archive', 'routine conversations ready to archive together'), keys: ['⇧', 'E'] };
      case 'unsubscribe': {
        const senders = new Set(section.entries.map(entry => `${entry.thread.accountId}:${entry.thread.senderEmail.toLowerCase()}`)).size;
        return { decision: 'unsubscribe', count: senders, text: many(senders, 'sender you can unsubscribe from, always with a confirmation', 'senders you can unsubscribe from, always with a confirmation'), keys: [] };
      }
    }
  });
}

export const PREPARED_UNTOUCHED_SENTENCE = 'Nothing has changed in Gmail yet.';
export const PREPARED_UNDO_SENTENCE = 'Archiving and Later can be undone with Z. Sending and unsubscribing always ask first.';
