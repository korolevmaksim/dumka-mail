import type { MailboxView, MailThread } from './types';

export const DUMKA_MUTED_LABEL_NAME = 'Dumka/Muted';

export interface MailboxFilterOptions {
  mutedLabelIdsByAccount?: Readonly<Record<string, readonly string[]>>;
  /** Inputs for the `waiting` mailbox; without them only the thread's own signals count. */
  waiting?: WaitingMailboxOptions;
}

export interface WaitingMailboxOptions {
  /** `accountId:threadId` keys the Follow-up Radar currently reports as awaiting a reply. */
  radarThreadKeys?: ReadonlySet<string>;
  /** A sent conversation older than this is no longer considered waiting (default 30). */
  maxAgeDays?: number;
}

export const DEFAULT_WAITING_MAX_AGE_DAYS = 30;

export type MailboxThread = Pick<MailThread, 'accountId' | 'labelIds' | 'reminderAt'>
  & Partial<Pick<MailThread, 'id' | 'lastMessageAt' | 'signals'>>;

export function waitingThreadKey(accountId: string, threadId: string): string {
  return `${accountId.trim().toLowerCase()}:${threadId}`;
}

function isTrashOrSpam(thread: Pick<MailThread, 'labelIds'>): boolean {
  return threadHasLabel(thread, 'TRASH') || threadHasLabel(thread, 'SPAM');
}

/**
 * Sent conversations still waiting for a reply: what the Follow-up Radar
 * reports, plus any recent thread whose last message the account sent itself
 * (the radar only lists items past its threshold).
 */
export function isWaitingThread(
  thread: MailboxThread,
  now: Date = new Date(),
  options: MailboxFilterOptions = {},
): boolean {
  if (isTrashOrSpam(thread) || isMutedThread(thread, options)) return false;
  const waiting = options.waiting || {};
  if (thread.id && waiting.radarThreadKeys?.has(waitingThreadKey(thread.accountId, thread.id))) return true;
  if (!thread.signals?.fromUser || !threadHasLabel(thread, 'SENT')) return false;
  const lastAt = thread.lastMessageAt ? Date.parse(thread.lastMessageAt) : NaN;
  if (!Number.isFinite(lastAt)) return false;
  const maxAgeDays = waiting.maxAgeDays && waiting.maxAgeDays > 0 ? waiting.maxAgeDays : DEFAULT_WAITING_MAX_AGE_DAYS;
  return now.getTime() - lastAt <= maxAgeDays * 24 * 60 * 60 * 1000;
}

export function threadHasLabel(thread: Pick<MailThread, 'labelIds'>, label: string): boolean {
  const normalized = label.toUpperCase();
  return thread.labelIds.some(labelId => labelId.toUpperCase() === normalized);
}

export function hasFutureReminder(thread: Pick<MailThread, 'reminderAt'>, now: Date = new Date()): boolean {
  if (!thread.reminderAt) return false;

  const reminderTime = Date.parse(thread.reminderAt);
  if (!Number.isFinite(reminderTime)) return false;

  return reminderTime > now.getTime();
}

export function isMutedThread(
  thread: Pick<MailThread, 'accountId' | 'labelIds'>,
  options: MailboxFilterOptions = {},
): boolean {
  const mutedLabelIds = options.mutedLabelIdsByAccount?.[thread.accountId] || [];
  if (mutedLabelIds.length === 0) return false;

  return thread.labelIds.some(labelId => mutedLabelIds.includes(labelId));
}

export function isThreadInMailbox(
  thread: MailboxThread,
  mailboxView: MailboxView,
  now: Date = new Date(),
  options: MailboxFilterOptions = {},
): boolean {
  switch (mailboxView) {
    case 'drafts':
      return false;
    case 'sent':
      return threadHasLabel(thread, 'SENT');
    case 'trash':
      return threadHasLabel(thread, 'TRASH');
    case 'spam':
      return threadHasLabel(thread, 'SPAM');
    case 'muted':
      return isMutedThread(thread, options);
    case 'inbox':
      return threadHasLabel(thread, 'INBOX') && !hasFutureReminder(thread, now) && !isMutedThread(thread, options);
    case 'later':
      // A reminded thread is hidden from the inbox until the reminder is due.
      return hasFutureReminder(thread, now) && !isTrashOrSpam(thread);
    case 'waiting':
      return isWaitingThread(thread, now, options);
    case 'allMail':
      return !isTrashOrSpam(thread);
  }
}
