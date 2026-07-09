import type { MailboxDelta, MailThread } from '../../../shared/types';

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
