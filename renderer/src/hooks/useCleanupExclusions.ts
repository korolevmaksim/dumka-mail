import { useCallback, useEffect, useState } from 'react';
import type { CleanupSenderExclusion, SenderCleanupStat } from '../../../shared/types';
import { emitToast } from '../lib/toastBus';

function exclusionKey(accountId: string, senderEmail: string): string {
  return `${accountId}:${senderEmail.trim().toLowerCase()}`;
}

interface UseCleanupExclusionsOptions {
  accountIds: string[];
  refreshStats: () => Promise<void>;
  onExcluded: (exclusion: CleanupSenderExclusion) => void;
}

export function useCleanupExclusions({
  accountIds,
  refreshStats,
  onExcluded,
}: UseCleanupExclusionsOptions) {
  const [exclusions, setExclusions] = useState<CleanupSenderExclusion[]>([]);
  const [excludeBusyKey, setExcludeBusyKey] = useState<string | null>(null);
  const [restoreBusyKey, setRestoreBusyKey] = useState<string | null>(null);

  const loadExclusions = useCallback(async () => {
    if (accountIds.length === 0) {
      setExclusions([]);
      return;
    }
    try {
      setExclusions(await window.electronAPI.listCleanupExclusions(accountIds));
    } catch (error) {
      console.error('Cleanup exclusions failed:', error);
      emitToast({ type: 'error', message: 'Could not load excluded Cleanup senders.' });
    }
  }, [accountIds]);

  useEffect(() => {
    void loadExclusions();
  }, [loadExclusions]);

  const restoreExclusion = useCallback(async (exclusion: CleanupSenderExclusion, notify = true) => {
    const key = exclusionKey(exclusion.accountId, exclusion.senderEmail);
    setRestoreBusyKey(key);
    try {
      await window.electronAPI.deleteCleanupExclusion(exclusion.accountId, exclusion.senderEmail);
      setExclusions(current => current.filter(item => exclusionKey(item.accountId, item.senderEmail) !== key));
      await refreshStats();
      if (notify) {
        emitToast({ type: 'success', message: `${exclusion.senderName || exclusion.senderEmail} restored to Cleanup.` });
      }
    } catch (error) {
      console.error('Cleanup exclusion restore failed:', error);
      emitToast({ type: 'error', message: 'Could not restore this sender to Cleanup.' });
    } finally {
      setRestoreBusyKey(null);
    }
  }, [refreshStats]);

  const excludeSender = useCallback(async (stat: SenderCleanupStat) => {
    const key = exclusionKey(stat.accountId, stat.senderEmail);
    setExcludeBusyKey(key);
    const exclusion: CleanupSenderExclusion = {
      accountId: stat.accountId,
      senderEmail: stat.senderEmail,
      senderName: stat.senderName || stat.senderEmail,
      excludedAt: new Date().toISOString(),
    };
    try {
      const saved = await window.electronAPI.saveCleanupExclusion(exclusion);
      setExclusions(current => [
        saved,
        ...current.filter(item => exclusionKey(item.accountId, item.senderEmail) !== key),
      ]);
      onExcluded(saved);
      emitToast({
        type: 'success',
        message: `${saved.senderName || saved.senderEmail} excluded from Cleanup.`,
        actionLabel: 'Undo',
        onAction: () => void restoreExclusion(saved, false),
        duration: 10000,
      });
    } catch (error) {
      console.error('Cleanup sender exclusion failed:', error);
      emitToast({ type: 'error', message: 'Could not exclude this sender from Cleanup.' });
    } finally {
      setExcludeBusyKey(null);
    }
  }, [onExcluded, restoreExclusion]);

  return {
    exclusions,
    excludeBusyKey,
    restoreBusyKey,
    excludeSender,
    restoreExclusion,
  };
}
