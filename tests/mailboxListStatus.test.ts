// When an empty mailbox list may say "nothing here", and when it must show
// placeholder rows (or the failed-read state) instead.
import { describe, expect, it } from 'vitest';
import { mailboxListStatus, type MailboxListStatusInput } from '../renderer/src/lib/mailboxListStatus';

const settled: MailboxListStatusInput = {
  activeScopeKey: 'work@example.com',
  loadedScopeKey: 'work@example.com',
  failedScopeKey: null,
  mailboxView: 'inbox',
  hasSearchQuery: false,
  searchRunning: false,
  threadCount: 40,
  visibleCount: 12,
  indexed: true,
  expectedCount: 12,
};
const status = (patch: Partial<MailboxListStatusInput>) => mailboxListStatus({ ...settled, ...patch });

describe('mailboxListStatus', () => {
  it('is ready when the rows are on screen or no account is active', () => {
    expect(status({})).toBe('ready');
    expect(status({ activeScopeKey: null, loadedScopeKey: null, threadCount: 0, visibleCount: 0 })).toBe('ready');
  });

  it('is loading until the active scope has been read from the cache', () => {
    const switched = { loadedScopeKey: null, threadCount: 0, visibleCount: 0, indexed: false, expectedCount: 0 };
    expect(status(switched)).toBe('loading');
    // Rows of the previous scope do not make the new one known.
    expect(status({ ...switched, loadedScopeKey: 'home@example.com' })).toBe('loading');
  });

  it('reports a failed read instead of loading for ever', () => {
    expect(status({ loadedScopeKey: null, failedScopeKey: 'work@example.com', threadCount: 0, visibleCount: 0 })).toBe('failed');
    // A failure of another scope says nothing about this one.
    expect(status({ loadedScopeKey: null, failedScopeKey: 'home@example.com', threadCount: 0, visibleCount: 0 })).toBe('loading');
    // A failed refresh does not undo the read before it: its rows stay, and
    // a mailbox it found empty is still empty.
    expect(status({ failedScopeKey: 'work@example.com' })).toBe('ready');
    expect(status({ failedScopeKey: 'work@example.com', mailboxView: 'trash', visibleCount: 0, expectedCount: 0 })).toBe('ready');
  });

  it('is loading while the mailbox index is built and until its rows are published', () => {
    expect(status({ visibleCount: 0, indexed: false, expectedCount: 0 })).toBe('loading');
    expect(status({ visibleCount: 0, indexed: true, expectedCount: 12 })).toBe('loading');
  });

  it('lets a mailbox be empty once nothing more can arrive', () => {
    // The account has no cached mail at all.
    expect(status({ threadCount: 0, visibleCount: 0, indexed: false, expectedCount: 0 })).toBe('ready');
    // The account has mail, this mailbox has none.
    expect(status({ mailboxView: 'trash', visibleCount: 0, expectedCount: 0 })).toBe('ready');
  });

  it('never replaces rows that are on screen', () => {
    expect(status({ indexed: false, expectedCount: 0 })).toBe('ready');
    expect(status({ hasSearchQuery: true, searchRunning: true })).toBe('ready');
  });

  it('follows the running search when a query is typed', () => {
    expect(status({ hasSearchQuery: true, searchRunning: true, visibleCount: 0 })).toBe('loading');
    expect(status({ hasSearchQuery: true, searchRunning: false, visibleCount: 0 })).toBe('ready');
  });

  it('does not wait for the index in Waiting or Drafts', () => {
    expect(status({ mailboxView: 'waiting', visibleCount: 0, indexed: false, expectedCount: 3 })).toBe('loading');
    expect(status({ mailboxView: 'waiting', visibleCount: 0, indexed: false, expectedCount: 0 })).toBe('ready');
    expect(status({ mailboxView: 'drafts', visibleCount: 0, indexed: false, expectedCount: 0 })).toBe('ready');
  });
});
