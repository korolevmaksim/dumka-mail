import { startTransition, useState, useEffect, useCallback, useRef } from 'react';
import { Account, GmailSignatureSyncResult, MailThread, MailMessage, MailActionLog, MailActionExecutionResult, AppSettings, TabCategory, MailboxView, ThreadAgentInsights, MailLabelDefinition, FollowUpRadarResult, FollowUpRadarItem, MailboxDelta, NavigationActivity } from '../../../shared/types';
import { SplitInboxKind } from '../../../shared/classifier';
import { buildFtsMatchQuery, parseSearchQuery, searchTextQuery } from '../../../shared/search';
import { fuseSearchMatches, orderSearchResults, type RankedSourceList } from '../../../shared/searchRanking';
import { categorize } from '../../../shared/categoryEngine';
import { applyOptimisticThreadReminder, isReversibleMailActionKind, reverseMailActionKind } from '../../../shared/mailActions';
import { emitToast } from '../lib/toastBus';
import { useMailSync } from './useMailSync';
import type { ThreadHeaderMessagesStatus } from '../lib/threadHeader';
import {
  collectFtsMatchLists,
  collectSemanticOutcomes,
  flattenMatchLists,
  SEMANTIC_SEARCH_SETTLE_DELAY_MS,
  shouldRunSemanticSearch,
  waitUnlessCancelled,
} from './mailSearchHelpers';
import { filterVisibleThreadsCooperatively } from './mailThreadFilter';
import { IDLE_SEARCH_STATE, type MailSearchState } from './mailSearchStatus';
import {
  buildMailboxIndexCooperatively,
  categoryFromMailboxIndex,
  replaceThreadInMailboxIndex,
  threadsForMailboxIndex,
  type MailboxIndex,
} from './mailboxIndex';
import { applyDeltaToThreads } from './mailboxDelta';

export interface SpeedProof {
  cacheReadyMs?: number;
  syncReadyMs?: number;
  searchMs?: number;
  aiMs?: number;
  detailCacheCoverage: string;
}

const SENT_SYNC_MIN_INTERVAL_MS = 60_000;
const SEARCH_COMPLETE_VISIBLE_MS = 1_200;
const DEFAULT_FOLLOW_UP_SCAN_LIMIT = 150;

interface UseMailStateProps {
  tabCategories: TabCategory[];
  categorySettings: AppSettings['inbox']['categories'];
  inboxSettings: AppSettings['inbox'];
  privacySettings: AppSettings['privacy'];
  labelDefinitions: MailLabelDefinition[];
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>;
  applyGmailSignatureSyncResult: (result: GmailSignatureSyncResult) => Promise<void>;
}

interface CachedMailboxSnapshot {
  accountIds: string[];
  threads: MailThread[];
  index: MailboxIndex;
  indexConfigKey: string;
}

const IDLE_NAVIGATION_ACTIVITY: NavigationActivity = {
  phase: 'idle',
  label: '',
  scopeKey: null,
  startedAt: null,
};

function accountScopeKey(account: Account | null, accounts: Account[]): string | null {
  if (!account) return null;
  if (account.id !== 'unified') return account.email;
  return `unified:${accounts.map(item => item.email).filter(Boolean).sort().join('|')}`;
}

function accountIdsForScope(account: Account | null, accounts: Account[]): string[] {
  if (!account) return [];
  return account.id === 'unified'
    ? accounts.map(item => item.email).filter(Boolean)
    : [account.email];
}

function shouldRefreshInlineCidMetadata(messages: MailMessage[]): boolean {
  return messages.some(message => {
    const html = message.bodyHtml || '';
    if (!/cid:/i.test(html)) return false;

    const imageAttachments = message.attachments.filter(att => att.mimeType.toLowerCase().startsWith('image/'));
    if (imageAttachments.length === 0) return true;

    return imageAttachments.some(att => !att.contentId || (!att.attachmentId && !att.base64Data));
  });
}

function threadStateKey(thread: Pick<MailThread, 'accountId' | 'id'> | null): string | null {
  return thread ? `${thread.accountId}:${thread.id}` : null;
}

function followUpRadarItemMatches(a: FollowUpRadarItem, b: FollowUpRadarItem): boolean {
  return a.accountId === b.accountId && a.threadId === b.threadId && a.sentMessageId === b.sentMessageId;
}

function removeFollowUpRadarItem(result: FollowUpRadarResult | null, item: FollowUpRadarItem): FollowUpRadarResult | null {
  if (!result) return result;
  const items = result.items.filter(candidate => !followUpRadarItemMatches(candidate, item));
  if (items.length === result.items.length) return result;
  return {
    ...result,
    candidateCount: Math.max(0, result.candidateCount - (result.items.length - items.length)),
    items,
  };
}

export function useMailState({
  tabCategories,
  categorySettings,
  inboxSettings,
  privacySettings,
  labelDefinitions,
  mutedLabelIdsByAccount,
  applyGmailSignatureSyncResult,
}: UseMailStateProps) {
  const [activeSplit, setActiveSplitState] = useState<SplitInboxKind>('important');
  const [splitCounts, setSplitCounts] = useState<Record<string, number>>({});
  const [mailboxView, setMailboxViewState] = useState<MailboxView>('inbox');
  const [mailboxCounts, setMailboxCounts] = useState<Record<MailboxView, number>>({ inbox: 0, drafts: 0, sent: 0, trash: 0, spam: 0, muted: 0 });
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null);
  
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [mailboxIndex, setMailboxIndex] = useState<MailboxIndex | null>(null);
  const [loadedThreadScopeKey, setLoadedThreadScopeKey] = useState<string | null>(null);
  const [navigationActivity, setNavigationActivity] = useState<NavigationActivity>(IDLE_NAVIGATION_ACTIVITY);
  const [visibleThreads, setVisibleThreads] = useState<MailThread[]>([]);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<MailThread | null>(null);
  const [openedThreadMessages, setOpenedThreadMessagesState] = useState<MailMessage[]>([]);
  const [openedThreadMessagesKey, setOpenedThreadMessagesKey] = useState<string | null>(null);
  const [openedThreadMessagesStatus, setOpenedThreadMessagesStatus] = useState<ThreadHeaderMessagesStatus>('idle');
  const [threadAgentInsights, setThreadAgentInsights] = useState<ThreadAgentInsights | null>(null);
  const [agentInsightsLoading, setAgentInsightsLoading] = useState(false);
  const openedThreadKeyRef = useRef<string | null>(null);
  const mailboxSnapshotCacheRef = useRef<Map<string, CachedMailboxSnapshot>>(new Map());
  const mailboxLoadGenerationRef = useRef(0);
  const threadsRef = useRef<MailThread[]>(threads);
  const mailboxIndexRef = useRef<MailboxIndex | null>(mailboxIndex);
  threadsRef.current = threads;
  mailboxIndexRef.current = mailboxIndex;

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchCoverage] = useState<string>('Local Cache');
  const [searchStatus, setSearchStatusState] = useState<MailSearchState>(IDLE_SEARCH_STATE);
  const searchStatusResetRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [searchTopCount, setSearchTopCount] = useState(0);
  const [semanticMatchThreadIds, setSemanticMatchThreadIds] = useState<Set<string>>(new Set());
  
  const [actionLog, setActionLog] = useState<MailActionLog[]>([]);
  const [followUpRadar, setFollowUpRadar] = useState<FollowUpRadarResult | null>(null);
  const [followUpRadarLoading, setFollowUpRadarLoading] = useState(false);
  const [followUpRadarError, setFollowUpRadarError] = useState<string | null>(null);
  
  const [speedProof, setSpeedProof] = useState<SpeedProof>({
    detailCacheCoverage: '0% detail · 0% bodies'
  });

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const sentSyncAtRef = useRef<Map<string, number>>(new Map());
  const activeScopeKey = accountScopeKey(activeAccount, accounts);
  const mailboxIndexConfigKey = JSON.stringify({ categorySettings, tabCategories, mutedLabelIdsByAccount });
  const activeScopeKeyRef = useRef<string | null>(activeScopeKey);
  activeScopeKeyRef.current = activeScopeKey;

  const updateSearchState = useCallback((state: MailSearchState) => {
    if (searchStatusResetRef.current !== null) {
      globalThis.clearTimeout(searchStatusResetRef.current);
      searchStatusResetRef.current = null;
    }

    setSearchStatusState(state);
    // Auto-hide the Done chip only once the semantic pass has settled.
    if (state.phase === 'complete' && state.semantic !== 'pending') {
      searchStatusResetRef.current = globalThis.setTimeout(() => {
        setSearchStatusState(current =>
          current.phase === 'complete' ? { ...current, phase: 'idle' } : current);
        searchStatusResetRef.current = null;
      }, SEARCH_COMPLETE_VISIBLE_MS);
    }
  }, []);

  useEffect(() => () => {
    if (searchStatusResetRef.current !== null) {
      globalThis.clearTimeout(searchStatusResetRef.current);
    }
  }, []);

  const resetOpenedThreadMessages = () => {
    setOpenedThreadMessagesState([]);
    setOpenedThreadMessagesKey(null);
    setOpenedThreadMessagesStatus('idle');
    setThreadAgentInsights(null);
    setAgentInsightsLoading(false);
    setNavigationActivity(current => (
      current.phase === 'loadingThread' || current.phase === 'renderingMessages'
        ? IDLE_NAVIGATION_ACTIVITY
        : current
    ));
  };

  const startOpenedThreadMessagesLoad = (key: string) => {
    setOpenedThreadMessagesState([]);
    setOpenedThreadMessagesKey(key);
    setOpenedThreadMessagesStatus('loading');
    setNavigationActivity({
      phase: 'loadingThread',
      label: 'Loading conversation…',
      scopeKey: key,
      startedAt: performance.now(),
    });
  };

  const acceptOpenedThreadMessages = (key: string, messages: MailMessage[]) => {
    setOpenedThreadMessagesState(messages);
    setOpenedThreadMessagesKey(key);
    setOpenedThreadMessagesStatus('ready');
    setNavigationActivity(current => (
      current.scopeKey === key ? IDLE_NAVIGATION_ACTIVITY : current
    ));
  };

  const rejectOpenedThreadMessages = (key: string, error: unknown) => {
    console.error('Failed to load conversation:', error);
    if (openedThreadKeyRef.current !== key) return;
    setOpenedThreadMessagesState([]);
    setOpenedThreadMessagesKey(key);
    setOpenedThreadMessagesStatus('ready');
    setThreadAgentInsights(null);
    setAgentInsightsLoading(false);
    setNavigationActivity(current => current.scopeKey === key ? IDLE_NAVIGATION_ACTIVITY : current);
    emitToast({ type: 'error', message: 'Conversation details could not be loaded.' });
  };

  const setOpenedThreadMessages = (messages: MailMessage[]) => {
    const currentKey = openedThreadKeyRef.current;
    setOpenedThreadMessagesState(messages);
    setOpenedThreadMessagesKey(currentKey);
    setOpenedThreadMessagesStatus(currentKey ? 'ready' : 'idle');
  };

  const refreshThreadAgentInsights = useCallback(async (threadArg?: MailThread | null) => {
    const thread = threadArg === undefined ? openedThread : threadArg;
    if (!thread) {
      setThreadAgentInsights(null);
      setAgentInsightsLoading(false);
      return;
    }

    const key = threadStateKey(thread);
    setAgentInsightsLoading(true);
    try {
      const insights = await window.electronAPI.getThreadAgentInsights(thread.accountId, thread.id);
      if (openedThreadKeyRef.current === key) {
        setThreadAgentInsights(insights);
      }
    } catch (err) {
      console.error('Failed to load agent insights:', err);
      if (openedThreadKeyRef.current === key) {
        setThreadAgentInsights(null);
      }
    } finally {
      if (openedThreadKeyRef.current === key) {
        setAgentInsightsLoading(false);
      }
    }
  }, [openedThread]);



  useEffect(() => {
    openedThreadKeyRef.current = threadStateKey(openedThread);
  }, [openedThread]);

  useEffect(() => {
    setOpenedThread(current => {
      if (!current) return current;
      const latestThread = threads.find(t => t.id === current.id && t.accountId === current.accountId);
      return latestThread || current;
    });
  }, [threads]);

  const setActiveSplit = (split: SplitInboxKind) => {
    setMailboxViewState('inbox');
    setActiveSplitState(split);
    if (mailboxIndex && !searchQuery.trim()) {
      setVisibleThreads(threadsForMailboxIndex(mailboxIndex, 'inbox', split));
      setNavigationActivity(IDLE_NAVIGATION_ACTIVITY);
    }
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSelectedThreadIds(new Set());
  };

  const setMailboxView = useCallback((view: MailboxView) => {
    setMailboxViewState(view);
    if (mailboxIndex && !searchQuery.trim()) {
      setVisibleThreads(threadsForMailboxIndex(mailboxIndex, view, activeSplit));
      setNavigationActivity(IDLE_NAVIGATION_ACTIVITY);
    }
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSelectedThreadIds(new Set());
  }, [activeSplit, mailboxIndex, searchQuery]);


  const getThreadCategory = useCallback((t: MailThread): string => (
    categorize(t, categorySettings.builtIn, categorySettings.custom, 'other')
  ), [categorySettings]);

  const patchThread = useCallback((
    accountId: string,
    threadId: string,
    patch: (thread: MailThread) => MailThread,
  ) => {
    const previousThreads = threadsRef.current;
    const threadIndex = previousThreads.findIndex(thread => thread.accountId === accountId && thread.id === threadId);
    if (threadIndex < 0) return;
    const previousThread = previousThreads[threadIndex];
    const nextThread = patch(previousThread);
    const nextThreads = previousThreads.slice();
    nextThreads[threadIndex] = nextThread;

    let nextIndex = mailboxIndexRef.current;
    if (nextIndex) {
      nextIndex = replaceThreadInMailboxIndex({
        index: nextIndex,
        previousThread,
        nextThread,
        tabCategories,
        mutedLabelIdsByAccount,
        getThreadCategory,
      });
    }

    threadsRef.current = nextThreads;
    mailboxIndexRef.current = nextIndex;
    setThreads(nextThreads);
    setMailboxIndex(nextIndex);
    if (nextIndex) {
      setSplitCounts(nextIndex.splitCounts);
      setMailboxCounts(nextIndex.mailboxCounts);
      const scopeKey = activeScopeKeyRef.current;
      if (scopeKey) {
        mailboxSnapshotCacheRef.current.set(scopeKey, {
          accountIds: accountIdsForScope(activeAccount, accounts),
          threads: nextThreads,
          index: nextIndex,
          indexConfigKey: mailboxIndexConfigKey,
        });
      }
    }
  }, [
    accounts,
    activeAccount,
    getThreadCategory,
    mailboxIndexConfigKey,
    mutedLabelIdsByAccount,
    tabCategories,
  ]);

  // Load accounts initially
  const loadAccounts = useCallback(async () => {
    const accList = await window.electronAPI.listAccounts();
    setAccounts(accList);
    if (accList.length > 0 && !activeAccount) {
      setActiveAccountState(accList[0]);
    }
  }, [activeAccount]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const setActiveAccount = useCallback((account: Account | null) => {
    mailboxLoadGenerationRef.current += 1;
    const nextScopeKey = accountScopeKey(account, accounts);
    const cachedCandidate = nextScopeKey ? mailboxSnapshotCacheRef.current.get(nextScopeKey) : null;
    const cached = cachedCandidate?.indexConfigKey === mailboxIndexConfigKey ? cachedCandidate : null;
    setActiveAccountState(account);
    setThreads(cached?.threads || []);
    setMailboxIndex(cached?.index || null);
    setLoadedThreadScopeKey(cached ? nextScopeKey : null);
    setVisibleThreads([]);
    if (cached) {
      setSplitCounts(cached.index.splitCounts);
      setMailboxCounts(cached.index.mailboxCounts);
      setNavigationActivity(IDLE_NAVIGATION_ACTIVITY);
    } else {
      setSplitCounts({});
      setMailboxCounts({ inbox: 0, drafts: 0, sent: 0, trash: 0, spam: 0, muted: 0 });
      setNavigationActivity(account ? {
        phase: 'loadingAccount',
        label: 'Loading account…',
        scopeKey: nextScopeKey,
        startedAt: performance.now(),
      } : IDLE_NAVIGATION_ACTIVITY);
    }
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSearchQuery('');
    setSelectedThreadIds(new Set());
  }, [accounts, mailboxIndexConfigKey]);


  // Listen to open thread requests from push notification click
  useEffect(() => {
    // Request notification permission if not already requested or granted
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(err => {
        console.error('Failed to request notification permission:', err);
      });
    }

    if (accounts.length === 0) return;

    const handleOpenNotificationThread = async (data: { accountId: string; threadId: string }) => {
      const { accountId, threadId } = data;
      
      const acc = accounts.find(a => a.email === accountId);
      if (!acc) return;

      setActiveAccount(acc);
      setMailboxViewState('inbox');
      resetOpenedThreadMessages();

      const threadsList = await window.electronAPI.listThreads(accountId);
      const thread = threadsList.find(t => t.id === threadId);
      if (thread) {
        const category = getThreadCategory(thread);
        setActiveSplitState(category);

        const nextThreadKey = threadStateKey(thread);
        if (!nextThreadKey) return;
        openedThreadKeyRef.current = nextThreadKey;
        setOpenedThread(thread);
        setFocusedThreadId(thread.id);
        startOpenedThreadMessagesLoad(nextThreadKey);
        setAgentInsightsLoading(true);

        try {
          const payload = await window.electronAPI.getThreadReaderPayload(thread.accountId, thread.id);
          if (openedThreadKeyRef.current !== nextThreadKey) return;
          acceptOpenedThreadMessages(nextThreadKey, payload.messages);
          setThreadAgentInsights(payload.insights);
          setAgentInsightsLoading(false);
        } catch (error) {
          rejectOpenedThreadMessages(nextThreadKey, error);
          return;
        }

        if (thread.isUnread && inboxSettings.autoMarkReadOnOpen) {
          patchThread(thread.accountId, thread.id, current => ({ ...current, isUnread: false }));
          window.electronAPI.modifyLabels(thread.accountId, thread.id, [], ['UNREAD']).catch(err => {
            console.error('Failed to mark thread as read from notification:', err);
          });
        }
      }
    };

    const unsubscribe = window.electronAPI.onOpenThread((data) => {
      handleOpenNotificationThread(data);
    });

    // Check if there was a pending open thread from app cold startup
    (async () => {
      try {
        const pending = await window.electronAPI.getPendingOpenThread();
        if (pending) {
          handleOpenNotificationThread(pending);
        }
      } catch (err) {
        console.error('Failed to get pending open thread on mount:', err);
      }
    })();

    return unsubscribe;
  }, [accounts, getThreadCategory, inboxSettings.autoMarkReadOnOpen, patchThread, setActiveAccount]);

  // Main threads load & sync loop
  const loadThreadsFromDB = useCallback(async (force = false) => {
    if (!activeAccount) return;
    const scopeKey = accountScopeKey(activeAccount, accounts);
    if (!scopeKey) return;
    const cachedCandidate = mailboxSnapshotCacheRef.current.get(scopeKey);
    const cached = cachedCandidate?.indexConfigKey === mailboxIndexConfigKey ? cachedCandidate : null;
    if (cached && !force) {
      setThreads(cached.threads);
      setMailboxIndex(cached.index);
      setSplitCounts(cached.index.splitCounts);
      setMailboxCounts(cached.index.mailboxCounts);
      setLoadedThreadScopeKey(scopeKey);
      setNavigationActivity(IDLE_NAVIGATION_ACTIVITY);
      return;
    }

    const generation = ++mailboxLoadGenerationRef.current;
    const start = performance.now();
    setNavigationActivity({
      phase: cached ? 'refreshing' : 'loadingAccount',
      label: cached ? 'Refreshing…' : 'Loading account…',
      scopeKey,
      startedAt: performance.now(),
    });

    const accountIds = accountIdsForScope(activeAccount, accounts);
    const list = await window.electronAPI.listThreadsForAccounts(accountIds);
    if (generation !== mailboxLoadGenerationRef.current || activeScopeKeyRef.current !== scopeKey) return;
    
    setThreads(list);
    setMailboxIndex(null);
    setLoadedThreadScopeKey(scopeKey);
    
    setSpeedProof((prev: SpeedProof) => ({
      ...prev,
      cacheReadyMs: Math.round(performance.now() - start)
    }));

    setSpeedProof((prev: SpeedProof) => ({
      ...prev,
      detailCacheCoverage: 'Bodies load on open',
    }));
  }, [activeAccount, accounts, mailboxIndexConfigKey]);

  useEffect(() => {
    loadThreadsFromDB();
  }, [loadThreadsFromDB]);

  useEffect(() => {
    if (!activeScopeKey || loadedThreadScopeKey !== activeScopeKey) return;

    const cached = mailboxSnapshotCacheRef.current.get(activeScopeKey);
    if (cached && cached.threads === threads && cached.indexConfigKey === mailboxIndexConfigKey) {
      setMailboxIndex(cached.index);
      setSplitCounts(cached.index.splitCounts);
      setMailboxCounts(cached.index.mailboxCounts);
      setNavigationActivity(current => (
        current.phase === 'loadingThread' ? current : IDLE_NAVIGATION_ACTIVITY
      ));
      return;
    }

    let cancelled = false;
    setNavigationActivity(current => current.phase === 'loadingThread' ? current : {
      phase: 'buildingMailbox',
      label: 'Organizing mail…',
      scopeKey: activeScopeKey,
      startedAt: performance.now(),
    });

    void buildMailboxIndexCooperatively({
      threads,
      tabCategories,
      mutedLabelIdsByAccount,
      getThreadCategory,
      isCancelled: () => cancelled,
    }).then(index => {
      if (!index || cancelled || activeScopeKeyRef.current !== activeScopeKey) return;
      setMailboxIndex(index);
      setSplitCounts(index.splitCounts);
      setMailboxCounts(index.mailboxCounts);
      mailboxSnapshotCacheRef.current.set(activeScopeKey, {
        accountIds: accountIdsForScope(activeAccount, accounts),
        threads,
        index,
        indexConfigKey: mailboxIndexConfigKey,
      });
      setNavigationActivity(current => (
        current.phase === 'loadingThread' ? current : IDLE_NAVIGATION_ACTIVITY
      ));
    });

    return () => {
      cancelled = true;
    };
  }, [
    accounts,
    activeAccount,
    activeScopeKey,
    getThreadCategory,
    loadedThreadScopeKey,
    mailboxIndexConfigKey,
    mutedLabelIdsByAccount,
    tabCategories,
    threads,
  ]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRemindersDue(() => {
      loadThreadsFromDB(true);
    });
    return unsubscribe;
  }, [loadThreadsFromDB]);

  const applyMailboxDelta = useCallback((delta: MailboxDelta) => {
    if (delta.upserts.length === 0 && delta.deletedThreadIds.length === 0) return;
    for (const [scopeKey, snapshot] of mailboxSnapshotCacheRef.current) {
      if (!snapshot.accountIds.includes(delta.accountId)) continue;
      const nextThreads = applyDeltaToThreads(snapshot.threads, delta);
      mailboxSnapshotCacheRef.current.delete(scopeKey);
      if (scopeKey === activeScopeKeyRef.current) {
        setThreads(nextThreads);
        setMailboxIndex(null);
      }
    }

    if (!accountIdsForScope(activeAccount, accounts).includes(delta.accountId)) return;
    setNavigationActivity({
      phase: 'refreshing',
      label: 'Refreshing…',
      scopeKey: activeScopeKeyRef.current,
      startedAt: performance.now(),
    });
    setThreads(current => applyDeltaToThreads(current, delta));
    setMailboxIndex(null);
  }, [activeAccount, accounts]);

  const {
    syncHealth,
    syncStatusText,
    backfillProgress,
    isSyncing,
    lastSuccessfulSync,
    onboardAccount,
    disconnectAccount,
    triggerSyncManual,
    triggerBackfillManual,
    setSyncHealth,
    setSyncStatusText,
    setBackfillProgress,
    setIsSyncing,
  } = useMailSync({
    accounts,
    activeAccount,
    clearCacheOnDisconnect: privacySettings.clearCacheOnDisconnect,
    loadAccounts,
    setActiveAccountState,
    applyMailboxDelta,
    setSpeedProof,
    applyGmailSignatureSyncResult,
  });

  useEffect(() => {
    if (mailboxView !== 'sent' || !activeAccount) return;

    const targetAccounts = activeAccount.id === 'unified' ? accounts : [activeAccount];
    const targetEmails = targetAccounts.map(account => account.email).filter(Boolean).sort();
    if (targetEmails.length === 0) return;

    const syncKey = targetEmails.join('|');
    const lastSyncAt = sentSyncAtRef.current.get(syncKey);
    if (lastSyncAt && Date.now() - lastSyncAt < SENT_SYNC_MIN_INTERVAL_MS) return;
    sentSyncAtRef.current.set(syncKey, Date.now());

    let cancelled = false;

    void (async () => {
      try {
        setSyncHealth('syncing');
        setSyncStatusText('Syncing sent mail...');

        const sentResults = await Promise.all(targetAccounts.map(async account => {
          const result = await window.electronAPI.syncSent(account.email);
          await window.electronAPI.saveThreads(result.threads);
          await window.electronAPI.saveMessages(result.messages);
          return { accountId: account.email, threads: result.threads };
        }));

        for (const result of sentResults) {
          applyMailboxDelta({
            accountId: result.accountId,
            upserts: result.threads,
            deletedThreadIds: [],
            revision: 0,
            completedAt: new Date().toISOString(),
          });
        }
        sentSyncAtRef.current.set(syncKey, Date.now());
        if (cancelled) return;
        setSyncHealth('ready');
        setSyncStatusText('Ready');
      } catch (err) {
        sentSyncAtRef.current.delete(syncKey);
        console.error('Sent mailbox sync failed:', err);
        if (!cancelled) {
          setSyncHealth('failed');
          setSyncStatusText('Sent sync failed');
          emitToast({ type: 'warning', message: 'Could not refresh Sent mail.' });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [mailboxView, activeAccount, accounts, applyMailboxDelta, setSyncHealth, setSyncStatusText]);

  // Sync Action Log
  const loadActionLog = useCallback(async () => {
    if (!activeAccount) return;
    if (activeAccount.id === 'unified') {
      const allLogs: MailActionLog[] = [];
      for (const acc of accounts) {
        const list = await window.electronAPI.listActionLog(acc.email);
        allLogs.push(...list);
      }
      allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setActionLog(allLogs);
    } else {
      const list = await window.electronAPI.listActionLog(activeAccount.email);
      setActionLog(list);
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadActionLog();
  }, [loadActionLog]);

  const loadFollowUpRadar = useCallback(async () => {
    if (!activeAccount || !inboxSettings.enableFollowUps) {
      setFollowUpRadar(null);
      setFollowUpRadarError(null);
      return;
    }

    const targetAccounts = activeAccount.id === 'unified' ? accounts : [activeAccount];
    const accountIds = targetAccounts.map(account => account.email).filter(Boolean);
    if (accountIds.length === 0) {
      setFollowUpRadar(null);
      setFollowUpRadarError(null);
      return;
    }

    setFollowUpRadarLoading(true);
    setFollowUpRadarError(null);
    try {
      const maxAgeDays = Math.max(1, Math.floor(inboxSettings.followUpMaxAgeDays || 30));
      const options = {
        thresholdHours: inboxSettings.followUpThresholdHours,
        maxAgeHours: maxAgeDays * 24,
        maxItems: inboxSettings.followUpMaxItems,
        sentThreadScanLimit: DEFAULT_FOLLOW_UP_SCAN_LIMIT,
      };
      const results = await Promise.all(accountIds.map(accountId => (
        window.electronAPI.listFollowUpRadarItems(accountId, options)
      )));

      if (results.length === 1) {
        setFollowUpRadar(results[0]);
        return;
      }

      const items = results
        .flatMap(result => result.items)
        .sort((a, b) => {
          if (a.priority === b.priority) return Date.parse(b.lastSentAt) - Date.parse(a.lastSentAt);
          return b.priority - a.priority;
        })
        .slice(0, inboxSettings.followUpMaxItems);
      setFollowUpRadar({
        accountId: 'unified',
        generatedAt: new Date().toISOString(),
        scannedThreadCount: results.reduce((sum, result) => sum + result.scannedThreadCount, 0),
        candidateCount: results.reduce((sum, result) => sum + result.candidateCount, 0),
        items,
        warnings: Array.from(new Set(results.flatMap(result => result.warnings))),
      });
    } catch (err) {
      console.error('Follow-up Radar failed:', err);
      setFollowUpRadar(null);
      setFollowUpRadarError(err instanceof Error ? err.message : String(err));
    } finally {
      setFollowUpRadarLoading(false);
    }
  }, [
    activeAccount,
    accounts,
    inboxSettings.enableFollowUps,
    inboxSettings.followUpThresholdHours,
    inboxSettings.followUpMaxAgeDays,
    inboxSettings.followUpMaxItems,
  ]);

  useEffect(() => {
    void loadFollowUpRadar();
  }, [loadFollowUpRadar]);

  const dismissFollowUpRadarItem = useCallback(async (item: FollowUpRadarItem) => {
    const previousRadar = followUpRadar;
    setFollowUpRadar(prev => removeFollowUpRadarItem(prev, item));
    try {
      await window.electronAPI.dismissFollowUpRadarItem(item.accountId, item.threadId, item.sentMessageId);
      void loadFollowUpRadar();
    } catch (err) {
      setFollowUpRadar(previousRadar);
      throw err;
    }
  }, [followUpRadar, loadFollowUpRadar]);

  const snoozeFollowUpRadarItem = useCallback(async (item: FollowUpRadarItem, snoozedUntil: string) => {
    const previousRadar = followUpRadar;
    setFollowUpRadar(prev => removeFollowUpRadarItem(prev, item));
    try {
      await window.electronAPI.snoozeFollowUpRadarItem(item.accountId, item.threadId, item.sentMessageId, snoozedUntil);
      void loadFollowUpRadar();
    } catch (err) {
      setFollowUpRadar(previousRadar);
      throw err;
    }
  }, [followUpRadar, loadFollowUpRadar]);

  const publishVisibleThreads = useCallback((filtered: MailThread[]) => {
    startTransition(() => {
      setVisibleThreads(filtered);
      setFocusedThreadId(prev => {
        if (prev && filtered.some(thread => thread.id === prev)) return prev;
        return filtered.length > 0 ? filtered[0].id : null;
      });
    });
  }, []);

  // Visible Threads filtering based on Search Query and Split Tabs
  useEffect(() => {
    if (threads.length === 0 || !activeAccount) {
      publishVisibleThreads([]);
      updateSearchState(IDLE_SEARCH_STATE);
      setSearchTopCount(0);
      setSemanticMatchThreadIds(prev => (prev.size === 0 ? prev : new Set()));
      return;
    }

    if (!searchQuery.trim()) {
      if (!mailboxIndex) return;
      publishVisibleThreads(threadsForMailboxIndex(mailboxIndex, mailboxView, activeSplit));
      updateSearchState(IDLE_SEARCH_STATE);
      setSearchTopCount(0);
      setSemanticMatchThreadIds(prev => (prev.size === 0 ? prev : new Set()));
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;
    const indexedThreadCategory = (thread: MailThread) => (
      mailboxIndex ? categoryFromMailboxIndex(mailboxIndex, thread) || getThreadCategory(thread) : getThreadCategory(thread)
    );

    const filterThreads = async () => {
      const start = performance.now();
      const now = new Date();
      const trimmedQuery = searchQuery.trim();
      const parsed = trimmedQuery ? parseSearchQuery(searchQuery) : null;
      const textQuery = parsed ? searchTextQuery(parsed) : '';
      const ftsQuery = parsed ? buildFtsMatchQuery(parsed.textTerms) : '';
      const accountIds = activeAccount.id === 'unified'
        ? accounts.map(acc => acc.email)
        : [activeAccount.email];
      const semanticDue = Boolean(textQuery) && shouldRunSemanticSearch(textQuery);

      updateSearchState({ phase: 'searching', semantic: semanticDue ? 'pending' : 'off', coverage: null });

      const applyMatches = async (
        matchLists: RankedSourceList[],
      ): Promise<boolean> => {
        const matches = flattenMatchLists(matchLists);
        const nextFiltered = await filterVisibleThreadsCooperatively({
          threads,
          searchQuery,
          matches,
          activeSplit,
          mailboxView,
          now,
          tabCategories,
          labelDefinitions,
          mutedLabelIdsByAccount,
          getThreadCategory: indexedThreadCategory,
          isCancelled,
        });

        if (!nextFiltered || cancelled) return false;

        if (textQuery) {
          const fusion = fuseSearchMatches(matchLists);
          const ordered = orderSearchResults(nextFiltered, fusion);
          publishVisibleThreads(ordered.threads);
          setSearchTopCount(ordered.topCount);
          setSemanticMatchThreadIds(ordered.semanticOnlyThreadIds);
        } else {
          publishVisibleThreads(nextFiltered);
          setSearchTopCount(0);
          setSemanticMatchThreadIds(prev => (prev.size === 0 ? prev : new Set()));
        }
        return true;
      };

      try {
        let ftsLists: RankedSourceList[] = [];
        if (ftsQuery) {
          try {
            ftsLists = await collectFtsMatchLists(accountIds, ftsQuery, window.electronAPI.searchFTS);
          } catch (err) {
            console.error('Local mail search failed:', err);
            ftsLists = [];
          }
        }

        if (cancelled) return;

        const didApplyFts = await applyMatches(ftsLists);
        if (!didApplyFts || cancelled) return;

        setSpeedProof((prev: SpeedProof) => ({
          ...prev,
          searchMs: Math.round(performance.now() - start)
        }));

        if (!semanticDue) {
          if (!cancelled) updateSearchState({ phase: 'complete', semantic: 'off', coverage: null });
          return;
        }

        updateSearchState({ phase: 'complete', semantic: 'pending', coverage: null });

        // Fire semantic search only after the user has paused typing; a new
        // searchQuery commit cancels this effect and skips the IPC call.
        const settled = await waitUnlessCancelled(SEMANTIC_SEARCH_SETTLE_DELAY_MS, isCancelled);
        if (!settled || cancelled) return;

        // Apply-when-ready: no timeout race — late results still land unless
        // this effect was cancelled by a newer query (main also supersedes).
        const semantic = await collectSemanticOutcomes(accountIds, textQuery, window.electronAPI.searchSemantic);
        if (cancelled) return;

        if (semantic.lists.length > 0) {
          const didApplySemantic = await applyMatches([...ftsLists, ...semantic.lists]);
          if (!didApplySemantic || cancelled) return;
        }

        updateSearchState({
          phase: 'complete',
          semantic: semantic.state === 'ok' ? 'applied' : semantic.state === 'error' ? 'error' : 'off',
          coverage: semantic.coverage,
          errorMessage: semantic.errorMessage,
        });
      } catch (err) {
        console.error('Mail search filtering failed:', err);
        if (!cancelled) updateSearchState({ phase: 'complete', semantic: 'off', coverage: null });
      }
    };

    void filterThreads();
    return () => {
      cancelled = true;
    };
  }, [
    threads,
    searchQuery,
    activeSplit,
    mailboxView,
    mailboxIndex,
    activeAccount,
    accounts,
    getThreadCategory,
    labelDefinitions,
    mutedLabelIdsByAccount,
    publishVisibleThreads,
    updateSearchState,
  ]);

  // Open Thread Detail
  const openThread = async (thread: MailThread | null) => {
    const previousThreadKey = openedThreadKeyRef.current;
    const nextThreadKey = threadStateKey(thread);
    openedThreadKeyRef.current = nextThreadKey;
    setOpenedThread(thread);
    if (!thread || !activeAccount) {
      resetOpenedThreadMessages();
      return;
    }

    setFocusedThreadId(thread.id);
    if (!nextThreadKey) {
      resetOpenedThreadMessages();
      return;
    }
    if (previousThreadKey !== nextThreadKey || openedThreadMessagesKey !== nextThreadKey) {
      startOpenedThreadMessagesLoad(nextThreadKey);
    }

    setAgentInsightsLoading(true);
    let msgs: MailMessage[];
    try {
      const payload = await window.electronAPI.getThreadReaderPayload(thread.accountId, thread.id);
      if (openedThreadKeyRef.current !== nextThreadKey) return;
      msgs = payload.messages;
      acceptOpenedThreadMessages(nextThreadKey, msgs);
      setThreadAgentInsights(payload.insights);
      setAgentInsightsLoading(false);
    } catch (error) {
      rejectOpenedThreadMessages(nextThreadKey, error);
      return;
    }

    if (shouldRefreshInlineCidMetadata(msgs)) {
      void (async () => {
        try {
          const freshMessages = await window.electronAPI.fetchThreadDetail(thread.accountId, thread.id);
          await window.electronAPI.saveMessages(freshMessages);
          if (openedThreadKeyRef.current === nextThreadKey) {
            acceptOpenedThreadMessages(nextThreadKey, freshMessages);
            void refreshThreadAgentInsights(thread);
          }
        } catch (err) {
          console.error('Failed to refresh inline message assets:', err);
        }
      })();
    }

    if (thread.isUnread && inboxSettings.autoMarkReadOnOpen && openedThreadKeyRef.current === nextThreadKey) {
      executeMailAction('markRead', thread.id);
    }
  };

  // Mail Operations wrapper (Read, Done, Reminders)
  const executeMailAction = async (
    kind: MailActionLog['kind'],
    threadId?: string | null,
    draftId?: string | null,
    customAction?: (actionId: string) => Promise<any>,
    payloadJson?: string | null
  ): Promise<MailActionExecutionResult> => {
    if (!activeAccount) return { accepted: false, offline: false, errorMessage: 'No active account.' };

    const targetThreadId = threadId || openedThread?.id || focusedThreadId || null;
    if (!targetThreadId && kind !== 'send') return { accepted: false, offline: false, errorMessage: 'No target thread.' };

    const payload = payloadJson ? JSON.parse(payloadJson) : {};
    const propagateReviewedFailure = Boolean(payload.proposalValidationItem);
    const payloadAccountId = typeof payload.accountId === 'string' ? payload.accountId : null;
    const actionId = crypto.randomUUID();
    const thread = targetThreadId
      ? payloadAccountId
        ? threads.find(t => t.id === targetThreadId && t.accountId === payloadAccountId) || null
        : threads.find(t => t.id === targetThreadId) || null
      : null;
    if (targetThreadId && payloadAccountId && !thread) {
      throw new Error('The account-scoped target thread is no longer available.');
    }
    const targetAccountId = payloadAccountId || (thread ? thread.accountId : activeAccount.email);
    
    const log: MailActionLog = {
      id: actionId,
      accountId: targetAccountId,
      threadId: targetThreadId,
      draftId,
      kind,
      status: 'queued',
      createdAt: new Date().toISOString(),
      payloadJson: payloadJson || null
    };

    setActionLog(prev => [log, ...prev]);

    // OPTIMISTIC UI STATE TRANSITIONS
    const currentIdx = targetThreadId ? visibleThreads.findIndex(t => t.id === targetThreadId) : -1;
    let nextThread: MailThread | null = null;
    if (currentIdx !== -1) {
      if (currentIdx + 1 < visibleThreads.length) {
        nextThread = visibleThreads[currentIdx + 1];
      } else if (currentIdx - 1 >= 0) {
        nextThread = visibleThreads[currentIdx - 1];
      }
    }

    const payloadLabelId = typeof payload.labelId === 'string' ? payload.labelId : null;

    if (kind === 'markDone') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: t.labelIds.filter(label => label.toUpperCase() !== 'INBOX') }
          : t
      )));
      if (mailboxView === 'inbox' && openedThread?.id === targetThreadId) {
        openThread(inboxSettings.openNextThreadAfterDone ? nextThread : null);
      }
      if (mailboxView === 'inbox' && nextThread && inboxSettings.openNextThreadAfterDone) {
        setFocusedThreadId(nextThread.id);
      } else if (mailboxView === 'inbox') {
        setFocusedThreadId(null);
      }
    } else if (kind === 'autoMarkRead' || kind === 'setReminder') {
      const fallbackReminder = new Date();
      fallbackReminder.setDate(fallbackReminder.getDate() + 1);
      fallbackReminder.setHours(9, 0, 0, 0);
      const reminderAt = typeof payload.reminderAt === 'string' ? payload.reminderAt : fallbackReminder.toISOString();
      setThreads(prev => applyOptimisticThreadReminder(prev, targetAccountId, targetThreadId || '', reminderAt));
      if (kind === 'autoMarkRead') {
        if (openedThread?.id === targetThreadId) {
          openThread(nextThread);
        }
        if (nextThread) {
          setFocusedThreadId(nextThread.id);
        } else {
          setFocusedThreadId(null);
        }
      }
    } else if (kind === 'markRead') {
      if (targetThreadId) patchThread(targetAccountId, targetThreadId, current => ({ ...current, isUnread: false }));
    } else if (kind === 'markUnread') {
      if (targetThreadId) patchThread(targetAccountId, targetThreadId, current => ({ ...current, isUnread: true }));
    } else if (kind === 'moveToTrash') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== 'INBOX'), 'TRASH'])) }
          : t
      )));
      if (openedThread?.id === targetThreadId) openThread(nextThread);
    } else if (kind === 'restoreFromTrash') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== 'TRASH'), 'INBOX'])) }
          : t
      )));
      if (mailboxView === 'trash' && openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
    } else if (kind === 'reportSpam') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== 'INBOX'), 'SPAM'])) }
          : t
      )));
      if (openedThread?.id === targetThreadId) openThread(nextThread);
    } else if (kind === 'restoreFromSpam') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== 'SPAM'), 'INBOX'])) }
          : t
      )));
      if (mailboxView === 'spam' && openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
    } else if (kind === 'muteThread') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? {
              ...t,
              labelIds: Array.from(new Set([
                ...t.labelIds.filter(label => label.toUpperCase() !== 'INBOX'),
                ...(payloadLabelId ? [payloadLabelId] : [])
              ]))
            }
          : t
      )));
      if (openedThread?.id === targetThreadId) openThread(nextThread);
    } else if (kind === 'unmuteThread' && payloadLabelId) {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label !== payloadLabelId), 'INBOX'])) }
          : t
      )));
      if (mailboxView === 'muted' && openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
    } else if (kind === 'unsubscribeSender') {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: t.labelIds.filter(label => label.toUpperCase() !== 'INBOX') }
          : t
      )));
      if (mailboxView === 'inbox' && openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
      if (mailboxView === 'inbox' && nextThread) {
        setFocusedThreadId(nextThread.id);
      } else if (mailboxView === 'inbox') {
        setFocusedThreadId(null);
      }
    } else if ((kind === 'applyLabel' || kind === 'moveToLabel') && payloadLabelId) {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? {
              ...t,
              labelIds: Array.from(new Set([
                ...t.labelIds.filter(label => kind === 'moveToLabel' ? label.toUpperCase() !== 'INBOX' : true),
                payloadLabelId
              ]))
            }
          : t
      )));
      if (kind === 'moveToLabel' && openedThread?.id === targetThreadId) openThread(nextThread);
    } else if (kind === 'removeLabel' && payloadLabelId) {
      setThreads(prev => prev.map(t => (
        t.id === targetThreadId && t.accountId === targetAccountId
          ? { ...t, labelIds: t.labelIds.filter(label => label !== payloadLabelId) }
          : t
      )));
    }

    return await (async (): Promise<MailActionExecutionResult> => {
      try {
        await window.electronAPI.saveActionLog(log);
        log.status = 'running';
        await window.electronAPI.saveActionLog(log);

        let res: any = null;
        if (customAction) {
          res = await customAction(actionId);
        } else {
          if (!targetThreadId && kind !== 'send') {
            return { accepted: false, offline: false, actionId, errorMessage: 'No target thread.' };
          }

          if (kind === 'markDone' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['INBOX'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'restoreInbox' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], [], actionId);
            loadThreadsFromDB(true);
          } else if (kind === 'markRead' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['UNREAD'], actionId);
          } else if (kind === 'markUnread' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['UNREAD'], [], actionId);
          } else if (kind === 'moveToTrash' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['TRASH'], ['INBOX'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'restoreFromTrash' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], ['TRASH'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'reportSpam' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['SPAM'], ['INBOX'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'restoreFromSpam' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], ['SPAM'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'muteThread' && targetThreadId) {
            const addLabels = payloadLabelId ? [payloadLabelId] : [];
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, addLabels, ['INBOX'], actionId, kind, payloadJson || undefined);
          } else if (kind === 'unmuteThread' && targetThreadId) {
            const removeLabels = payloadLabelId ? [payloadLabelId] : [];
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], removeLabels, actionId, kind, payloadJson || undefined);
          } else if ((kind === 'applyLabel' || kind === 'moveToLabel') && targetThreadId && payloadLabelId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [payloadLabelId], kind === 'moveToLabel' ? ['INBOX'] : [], actionId, kind, payloadJson || undefined);
          } else if (kind === 'removeLabel' && targetThreadId && payloadLabelId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], [payloadLabelId], actionId, kind, payloadJson || undefined);
          } else if (kind === 'setReminder' && targetThreadId) {
            const fallbackReminder = new Date();
            fallbackReminder.setDate(fallbackReminder.getDate() + 1);
            fallbackReminder.setHours(9, 0, 0, 0);
            const reminderAt = typeof payload.reminderAt === 'string' ? payload.reminderAt : fallbackReminder.toISOString();
            await window.electronAPI.saveReminder(
              targetAccountId,
              targetThreadId,
              reminderAt,
              payload.proposalValidationItem,
            );
          }
        }

        if (res && res.offline) {
          loadActionLog();
          return { accepted: true, offline: true, actionId };
        } else {
          log.status = 'completed';
          log.completedAt = new Date().toISOString();
          await window.electronAPI.saveActionLog(log);
          loadActionLog();
          return { accepted: true, offline: false, actionId };
        }
      } catch (err: any) {
        console.error('Background mail action failed:', err);
        log.status = 'failed';
        log.failureMessage = err.message;
        await window.electronAPI.saveActionLog(log);
        loadActionLog();

        loadThreadsFromDB(true);
        if (propagateReviewedFailure) throw err;
        return { accepted: false, offline: false, actionId, errorMessage: err.message };
      }
    })();
  };

  const undoLastAction = async () => {
    const lastReversible = actionLog.find(l => l.status === 'completed' && isReversibleMailActionKind(l.kind));
    if (!lastReversible) {
      emitToast({ type: 'info', message: 'Nothing to undo.' });
      return;
    }

    const reverseKind = reverseMailActionKind(lastReversible.kind);
    if (!reverseKind) return;

    await executeMailAction(reverseKind, lastReversible.threadId, null, undefined, lastReversible.payloadJson || null);
  };

  const snoozeThread = async (thread: MailThread, date: Date) => {
    const reminderAt = date.toISOString();
    await executeMailAction('autoMarkRead', thread.id, null, async () => {
      await window.electronAPI.saveReminder(thread.accountId, thread.id, reminderAt);
    }, JSON.stringify({ accountId: thread.accountId, reminderAt }));
  };

  const clearThreadReminder = async (thread: MailThread) => {
    await window.electronAPI.deleteReminder(thread.accountId, thread.id);
    setThreads(prev => applyOptimisticThreadReminder(prev, thread.accountId, thread.id, null));
    loadThreadsFromDB();
  };

  const triggerVisibleBodyRepair = async () => {
    if (!activeAccount || visibleThreads.length === 0) return;
    
    setSyncStatusText('Caching bodies...');
    setSyncHealth('syncing');

    const targets = visibleThreads.slice(0, 25);
    try {
      await Promise.all(targets.map(async t => {
        const msgs = await window.electronAPI.fetchThreadDetail(activeAccount.email, t.id);
        await window.electronAPI.saveMessages(msgs);
      }));
      await loadThreadsFromDB();
      setSyncHealth('ready');
      setSyncStatusText('Ready');
    } catch (e) {
      console.error('Body repair caching failed:', e);
      setSyncHealth('failed');
      setSyncStatusText('Cache repair failed');
    }
  };

  const toggleThreadSelection = useCallback((threadId: string) => {
    setSelectedThreadIds(prev => {
      const next = new Set(prev);
      if (next.has(threadId)) {
        next.delete(threadId);
      } else {
        next.add(threadId);
      }
      return next;
    });
  }, []);

  const selectAllThreads = useCallback(() => {
    setSelectedThreadIds(new Set(visibleThreads.map(t => t.id)));
  }, [visibleThreads]);

  const clearThreadSelection = useCallback(() => {
    setSelectedThreadIds(new Set());
  }, []);

  const handleSetSearchQuery = useCallback((q: string) => {
    setSearchQuery(q);
    setSelectedThreadIds(new Set());
  }, []);

  const executeBatchMailAction = async (
    kind: 'markRead' | 'markUnread' | 'markDone' | 'moveToTrash' | 'restoreFromTrash' | 'reportSpam' | 'restoreFromSpam',
    threadIds: string[]
  ) => {
    if (!activeAccount || threadIds.length === 0) return;

    setSelectedThreadIds(new Set());

    // OPTIMISTIC UI STATE TRANSITIONS
    if (kind === 'markDone') {
      setThreads(prev => prev.map(t => (
        threadIds.includes(t.id)
          ? { ...t, labelIds: t.labelIds.filter(label => label.toUpperCase() !== 'INBOX') }
          : t
      )));
      if (mailboxView === 'inbox' && openedThread && threadIds.includes(openedThread.id)) {
        const remainingVisible = visibleThreads.filter(t => !threadIds.includes(t.id));
        if (inboxSettings.openNextThreadAfterDone && remainingVisible.length > 0) {
          openThread(remainingVisible[0]);
        } else {
          openThread(null);
        }
      }
      if (mailboxView === 'inbox') {
        setFocusedThreadId(null);
      }
    } else if (kind === 'markRead') {
      setThreads(prev => prev.map(t => threadIds.includes(t.id) ? { ...t, isUnread: false } : t));
    } else if (kind === 'markUnread') {
      setThreads(prev => prev.map(t => threadIds.includes(t.id) ? { ...t, isUnread: true } : t));
    } else if (kind === 'moveToTrash' || kind === 'reportSpam') {
      const targetLabel = kind === 'moveToTrash' ? 'TRASH' : 'SPAM';
      setThreads(prev => prev.map(t => threadIds.includes(t.id)
        ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== 'INBOX'), targetLabel])) }
        : t));
    } else if (kind === 'restoreFromTrash' || kind === 'restoreFromSpam') {
      const sourceLabel = kind === 'restoreFromTrash' ? 'TRASH' : 'SPAM';
      setThreads(prev => prev.map(t => threadIds.includes(t.id)
        ? { ...t, labelIds: Array.from(new Set([...t.labelIds.filter(label => label.toUpperCase() !== sourceLabel), 'INBOX'])) }
        : t));
    }

    const promises = threadIds.map(async (targetThreadId) => {
      const actionId = crypto.randomUUID();
      const thread = threads.find(t => t.id === targetThreadId);
      const targetAccountId = thread ? thread.accountId : activeAccount.email;

      const log: MailActionLog = {
        id: actionId,
        accountId: targetAccountId,
        threadId: targetThreadId,
        kind,
        status: 'queued',
        createdAt: new Date().toISOString()
      };

      try {
        await window.electronAPI.saveActionLog(log);
        log.status = 'running';
        await window.electronAPI.saveActionLog(log);

        let res: any = null;
        if (kind === 'markDone') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['INBOX'], actionId);
        } else if (kind === 'markRead') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['UNREAD'], actionId);
        } else if (kind === 'markUnread') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['UNREAD'], [], actionId);
        } else if (kind === 'moveToTrash') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['TRASH'], ['INBOX'], actionId, kind);
        } else if (kind === 'restoreFromTrash') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], ['TRASH'], actionId, kind);
        } else if (kind === 'reportSpam') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['SPAM'], ['INBOX'], actionId, kind);
        } else if (kind === 'restoreFromSpam') {
          res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], ['SPAM'], actionId, kind);
        }

        if (res && res.offline) {
          // keep pending
        } else {
          log.status = 'completed';
          log.completedAt = new Date().toISOString();
          await window.electronAPI.saveActionLog(log);
        }
      } catch (err: any) {
        console.error(`Batch action item failed for thread ${targetThreadId}:`, err);
        log.status = 'failed';
        log.failureMessage = err.message;
        await window.electronAPI.saveActionLog(log);
      }
    });

    await Promise.all(promises);
    loadActionLog();
    loadThreadsFromDB();
  };

  const dismissAgentDraftSuggestion = useCallback(async (id: string) => {
    await window.electronAPI.dismissAgentDraftSuggestion(id);
    setThreadAgentInsights(current => current?.draftSuggestion?.id === id
      ? { ...current, draftSuggestion: null }
      : current);
  }, []);

  const markAgentDraftSuggestionApplied = useCallback(async (id: string) => {
    await window.electronAPI.markAgentDraftSuggestionApplied(id);
    setThreadAgentInsights(current => current?.draftSuggestion?.id === id
      ? { ...current, draftSuggestion: null }
      : current);
  }, []);

  const unsubscribeThread = useCallback(async (threadId?: string | null) => {
    const targetThreadId = threadId || openedThread?.id || focusedThreadId;
    if (!targetThreadId) return;
    const thread = threads.find(item => item.id === targetThreadId) || openedThread;
    const targetAccountId = thread?.accountId || activeAccount?.email;
    if (!targetAccountId) return;

    await executeMailAction('unsubscribeSender', targetThreadId, null, async (actionId: string) => {
      const result = await window.electronAPI.unsubscribeThread(targetAccountId, targetThreadId, actionId);
      emitToast({ type: 'success', message: 'Unsubscribed and archived.' });
      return result;
    });
  }, [activeAccount?.email, executeMailAction, focusedThreadId, openedThread, threads]);


  return {
    mailboxView,
    setMailboxView,
    mailboxCounts,
    navigationActivity,
    activeSplit,
    setActiveSplit,
    splitCounts,
    accounts,
    activeAccount,
    threads,
    visibleThreads,
    focusedThreadId,
    openedThread,
    openedThreadMessages,
    openedThreadMessagesKey,
    openedThreadMessagesStatus,
    threadAgentInsights,
    agentInsightsLoading,
    searchQuery,
    searchStatus,
    searchTopCount,
    semanticMatchThreadIds,
    searchCoverage,
    actionLog,
    followUpRadar,
    followUpRadarLoading,
    followUpRadarError,
    syncHealth,
    syncStatusText,
    backfillProgress,
    isSyncing,
    lastSuccessfulSync,
    speedProof,
    selectedThreadIds,
    setSelectedThreadIds,
    toggleThreadSelection,
    selectAllThreads,
    clearThreadSelection,
    executeBatchMailAction,

    setThreads,
    setVisibleThreads,
    setFocusedThreadId,
    setOpenedThread,
    setOpenedThreadMessages,
    setSearchQuery: handleSetSearchQuery,
    setActionLog,
    setSyncHealth,
    setSyncStatusText,
    setBackfillProgress,
    setIsSyncing,
    setSpeedProof,
    setActiveAccount,
    openThread,
    refreshThreadAgentInsights,
    dismissAgentDraftSuggestion,
    markAgentDraftSuggestionApplied,
    unsubscribeThread,
    loadFollowUpRadar,
    dismissFollowUpRadarItem,
    snoozeFollowUpRadarItem,
    executeMailAction,
    undoLastAction,
    snoozeThread,
    clearThreadReminder,
    onboardAccount,
    disconnectAccount,
    triggerSyncManual,
    triggerBackfillManual,
    triggerVisibleBodyRepair,
    loadThreadsFromDB,
    loadActionLog,
    getThreadCategory
  };
}
