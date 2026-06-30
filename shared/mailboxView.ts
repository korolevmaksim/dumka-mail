import type { MailboxView, MailThread } from './types';

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

export function isThreadInMailbox(
  thread: Pick<MailThread, 'labelIds' | 'reminderAt'>,
  mailboxView: MailboxView,
  now: Date = new Date(),
): boolean {
  if (mailboxView === 'sent') {
    return threadHasLabel(thread, 'SENT');
  }

  return threadHasLabel(thread, 'INBOX') && !hasFutureReminder(thread, now);
}
