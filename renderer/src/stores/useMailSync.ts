import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Account,
  GmailSignatureSyncResult,
  GoogleAuthIssue,
  MailboxBackfillProgressEvent,
  MailboxDelta,
  MailboxSyncHealthEvent,
  MailSyncCompletion,
} from '../../../shared/types';
import { emitToast } from '../lib/toastBus';
import {
  applyBackfillEvent,
  applySyncSuccess,
  displaySyncStatus,
  mergeStoredProgress,
  pendingFirstSyncProgress,
  progressFromSyncState,
  progressKey,
  summarizeScopeProgress,
  type AccountSyncProgress,
} from '../../../shared/mailboxSyncProgress';
import {
  decodeGoogleSignInError,
  googleSignInErrorToast,
  type GoogleSignInError,
} from '../../../shared/googleSignInErrors';
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
  /** Reload the active mailbox scope from SQLite (used when an account's first sync lands). */
  reloadMailbox: () => void;
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
  reloadMailbox,
}: UseMailSyncProps) {
  const [syncHealth, setSyncHealth] = useState<'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect'>('ready');
  const [syncStatusText, setSyncStatusText] = useState<string>('Ready');
  const [backfillProgress, setBackfillProgress] = useState<string>('');
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<MailSyncCompletion | null>(null);
  const [googleAuthIssues, setGoogleAuthIssues] = useState<GoogleAuthIssue[]>([]);
  const [reauthorizingAccountId, setReauthorizingAccountId] = useState<string | null>(null);
  const isSyncingRef = useRef<boolean>(false);
  const [progressByAccount, setProgressByAccount] = useState<Record<string, AccountSyncProgress>>({});
  const progressByAccountRef = useRef(progressByAccount);
  progressByAccountRef.current = progressByAccount;
  const requestedProgressRef = useRef<Set<string>>(new Set());
  const [signInError, setSignInError] = useState<GoogleSignInError | null>(null);
  const [signInBusy, setSignInBusy] = useState(false);
  const signInAttemptRef = useRef(0);
  const reloadMailboxRef = useRef(reloadMailbox);
  reloadMailboxRef.current = reloadMailbox;
  const activeScopeIdsRef = useRef<string[]>([]);
  activeScopeIdsRef.current = !activeAccount
    ? []
    : activeAccount.id === 'unified'
      ? accounts.map(account => progressKey(account.email))
      : [progressKey(activeAccount.email)];

  const refreshStoredProgress = useCallback((accountId: string) => {
    const key = progressKey(accountId);
    void window.electronAPI.getSyncState(key)
      .then(state => {
        const stored = progressFromSyncState(state);
        setProgressByAccount(current => ({ ...current, [key]: mergeStoredProgress(current[key], stored) }));
      })
      .catch(error => console.warn('Could not read sync state:', error));
  }, []);

  // Seed per-account first-sync / backfill progress from sync_state once per account.
  useEffect(() => {
    for (const account of accounts) {
      const key = progressKey(account.email);
      if (!key || requestedProgressRef.current.has(key)) continue;
      requestedProgressRef.current.add(key);
      refreshStoredProgress(key);
    }
  }, [accounts, refreshStoredProgress]);

  useEffect(() => window.electronAPI.onBackfillProgress((event: MailboxBackfillProgressEvent) => {
    const key = progressKey(event.accountId);
    setProgressByAccount(current => ({ ...current, [key]: applyBackfillEvent(current[key], event) }));
  }), []);

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

  // History backfill is owned by the main process (it starts after the first
  // successful sync and at launch). The manual command only nudges that loop.
  const triggerBackfillManual = useCallback(async () => {
    if (!activeAccount) return;
    const targets = activeAccount.id === 'unified' ? accounts : [activeAccount];
    const blocked = new Set(googleAuthIssues.map(issue => issue.accountId));
    for (const account of targets) {
      const key = progressKey(account.email);
      if (!key || blocked.has(key)) continue;
      try {
        const result = await window.electronAPI.runBackfillPage(key);
        setProgressByAccount(current => ({
          ...current,
          [key]: mergeStoredProgress(current[key], {
            firstSyncDone: current[key]?.firstSyncDone ?? true,
            threadsIndexed: result.threadsIndexed,
            backfillCompleted: result.completed,
            backfillRunning: !result.completed,
            pausedReason: null,
          }),
        }));
      } catch (error) {
        console.error('Could not resume older mail indexing:', error);
      }
    }
  }, [activeAccount, accounts, googleAuthIssues]);

  useEffect(() => window.electronAPI.onMailboxDelta(delta => {
    applyMailboxDelta(delta);
    // Older-mail pages are not a completed sync (they must not re-trigger
    // sync-completion consumers such as the Daily Briefing refresh).
    if (delta.source === 'backfill') return;
    setLastSuccessfulSync(previous => ({
      revision: Math.max(previous?.revision || 0, delta.revision),
      accountIds: Array.from(new Set([...(previous?.accountIds || []), delta.accountId])),
      completedAt: delta.completedAt,
    }));
  }), [applyMailboxDelta]);

  useEffect(() => window.electronAPI.onMailboxSyncHealth((event: MailboxSyncHealthEvent) => {
    if (event.ok) {
      const key = progressKey(event.accountId);
      const wasPending = progressByAccountRef.current[key]?.firstSyncDone === false;
      setProgressByAccount(current => ({ ...current, [key]: applySyncSuccess(current[key]) }));
      // The first sync can land before the renderer switched to the new
      // account; reload once from SQLite so no early delta is missed.
      if (wasPending && activeScopeIdsRef.current.includes(key)) reloadMailboxRef.current();
      setLastSuccessfulSync(previous => ({
        revision: previous?.revision || 0,
        accountIds: Array.from(new Set([...(previous?.accountIds || []), event.accountId])),
        completedAt: event.lastSuccessAt || event.completedAt,
      }));
      setSyncHealth(current => (current === 'reconnect' ? current : 'ready'));
      setSyncStatusText(current => (current.startsWith('Reconnect ') ? current : 'Ready'));
      return;
    }
    setSyncHealth(current => (current === 'reconnect' ? current : 'failed'));
    setSyncStatusText(current => (
      current.startsWith('Reconnect ') ? current : (event.lastError || 'Degraded sync')
    ));
  }), []);

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
    } catch (err: any) {
      console.error('Inbox sync error:', err);
      setSyncHealth(googleAuthIssues.length > 0 ? 'reconnect' : 'failed');
      setSyncStatusText(googleAuthIssues.length > 0 ? syncStatusText : 'Degraded sync');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [activeAccount, accounts, googleAuthIssues, syncStatusText, setSpeedProof]);

  const triggerSyncManual = useCallback(async () => {
    await runSync(false);
  }, [runSync]);

  const onboardAccount = async (emailHint: string) => {
    // Not guarded by signInBusy: a closed browser tab would otherwise block
    // sign-in for the 5-minute OAuth timeout. Each click starts a fresh flow.
    const attempt = ++signInAttemptRef.current;
    setSignInBusy(true);
    setSignInError(null);
    try {
      const result = await window.electronAPI.onboardAccount(emailHint);
      const key = progressKey(result.account.email);
      // The main process already started this account's first sync. Show
      // `Fetching inbox…` until it reports success (it may already have).
      setProgressByAccount(current => (current[key] ? current : { ...current, [key]: pendingFirstSyncProgress() }));
      requestedProgressRef.current.add(key);
      refreshStoredProgress(key);
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
      console.error('Account onboarding failed.');
      // A superseded attempt (the user clicked again) must not report its timeout.
      if (attempt !== signInAttemptRef.current) return;
      const typed = decodeGoogleSignInError(e) ?? { code: 'GOOGLE_OAUTH_FAILED' as const };
      setSignInError(typed);
      // The first-run panel explains the failure inline; elsewhere a toast does.
      if (accounts.length > 0) {
        emitToast({ type: 'error', message: googleSignInErrorToast(typed) });
      }
    } finally {
      if (attempt === signInAttemptRef.current) setSignInBusy(false);
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
      console.error('Google reauthorization failed.');
      const typed = decodeGoogleSignInError(error);
      emitToast({
        type: 'error',
        message: typed
          ? `Could not reconnect ${normalizedAccountId}. ${googleSignInErrorToast(typed)}`
          : `Could not reconnect ${normalizedAccountId}. Please try again.`,
      });
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

  const scopeSummary = summarizeScopeProgress(progressByAccount, activeScopeIdsRef.current);
  const displayedStatus = displaySyncStatus({ health: syncHealth, text: syncStatusText }, scopeSummary);
  const displayedBackfillProgress = scopeSummary.backfillText || backfillProgress;

  return {
    syncHealth: displayedStatus.health,
    syncStatusText: displayedStatus.text,
    backfillProgress: displayedBackfillProgress,
    fetchingInbox: scopeSummary.fetchingInbox,
    olderMailIndexing: scopeSummary.olderMailIndexing,
    signInError,
    signInBusy,
    clearSignInError: () => setSignInError(null),
    isSyncing,
    lastSuccessfulSync,
    googleAuthIssues,
    reauthorizingAccountId,
    onboardAccount,
    reauthorizeAccount,
    disconnectAccount,
    triggerSyncManual,
    triggerBackfillManual,
    setSyncHealth,
    setSyncStatusText,
    setBackfillProgress,
    setIsSyncing,
  };
}
