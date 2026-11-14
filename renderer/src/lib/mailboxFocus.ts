import type { MailboxView } from '../../../shared/types';

/** A different mailbox gets a fresh viewport; sync and classification do not. */
export function mailboxListScopeKey(accountId: string | null | undefined, mailboxView: MailboxView): string {
  return JSON.stringify([accountId || null, mailboxView]);
}

/**
 * Inbox sections own their visual keyboard order. Do not focus the newest
 * chronological thread first: it might be in Clear at the bottom of the list,
 * and the reader's focus-following scroll would jump straight to that group.
 * Flat mailboxes and search results retain their chronological/ranked order.
 */
export function mailboxFocusAfterListUpdate(
  previousId: string | null,
  threads: readonly { id: string }[],
  mailboxView: MailboxView,
  searchQuery: string,
): string | null {
  if (previousId && threads.some(thread => thread.id === previousId)) return previousId;
  if (mailboxView === 'inbox' && !searchQuery.trim()) return null;
  return threads[0]?.id || null;
}
