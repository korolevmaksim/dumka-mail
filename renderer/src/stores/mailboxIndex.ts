import type { MailboxView, MailThread, TabCategory } from '../../../shared/types';
import { isThreadInMailbox } from '../../../shared/mailboxView';

const INDEXED_MAILBOXES = ['inbox', 'sent', 'trash', 'spam', 'muted'] as const;
type IndexedMailbox = typeof INDEXED_MAILBOXES[number];

export interface MailboxIndex {
  categoryByThreadKey: Map<string, string>;
  inboxBySplit: Map<string, MailThread[]>;
  mailboxThreads: Record<IndexedMailbox, MailThread[]>;
  splitCounts: Record<string, number>;
  mailboxCounts: Record<MailboxView, number>;
}

interface BuildMailboxIndexInput {
  threads: MailThread[];
  tabCategories: TabCategory[];
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>;
  getThreadCategory: (thread: MailThread) => string;
  isCancelled?: () => boolean;
  yieldToUI?: () => Promise<void>;
  sliceMs?: number;
  nowMs?: () => number;
}

function threadKey(thread: Pick<MailThread, 'accountId' | 'id'>): string {
  return `${thread.accountId}:${thread.id}`;
}

function defaultYieldToUI(): Promise<void> {
  return new Promise(resolve => {
    if (typeof globalThis.requestAnimationFrame === 'function') {
      globalThis.requestAnimationFrame(() => resolve());
      return;
    }
    globalThis.setTimeout(resolve, 0);
  });
}

export async function buildMailboxIndexCooperatively({
  threads,
  tabCategories,
  mutedLabelIdsByAccount,
  getThreadCategory,
  isCancelled = () => false,
  yieldToUI = defaultYieldToUI,
  sliceMs = 8,
  nowMs = () => performance.now(),
}: BuildMailboxIndexInput): Promise<MailboxIndex | null> {
  const categoryByThreadKey = new Map<string, string>();
  const inboxBySplit = new Map<string, MailThread[]>();
  const mailboxThreads: Record<IndexedMailbox, MailThread[]> = {
    inbox: [],
    sent: [],
    trash: [],
    spam: [],
    muted: [],
  };
  const splitCounts: Record<string, number> = {};
  const mailboxCounts: Record<MailboxView, number> = {
    inbox: 0,
    drafts: 0,
    sent: 0,
    trash: 0,
    spam: 0,
    muted: 0,
  };
  for (const category of tabCategories) {
    splitCounts[category.id] = 0;
  }

  const now = new Date();
  let sliceStartedAt = nowMs();
  for (let index = 0; index < threads.length; index += 1) {
    if (isCancelled()) return null;
    const thread = threads[index];

    for (const mailbox of INDEXED_MAILBOXES) {
      if (!isThreadInMailbox(thread, mailbox, now, { mutedLabelIdsByAccount })) continue;
      mailboxThreads[mailbox].push(thread);
      mailboxCounts[mailbox] += 1;
    }

    const category = getThreadCategory(thread);
    categoryByThreadKey.set(threadKey(thread), category);
    if (mailboxThreads.inbox[mailboxThreads.inbox.length - 1] === thread) {
      const bucket = inboxBySplit.get(category) || [];
      bucket.push(thread);
      inboxBySplit.set(category, bucket);
      splitCounts[category] = (splitCounts[category] || 0) + 1;
    }

    if (index + 1 < threads.length && nowMs() - sliceStartedAt >= Math.max(1, sliceMs)) {
      await yieldToUI();
      if (isCancelled()) return null;
      sliceStartedAt = nowMs();
    }
  }

  return {
    categoryByThreadKey,
    inboxBySplit,
    mailboxThreads,
    splitCounts,
    mailboxCounts,
  };
}

export function threadsForMailboxIndex(
  index: MailboxIndex,
  mailboxView: MailboxView,
  activeSplit: string,
): MailThread[] {
  if (mailboxView === 'drafts') return [];
  if (mailboxView === 'inbox') return index.inboxBySplit.get(activeSplit) || [];
  return index.mailboxThreads[mailboxView];
}

export function categoryFromMailboxIndex(index: MailboxIndex, thread: MailThread): string | undefined {
  return index.categoryByThreadKey.get(threadKey(thread));
}

function withoutThread(threads: MailThread[], key: string): MailThread[] {
  return threads.filter(thread => threadKey(thread) !== key);
}

function insertByRecency(threads: MailThread[], thread: MailThread): MailThread[] {
  const next = [...threads, thread];
  next.sort((left, right) => Date.parse(right.lastMessageAt) - Date.parse(left.lastMessageAt));
  return next;
}

export function replaceThreadInMailboxIndex({
  index,
  previousThread,
  nextThread,
  tabCategories,
  mutedLabelIdsByAccount,
  getThreadCategory,
}: {
  index: MailboxIndex;
  previousThread: MailThread;
  nextThread: MailThread;
  tabCategories: TabCategory[];
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>;
  getThreadCategory: (thread: MailThread) => string;
}): MailboxIndex {
  const key = threadKey(previousThread);
  const mailboxThreads: Record<IndexedMailbox, MailThread[]> = {
    inbox: withoutThread(index.mailboxThreads.inbox, key),
    sent: withoutThread(index.mailboxThreads.sent, key),
    trash: withoutThread(index.mailboxThreads.trash, key),
    spam: withoutThread(index.mailboxThreads.spam, key),
    muted: withoutThread(index.mailboxThreads.muted, key),
  };
  const inboxBySplit = new Map<string, MailThread[]>();
  for (const [category, threads] of index.inboxBySplit) {
    inboxBySplit.set(category, withoutThread(threads, key));
  }

  const categoryByThreadKey = new Map(index.categoryByThreadKey);
  categoryByThreadKey.delete(key);
  const now = new Date();
  for (const mailbox of INDEXED_MAILBOXES) {
    if (isThreadInMailbox(nextThread, mailbox, now, { mutedLabelIdsByAccount })) {
      mailboxThreads[mailbox] = insertByRecency(mailboxThreads[mailbox], nextThread);
    }
  }

  const category = getThreadCategory(nextThread);
  categoryByThreadKey.set(threadKey(nextThread), category);
  if (mailboxThreads.inbox.some(thread => threadKey(thread) === threadKey(nextThread))) {
    inboxBySplit.set(category, insertByRecency(inboxBySplit.get(category) || [], nextThread));
  }

  const splitCounts: Record<string, number> = {};
  for (const tab of tabCategories) splitCounts[tab.id] = 0;
  for (const [categoryId, threads] of inboxBySplit) splitCounts[categoryId] = threads.length;

  return {
    categoryByThreadKey,
    inboxBySplit,
    mailboxThreads,
    splitCounts,
    mailboxCounts: {
      inbox: mailboxThreads.inbox.length,
      drafts: index.mailboxCounts.drafts,
      sent: mailboxThreads.sent.length,
      trash: mailboxThreads.trash.length,
      spam: mailboxThreads.spam.length,
      muted: mailboxThreads.muted.length,
    },
  };
}
