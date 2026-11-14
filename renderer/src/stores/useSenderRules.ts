// Sender rules in the renderer (design-review/SPEC.md §7): the quiet offer row,
// the consent for a rule from the context menu, "Handled for you", and the
// rule counters that live in settings. Counting and applying happen in the
// main process; this hook reads its tables and edits the rules (settings are
// renderer-owned and saved as one blob).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getSenderRules, normalizeAccountId, setSenderRules } from '../../../shared/accountSettings';
import {
  applySenderRuleBringBack,
  createSenderRule,
  isSenderRuleEligible,
  normalizeSenderEmail,
  pickSenderRuleOffer,
  senderDisplayName,
  senderRuleAutoDisabledToast,
  senderRuleNeedsAutonomy,
} from '../../../shared/senderRules';
import type {
  Account,
  AppSettings,
  MailActionExecutionResult,
  MailActionLog,
  MailboxView,
  MailThread,
  SenderRuleHandledItem,
  SenderRuleStats,
  SenderRulesChangedEvent,
} from '../../../shared/types';
import { emitToast } from '../lib/toastBus';

type ExecuteMailAction = (
  kind: MailActionLog['kind'],
  threadId?: string | null,
  draftId?: string | null,
  customAction?: (actionId: string) => Promise<unknown>,
  payloadJson?: string | null,
) => Promise<MailActionExecutionResult>;

interface UseSenderRulesProps {
  activeAccount: Account | null;
  mailboxView: MailboxView;
  searchQuery: string;
  /** Threads currently shown in the inbox (a handled thread already back there is not listed). */
  visibleThreads: MailThread[];
  settings: AppSettings;
  updateSettings: (updater: (settings: AppSettings) => void) => Promise<void>;
  executeMailAction: ExecuteMailAction;
  focusedThreadId: string | null;
  openedThreadId: string | null;
}

/** A sender the user may agree to auto-archive (offer row or context menu). */
export interface SenderRuleConsent {
  accountId: string;
  senderEmail: string;
  senderName: string;
  confirmations: number;
  /** Creating the rule also raises the account to "Prepare and apply my sender rules". */
  needsAutonomy: boolean;
  source: 'offer' | 'menu';
}

function singleAccountId(activeAccount: Account | null): string | null {
  if (!activeAccount || activeAccount.id === 'unified') return null;
  return normalizeAccountId(activeAccount.email) || null;
}

export function useSenderRules({
  activeAccount,
  mailboxView,
  searchQuery,
  visibleThreads,
  settings,
  updateSettings,
  executeMailAction,
  focusedThreadId,
  openedThreadId,
}: UseSenderRulesProps) {
  const accountId = singleAccountId(activeAccount);
  const [stats, setStats] = useState<{ accountId: string | null; rows: SenderRuleStats[] }>({ accountId: null, rows: [] });
  const [handled, setHandled] = useState<{ accountId: string | null; items: SenderRuleHandledItem[] }>({ accountId: null, items: [] });
  const [handledExpanded, setHandledExpanded] = useState(false);
  const [handledRowFocused, setHandledRowFocused] = useState(false);
  const [senderRuleConsent, setSenderRuleConsent] = useState<SenderRuleConsent | null>(null);
  const [busy, setBusy] = useState(false);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const reload = useCallback(async (id: string) => {
    try {
      const [rows, items] = await Promise.all([
        window.electronAPI.listSenderRuleStats(id),
        window.electronAPI.listSenderRuleHandled(id),
      ]);
      setStats(current => (current.accountId === id || id === accountIdRef.current ? { accountId: id, rows } : current));
      setHandled(current => (current.accountId === id || id === accountIdRef.current ? { accountId: id, items } : current));
    } catch (error) {
      console.error('Failed to load sender rule state:', error);
    }
  }, []);
  const accountIdRef = useRef(accountId);
  accountIdRef.current = accountId;

  useEffect(() => {
    setHandledExpanded(false);
    setHandledRowFocused(false);
    if (!accountId) return;
    void reload(accountId);
  }, [accountId, reload]);

  /** A bring-back counts on the sender's rule; the second one switches it off. */
  const applyBringBack = useCallback((event: SenderRulesChangedEvent) => {
    const bringBack = event.bringBack;
    if (!bringBack) return;
    const rules = getSenderRules(settingsRef.current, event.accountId);
    const { changed, disabled } = applySenderRuleBringBack(rules, bringBack.senderEmail);
    if (!changed) return;
    void updateSettings(next => {
      const result = applySenderRuleBringBack(getSenderRules(next, event.accountId), bringBack.senderEmail);
      if (!result.changed) return;
      next.accountOverrides = setSenderRules(next, event.accountId, result.rules).accountOverrides;
    });
    if (disabled) {
      emitToast({ type: 'info', message: senderRuleAutoDisabledToast(senderDisplayName(disabled)) });
    }
  }, [updateSettings]);

  useEffect(() => {
    if (!window.electronAPI.onSenderRulesChanged) return;
    return window.electronAPI.onSenderRulesChanged(event => {
      applyBringBack(event);
      if (event.accountId === accountIdRef.current) void reload(event.accountId);
    });
  }, [applyBringBack, reload]);

  const rules = useMemo(() => (accountId ? getSenderRules(settings, accountId) : []), [accountId, settings]);
  const inboxSectioned = mailboxView === 'inbox' && !searchQuery.trim() && Boolean(accountId);

  const senderRuleOffer = useMemo<SenderRuleConsent | null>(() => {
    if (!inboxSectioned || !accountId || stats.accountId !== accountId) return null;
    const pick = pickSenderRuleOffer(stats.rows, rules);
    if (!pick) return null;
    return {
      accountId,
      senderEmail: pick.senderEmail,
      senderName: senderDisplayName(pick),
      confirmations: pick.confirmations,
      needsAutonomy: senderRuleNeedsAutonomy(settings, accountId),
      source: 'offer',
    };
  }, [accountId, inboxSectioned, rules, settings, stats]);

  const inboxThreadIds = useMemo(() => new Set(visibleThreads.map(thread => thread.id)), [visibleThreads]);
  const handledItems = useMemo(() => {
    if (!inboxSectioned || handled.accountId !== accountId) return [];
    // A thread that is back in the inbox (new reply, rolled-back archive) is no longer "handled".
    return handled.items.filter(item => !inboxThreadIds.has(item.threadId));
  }, [accountId, handled, inboxSectioned, inboxThreadIds]);

  // Focus on the handled row is exclusive with a focused / opened thread row.
  useEffect(() => {
    setHandledRowFocused(false);
  }, [focusedThreadId, openedThreadId]);

  useEffect(() => {
    if (handledItems.length === 0) {
      setHandledExpanded(false);
      setHandledRowFocused(false);
    }
  }, [handledItems.length]);

  // --- Creating a rule ------------------------------------------------------------

  const createRule = useCallback(async (consent: SenderRuleConsent) => {
    const id = crypto.randomUUID();
    let autonomyRaised = false;
    await updateSettings(next => {
      const result = createSenderRule(next, consent.accountId, {
        id,
        senderEmail: consent.senderEmail,
        senderName: consent.senderName,
        confirmations: consent.confirmations,
      });
      autonomyRaised = result.autonomyRaised;
      next.accountOverrides = result.settings.accountOverrides;
    });
    emitToast({
      type: 'success',
      message: `New mail from ${consent.senderName} will skip the inbox${autonomyRaised || consent.needsAutonomy ? '. Sender rules are on for this account.' : '.'}`,
    });
  }, [updateSettings]);

  const acceptSenderRuleOffer = useCallback(async () => {
    if (!senderRuleOffer || busy) return;
    setBusy(true);
    try {
      await createRule(senderRuleOffer);
    } finally {
      setBusy(false);
    }
  }, [busy, createRule, senderRuleOffer]);

  const dismissSenderRuleOffer = useCallback(async () => {
    if (!senderRuleOffer) return;
    const offer = senderRuleOffer;
    // Hide at once; the stored dismissal follows.
    setStats(current => ({
      ...current,
      rows: current.rows.map(row => (row.senderEmail === offer.senderEmail ? { ...row, dismissedAt: new Date().toISOString() } : row)),
    }));
    try {
      await window.electronAPI.dismissSenderRuleOffer(offer.accountId, offer.senderEmail);
    } catch (error) {
      console.error('Failed to dismiss the sender rule offer:', error);
    }
  }, [senderRuleOffer]);

  /** Context menu `Always archive from this sender…`: null when the thread can never be handled by a rule. */
  const senderRuleMenuState = useCallback((thread: MailThread): 'available' | 'exists' | 'ineligible' => {
    const threadAccount = normalizeAccountId(thread.accountId);
    const sender = normalizeSenderEmail(thread.senderEmail);
    if (!sender || sender === threadAccount) return 'ineligible';
    if (getSenderRules(settingsRef.current, threadAccount).some(rule => normalizeSenderEmail(rule.senderEmail) === sender)) return 'exists';
    return isSenderRuleEligible(thread, threadAccount) ? 'available' : 'ineligible';
  }, []);

  const requestSenderRule = useCallback((thread: MailThread) => {
    const threadAccount = normalizeAccountId(thread.accountId);
    const sender = normalizeSenderEmail(thread.senderEmail);
    if (senderRuleMenuState(thread) !== 'available') {
      emitToast({ type: 'info', message: 'Mail from people, security notices and invitations is never handled automatically.' });
      return;
    }
    const known = stats.accountId === threadAccount ? stats.rows.find(row => row.senderEmail === sender) : undefined;
    setSenderRuleConsent({
      accountId: threadAccount,
      senderEmail: sender,
      senderName: senderDisplayName({ senderName: thread.senderNames.find(name => name.trim()) || known?.senderName, senderEmail: sender }),
      confirmations: known?.confirmations || 0,
      needsAutonomy: senderRuleNeedsAutonomy(settingsRef.current, threadAccount),
      source: 'menu',
    });
  }, [senderRuleMenuState, stats]);

  const confirmSenderRuleConsent = useCallback(async () => {
    const consent = senderRuleConsent;
    if (!consent) return;
    setSenderRuleConsent(null);
    await createRule(consent);
  }, [createRule, senderRuleConsent]);

  const cancelSenderRuleConsent = useCallback(() => setSenderRuleConsent(null), []);

  // --- Handled for you ------------------------------------------------------------

  const removeHandledLocally = useCallback((threadIds: Set<string>) => {
    setHandled(current => ({ ...current, items: current.items.filter(item => !threadIds.has(item.threadId)) }));
  }, []);

  /** Back to the inbox through the normal restore path; main counts the bring-back. */
  const bringBackHandled = useCallback(async (item: SenderRuleHandledItem) => {
    removeHandledLocally(new Set([item.threadId]));
    const result = await executeMailAction('restoreInbox', item.threadId, null, undefined, JSON.stringify({ silent: true }));
    if (!result.accepted && accountIdRef.current) void reload(accountIdRef.current);
    else emitToast({ type: 'success', message: `Back in the inbox: ${item.subject || '(no subject)'}` });
  }, [executeMailAction, reload, removeHandledLocally]);

  const bringBackAllHandled = useCallback(async () => {
    const items = handledItems;
    if (items.length === 0) return;
    removeHandledLocally(new Set(items.map(item => item.threadId)));
    const batchId = crypto.randomUUID();
    const results = [];
    for (const item of items) {
      results.push(await executeMailAction('restoreInbox', item.threadId, null, undefined, JSON.stringify({ silent: true, batchId })));
    }
    const failed = results.filter(result => !result.accepted).length;
    if (failed > 0) {
      emitToast({ type: 'error', message: `Could not bring back ${failed} of ${items.length}.` });
      if (accountIdRef.current) void reload(accountIdRef.current);
    } else {
      emitToast({ type: 'success', message: `${items.length} ${items.length === 1 ? 'conversation is' : 'conversations are'} back in the inbox.` });
    }
    setHandledExpanded(false);
  }, [executeMailAction, handledItems, reload, removeHandledLocally]);

  const markHandledReviewed = useCallback(async () => {
    const id = accountIdRef.current;
    if (!id) return;
    setHandled(current => ({ ...current, items: [] }));
    setHandledExpanded(false);
    setHandledRowFocused(false);
    try {
      await window.electronAPI.markSenderRuleHandledReviewed(id);
    } catch (error) {
      console.error('Failed to mark handled mail as reviewed:', error);
      void reload(id);
    }
  }, [reload]);

  /** Collapsing the expanded list counts as reviewing it. */
  const toggleHandledExpanded = useCallback((expand?: boolean) => {
    const next = expand ?? !handledExpanded;
    if (next === handledExpanded) return;
    if (!next) {
      void markHandledReviewed();
      return;
    }
    setHandledExpanded(true);
  }, [handledExpanded, markHandledReviewed]);

  return {
    senderRuleOffer,
    senderRuleOfferBusy: busy,
    acceptSenderRuleOffer,
    dismissSenderRuleOffer,
    senderRuleConsent,
    senderRuleMenuState,
    requestSenderRule,
    confirmSenderRuleConsent,
    cancelSenderRuleConsent,
    handledItems,
    handledExpanded,
    toggleHandledExpanded,
    handledRowFocused,
    setHandledRowFocused,
    bringBackHandled,
    bringBackAllHandled,
    markHandledReviewed,
    senderRuleStats: stats.accountId === accountId ? stats.rows : [],
  };
}

export type SenderRulesState = ReturnType<typeof useSenderRules>;
