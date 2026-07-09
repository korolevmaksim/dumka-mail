import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, GmailSignatureSyncResult, MailboxDelta, MailSyncCompletion } from '../../../shared/types';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';

interface UseMailSyncProps {
  accounts: Account[];
  activeAccount: Account | null;
  clearCacheOnDisconnect: boolean;
  loadAccounts: () => Promise<void>;
  setActiveAccountState: (acc: Account | null) => void;
  applyMailboxDelta: (delta: MailboxDelta) => void;
  setSpeedProof: React.Dispatch<React.SetStateAction<SpeedProof>>;
  applyGmailSignatureSyncResult: (result: GmailSignatureSyncResult) => Promise<void>;
}

export function useMailSync({
  accounts,
  activeAccount,
  clearCacheOnDisconnect,
  loadAccounts,
  setActiveAccountState,
  applyMailboxDelta,
  setSpeedProof,
  applyGmailSignatureSyncResult,
}: UseMailSyncProps) {
  const [syncHealth, setSyncHealth] = useState<'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect'>('ready');
  const [syncStatusText, setSyncStatusText] = useState<string>('Ready');
  const [backfillProgress, setBackfillProgress] = useState<string>('0%');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<MailSyncCompletion | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  // Backfill background loader
  const triggerSilentBackfill = useCallback(async () => {
    if (!activeAccount || activeAccount.id === 'unified') return;
    const syncState = await window.electronAPI.getSyncState(activeAccount.email);
    if (syncState && syncState.historyBackfillCompletedAt) {
      setBackfillProgress('All mail indexed');
      return;
    }

    setSyncHealth('indexing');
    setSyncStatusText('Indexing older mail...');

    try {
      const result = await window.electronAPI.runBackfillPage(activeAccount.email);
      setBackfillProgress(result.completed ? 'All mail indexed' : `${result.threadsIndexed} threads indexed`);
      if (result.busy) return;

      setSyncHealth('ready');
      setSyncStatusText('Ready');
    } catch (e: any) {
      console.error('Silent backfill page fetch failed:', e);
      setSyncHealth('paused');
      setSyncStatusText('Indexing paused');
    }
  }, [activeAccount]);

  const triggerBackfillManual = useCallback(async () => {
    await triggerSilentBackfill();
  }, [triggerSilentBackfill]);

  useEffect(() => window.electronAPI.onMailboxDelta(delta => {
    applyMailboxDelta(delta);
    setLastSuccessfulSync(previous => ({
      revision: Math.max(previous?.revision || 0, delta.revision),
      accountIds: Array.from(new Set([...(previous?.accountIds || []), delta.accountId])),
      completedAt: delta.completedAt,
    }));
  }), [applyMailboxDelta]);

  // Main owns scheduled Gmail reconciliation. The renderer only requests a
  // manual pass and applies the resulting mailbox deltas.
  const runSync = useCallback(async (silent = false) => {
    if (isSyncingRef.current || !activeAccount) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    if (!silent) {
      setSyncHealth('syncing');
      setSyncStatusText('Gmail Reconciliation...');
    }

    try {
      const start = performance.now();
      const targetAccounts = activeAccount.id === 'unified' ? accounts : [activeAccount];
      const targetAccountIds = targetAccounts.map(account => account.email.trim().toLowerCase()).filter(Boolean);
      const deltas = await window.electronAPI.syncMailboxNow(targetAccountIds);
      setLastSuccessfulSync({
        revision: deltas.reduce((max, delta) => Math.max(max, delta.revision), 0),
        accountIds: targetAccountIds,
        completedAt: new Date().toISOString(),
      });
      setSyncHealth('ready');
      setSyncStatusText('Ready');
      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        syncReadyMs: Math.round(performance.now() - start)
      }));

      if (activeAccount.id !== 'unified' && !silent) {
        triggerSilentBackfill();
      }
    } catch (err: any) {
      console.error('Inbox sync error:', err);
      setSyncHealth('failed');
      setSyncStatusText(err.message.includes('credentials') ? 'Reconnect Gmail' : 'Degraded sync');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [activeAccount, accounts, triggerSilentBackfill, setSpeedProof]);

  const triggerSyncManual = useCallback(async () => {
    await runSync(false);
  }, [runSync]);

  const onboardAccount = async (emailHint: string) => {
    try {
      const result = await window.electronAPI.onboardAccount(emailHint);
      await loadAccounts();
      setActiveAccountState(result.account);

      if (result.signatureSync) {
        await applyGmailSignatureSyncResult(result.signatureSync);
        if (result.signatureSync.found) {
          emitToast({ type: 'success', message: `Imported Gmail signature for ${result.account.email}.` });
        }
      } else if (result.signatureSyncError) {
        console.warn('Gmail signature sync failed during onboarding:', result.signatureSyncError);
      }
    } catch (e) {
      console.error('Account onboarding failed:', e);
      emitToast({ type: 'error', message: 'Google authentication failed. Please try again.' });
    }
  };

  const disconnectAccount = async (id: string) => {
    await window.electronAPI.disconnectAccount(id, { purgeCache: clearCacheOnDisconnect, revokeToken: true });
    loadAccounts();
    if (activeAccount?.id === id) {
      setActiveAccountState(null);
    }
  };

  return {
    syncHealth,
    syncStatusText,
    backfillProgress,
    isSyncing,
    lastSuccessfulSync,
    onboardAccount,
    disconnectAccount,
    triggerSyncManual,
    triggerBackfillManual,
    triggerSilentBackfill,
    setSyncHealth,
    setSyncStatusText,
    setBackfillProgress,
    setIsSyncing,
  };
}
