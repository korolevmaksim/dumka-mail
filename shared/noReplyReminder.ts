// "Remind me if no reply" in the reply dock. On send the thread gets an
// ordinary reminder (the same mechanism as `H`); a watch entry remembers it so
// the renderer can clear that reminder once someone else replies.
import type { MailThread } from './types';

export const NO_REPLY_REMINDER_DAY_OPTIONS = [1, 2, 3, 5, 7] as const;
export const DEFAULT_NO_REPLY_REMINDER_DAYS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function noReplyReminderAt(now: Date, days: number): Date {
  const safeDays = Number.isFinite(days) && days > 0 ? days : DEFAULT_NO_REPLY_REMINDER_DAYS;
  return new Date(now.getTime() + safeDays * DAY_MS);
}

export function noReplyDaysLabel(days: number): string {
  return days === 1 ? '1 day' : `${days} days`;
}

export interface NoReplyWatch {
  accountId: string;
  threadId: string;
  /** When the user pressed Send. */
  sentAt: string;
  remindAt: string;
}

export type NoReplyWatchVerdict = 'keep' | 'clear' | 'drop';

function time(value: string | null | undefined): number {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function lastMessageFromSomeoneElse(thread: Pick<MailThread, 'signals' | 'senderEmail' | 'accountId'>): boolean {
  if (thread.signals) return !thread.signals.fromUser;
  return thread.senderEmail.trim().toLowerCase() !== thread.accountId.trim().toLowerCase();
}

/**
 * `clear`: a reply arrived after the send, remove the reminder.
 * `drop`: the reminder already fired or was changed by the user, stop watching.
 * `keep`: nothing to do yet (also when the thread is not loaded).
 */
export function evaluateNoReplyWatch(
  watch: NoReplyWatch,
  thread: Pick<MailThread, 'signals' | 'senderEmail' | 'accountId' | 'lastMessageAt' | 'reminderAt'> | null | undefined,
  now: Date = new Date(),
): NoReplyWatchVerdict {
  const remindAt = time(watch.remindAt);
  if (!Number.isFinite(remindAt) || now.getTime() >= remindAt) return 'drop';
  if (!thread) return 'keep';
  if (thread.reminderAt) {
    const current = time(thread.reminderAt);
    if (Number.isFinite(current) && Math.abs(current - remindAt) > 60_000) return 'drop';
  }
  const sentAt = time(watch.sentAt);
  const lastAt = time(thread.lastMessageAt);
  if (Number.isFinite(sentAt) && Number.isFinite(lastAt) && lastAt > sentAt && lastMessageFromSomeoneElse(thread)) {
    return 'clear';
  }
  return 'keep';
}

export function parseNoReplyWatches(raw: unknown): NoReplyWatch[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((entry): entry is NoReplyWatch => (
    Boolean(entry)
    && typeof entry === 'object'
    && typeof (entry as NoReplyWatch).accountId === 'string'
    && typeof (entry as NoReplyWatch).threadId === 'string'
    && typeof (entry as NoReplyWatch).sentAt === 'string'
    && typeof (entry as NoReplyWatch).remindAt === 'string'
  ));
}

/** Adds or replaces the watch for the same thread. */
export function upsertNoReplyWatch(watches: readonly NoReplyWatch[], next: NoReplyWatch): NoReplyWatch[] {
  return [
    ...watches.filter(entry => !(entry.accountId === next.accountId && entry.threadId === next.threadId)),
    next,
  ];
}
