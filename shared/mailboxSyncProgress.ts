// Pure derivation of the first-sync ("Fetching inbox…") and older-mail
// indexing ("Indexing older mail, N threads") states shown in the renderer.
// The main process owns both the sync and the backfill loop; the renderer only
// folds `sync_state`, `api:mailboxSyncHealth` and `api:backfillProgress` into
// this per-account record.

import type { MailboxBackfillProgressEvent, SyncState } from './types';
import type { MailboxSyncHealth } from './syncStatusAffordance';

export interface AccountSyncProgress {
  /** True once a mailbox sync has completed for this account (ever). */
  firstSyncDone: boolean;
  threadsIndexed: number;
  backfillCompleted: boolean;
  backfillRunning: boolean;
  pausedReason: MailboxBackfillProgressEvent['pausedReason'];
}

export type AccountSyncProgressMap = Readonly<Record<string, AccountSyncProgress>>;

export const FETCHING_INBOX_TEXT = 'Fetching inbox…';
export const ALL_MAIL_INDEXED_TEXT = 'All mail indexed';
export const OLDER_MAIL_INDEXING_NOTICE = 'Older mail is still being indexed';

export function progressKey(accountId: string): string {
  return accountId.trim().toLowerCase();
}

/** A just-connected account whose first sync has not finished yet. */
export function pendingFirstSyncProgress(): AccountSyncProgress {
  return { firstSyncDone: false, threadsIndexed: 0, backfillCompleted: false, backfillRunning: false, pausedReason: null };
}

export function progressFromSyncState(state: SyncState | null | undefined): AccountSyncProgress {
  return {
    firstSyncDone: Boolean(state?.lastFullSyncAt || state?.historyId),
    threadsIndexed: state?.historyBackfillThreadsSynced || 0,
    backfillCompleted: Boolean(state?.historyBackfillCompletedAt),
    // Not completed after the first sync: the main loop resumes it shortly.
    backfillRunning: Boolean((state?.lastFullSyncAt || state?.historyId) && !state?.historyBackfillCompletedAt),
    pausedReason: null,
  };
}

/** Merge a freshly read `sync_state` without regressing what events already proved. */
export function mergeStoredProgress(
  current: AccountSyncProgress | undefined,
  stored: AccountSyncProgress,
): AccountSyncProgress {
  if (!current) return stored;
  return {
    firstSyncDone: current.firstSyncDone || stored.firstSyncDone,
    threadsIndexed: Math.max(current.threadsIndexed, stored.threadsIndexed),
    backfillCompleted: current.backfillCompleted || stored.backfillCompleted,
    backfillRunning: current.backfillCompleted || stored.backfillCompleted ? false : current.backfillRunning,
    pausedReason: current.pausedReason,
  };
}

export function applySyncSuccess(current: AccountSyncProgress | undefined): AccountSyncProgress {
  const base = current ?? pendingFirstSyncProgress();
  return {
    ...base,
    firstSyncDone: true,
    // The main process queues backfill after every successful sync.
    backfillRunning: !base.backfillCompleted,
    pausedReason: base.backfillCompleted ? null : base.pausedReason,
  };
}

export function applyBackfillEvent(
  current: AccountSyncProgress | undefined,
  event: MailboxBackfillProgressEvent,
): AccountSyncProgress {
  return {
    // Backfill only ever runs after a first sync.
    firstSyncDone: true,
    threadsIndexed: Math.max(current?.threadsIndexed ?? 0, event.threadsIndexed),
    backfillCompleted: event.completed,
    backfillRunning: !event.completed && event.running,
    pausedReason: event.completed || event.running ? null : event.pausedReason ?? 'error',
  };
}

export interface ScopeSyncSummary {
  /** Some account in scope has never completed a sync. */
  fetchingInbox: boolean;
  /** Some account in scope has not finished indexing older mail. */
  olderMailIndexing: boolean;
  /** Status fragment: `Indexing older mail, N threads`, `All mail indexed`, … or ''. */
  backfillText: string;
}

export function summarizeScopeProgress(
  progress: AccountSyncProgressMap,
  accountIds: readonly string[],
): ScopeSyncSummary {
  const entries = accountIds
    .map(accountId => progress[progressKey(accountId)])
    .filter((entry): entry is AccountSyncProgress => Boolean(entry));
  if (entries.length === 0) return { fetchingInbox: false, olderMailIndexing: false, backfillText: '' };

  const fetchingInbox = entries.some(entry => !entry.firstSyncDone);
  const synced = entries.filter(entry => entry.firstSyncDone);
  const olderMailIndexing = entries.some(entry => !entry.backfillCompleted);
  const threadsIndexed = synced.reduce((sum, entry) => sum + entry.threadsIndexed, 0);
  const incomplete = synced.filter(entry => !entry.backfillCompleted);

  let backfillText = '';
  if (synced.length > 0) {
    if (incomplete.length === 0) {
      backfillText = fetchingInbox ? '' : ALL_MAIL_INDEXED_TEXT;
    } else if (incomplete.every(entry => !entry.backfillRunning && entry.pausedReason)) {
      backfillText = `Older mail indexing paused, ${formatThreadCount(threadsIndexed)}`;
    } else {
      backfillText = `Indexing older mail, ${formatThreadCount(threadsIndexed)}`;
    }
  }
  return { fetchingInbox, olderMailIndexing, backfillText };
}

function formatThreadCount(count: number): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? 'thread' : 'threads'}`;
}

export interface DisplayedSyncStatus {
  health: MailboxSyncHealth;
  text: string;
}

/**
 * Status-area text: never `Ready` while the inbox is still being fetched, and
 * the indexing progress instead of `Ready` while older mail is being indexed.
 * Reconnect and failure states always win.
 */
export function displaySyncStatus(base: DisplayedSyncStatus, summary: ScopeSyncSummary): DisplayedSyncStatus {
  if (base.health === 'reconnect' || base.health === 'failed') return base;
  if (summary.fetchingInbox) return { health: 'syncing', text: FETCHING_INBOX_TEXT };
  if (base.health === 'ready' && base.text === 'Ready' && summary.backfillText && summary.backfillText !== ALL_MAIL_INDEXED_TEXT) {
    return {
      health: summary.backfillText.startsWith('Older mail indexing paused') ? 'paused' : 'indexing',
      text: summary.backfillText,
    };
  }
  return base;
}
