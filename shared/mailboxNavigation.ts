import type { MailboxView } from './types';

export const MAILBOX_VIEW_ORDER: MailboxView[] = ['inbox', 'drafts', 'sent', 'trash', 'spam', 'muted'];

export const MAILBOX_VIEW_LABELS: Record<MailboxView, string> = {
  inbox: 'Inbox',
  drafts: 'Drafts',
  sent: 'Sent',
  trash: 'Trash',
  spam: 'Spam',
  muted: 'Muted',
};

export function nextMailboxView(current: MailboxView, direction: 1 | -1 = 1): MailboxView {
  const currentIndex = MAILBOX_VIEW_ORDER.indexOf(current);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (safeIndex + direction + MAILBOX_VIEW_ORDER.length) % MAILBOX_VIEW_ORDER.length;
  return MAILBOX_VIEW_ORDER[nextIndex];
}
