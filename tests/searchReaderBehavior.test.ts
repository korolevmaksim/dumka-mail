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

  it('does not close the reader in preview pane mode', () => {
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
