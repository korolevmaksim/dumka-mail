export interface SearchReaderCloseInput {
  previousSearchQuery: string;
  nextSearchQuery: string;
  hasOpenedThread: boolean;
  enablePreviewPane: boolean;
}

/**
 * Whether the open conversation should close because the search changed.
 *
 * Starting a search (no query → a query) always closes it: the list is about
 * to show results the open conversation has nothing to do with, and it would
 * sit next to a highlighted result as if it were that result. While a search
 * is being refined the conversation the person opened from the results stays
 * when the reading pane is beside the list, and closes when it replaces it.
 *
 * Decided on the query change only, never on later list updates: a result
 * that leaves the list while it is being read (marked read under `is:unread`,
 * archived under `in:inbox`) must stay open.
 */
export function shouldCloseReaderForSearchChange({
  previousSearchQuery,
  nextSearchQuery,
  hasOpenedThread,
  enablePreviewPane,
}: SearchReaderCloseInput): boolean {
  if (!hasOpenedThread || !nextSearchQuery.trim() || nextSearchQuery === previousSearchQuery) return false;
  const searchStarts = !previousSearchQuery.trim();
  return searchStarts || !enablePreviewPane;
}
