import { useState, useEffect, useCallback, useRef } from 'react';
import { Account } from '../../../shared/types';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';

interface UseMailSyncProps {
  accounts: Account[];
  activeAccount: Account | null;
  loadAccounts: () => Promise<void>;
  setActiveAccountState: (acc: Account | null) => void;
  loadThreadsFromDB: () => Promise<void>;
  setSpeedProof: React.Dispatch<React.SetStateAction<SpeedProof>>;
}

export function useMailSync({
  accounts,
  activeAccount,
  loadAccounts,
  setActiveAccountState,
  loadThreadsFromDB,
  setSpeedProof,
}: UseMailSyncProps) {
  const [syncHealth, setSyncHealth] = useState<'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect'>('ready');
  const [syncStatusText, setSyncStatusText] = useState<string>('Ready');
  const [backfillProgress, setBackfillProgress] = useState<string>('0%');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
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
      const page = await window.electronAPI.syncBackfillPage(activeAccount.email, syncState?.historyBackfillPageToken || undefined);
      
      await window.electronAPI.saveThreads(page.threads);
      await window.electronAPI.saveMessages(page.messages);

      const nextPagesSynced = (syncState?.historyBackfillPagesSynced || 0) + 1;
      const nextThreadsSynced = (syncState?.historyBackfillThreadsSynced || 0) + page.threads.length;

      await window.electronAPI.saveSyncState({
        accountId: activeAccount.email,
        historyId: syncState?.historyId || null,
        lastFullSyncAt: syncState?.lastFullSyncAt || null,
        historyBackfillPageToken: page.nextPageToken || null,
        historyBackfillCompletedAt: page.nextPageToken ? null : new Date().toISOString(),
        historyBackfillPagesSynced: nextPagesSynced,
        historyBackfillThreadsSynced: nextThreadsSynced
      });

      setBackfillProgress(`${nextThreadsSynced} threads indexed`);
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

  // Sync Inbox logic
  const runSync = useCallback(async (silent = false, forceFull = false, syncAll = false) => {
    if (isSyncingRef.current || !activeAccount) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    if (!silent) {
      setSyncHealth('syncing');
      setSyncStatusText('Gmail Reconciliation...');
    }

    try {
      const start = performance.now();
      const targetAccounts = (syncAll || activeAccount.id === 'unified') ? accounts : [activeAccount];

      for (const acc of targetAccounts) {
        const syncState = await window.electronAPI.getSyncState(acc.email);
        
        let syncResult;
        if (syncState && syncState.historyId && !forceFull) {
          try {
            const incResult = await window.electronAPI.syncIncremental(acc.email, syncState.historyId);
            
            for (const tid of incResult.updatedThreadIds) {
              try {
                const msgs = await window.electronAPI.fetchThreadDetail(acc.email, tid);
                await window.electronAPI.saveMessages(msgs, { notifyOfNew: true });

                if (msgs.length > 0) {
                  const lastMsg = msgs[msgs.length - 1];
                  const senderNames = Array.from(new Set(msgs.map(m => m.senderName || m.senderEmail)));
                  const thread = {
                    id: tid,
                    accountId: acc.email,
                    subject: lastMsg.subject || '',
                    snippet: lastMsg.snippet || '',
                    lastMessageAt: lastMsg.receivedAt,
                    senderNames,
                    senderEmail: lastMsg.senderEmail,
                    labelIds: Array.from(new Set(msgs.flatMap(m => m.labelIds))),
                    hasAttachments: msgs.some(m => m.hasAttachments),
                    isUnread: msgs.some(m => m.isUnread)
                  };
                  await window.electronAPI.saveThreads([thread]);
                }
              } catch (e: any) {
                console.warn(`Failed to fetch thread detail for ${tid} during incremental sync:`, e);
                if (e.message?.includes('not found') || e.message?.includes('404')) {
                  await window.electronAPI.deleteThread(acc.email, tid);
                }
              }
            }
            for (const tid of incResult.deletedThreadIds) {
              await window.electronAPI.deleteThread(acc.email, tid);
            }

            await window.electronAPI.saveSyncState({
              accountId: acc.email,
              historyId: incResult.historyId,
              lastFullSyncAt: syncState.lastFullSyncAt,
              historyBackfillPagesSynced: syncState.historyBackfillPagesSynced,
              historyBackfillThreadsSynced: syncState.historyBackfillThreadsSynced,
              historyBackfillPageToken: syncState.historyBackfillPageToken
            });
          } catch (e: any) {
            if (e.message === 'HISTORY_EXPIRED') {
              syncResult = await window.electronAPI.syncInbox(acc.email);
            } else {
              throw e;
            }
          }
        } else {
          syncResult = await window.electronAPI.syncInbox(acc.email);
        }

        if (syncResult) {
          await window.electronAPI.saveThreads(syncResult.threads);
          await window.electronAPI.saveMessages(syncResult.messages);
          await window.electronAPI.saveSyncState({
            accountId: acc.email,
            historyId: syncResult.historyId,
            lastFullSyncAt: new Date().toISOString(),
            historyBackfillPagesSynced: 0,
            historyBackfillThreadsSynced: 0
          });
        }
      }

      await loadThreadsFromDB();
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
  }, [activeAccount, loadThreadsFromDB, accounts, triggerSilentBackfill, setSpeedProof]);

  useEffect(() => {
    if (!activeAccount) return;
    // Do not force a full startup sync: it would advance the Gmail history cursor
    // before incremental sync can notify about mail that arrived while the app was closed.
    runSync(false, false);

    const intervalId = setInterval(() => {
      runSync(true, false, true);
    }, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeAccount, runSync]);

  const triggerSyncManual = useCallback(async () => {
    await runSync(false, true);
  }, [runSync]);

  const onboardAccount = async (emailHint: string) => {
    try {
      const newAcc = await window.electronAPI.onboardAccount(emailHint);
      await loadAccounts();
      setActiveAccountState(newAcc);
    } catch (e) {
      console.error('Account onboarding failed:', e);
      emitToast({ type: 'error', message: 'Google authentication failed. Please try again.' });
    }
  };

  const disconnectAccount = async (id: string) => {
    await window.electronAPI.deleteAccount(id);
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
