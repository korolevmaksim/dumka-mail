import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Account,
  GmailSignatureSyncResult,
  GoogleAuthIssue,
  MailboxDelta,
  MailSyncCompletion,
} from '../../../shared/types';
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
  const [googleAuthIssues, setGoogleAuthIssues] = useState<GoogleAuthIssue[]>([]);
  const [reauthorizingAccountId, setReauthorizingAccountId] = useState<string | null>(null);
  const isSyncingRef = useRef<boolean>(false);

  useEffect(() => {
    let disposed = false;
    const unsubscribe = window.electronAPI.onGoogleAuthStateChanged(change => {
      if (disposed) return;
      setGoogleAuthIssues(current => {
        const remaining = current.filter(issue => issue.accountId !== change.accountId);
        return change.issue
          ? [...remaining, change.issue].sort((a, b) => a.accountId.localeCompare(b.accountId))
          : remaining;
      });
    });

    void window.electronAPI.listGoogleAuthIssues()
      .then(issues => {
        if (!disposed) setGoogleAuthIssues(issues);
      })
      .catch(error => console.error('Failed to load Google authorization state:', error));

    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (googleAuthIssues.length > 0) {
      setSyncHealth('reconnect');
      setSyncStatusText(
        googleAuthIssues.length === 1
          ? `Reconnect ${googleAuthIssues[0].accountId}`
          : `Reconnect ${googleAuthIssues.length} Gmail accounts`,
      );
      return;
    }
    setSyncHealth(current => current === 'reconnect' ? 'ready' : current);
    setSyncStatusText(current => current.startsWith('Reconnect ') ? 'Ready' : current);
  }, [googleAuthIssues]);

  // Backfill background loader
  const triggerSilentBackfill = useCallback(async () => {
    if (!activeAccount || activeAccount.id === 'unified') return;
    if (googleAuthIssues.some(issue => issue.accountId === activeAccount.email.trim().toLowerCase())) return;
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
  }, [activeAccount, googleAuthIssues]);

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
      const blockedAccountIds = new Set(googleAuthIssues.map(issue => issue.accountId));
      const targetAccountIds = targetAccounts
        .map(account => account.email.trim().toLowerCase())
        .filter(accountId => accountId && !blockedAccountIds.has(accountId));
      if (targetAccountIds.length === 0) {
        setSyncHealth('reconnect');
        return;
      }
      const deltas = await window.electronAPI.syncMailboxNow(targetAccountIds);
      setLastSuccessfulSync({
        revision: deltas.reduce((max, delta) => Math.max(max, delta.revision), 0),
        accountIds: targetAccountIds,
        completedAt: new Date().toISOString(),
      });
      setSyncHealth(googleAuthIssues.length > 0 ? 'reconnect' : 'ready');
      setSyncStatusText(googleAuthIssues.length > 0 ? syncStatusText : 'Ready');
      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        syncReadyMs: Math.round(performance.now() - start)
      }));

      if (activeAccount.id !== 'unified' && !silent) {
        triggerSilentBackfill();
      }
    } catch (err: any) {
      console.error('Inbox sync error:', err);
      setSyncHealth(googleAuthIssues.length > 0 ? 'reconnect' : 'failed');
      setSyncStatusText(googleAuthIssues.length > 0 ? syncStatusText : 'Degraded sync');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [activeAccount, accounts, googleAuthIssues, syncStatusText, triggerSilentBackfill, setSpeedProof]);

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

  const reauthorizeAccount = async (accountId: string) => {
    const normalizedAccountId = accountId.trim().toLowerCase();
    if (!normalizedAccountId || reauthorizingAccountId) return;

    setReauthorizingAccountId(normalizedAccountId);
    try {
      await window.electronAPI.reauthorizeAccount(normalizedAccountId);
      setGoogleAuthIssues(current => current.filter(issue => issue.accountId !== normalizedAccountId));
      await loadAccounts();

      try {
        await window.electronAPI.syncMailboxNow([normalizedAccountId]);
        emitToast({ type: 'success', message: `${normalizedAccountId} is connected and syncing again.` });
      } catch (syncError) {
        console.warn('Immediate mailbox sync after reauthorization failed:', syncError);
        const currentIssues = await window.electronAPI.listGoogleAuthIssues().catch(() => []);
        if (currentIssues.some(issue => issue.accountId === normalizedAccountId)) {
          setGoogleAuthIssues(currentIssues);
          emitToast({ type: 'error', message: `Google still rejected access for ${normalizedAccountId}. Please reconnect again.` });
        } else {
          emitToast({ type: 'warning', message: `${normalizedAccountId} was reconnected. Mail sync will retry automatically.` });
        }
      }
    } catch (error) {
      console.error('Google reauthorization failed:', error);
      emitToast({ type: 'error', message: `Could not reconnect ${normalizedAccountId}. Please try again.` });
    } finally {
      setReauthorizingAccountId(null);
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
    googleAuthIssues,
    reauthorizingAccountId,
    onboardAccount,
    reauthorizeAccount,
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
