import { startTransition, useState, useEffect, useCallback, useRef } from 'react';
import { Account, GmailSignatureSyncResult, MailThread, MailMessage, MailActionLog, AppSettings, TabCategory, MailboxView, ThreadAgentInsights, MailLabelDefinition } from '../../../shared/types';
import { SplitInboxKind } from '../../../shared/classifier';
import { parseSearchQuery } from '../../../shared/search';
import { categorize } from '../../../shared/categoryEngine';
import { isThreadInMailbox } from '../../../shared/mailboxView';
import { isReversibleMailActionKind, reverseMailActionKind } from '../../../shared/mailActions';
import { emitToast } from '../lib/toastBus';
import { useMailSync } from './useMailSync';
import type { ThreadHeaderMessagesStatus } from '../lib/threadHeader';
import {
  collectFtsMatches,
  collectSemanticMatchesWithTimeout,
  SEMANTIC_SEARCH_SETTLE_DELAY_MS,
  shouldRunSemanticSearch,
  waitUnlessCancelled,
  type ThreadSearchMatch,
} from './mailSearchHelpers';
import { filterVisibleThreadsCooperatively } from './mailThreadFilter';
import type { MailSearchStatus } from './mailSearchStatus';

export interface SpeedProof {
  cacheReadyMs?: number;
  syncReadyMs?: number;
  searchMs?: number;
  aiMs?: number;
  detailCacheCoverage: string;
}

const SENT_SYNC_MIN_INTERVAL_MS = 60_000;
const SEARCH_COMPLETE_VISIBLE_MS = 1_200;

interface UseMailStateProps {
  tabCategories: TabCategory[];
  categorySettings: AppSettings['inbox']['categories'];
  inboxSettings: AppSettings['inbox'];
  privacySettings: AppSettings['privacy'];
  labelDefinitions: MailLabelDefinition[];
  mutedLabelIdsByAccount: Readonly<Record<string, readonly string[]>>;
  applyGmailSignatureSyncResult: (result: GmailSignatureSyncResult) => Promise<void>;
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
  const [visibleThreads, setVisibleThreads] = useState<MailThread[]>([]);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<MailThread | null>(null);
  const [openedThreadMessages, setOpenedThreadMessagesState] = useState<MailMessage[]>([]);
  const [openedThreadMessagesKey, setOpenedThreadMessagesKey] = useState<string | null>(null);
  const [openedThreadMessagesStatus, setOpenedThreadMessagesStatus] = useState<ThreadHeaderMessagesStatus>('idle');
  const [threadAgentInsights, setThreadAgentInsights] = useState<ThreadAgentInsights | null>(null);
  const [agentInsightsLoading, setAgentInsightsLoading] = useState(false);
  const openedThreadKeyRef = useRef<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchCoverage] = useState<string>('Local Cache');
  const [searchStatus, setSearchStatusState] = useState<MailSearchStatus>('idle');
  const searchStatusResetRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  
  const [actionLog, setActionLog] = useState<MailActionLog[]>([]);
  
  const [speedProof, setSpeedProof] = useState<SpeedProof>({
    detailCacheCoverage: '0% detail · 0% bodies'
  });

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());
  const sentSyncAtRef = useRef<Map<string, number>>(new Map());

  const updateSearchStatus = useCallback((status: MailSearchStatus) => {
    if (searchStatusResetRef.current !== null) {
      globalThis.clearTimeout(searchStatusResetRef.current);
      searchStatusResetRef.current = null;
    }

    setSearchStatusState(status);
    if (status === 'complete') {
      searchStatusResetRef.current = globalThis.setTimeout(() => {
        setSearchStatusState(current => current === 'complete' ? 'idle' : current);
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
  };

  const startOpenedThreadMessagesLoad = (key: string) => {
    setOpenedThreadMessagesState([]);
    setOpenedThreadMessagesKey(key);
    setOpenedThreadMessagesStatus('loading');
  };

  const acceptOpenedThreadMessages = (key: string, messages: MailMessage[]) => {
    setOpenedThreadMessagesState(messages);
    setOpenedThreadMessagesKey(key);
    setOpenedThreadMessagesStatus('ready');
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
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSelectedThreadIds(new Set());
  };

  const setMailboxView = useCallback((view: MailboxView) => {
    setMailboxViewState(view);
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSelectedThreadIds(new Set());
  }, []);


  const getThreadCategory = useCallback((t: MailThread): string => (
    categorize(t, categorySettings.builtIn, categorySettings.custom, 'other')
  ), [categorySettings]);

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
    setActiveAccountState(account);
    setOpenedThread(null);
    resetOpenedThreadMessages();
    setFocusedThreadId(null);
    setSearchQuery('');
    setSelectedThreadIds(new Set());
  }, []);


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

        const msgs = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
        if (openedThreadKeyRef.current !== nextThreadKey) return;
        acceptOpenedThreadMessages(nextThreadKey, msgs);

        if (thread.isUnread && inboxSettings.autoMarkReadOnOpen) {
          setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, isUnread: false } : t));
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
  }, [accounts, getThreadCategory, inboxSettings.autoMarkReadOnOpen, setActiveAccount]);

  // Main threads load & sync loop
  const loadThreadsFromDB = useCallback(async () => {
    if (!activeAccount) return;
    const start = performance.now();
    
    let list: MailThread[] = [];
    if (activeAccount.id === 'unified') {
      const allThreads: MailThread[] = [];
      for (const acc of accounts) {
        const accThreads = await window.electronAPI.listThreads(acc.email);
        allThreads.push(...accThreads);
      }
      allThreads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      list = allThreads;
    } else {
      list = await window.electronAPI.listThreads(activeAccount.email);
    }
    
    setThreads(list);
    
    setSpeedProof((prev: SpeedProof) => ({
      ...prev,
      cacheReadyMs: Math.round(performance.now() - start)
    }));

    const total = list.length;
    if (total > 0) {
      const messages = await Promise.all(list.slice(0, 30).map(t => window.electronAPI.listMessagesForThread(t.accountId, t.id)));
      const detailHydrated = messages.filter(m => m.length > 0).length;
      const bodiesReady = messages.filter(m => m.some(msg => msg.bodyPlain || msg.bodyHtml)).length;
      
      const detailPct = Math.round((detailHydrated / Math.min(total, 30)) * 100);
      const bodyPct = Math.round((bodiesReady / Math.min(total, 30)) * 100);

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        detailCacheCoverage: `${detailPct}% detail · ${bodyPct}% bodies`
      }));
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadThreadsFromDB();
  }, [loadThreadsFromDB]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onRemindersDue(() => {
      loadThreadsFromDB();
    });
    return unsubscribe;
  }, [loadThreadsFromDB]);

  const {
    syncHealth,
    syncStatusText,
    backfillProgress,
    isSyncing,
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
    loadThreadsFromDB,
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

        await Promise.all(targetAccounts.map(async account => {
          const result = await window.electronAPI.syncSent(account.email);
          await window.electronAPI.saveThreads(result.threads);
          await window.electronAPI.saveMessages(result.messages);
        }));

        await loadThreadsFromDB();
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
  }, [mailboxView, activeAccount, accounts, loadThreadsFromDB, setSyncHealth, setSyncStatusText]);

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
      updateSearchStatus('idle');
      return;
    }

    let cancelled = false;
    const isCancelled = () => cancelled;

    const filterThreads = async () => {
      const start = performance.now();
      const now = new Date();
      const trimmedQuery = searchQuery.trim();
      const parsed = trimmedQuery ? parseSearchQuery(searchQuery) : null;
      const textQuery = parsed ? parsed.textTerms.join(' ').trim() : '';
      const accountIds = activeAccount.id === 'unified'
        ? accounts.map(acc => acc.email)
        : [activeAccount.email];

      updateSearchStatus('searching');

      const applyMatches = async (matches: ThreadSearchMatch[]): Promise<boolean> => {
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
          getThreadCategory,
          isCancelled,
        });

        if (!nextFiltered || cancelled) return false;
        publishVisibleThreads(nextFiltered);
        return true;
      };

      try {
        let ftsMatches: ThreadSearchMatch[] = [];
        if (textQuery) {
          try {
            ftsMatches = await collectFtsMatches(accountIds, textQuery, window.electronAPI.searchFTS);
          } catch (err) {
            console.error('Local mail search failed:', err);
            ftsMatches = [];
          }
        }

        if (cancelled) return;

        const didApplyFts = await applyMatches(ftsMatches);
        if (!didApplyFts || cancelled) return;

        setSpeedProof((prev: SpeedProof) => ({
          ...prev,
          searchMs: Math.round(performance.now() - start)
        }));

        if (shouldRunSemanticSearch(textQuery)) {
          // Fire semantic search only after the user has paused typing; a new
          // searchQuery commit cancels this effect and skips the IPC call.
          const settled = await waitUnlessCancelled(SEMANTIC_SEARCH_SETTLE_DELAY_MS, isCancelled);
          if (!settled || cancelled) return;
          const semanticMatches = await collectSemanticMatchesWithTimeout(accountIds, textQuery, window.electronAPI.searchSemantic);
          if (cancelled) return;
          if (semanticMatches.length > 0) {
            const didApplySemantic = await applyMatches([...ftsMatches, ...semanticMatches]);
            if (!didApplySemantic || cancelled) return;
          }
        }

        if (!cancelled) updateSearchStatus('complete');
      } catch (err) {
        console.error('Mail search filtering failed:', err);
        if (!cancelled) updateSearchStatus('complete');
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
    activeAccount,
    accounts,
    getThreadCategory,
    labelDefinitions,
    mutedLabelIdsByAccount,
    publishVisibleThreads,
    updateSearchStatus,
  ]);

  // Recalculate Split Tabs counters
  useEffect(() => {
    const counts: Record<string, number> = {};
    const nextMailboxCounts: Record<MailboxView, number> = { inbox: 0, drafts: 0, sent: 0, trash: 0, spam: 0, muted: 0 };
    const now = new Date();
    for (const c of tabCategories) {
      counts[c.id] = 0;
    }

    for (const t of threads) {
      if (isThreadInMailbox(t, 'sent', now, { mutedLabelIdsByAccount })) {
        nextMailboxCounts.sent++;
      }
      if (isThreadInMailbox(t, 'trash', now, { mutedLabelIdsByAccount })) {
        nextMailboxCounts.trash++;
      }
      if (isThreadInMailbox(t, 'spam', now, { mutedLabelIdsByAccount })) {
        nextMailboxCounts.spam++;
      }
      if (isThreadInMailbox(t, 'muted', now, { mutedLabelIdsByAccount })) {
        nextMailboxCounts.muted++;
      }

      if (!isThreadInMailbox(t, 'inbox', now, { mutedLabelIdsByAccount })) continue;
      nextMailboxCounts.inbox++;
      const split = getThreadCategory(t);
      if (counts[split] !== undefined) {
        counts[split]++;
      } else {
        counts[split] = 1;
      }
    }

    setSplitCounts(counts);
    setMailboxCounts(nextMailboxCounts);
  }, [threads, getThreadCategory, tabCategories, mutedLabelIdsByAccount]);

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

    const msgs = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
    if (openedThreadKeyRef.current !== nextThreadKey) return;
    acceptOpenedThreadMessages(nextThreadKey, msgs);
    void refreshThreadAgentInsights(thread);

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
  ) => {
    if (!activeAccount) return;

    const targetThreadId = threadId || openedThread?.id || focusedThreadId || null;
    if (!targetThreadId && kind !== 'send') return;

    const payload = payloadJson ? JSON.parse(payloadJson) : {};
    const payloadAccountId = typeof payload.accountId === 'string' ? payload.accountId : null;
    const actionId = crypto.randomUUID();
    const thread = targetThreadId
      ? threads.find(t => t.id === targetThreadId && (!payloadAccountId || t.accountId === payloadAccountId))
        || threads.find(t => t.id === targetThreadId)
      : null;
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
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, reminderAt } : t));
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
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: false } : t));
    } else if (kind === 'markUnread') {
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: true } : t));
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

    (async () => {
      try {
        await window.electronAPI.saveActionLog(log);
        log.status = 'running';
        await window.electronAPI.saveActionLog(log);

        let res: any = null;
        if (customAction) {
          res = await customAction(actionId);
        } else {
          if (!targetThreadId && kind !== 'send') return;

          if (kind === 'markDone' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['INBOX'], actionId);
          } else if (kind === 'restoreInbox' && targetThreadId) {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], [], actionId);
            loadThreadsFromDB();
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
            await window.electronAPI.saveReminder(targetAccountId, targetThreadId, reminderAt);
          }
        }

        if (res && res.offline) {
          loadActionLog();
        } else {
          log.status = 'completed';
          log.completedAt = new Date().toISOString();
          await window.electronAPI.saveActionLog(log);
          loadActionLog();
        }
      } catch (err: any) {
        console.error('Background mail action failed:', err);
        log.status = 'failed';
        log.failureMessage = err.message;
        await window.electronAPI.saveActionLog(log);
        loadActionLog();

        loadThreadsFromDB();
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
    }, JSON.stringify({ reminderAt }));
  };

  const clearThreadReminder = async (thread: MailThread) => {
    await window.electronAPI.deleteReminder(thread.accountId, thread.id);
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, reminderAt: null } : t));
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
    searchCoverage,
    actionLog,
    syncHealth,
    syncStatusText,
    backfillProgress,
    isSyncing,
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
