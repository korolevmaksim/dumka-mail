import type { MailThread } from './types';

export const MAX_INCREMENTAL_HISTORY_PAGES = 20;

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: Array<{ message?: { threadId?: string } }>;
  labelsAdded?: Array<{ message?: { threadId?: string } }>;
  labelsRemoved?: Array<{ message?: { threadId?: string } }>;
  messagesDeleted?: Array<{ message?: { id?: string; threadId?: string } }>;
}

/**
 * The messages Gmail deleted for good, by conversation. A conversation listed
 * with no message ids lost a message Gmail did not name.
 */
export type DeletedMessageIds = Record<string, string[]>;

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

/** The deleted messages of one conversation, as a sync pass hands them to the local cache. */
export interface DeletedConversationMessages {
  threadId: string;
  messageIds: string[];
  /** The same history also reported the conversation as changed, so it is read again anyway. */
  alsoChanged: boolean;
}

export interface DeletedMessagesOutcome {
  /** Conversations whose last message went: removed from the cache as a whole. */
  removedThreadIds: string[];
  /** Conversations that stay in the cache: to be read again from Gmail. */
  remainingThreadIds: string[];
  /**
   * The remaining conversations that lost a message here, as they are stored
   * now, so a window that shows one of them can drop that message at once.
   */
  shortenedThreads: MailThread[];
}

export interface HistoryChanges {
  updatedThreadIds: string[];
  /**
   * Conversations that lost at least one message. Gmail reports a deleted
   * message, never a deleted conversation: whether anything is left of the
   * conversation is not known from the history alone.
   */
  deletedThreadIds: string[];
  deletedMessageIds: DeletedMessageIds;
}

/** Collects the changes of history records into `target`, so pages can be merged. */
function collectHistoryChanges(
  records: GmailHistoryRecord[],
  updatedThreadIds: Set<string>,
  deletedMessageIds: Map<string, Set<string>>,
): void {
  const add = (threadId?: string) => {
    if (threadId) updatedThreadIds.add(threadId);
  };

  for (const record of records) {
    for (const item of record.messagesAdded || []) add(item.message?.threadId);
    for (const item of record.labelsAdded || []) add(item.message?.threadId);
    for (const item of record.labelsRemoved || []) add(item.message?.threadId);
    for (const item of record.messagesDeleted || []) {
      const threadId = item.message?.threadId;
      if (!threadId) continue;
      const messageIds = deletedMessageIds.get(threadId) ?? new Set<string>();
      deletedMessageIds.set(threadId, messageIds);
      if (item.message?.id) messageIds.add(item.message.id);
    }
  }
}

function historyChanges(updatedThreadIds: Set<string>, deletedMessageIds: Map<string, Set<string>>): HistoryChanges {
  return {
    updatedThreadIds: Array.from(updatedThreadIds),
    deletedThreadIds: Array.from(deletedMessageIds.keys()),
    deletedMessageIds: Object.fromEntries(
      Array.from(deletedMessageIds, ([threadId, messageIds]) => [threadId, Array.from(messageIds)]),
    ),
  };
}

export function collectHistoryThreadIds(records: GmailHistoryRecord[]): HistoryChanges {
  const updatedThreadIds = new Set<string>();
  const deletedMessageIds = new Map<string, Set<string>>();
  collectHistoryChanges(records, updatedThreadIds, deletedMessageIds);
  return historyChanges(updatedThreadIds, deletedMessageIds);
}

export function resolveIncrementalHistoryCursor(
  startHistoryId: string,
  pages: GmailHistoryPage[],
  maxPages = MAX_INCREMENTAL_HISTORY_PAGES,
): string {
  if (pages.length === 0) return startHistoryId;
  const lastPage = pages[pages.length - 1];
  if (pages.length >= maxPages && lastPage.nextPageToken) {
    throw new Error('HISTORY_EXPIRED');
  }
  return lastPage.historyId || startHistoryId;
}

export async function paginateGmailHistory(options: {
  startHistoryId: string;
  maxPages?: number;
  fetchPage: (pageToken?: string) => Promise<GmailHistoryPage>;
}): Promise<HistoryChanges & { historyId: string }> {
  const maxPages = options.maxPages ?? MAX_INCREMENTAL_HISTORY_PAGES;
  const pages: GmailHistoryPage[] = [];
  const updatedThreadIds = new Set<string>();
  const deletedMessageIds = new Map<string, Set<string>>();
  let pageToken: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await options.fetchPage(pageToken);
    pages.push(page);
    collectHistoryChanges(page.history || [], updatedThreadIds, deletedMessageIds);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return {
    ...historyChanges(updatedThreadIds, deletedMessageIds),
    historyId: resolveIncrementalHistoryCursor(options.startHistoryId, pages, maxPages),
  };
}
