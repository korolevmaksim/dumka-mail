import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react';
import { groupThreadsByDecision, type DecisionEntry, type DecisionSection } from '../../../shared/decision';
import {
  buildUserCorrection,
  hasDecisionModel,
  indexDecisionRecords,
  isCollapsibleSection,
  planClearBatch,
  frozenBatchIsGone,
  planLaterBatch,
  resolveInboxDecision,
  selectUnsubscribeBatch,
  threadEntryKey,
  type StoredDecisions,
  type ThreadDecisionMap,
} from '../../../shared/inboxSections';
import { aggregateMailActionResults } from '../../../shared/mailActionFeedback';
import { parseUnsubscribeCandidate } from '../../../shared/mailSecurity';
import { unsubscribeTargetFromCandidate, type UnsubscribeTarget } from '../../../shared/unsubscribeConfirm';
import type {
  Account,
  AIProviderDescriptor,
  Decision,
  MailActionExecutionResult,
  MailActionLog,
  MailboxView,
  MailThread,
  ThreadDecision,
} from '../../../shared/types';
import {
  buildFlatListItems,
  buildSectionListItems,
  collapsedGroupForThread,
  navigationThreads,
  selectableThreadIds,
  type GroupViewState,
  type GroupViewStates,
  type MailboxListItem,
} from '../lib/inboxListItems';
import { presentMailActionFeedback } from '../lib/presentMailAction';
import { emitToast } from '../lib/toastBus';
import { useModelStatus } from './useAgentPrep';
import { sortingConfig, sortingCacheMatches, type SortingSettingsSource } from '../../../shared/sortingConfig';

type ExecuteMailAction = (
  kind: MailActionLog['kind'],
  threadId?: string | null,
  draftId?: string | null,
  customAction?: (actionId: string) => Promise<unknown>,
  payloadJson?: string | null,
) => Promise<MailActionExecutionResult>;

interface UseInboxSectionsProps {
  modelAllowedAccountIds?: readonly string[];
  sortingSettings?: SortingSettingsSource;
  decisionsConfigured?: boolean;
  accounts: Account[];
  activeAccount: Account | null;
  mailboxView: MailboxView;
  searchQuery: string;
  visibleThreads: MailThread[];
  searchTopCount: number;
  focusedThreadId: string | null;
  setFocusedThreadId: (id: string | null) => void;
  setSelectedThreadIds: (ids: Set<string>) => void;
  openedThread: MailThread | null;
  inboxCount: number;
  aiProviderDesc: AIProviderDescriptor | null;
  /** False when no account in scope has the model sort its mail (mail text kept local, or background sorting off): rules only. */
  modelAllowedForScope?: boolean;
  navigationOrderRef: MutableRefObject<MailThread[] | null>;
  executeMailAction: ExecuteMailAction;
  executeBatchMailAction: (kind: 'markDone', threadIds: string[]) => Promise<void>;
  undoMailActionBatch: (batchId: string) => Promise<void>;
  unsubscribeSenders: (targets: UnsubscribeTarget[], options: { archive: boolean; decisions?: ThreadDecisionMap }) => Promise<void>;
}

const UNSUBSCRIBE_PROBE_MESSAGES = 5;
const NO_GROUPS: GroupViewStates = {};

function scopeAccountIds(activeAccount: Account | null, accounts: Account[]): string[] {
  if (!activeAccount) return [];
  return activeAccount.id === 'unified' ? accounts.map(account => account.email).filter(Boolean) : [activeAccount.email];
}

function storedForSections(stored: StoredDecisions | undefined, hasModel: boolean, config: ReturnType<typeof sortingConfig>): StoredDecisions | undefined {
  if (!stored || (hasModel && (!stored.model || sortingCacheMatches(stored.model.model, config)))) return stored;
  return stored.user ? { user: stored.user } : undefined;
}

function emptyGroupState(): GroupViewState {
  return { expanded: false, frozenKeys: null, excludedKeys: new Set() };
}

export function useInboxSections({
  modelAllowedAccountIds,
  sortingSettings, decisionsConfigured = false,
  accounts,
  activeAccount,
  mailboxView,
  searchQuery,
  visibleThreads,
  searchTopCount,
  focusedThreadId,
  setFocusedThreadId,
  setSelectedThreadIds,
  openedThread,
  inboxCount,
  aiProviderDesc,
  modelAllowedForScope = true,
  navigationOrderRef,
  executeMailAction,
  executeBatchMailAction,
  undoMailActionBatch,
  unsubscribeSenders,
}: UseInboxSectionsProps) {
  const accountIds = useMemo(() => scopeAccountIds(activeAccount, accounts), [accounts, activeAccount]);
  const accountKey = accountIds.join('\u0000');
  const [threadDecisions, setThreadDecisions] = useState<ThreadDecisionMap>({});
  const [groupSnapshot, setGroupSnapshot] = useState<{ scope: string; groups: GroupViewStates }>({ scope: '', groups: {} });
  const [unsubscribeReviewTargets, setUnsubscribeReviewTargets] = useState<UnsubscribeTarget[] | null>(null);
  const [unsubscribeReviewBusy, setUnsubscribeReviewBusy] = useState(false);
  const [inboxCountsByAccount, setInboxCountsByAccount] = useState<Record<string, number>>({});

  // --- Stored decisions (seam for the model slice) ---------------------------
  useEffect(() => {
    let cancelled = false;
    const ids = accountKey ? accountKey.split('\u0000') : [];
    void Promise.all(ids.map(async accountId => {
      try {
        return [accountId, indexDecisionRecords(await window.electronAPI.listThreadDecisions(accountId))] as const;
      } catch (error) {
        console.error('Failed to load thread decisions:', error);
        return [accountId, {}] as const;
      }
    })).then(entries => {
      if (cancelled) return;
      setThreadDecisions(current => {
        const next = { ...current };
        for (const [accountId, byThread] of entries) next[accountId] = byThread;
        return next;
      });
    });
    return () => {
      cancelled = true;
    };
  }, [accountKey]);

  // Model rows are written by the main process; reload that account's map.
  useEffect(() => {
    const ids = accountKey ? accountKey.split('\u0000') : [];
    if (ids.length === 0 || !window.electronAPI.onThreadDecisionsChanged) return;
    let disposed = false;
    const unsubscribe = window.electronAPI.onThreadDecisionsChanged(({ accountId }) => {
      if (!ids.includes(accountId)) return;
      window.electronAPI.listThreadDecisions(accountId)
        .then(records => {
          if (disposed) return;
          setThreadDecisions(current => ({ ...current, [accountId]: indexDecisionRecords(records) }));
        })
        .catch(error => console.error('Failed to reload thread decisions:', error));
    });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [accountKey]);

  // --- Rail badges: threads left per account --------------------------------
  const accountEmailsKey = accounts.map(account => account.email).filter(Boolean).join('\u0000');
  useEffect(() => {
    const ids = accountEmailsKey ? accountEmailsKey.split('\u0000') : [];
    if (ids.length === 0) {
      setInboxCountsByAccount({});
      return;
    }
    let cancelled = false;
    // Debounced: inboxCount changes with every archive in a burst.
    const timer = window.setTimeout(() => {
      window.electronAPI.countInboxThreads(ids)
        .then(counts => { if (!cancelled) setInboxCountsByAccount(counts); })
        .catch(error => console.error('Failed to count inbox threads:', error));
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [accountEmailsKey, inboxCount]);
  const railInboxCounts = useMemo(() => {
    // The active account's live count wins over the (debounced) database count.
    if (!activeAccount || activeAccount.id === 'unified') return inboxCountsByAccount;
    return { ...inboxCountsByAccount, [activeAccount.email]: inboxCount };
  }, [activeAccount, inboxCount, inboxCountsByAccount]);

  // --- Sections -----------------------------------------------------------------
  // An unreachable model, an account that keeps mail text local or one with
  // background sorting off (the default) uses the no-model section set;
  // stored model rows are then ignored.
  const modelStatus = useModelStatus();
  const sortConfig = useMemo(() => sortingConfig(sortingSettings), [sortingSettings]);
  const allowedAccounts = useMemo(() => modelAllowedAccountIds
    ? new Set(modelAllowedAccountIds.map(id => id.toLowerCase())) : null, [modelAllowedAccountIds]);
  const usesDecisions = sortConfig.engine === 'openAIDecisions';
  const hasModel = (usesDecisions ? decisionsConfigured && Boolean(sortConfig.model)
    : hasDecisionModel(aiProviderDesc) && modelStatus !== 'unreachable') && modelAllowedForScope;
  /** Model sorting is on for this scope, but the model is not answering: sections fall back to rules until it does. */
  const modelSortingPaused = !usesDecisions && hasDecisionModel(aiProviderDesc) && modelStatus === 'unreachable' && modelAllowedForScope;
  const sectioned = mailboxView === 'inbox' && !searchQuery.trim();
  const scope = `${accountKey}|${mailboxView}|${sectioned ? 'sections' : 'flat'}`;
  const groups = groupSnapshot.scope === scope ? groupSnapshot.groups : NO_GROUPS;

  const decisionSections = useMemo<DecisionSection[]>(() => {
    if (!sectioned) return [];
    const entries: DecisionEntry[] = visibleThreads.map(thread => ({
      thread,
      decision: resolveInboxDecision(thread, { accountEmail: thread.accountId }, storedForSections(threadDecisions[thread.accountId]?.[thread.id],
        hasModel && (!allowedAccounts || allowedAccounts.has(thread.accountId.toLowerCase())), sortConfig)),
    }));
    return groupThreadsByDecision(entries, hasModel);
  }, [hasModel, sectioned, threadDecisions, visibleThreads, sortConfig, allowedAccounts]);

  const decisionByThreadKey = useMemo(() => {
    const map = new Map<string, ThreadDecision>();
    for (const section of decisionSections) {
      for (const entry of section.entries) map.set(threadEntryKey(entry.thread), entry.decision);
    }
    return map;
  }, [decisionSections]);

  const mailboxListItems = useMemo<MailboxListItem[]>(() => (
    sectioned ? buildSectionListItems(decisionSections, groups) : buildFlatListItems(visibleThreads, searchTopCount)
  ), [decisionSections, groups, searchTopCount, sectioned, visibleThreads]);

  const listNavigationThreads = useMemo(
    () => (sectioned ? navigationThreads(mailboxListItems) : visibleThreads),
    [mailboxListItems, sectioned, visibleThreads],
  );
  // Read synchronously by executeMailAction ("next thread" after archive).
  navigationOrderRef.current = listNavigationThreads;

  /** `⌘A` selects the rows the list shows, never the threads hidden in a collapsed group. */
  const selectAllThreads = useCallback(() => {
    setSelectedThreadIds(new Set(sectioned ? selectableThreadIds(mailboxListItems) : visibleThreads.map(thread => thread.id)));
  }, [mailboxListItems, sectioned, setSelectedThreadIds, visibleThreads]);

  // Sections choose the initial focus in visual order, not chronological
  // order. A hidden thread is represented by its collapsed group row.
  useEffect(() => {
    if (!sectioned || openedThread || listNavigationThreads.length === 0) return;
    if (focusedThreadId && listNavigationThreads.some(thread => thread.id === focusedThreadId)) return;
    const group = collapsedGroupForThread(mailboxListItems, focusedThreadId);
    setFocusedThreadId(group?.entries[0]?.thread.id || listNavigationThreads[0].id);
  }, [focusedThreadId, listNavigationThreads, mailboxListItems, openedThread, sectioned, setFocusedThreadId]);

  const sectionOfThread = useCallback((thread: MailThread | null | undefined): Decision | null => {
    if (!thread) return null;
    return decisionByThreadKey.get(threadEntryKey(thread))?.decision || null;
  }, [decisionByThreadKey]);

  const focusedThread = useMemo(
    () => (focusedThreadId ? listNavigationThreads.find(thread => thread.id === focusedThreadId) || null : null),
    [focusedThreadId, listNavigationThreads],
  );
  const focusedCollapsedGroup = useMemo(() => {
    if (!sectioned || openedThread) return null;
    return collapsedGroupForThread(mailboxListItems, focusedThreadId)?.decision || null;
  }, [focusedThreadId, mailboxListItems, openedThread, sectioned]);
  /** Section the keyboard acts on: the open thread's, else the focused row's. */
  const focusedSection = sectioned ? sectionOfThread(openedThread || focusedThread) : null;

  // --- Group state ----------------------------------------------------------------
  const updateGroups = useCallback((updater: (current: GroupViewStates) => GroupViewStates) => {
    setGroupSnapshot(current => ({ scope, groups: updater(current.scope === scope ? current.groups : {}) }));
  }, [scope]);

  const sectionFor = useCallback(
    (decision: Decision) => decisionSections.find(section => section.decision === decision) || null,
    [decisionSections],
  );

  /** Opens (freezing the current rows) or closes a collapsible group. */
  const toggleSectionGroup = useCallback((decision: Decision, expand?: boolean) => {
    if (!isCollapsibleSection(decision)) return;
    const section = sectionFor(decision);
    updateGroups(current => {
      const isExpanded = Boolean(current[decision]?.expanded);
      const nextExpanded = expand ?? !isExpanded;
      if (nextExpanded === isExpanded) return current;
      if (!nextExpanded) {
        const { [decision]: _closed, ...rest } = current;
        return rest;
      }
      return {
        ...current,
        [decision]: {
          expanded: true,
          frozenKeys: new Set((section?.entries || []).map(entry => threadEntryKey(entry.thread))),
          excludedKeys: new Set<string>(),
        },
      };
    });
  }, [sectionFor, updateGroups]);

  // An open group whose reviewed rows have all left (archived elsewhere, re-sorted)
  // holds only later arrivals. Close it: its action would archive nothing.
  useEffect(() => {
    const stale = (Object.keys(groups) as Decision[]).filter(decision =>
      groups[decision]?.expanded && frozenBatchIsGone(sectionFor(decision)?.entries || [], groups[decision]?.frozenKeys));
    if (stale.length === 0) return;
    updateGroups(current => {
      const next = { ...current };
      for (const decision of stale) delete next[decision];
      return next;
    });
  }, [groups, sectionFor, updateGroups]);

  const setGroupRowChecked = useCallback((decision: Decision, thread: MailThread, checked: boolean) => {
    updateGroups(current => {
      const state = current[decision] || emptyGroupState();
      const excludedKeys = new Set(state.excludedKeys);
      const key = threadEntryKey(thread);
      if (checked) excludedKeys.delete(key);
      else excludedKeys.add(key);
      return { ...current, [decision]: { ...state, excludedKeys } };
    });
  }, [updateGroups]);

  const batchInputFor = useCallback((decision: Decision) => {
    const section = sectionFor(decision);
    const state = groups[decision];
    return {
      entries: section?.entries || [],
      frozenKeys: state?.frozenKeys || null,
      excludedKeys: state?.excludedKeys,
    };
  }, [groups, sectionFor]);

  /** The rows `⇧E` would archive right now (frozen, checked, never protected). */
  const clearBatchThreads = useMemo(() => planClearBatch(batchInputFor('clear')), [batchInputFor]);

  /** `⇧E` on Clear: open the group first; once open, archive its checked rows as one batch. */
  const runClearGroupAction = useCallback(async () => {
    const section = sectionFor('clear');
    if (!section) {
      emitToast({ type: 'info', message: 'Nothing in Clear.' });
      return;
    }
    if (!groups.clear?.expanded) {
      toggleSectionGroup('clear', true);
      return;
    }
    const threads = planClearBatch(batchInputFor('clear'));
    if (threads.length === 0) {
      emitToast({ type: 'info', message: 'No checked conversations to archive.' });
      return;
    }
    toggleSectionGroup('clear', false);
    await executeBatchMailAction('markDone', threads.map(thread => thread.id));
  }, [batchInputFor, executeBatchMailAction, groups.clear?.expanded, sectionFor, toggleSectionGroup]);

  /** `⇧H` on Later: remind every row at its suggested time as one undoable batch. */
  const remindLaterGroup = useCallback(async () => {
    const plan = planLaterBatch(batchInputFor('later'));
    if (plan.length === 0) {
      emitToast({ type: 'info', message: 'Nothing in Later to schedule.' });
      return;
    }
    const batchId = crypto.randomUUID();
    const results = await Promise.all(plan.map(item => executeMailAction(
      'setReminder',
      item.thread.id,
      null,
      undefined,
      JSON.stringify({ accountId: item.thread.accountId, reminderAt: item.at.toISOString(), batchId, silent: true }),
    )));
    const aggregated = aggregateMailActionResults(results);
    presentMailActionFeedback({
      result: aggregated,
      kind: 'setReminder',
      count: results.length,
      succeeded: aggregated.succeeded,
      failed: aggregated.failed,
    }, {
      onUndo: () => {
        void undoMailActionBatch(batchId).catch(error => {
          console.error('Failed to undo Later batch:', error);
          emitToast({ type: 'error', message: 'Could not undo.' });
        });
      },
      onRetry: () => { void remindLaterGroup(); },
    });
  }, [batchInputFor, executeMailAction, undoMailActionBatch]);

  /** `Review` on Unsubscribe: resolve each checked sender's method, then confirm in the sheet. */
  const reviewUnsubscribeGroup = useCallback(async () => {
    const entries = selectUnsubscribeBatch(batchInputFor('unsubscribe'));
    if (entries.length === 0) {
      emitToast({ type: 'info', message: 'No checked senders to review.' });
      return;
    }
    setUnsubscribeReviewBusy(true);
    try {
      const seenSenders = new Set<string>();
      const targets: UnsubscribeTarget[] = [];
      for (const { thread } of entries) {
        const senderKey = `${thread.accountId.toLowerCase()}:${thread.senderEmail.toLowerCase()}`;
        if (seenSenders.has(senderKey)) continue;
        const messages = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
        const newestFirst = [...messages]
          .sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt))
          .slice(0, UNSUBSCRIBE_PROBE_MESSAGES);
        for (const message of newestFirst) {
          const target = unsubscribeTargetFromCandidate(parseUnsubscribeCandidate(message));
          if (!target) continue;
          seenSenders.add(senderKey);
          targets.push({
            ...target,
            accountId: thread.accountId,
            threadId: thread.id,
            senderName: target.senderName || thread.senderNames[0] || thread.senderEmail,
            senderEmail: target.senderEmail || thread.senderEmail,
          });
          break;
        }
      }
      if (targets.length === 0) {
        emitToast({ type: 'warning', message: 'No usable unsubscribe method found for these senders.' });
        return;
      }
      setUnsubscribeReviewTargets(targets);
    } catch (error) {
      console.error('Unsubscribe review failed:', error);
      emitToast({ type: 'error', message: 'Could not prepare the unsubscribe review.' });
    } finally {
      setUnsubscribeReviewBusy(false);
    }
  }, [batchInputFor]);

  const confirmUnsubscribeReview = useCallback(async (options: { archive: boolean }) => {
    const targets = unsubscribeReviewTargets;
    if (!targets) return;
    setUnsubscribeReviewBusy(true);
    try {
      await unsubscribeSenders(targets, { ...options, decisions: threadDecisions });
      setUnsubscribeReviewTargets(null);
      toggleSectionGroup('unsubscribe', false);
    } finally {
      setUnsubscribeReviewBusy(false);
    }
  }, [threadDecisions, toggleSectionGroup, unsubscribeReviewTargets, unsubscribeSenders]);

  const cancelUnsubscribeReview = useCallback(() => setUnsubscribeReviewTargets(null), []);

  // --- Corrections (V) ----------------------------------------------------------------
  const threadDecisionsRef = useRef(threadDecisions);
  threadDecisionsRef.current = threadDecisions;

  /** Stores a user correction (`source: 'user'`); the thread moves immediately. */
  const moveThreadToSection = useCallback(async (thread: MailThread, decision: Decision) => {
    const record = buildUserCorrection(thread, decision);
    const previous = threadDecisionsRef.current[thread.accountId]?.[thread.id];
    const apply = (stored: typeof previous) => setThreadDecisions(current => {
      const byThread = { ...(current[thread.accountId] || {}) };
      if (stored) byThread[thread.id] = stored;
      else delete byThread[thread.id];
      return { ...current, [thread.accountId]: byThread };
    });
    apply({ ...previous, user: record });
    try {
      await window.electronAPI.saveThreadDecision(record);
    } catch (error) {
      console.error('Failed to save section correction:', error);
      apply(previous);
      emitToast({ type: 'error', message: 'Could not move the conversation.' });
    }
  }, []);

  return {
    threadDecisions,
    hasModel,
    modelSortingPaused,
    sectioned,
    decisionSections,
    mailboxListItems,
    listNavigationThreads,
    selectAllThreads,
    groupViewStates: groups,
    focusedSection,
    focusedCollapsedGroup,
    clearBatchThreads,
    sectionOfThread,
    toggleSectionGroup,
    setGroupRowChecked,
    runClearGroupAction,
    remindLaterGroup,
    reviewUnsubscribeGroup,
    unsubscribeReviewTargets,
    unsubscribeReviewBusy,
    confirmUnsubscribeReview,
    cancelUnsubscribeReview,
    moveThreadToSection,
    inboxCountsByAccount: railInboxCounts,
  };
}

export type InboxSectionsState = ReturnType<typeof useInboxSections>;
