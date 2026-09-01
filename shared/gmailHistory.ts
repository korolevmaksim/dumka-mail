export const MAX_INCREMENTAL_HISTORY_PAGES = 20;

export interface GmailHistoryRecord {
  id?: string;
  messagesAdded?: Array<{ message?: { threadId?: string } }>;
  labelsAdded?: Array<{ message?: { threadId?: string } }>;
  labelsRemoved?: Array<{ message?: { threadId?: string } }>;
  messagesDeleted?: Array<{ message?: { threadId?: string } }>;
}

export interface GmailHistoryPage {
  history?: GmailHistoryRecord[];
  historyId?: string;
  nextPageToken?: string;
}

export function collectHistoryThreadIds(records: GmailHistoryRecord[]): {
  updatedThreadIds: string[];
  deletedThreadIds: string[];
} {
  const updatedThreadIds = new Set<string>();
  const deletedThreadIds = new Set<string>();

  const add = (target: Set<string>, threadId?: string) => {
    if (threadId) target.add(threadId);
  };

  for (const record of records) {
    for (const item of record.messagesAdded || []) add(updatedThreadIds, item.message?.threadId);
    for (const item of record.labelsAdded || []) add(updatedThreadIds, item.message?.threadId);
    for (const item of record.labelsRemoved || []) add(updatedThreadIds, item.message?.threadId);
    for (const item of record.messagesDeleted || []) add(deletedThreadIds, item.message?.threadId);
  }

  return {
    updatedThreadIds: Array.from(updatedThreadIds),
    deletedThreadIds: Array.from(deletedThreadIds),
  };
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
}): Promise<{ updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string }> {
  const maxPages = options.maxPages ?? MAX_INCREMENTAL_HISTORY_PAGES;
  const pages: GmailHistoryPage[] = [];
  const updatedThreadIds = new Set<string>();
  const deletedThreadIds = new Set<string>();
  let pageToken: string | undefined;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const page = await options.fetchPage(pageToken);
    pages.push(page);
    const collected = collectHistoryThreadIds(page.history || []);
    collected.updatedThreadIds.forEach(id => updatedThreadIds.add(id));
    collected.deletedThreadIds.forEach(id => deletedThreadIds.add(id));
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  return {
    updatedThreadIds: Array.from(updatedThreadIds),
    deletedThreadIds: Array.from(deletedThreadIds),
    historyId: resolveIncrementalHistoryCursor(options.startHistoryId, pages, maxPages),
  };
}
