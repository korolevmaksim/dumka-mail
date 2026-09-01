export type MailboxSyncHealth = 'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect';

export type SyncStatusAffordance = 'retrySync' | 'continueIndexing' | 'none';

export function isRenderedBackfillProgress(progress: string): boolean {
  return progress !== '' && progress !== '0%';
}

export function isIncompleteBackfillProgress(progress: string): boolean {
  return isRenderedBackfillProgress(progress) && progress !== 'All mail indexed';
}

export function syncStatusAffordance(input: {
  syncHealth: MailboxSyncHealth;
  backfillProgress: string;
  hasAccount: boolean;
}): SyncStatusAffordance {
  switch (input.syncHealth) {
    case 'failed':
      return 'retrySync';
    case 'ready':
    case 'syncing':
    case 'indexing':
    case 'paused':
    case 'reconnect':
      if (input.hasAccount && isIncompleteBackfillProgress(input.backfillProgress)) {
        return 'continueIndexing';
      }
      return 'none';
    default: {
      const _exhaustive: never = input.syncHealth;
      return _exhaustive;
    }
  }
}
