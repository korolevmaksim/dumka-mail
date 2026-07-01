export interface SearchReaderCloseInput {
  previousSearchQuery: string;
  nextSearchQuery: string;
  hasOpenedThread: boolean;
  enablePreviewPane: boolean;
}

export function shouldCloseReaderForSearchChange({
  previousSearchQuery,
  nextSearchQuery,
  hasOpenedThread,
  enablePreviewPane,
}: SearchReaderCloseInput): boolean {
  return Boolean(
    nextSearchQuery.trim() &&
    nextSearchQuery !== previousSearchQuery &&
    hasOpenedThread &&
    !enablePreviewPane
  );
}
