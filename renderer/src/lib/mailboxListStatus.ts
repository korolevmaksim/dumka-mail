import type { MailboxView } from '../../../shared/types';

/**
 * Whether an empty mailbox list means "nothing here" or "not known yet".
 * `loading`: the rows are still being read, indexed or published, so the list
 * shows placeholder rows. `failed`: the local cache did not answer, so the
 * list says so. Only `ready` may claim that a mailbox is empty.
 */
export type MailboxListStatus = 'ready' | 'loading' | 'failed';

export interface MailboxListStatusInput {
  /** The account scope on screen; null when no account is active. */
  activeScopeKey: string | null;
  /** The scope whose conversations were last read from the local cache. */
  loadedScopeKey: string | null;
  /** The scope whose last read failed. */
  failedScopeKey: string | null;
  mailboxView: MailboxView;
  hasSearchQuery: boolean;
  searchRunning: boolean;
  /** Conversations cached for the scope, in every mailbox. */
  threadCount: number;
  /** Rows the list holds right now. */
  visibleCount: number;
  /** The mailbox index for the loaded conversations is built. */
  indexed: boolean;
  /** Rows this mailbox holds once the list is published (0 while unknown). */
  expectedCount: number;
}

export function mailboxListStatus(input: MailboxListStatusInput): MailboxListStatus {
  if (!input.activeScopeKey) return 'ready';
  if (input.loadedScopeKey !== input.activeScopeKey) {
    return input.failedScopeKey === input.activeScopeKey ? 'failed' : 'loading';
  }
  // Rows on screen are never replaced by placeholders, and a scope without
  // any cached conversation has nothing left to wait for.
  if (input.visibleCount > 0 || input.threadCount === 0) return 'ready';
  if (input.hasSearchQuery) return input.searchRunning ? 'loading' : 'ready';
  // Drafts are not thread rows; Waiting is derived without the index.
  if (input.mailboxView === 'drafts') return 'ready';
  if (input.mailboxView !== 'waiting' && !input.indexed) return 'loading';
  // The rows exist but the list has not been handed them yet.
  return input.expectedCount > 0 ? 'loading' : 'ready';
}
