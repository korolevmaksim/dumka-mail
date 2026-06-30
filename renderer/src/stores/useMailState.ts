import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, GmailSignatureSyncResult, MailThread, MailMessage, MailActionLog, CustomClassifierRule, TabCategory } from '../../../shared/types';
import { SplitInboxKind } from '../../../shared/classifier';
import { parseSearchQuery } from '../../../shared/search';
import { SplitInboxRouter } from '../../../shared/classifier';
import { emitToast } from '../lib/toastBus';
import { useMailSync } from './useMailSync';

export interface SpeedProof {
  cacheReadyMs?: number;
  syncReadyMs?: number;
  searchMs?: number;
  aiMs?: number;
  detailCacheCoverage: string;
}

interface UseMailStateProps {
  customClassifierRules: CustomClassifierRule[];
  tabCategories: TabCategory[];
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
  customClassifierRules,
  tabCategories,
  applyGmailSignatureSyncResult,
}: UseMailStateProps) {
  const [activeSplit, setActiveSplitState] = useState<SplitInboxKind>('important');
  const [splitCounts, setSplitCounts] = useState<Record<string, number>>({});
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null);
  
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [visibleThreads, setVisibleThreads] = useState<MailThread[]>([]);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<MailThread | null>(null);
  const [openedThreadMessages, setOpenedThreadMessages] = useState<MailMessage[]>([]);
  const openedThreadKeyRef = useRef<string | null>(null);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchCoverage] = useState<string>('Local Cache');
  
  const [actionLog, setActionLog] = useState<MailActionLog[]>([]);
  
  const [speedProof, setSpeedProof] = useState<SpeedProof>({
    detailCacheCoverage: '0% detail · 0% bodies'
  });

  const [selectedThreadIds, setSelectedThreadIds] = useState<Set<string>>(new Set());




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
    setActiveSplitState(split);
    setOpenedThread(null);
    setOpenedThreadMessages([]);
    setFocusedThreadId(null);
    setSelectedThreadIds(new Set());
  };


  const getThreadCategory = useCallback((t: MailThread): string => {
    for (const rule of customClassifierRules) {
      if (!rule.active) continue;

      if (rule.accountId && rule.accountId !== 'global' && t.accountId !== rule.accountId) {
        continue;
      }

      const category = tabCategories.find(c => c.id === rule.targetCategory);
      if (!category || !category.active) continue;

      if (category.accountId && category.accountId !== 'global' && t.accountId !== category.accountId) {
        continue;
      }

      let match = false;
      const val = rule.value.toLowerCase().trim();
      if (!val) continue;

      if (rule.field === 'from') {
        const fromStr = `${t.senderNames.join(' ')} ${t.senderEmail}`.toLowerCase();
        if (rule.condition === 'contains') match = fromStr.includes(val);
        else if (rule.condition === 'equals') match = t.senderEmail.toLowerCase() === val;
        else if (rule.condition === 'startsWith') match = t.senderEmail.toLowerCase().startsWith(val);
        else if (rule.condition === 'endsWith') match = t.senderEmail.toLowerCase().endsWith(val);
      } else if (rule.field === 'subject') {
        const subjectStr = t.subject.toLowerCase();
        if (rule.condition === 'contains') match = subjectStr.includes(val);
        else if (rule.condition === 'equals') match = subjectStr === val;
        else if (rule.condition === 'startsWith') match = subjectStr.startsWith(val);
        else if (rule.condition === 'endsWith') match = subjectStr.endsWith(val);
      }

      if (match) {
        return rule.targetCategory;
      }
    }

    const systemSplit = SplitInboxRouter.split(t);
    const systemTab = tabCategories.find(c => c.id === systemSplit);
    if (systemTab && systemTab.active) {
      return systemSplit;
    }
    return 'other';
  }, [customClassifierRules, tabCategories]);

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
    setOpenedThreadMessages([]);
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

      const threadsList = await window.electronAPI.listThreads(accountId);
      const thread = threadsList.find(t => t.id === threadId);
      if (thread) {
        const category = getThreadCategory(thread);
        setActiveSplitState(category);

        setOpenedThread(thread);
        setFocusedThreadId(thread.id);

        const msgs = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
        setOpenedThreadMessages(msgs);

        if (thread.isUnread) {
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
  }, [accounts, getThreadCategory, setActiveAccount]);

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
    loadAccounts,
    setActiveAccountState,
    loadThreadsFromDB,
    setSpeedProof,
    applyGmailSignatureSyncResult,
  });

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

  // Visible Threads filtering based on Search Query and Split Tabs
  useEffect(() => {
    if (threads.length === 0 || !activeAccount) {
      setVisibleThreads([]);
      return;
    }

    const filterThreads = async () => {
      if (!activeAccount) return;
      let filtered = threads;

      if (searchQuery.trim()) {
        const parsed = parseSearchQuery(searchQuery);
        const start = performance.now();
        
        let ftsMatches: { threadId: string; messageId: string }[] = [];
        if (activeAccount.id === 'unified') {
          for (const acc of accounts) {
            const matches = await window.electronAPI.searchFTS(acc.email, parsed.textTerms.join(' '));
            ftsMatches.push(...matches);
          }
        } else {
          ftsMatches = await window.electronAPI.searchFTS(activeAccount.email, parsed.textTerms.join(' '));
        }
        
        setSpeedProof((prev: SpeedProof) => ({
          ...prev,
          searchMs: Math.round(performance.now() - start)
        }));

        const matchThreadIds = new Set(ftsMatches.map(m => m.threadId));
        filtered = threads.filter(t => matchThreadIds.has(t.id));

        if (parsed.from) {
          filtered = filtered.filter(t => t.senderEmail.includes(parsed.from!) || t.senderNames.some(n => n.toLowerCase().includes(parsed.from!)));
        }
        if (parsed.domain) {
          filtered = filtered.filter(t => t.senderEmail.endsWith(`@${parsed.domain}`) || t.senderEmail.endsWith(`.${parsed.domain}`));
        }
        if (parsed.hasAttachment !== undefined) {
          filtered = filtered.filter(t => t.hasAttachments === parsed.hasAttachment);
        }
        if (parsed.isUnread !== undefined) {
          filtered = filtered.filter(t => t.isUnread === parsed.isUnread);
        }
      } else {
        filtered = threads.filter(t => {
          const inInbox = t.labelIds.some(l => l.toUpperCase() === 'INBOX');
          if (!inInbox) return false;

          if (t.reminderAt && new Date(t.reminderAt) > new Date()) {
            return false;
          }
          return getThreadCategory(t) === activeSplit;
        });
      }

      setVisibleThreads(filtered);

      setFocusedThreadId(prev => {
        if (prev && filtered.some(t => t.id === prev)) return prev;
        return filtered.length > 0 ? filtered[0].id : null;
      });
    };

    filterThreads();
  }, [threads, searchQuery, activeSplit, activeAccount, accounts, getThreadCategory]);

  // Recalculate Split Tabs counters
  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const c of tabCategories) {
      counts[c.id] = 0;
    }

    for (const t of threads) {
      const inInbox = t.labelIds.some(l => l.toUpperCase() === 'INBOX');
      if (!inInbox) continue;

      if (t.reminderAt && new Date(t.reminderAt) > new Date()) continue;
      const split = getThreadCategory(t);
      if (counts[split] !== undefined) {
        counts[split]++;
      } else {
        counts[split] = 1;
      }
    }

    setSplitCounts(counts);
  }, [threads, getThreadCategory, tabCategories]);

  // Open Thread Detail
  const openThread = async (thread: MailThread | null) => {
    const previousThreadKey = openedThreadKeyRef.current;
    const nextThreadKey = threadStateKey(thread);
    openedThreadKeyRef.current = nextThreadKey;
    setOpenedThread(thread);
    if (!thread || !activeAccount) {
      setOpenedThreadMessages([]);
      return;
    }

    setFocusedThreadId(thread.id);
    if (previousThreadKey !== nextThreadKey) {
      setOpenedThreadMessages([]);
    }

    const msgs = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
    if (openedThreadKeyRef.current !== nextThreadKey) return;
    setOpenedThreadMessages(msgs);

    if (shouldRefreshInlineCidMetadata(msgs)) {
      void (async () => {
        try {
          const freshMessages = await window.electronAPI.fetchThreadDetail(thread.accountId, thread.id);
          await window.electronAPI.saveMessages(freshMessages);
          if (openedThreadKeyRef.current === nextThreadKey) {
            setOpenedThreadMessages(freshMessages);
          }
        } catch (err) {
          console.error('Failed to refresh inline message assets:', err);
        }
      })();
    }

    if (thread.isUnread && openedThreadKeyRef.current === nextThreadKey) {
      executeMailAction('markRead', thread.id);
    }
  };

  // Mail Operations wrapper (Read, Done, Reminders)
  const executeMailAction = async (
    kind: MailActionLog['kind'],
    threadId?: string | null,
    draftId?: string | null,
    customAction?: (actionId: string) => Promise<any>
  ) => {
    if (!activeAccount) return;

    const targetThreadId = threadId || openedThread?.id || focusedThreadId || null;
    if (!targetThreadId && kind !== 'send') return;

    const actionId = crypto.randomUUID();
    const thread = targetThreadId ? threads.find(t => t.id === targetThreadId) : null;
    const targetAccountId = thread ? thread.accountId : activeAccount.email;
    
    const log: MailActionLog = {
      id: actionId,
      accountId: targetAccountId,
      threadId: targetThreadId,
      draftId,
      kind,
      status: 'queued',
      createdAt: new Date().toISOString()
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

    if (kind === 'markDone') {
      setThreads(prev => prev.filter(t => t.id !== targetThreadId));
      if (openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
      if (nextThread) {
        setFocusedThreadId(nextThread.id);
      } else {
        setFocusedThreadId(null);
      }
    } else if (kind === 'autoMarkRead') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, reminderAt: tomorrow.toISOString() } : t));
      if (openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
      if (nextThread) {
        setFocusedThreadId(nextThread.id);
      } else {
        setFocusedThreadId(null);
      }
    } else if (kind === 'markRead') {
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: false } : t));
    } else if (kind === 'markUnread') {
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: true } : t));
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
    const lastReversible = actionLog.find(l => l.status === 'completed' && ['markRead', 'markUnread', 'markDone', 'restoreInbox'].includes(l.kind));
    if (!lastReversible) {
      emitToast({ type: 'info', message: 'Nothing to undo.' });
      return;
    }

    const reverseKind: MailActionLog['kind'] = 
      lastReversible.kind === 'markDone' ? 'restoreInbox' :
      lastReversible.kind === 'restoreInbox' ? 'markDone' :
      lastReversible.kind === 'markRead' ? 'markUnread' : 'markRead';

    await executeMailAction(reverseKind, lastReversible.threadId);
  };

  const snoozeThread = async (thread: MailThread, date: Date) => {
    await executeMailAction('autoMarkRead', thread.id, null, async () => {
      await window.electronAPI.saveReminder(thread.accountId, thread.id, date.toISOString());
    });
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
    kind: 'markRead' | 'markUnread' | 'markDone',
    threadIds: string[]
  ) => {
    if (!activeAccount || threadIds.length === 0) return;

    setSelectedThreadIds(new Set());

    // OPTIMISTIC UI STATE TRANSITIONS
    if (kind === 'markDone') {
      setThreads(prev => prev.filter(t => !threadIds.includes(t.id)));
      if (openedThread && threadIds.includes(openedThread.id)) {
        const remainingVisible = visibleThreads.filter(t => !threadIds.includes(t.id));
        if (remainingVisible.length > 0) {
          openThread(remainingVisible[0]);
        } else {
          openThread(null);
        }
      }
      setFocusedThreadId(null);
    } else if (kind === 'markRead') {
      setThreads(prev => prev.map(t => threadIds.includes(t.id) ? { ...t, isUnread: false } : t));
    } else if (kind === 'markUnread') {
      setThreads(prev => prev.map(t => threadIds.includes(t.id) ? { ...t, isUnread: true } : t));
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


  return {
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
    searchQuery,
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
