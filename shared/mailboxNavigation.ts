import type { MailboxView } from './types';

/** Mailbox switcher order (design-review/SPEC.md §2). */
export const MAILBOX_VIEW_ORDER: MailboxView[] = ['inbox', 'later', 'waiting', 'drafts', 'sent', 'allMail', 'trash', 'spam', 'muted'];

export const MAILBOX_VIEW_LABELS: Record<MailboxView, string> = {
  inbox: 'Inbox',
  later: 'Later',
  waiting: 'Waiting',
  drafts: 'Drafts',
  sent: 'Sent',
  allMail: 'All mail',
  trash: 'Trash',
  spam: 'Spam',
  muted: 'Muted',
};

export function emptyMailboxCounts(): Record<MailboxView, number> {
  return { inbox: 0, later: 0, waiting: 0, drafts: 0, sent: 0, allMail: 0, trash: 0, spam: 0, muted: 0 };
}

export function nextMailboxView(current: MailboxView, direction: 1 | -1 = 1): MailboxView {
  const currentIndex = MAILBOX_VIEW_ORDER.indexOf(current);
  const safeIndex = currentIndex === -1 ? 0 : currentIndex;
  const nextIndex = (safeIndex + direction + MAILBOX_VIEW_ORDER.length) % MAILBOX_VIEW_ORDER.length;
  return MAILBOX_VIEW_ORDER[nextIndex];
}
