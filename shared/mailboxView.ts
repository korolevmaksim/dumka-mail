import type { MailboxView, MailThread } from './types';

export const DUMKA_MUTED_LABEL_NAME = 'Dumka/Muted';

export interface MailboxFilterOptions {
  mutedLabelIdsByAccount?: Readonly<Record<string, readonly string[]>>;
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
  thread: Pick<MailThread, 'accountId' | 'labelIds' | 'reminderAt'>,
  mailboxView: MailboxView,
  now: Date = new Date(),
  options: MailboxFilterOptions = {},
): boolean {
  switch (mailboxView) {
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
  }
}
