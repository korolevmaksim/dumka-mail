import type { MailLabelDefinition, MailThread, TabCategory, MailboxView } from '../../../shared/types';
import type { SplitInboxKind } from '../../../shared/classifier';
import { isThreadInMailbox } from '../../../shared/mailboxView';
import { threadMatchesLabelSearchQuery } from '../../../shared/labels';
import { matchesSearchDateRange, parseSearchQuery } from '../../../shared/search';
import type { ThreadSearchMatch } from './mailSearchHelpers';

export const DEFAULT_THREAD_FILTER_BATCH_SIZE = 100;

const MAILBOX_SEARCH_ALIASES: Record<string, MailboxView> = {
  inbox: 'inbox',
  sent: 'sent',
  trash: 'trash',
  spam: 'spam',
  muted: 'muted',
};

function normalizeSearchToken(value: string): string {
  return value.trim().toLowerCase().replace(/[\s_-]+/g, '');
}

function defaultYieldToUI(): Promise<void> {
  return new Promise(resolve => {
    const requestFrame = globalThis.requestAnimationFrame;
    if (typeof requestFrame === 'function') {
      requestFrame(() => resolve());
      return;
    }
    globalThis.setTimeout(resolve, 0);
  });
}

function threadMatchesInSearch(
  thread: MailThread,
  value: string,
  now: Date,
  tabCategories: TabCategory[],
  getThreadCategory: (thread: MailThread) => string,
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>,
): boolean {
  const normalized = normalizeSearchToken(value);
  const mailbox = MAILBOX_SEARCH_ALIASES[normalized];
  if (mailbox) {
    return isThreadInMailbox(thread, mailbox, now, { mutedLabelIdsByAccount });
  }

  const categoryId = getThreadCategory(thread);
  const category = tabCategories.find(item => item.id === categoryId);
  return normalizeSearchToken(categoryId) === normalized ||
    Boolean(category && normalizeSearchToken(category.displayName) === normalized);
}

export interface CooperativeThreadFilterInput {
  threads: MailThread[];
  searchQuery: string;
  matches: ThreadSearchMatch[];
  activeSplit: SplitInboxKind;
  mailboxView: MailboxView;
  now: Date;
  tabCategories: TabCategory[];
  labelDefinitions: MailLabelDefinition[];
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>;
  getThreadCategory: (thread: MailThread) => string;
  yieldToUI?: () => Promise<void>;
  batchSize?: number;
  isCancelled?: () => boolean;
}

export async function filterVisibleThreadsCooperatively({
  threads,
  searchQuery,
  matches,
  activeSplit,
  mailboxView,
  now,
  tabCategories,
  labelDefinitions,
  mutedLabelIdsByAccount,
  getThreadCategory,
  yieldToUI = defaultYieldToUI,
  batchSize = DEFAULT_THREAD_FILTER_BATCH_SIZE,
  isCancelled = () => false,
}: CooperativeThreadFilterInput): Promise<MailThread[] | null> {
  const trimmedQuery = searchQuery.trim();
  const hasSearch = trimmedQuery.length > 0;
  const parsed = hasSearch ? parseSearchQuery(searchQuery) : null;
  const textQuery = parsed ? parsed.textTerms.join(' ').trim() : '';
  const matchThreadIds = textQuery ? new Set(matches.map(match => match.threadId)) : null;
  const filtered: MailThread[] = [];
  const safeBatchSize = Math.max(1, batchSize);
  const matchesSearchThread = (thread: MailThread): boolean => {
    if (!parsed) return false;
    if (matchThreadIds && !matchThreadIds.has(thread.id)) return false;
    if (mailboxView !== 'inbox' && !isThreadInMailbox(thread, mailboxView, now, { mutedLabelIdsByAccount })) return false;
    if (parsed.from) {
      const from = parsed.from;
      const senderMatches = thread.senderEmail.includes(from) ||
        thread.senderNames.some(name => name.toLowerCase().includes(from));
      if (!senderMatches) return false;
    }
    if (parsed.domain && !(thread.senderEmail.endsWith(`@${parsed.domain}`) || thread.senderEmail.endsWith(`.${parsed.domain}`))) return false;
    if (parsed.hasAttachment !== undefined && thread.hasAttachments !== parsed.hasAttachment) return false;
    if (parsed.isUnread !== undefined && thread.isUnread !== parsed.isUnread) return false;
    if (parsed.label && !threadMatchesLabelSearchQuery(thread, parsed.label, labelDefinitions)) return false;
    if (parsed.inSplit && !threadMatchesInSearch(thread, parsed.inSplit, now, tabCategories, getThreadCategory, mutedLabelIdsByAccount)) return false;
    if ((parsed.after || parsed.before) && !matchesSearchDateRange(thread.lastMessageAt, parsed.after, parsed.before)) return false;
    return true;
  };
  const matchesDefaultThread = (thread: MailThread): boolean => {
    if (mailboxView !== 'inbox') {
      return isThreadInMailbox(thread, mailboxView, now, { mutedLabelIdsByAccount });
    }
    return isThreadInMailbox(thread, 'inbox', now, { mutedLabelIdsByAccount }) &&
      getThreadCategory(thread) === activeSplit;
  };

  for (let index = 0; index < threads.length; index += 1) {
    if (isCancelled()) return null;

    const thread = threads[index];
    if ((hasSearch && matchesSearchThread(thread)) || (!hasSearch && matchesDefaultThread(thread))) {
      filtered.push(thread);
    }

    if ((index + 1) % safeBatchSize === 0 && index + 1 < threads.length) {
      await yieldToUI();
      if (isCancelled()) return null;
    }
  }

  return filtered;
}
