import type { MailboxDelta, MailMessage, MailThread } from '../../../shared/types';

/**
 * The messages the reader should show after a sync touched the open
 * conversation, or null to leave it as it is. Only a message Gmail deleted
 * for good changes what is shown: `stored` then replaces it. While nothing is
 * stored (the conversation is about to be read again) the reader keeps its
 * messages.
 */
export function readerMessagesAfterSync(shown: MailMessage[], stored: MailMessage[]): MailMessage[] | null {
  if (shown.length === 0 || stored.length === 0) return null;
  const storedIds = new Set(stored.map(message => message.id));
  return shown.every(message => storedIds.has(message.id)) ? null : stored;
}

export function applyDeltaToThreads(threads: MailThread[], delta: MailboxDelta): MailThread[] {
  if (delta.upserts.length === 0 && delta.deletedThreadIds.length === 0) return threads;
  const deleted = new Set(delta.deletedThreadIds);
  const nextByKey = new Map<string, MailThread>();
  for (const thread of threads) {
    if (thread.accountId === delta.accountId && deleted.has(thread.id)) continue;
    nextByKey.set(`${thread.accountId}:${thread.id}`, thread);
  }
  for (const thread of delta.upserts) {
    nextByKey.set(`${thread.accountId}:${thread.id}`, thread);
  }
  return Array.from(nextByKey.values()).sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt));
}
