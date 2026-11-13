import { describe, expect, it } from 'vitest';
import { shouldCloseReaderForSearchChange } from '../renderer/src/lib/searchReaderBehavior';

describe('search reader behavior', () => {
  it('closes the reader when a non-empty search query changes outside preview pane', () => {
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: '',
      nextSearchQuery: 'jira',
      hasOpenedThread: true,
      enablePreviewPane: false,
    })).toBe(true);
  });

  it('keeps a clicked search result open when the query is unchanged', () => {
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: 'jira',
      nextSearchQuery: 'jira',
      hasOpenedThread: true,
      enablePreviewPane: false,
    })).toBe(false);
  });

  it('closes a conversation opened before the search, also with the reading pane beside the list', () => {
    // Otherwise it would sit next to a highlighted result it has nothing to do with.
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: '',
      nextSearchQuery: 'invoice',
      hasOpenedThread: true,
      enablePreviewPane: true,
    })).toBe(true);
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: '  ',
      nextSearchQuery: 'i',
      hasOpenedThread: true,
      enablePreviewPane: true,
    })).toBe(true);
  });

  it('has nothing to close without an open conversation', () => {
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: '',
      nextSearchQuery: 'invoice',
      hasOpenedThread: false,
      enablePreviewPane: true,
    })).toBe(false);
  });

  it('keeps a result open while the search is refined in preview pane mode', () => {
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: 'jira',
      nextSearchQuery: 'jira status',
      hasOpenedThread: true,
      enablePreviewPane: true,
    })).toBe(false);
  });

  it('does not close the reader for an empty query', () => {
    expect(shouldCloseReaderForSearchChange({
      previousSearchQuery: 'jira',
      nextSearchQuery: '   ',
      hasOpenedThread: true,
      enablePreviewPane: false,
    })).toBe(false);
  });
});
