import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildAccountTags, type AccountTag } from '../../../../shared/accountTags';
import { BellOff, FileText, Inbox, OctagonAlert, Send, Clock, Hourglass, Archive, Trash2 } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useInviteRsvp } from '../../hooks/useInviteRsvp';
import { threadNeedsInviteAnswer } from '../../../../shared/inviteRsvp';
import { ThreadRow } from '../ThreadRow';
import { MailboxEmptyState } from '../MailboxEmptyState';
import { DraftRow } from './DraftRow';
import { HandledForYouRow, SenderRuleOfferRow } from './SenderRuleRows';
import {
  CollapsedGroupRow,
  LateDividerRow,
  SearchHeaderRow,
  SectionHeaderRow,
  SectionThreadRow,
  type SectionAction,
} from './SectionRows';
import { densityMetrics } from '../../lib/density';
import { actionKeyHints } from '../../lib/actionKeyHints';
import { SectionJumpBar } from './SectionJumpBar';
import {
  buildItemOffsets,
  calculateVariableVirtualWindow,
  scrollTopForItem,
} from '../../lib/virtualList';
import {
  itemIndexForThread,
  listItemHeight,
  listItemMetrics,
  resolveCurrentSection,
  sectionJumpDestination,
  sectionJumpTargets,
  type MailboxListItem,
  type SectionJumpAnchor,
} from '../../lib/inboxListItems';
import { registerSectionJump } from '../../lib/sectionJumpBridge';
import { isCollapsibleSection, laterSectionActionLabel, planClearBatch } from '../../../../shared/inboxSections';
import { mailboxEmptyCopy } from '../../../../shared/mailboxEmptyCopy';
import { MAILBOX_VIEW_LABELS } from '../../../../shared/mailboxNavigation';
import type { DecisionEntry } from '../../../../shared/decision';
import type { Decision, Draft, MailboxView, MailThread } from '../../../../shared/types';

export const MAILBOX_ICONS: Record<MailboxView, typeof Inbox> = {
  inbox: Inbox,
  later: Clock,
  waiting: Hourglass,
  drafts: FileText,
  sent: Send,
  allMail: Archive,
  trash: Trash2,
  spam: OctagonAlert,
  muted: BellOff,
};

interface MailboxListProps {
  onThreadContextMenu: (event: React.MouseEvent, thread: MailThread) => void;
}

/**
 * The scrollable mailbox list. Owns its viewport state so scrolling only
 * re-renders this component, not the whole app shell.
 */
export function MailboxList({ onThreadContextMenu }: MailboxListProps) {
  const store = useAppStore();
  const inviteRsvp = useInviteRsvp();
  const accountNames = useMemo(
    () => new Map(store.accounts.map(account => [account.email, account.displayName] as const)),
    [store.accounts],
  );
  // Rows carry an account marker only where accounts are mixed.
  const accountTags = useMemo(
    () => (store.activeAccount?.id === 'unified' ? buildAccountTags(store.accounts.map(account => account.email)) : new Map<string, AccountTag>()),
    [store.accounts, store.activeAccount?.id],
  );
  const listRef = useRef<HTMLDivElement>(null);
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 0 });
  const [measuredFlatRowHeight, setMeasuredFlatRowHeight] = useState<number | null>(null);
  const [lastSelectedThreadId, setLastSelectedThreadId] = useState<string | null>(null);
  const isDrafts = store.mailboxView === 'drafts';
  const items = store.mailboxListItems;
  const { density, fontScale = 1, showAvatars } = store.settings.appearance;

  const baseRowHeight = densityMetrics(density).threadRowHeight;
  const estimatedFlatRowHeight = Math.max(56, Math.round(baseRowHeight * fontScale));
  const metrics = useMemo(
    () => listItemMetrics(baseRowHeight, fontScale, measuredFlatRowHeight ?? estimatedFlatRowHeight),
    [baseRowHeight, estimatedFlatRowHeight, fontScale, measuredFlatRowHeight],
  );
  const heights = useMemo(() => items.map(item => listItemHeight(item, metrics)), [items, metrics]);
  const offsets = useMemo(() => buildItemOffsets(heights), [heights]);
  const threadRowCount = useMemo(() => items.reduce((sum, item) => sum + (item.kind === 'thread' ? 1 : 0), 0), [items]);

  const syncViewport = useCallback((element: HTMLDivElement) => {
    setViewport(prev => {
      const next = { scrollTop: element.scrollTop, height: element.clientHeight };
      if (Math.abs(prev.scrollTop - next.scrollTop) < 1 && Math.abs(prev.height - next.height) < 1) return prev;
      return next;
    });
  }, []);

  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    syncViewport(element);
    const observer = new ResizeObserver(() => syncViewport(element));
    observer.observe(element);
    return () => observer.disconnect();
  }, [syncViewport, store.mailboxView, isDrafts]);

  // Flat rows (ThreadRow) size by content; measure one so the window math matches.
  useEffect(() => {
    if (isDrafts) return;
    const frame = window.requestAnimationFrame(() => {
      const row = listRef.current?.querySelector<HTMLElement>('[data-flat-row-wrapper] > [data-thread-row]');
      const height = row?.getBoundingClientRect().height ?? 0;
      if (height <= 0) return;
      setMeasuredFlatRowHeight(prev => (prev !== null && Math.abs(prev - height) < 1 ? prev : Math.round(height)));
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isDrafts, items.length, density, fontScale, viewport.height]);

  // Keep the focused / opened row in view — only when that row changes.
  // Items, offsets and the viewport are read through refs so a list update
  // (decisions, sync deltas, checkbox toggles) never snaps the list back to
  // the focused row while the user scrolls. A target that is not laid out yet
  // (empty list, unmeasured viewport, row not loaded) stays pending until it is.
  const targetThreadId = store.openedThread?.id || store.focusedThreadId;
  const layoutRef = useRef({ items, offsets, oneLine: metrics.oneLine, viewportHeight: viewport.height });
  layoutRef.current = { items, offsets, oneLine: metrics.oneLine, viewportHeight: viewport.height };
  const pendingScrollTargetRef = useRef<string | null>(null);
  // A section jump places the list itself and then focuses the section's first
  // row; that focus change must not scroll again (it would push the header down).
  const jumpFocusedThreadRef = useRef<string | null>(null);
  useEffect(() => {
    pendingScrollTargetRef.current = jumpFocusedThreadRef.current === targetThreadId ? null : targetThreadId;
    jumpFocusedThreadRef.current = null;
  }, [targetThreadId, store.mailboxView]);
  const layoutReady = !isDrafts && items.length > 0 && viewport.height > 0;
  useEffect(() => {
    const target = pendingScrollTargetRef.current;
    if (!target || !layoutReady) return;
    const layout = layoutRef.current;
    const targetIndex = itemIndexForThread(layout.items, target);
    if (targetIndex === -1) return;
    const element = listRef.current;
    if (!element) return;
    pendingScrollTargetRef.current = null;
    const next = scrollTopForItem({
      index: layout.offsets,
      itemIndex: targetIndex,
      viewportHeight: layout.viewportHeight,
      currentScrollTop: element.scrollTop,
      marginPx: layout.oneLine * 2,
    });
    if (Math.abs(element.scrollTop - next) < 1) return;
    element.scrollTop = next;
    setViewport(prev => ({ ...prev, scrollTop: next }));
    // `items` is a dependency only so a pending target is retried when rows
    // arrive; once it has scrolled, list updates are no-ops here.
  }, [targetThreadId, store.mailboxView, layoutReady, items]);

  // Opening a group for review brings its header to the top of the list, so
  // the conversations the action covers are on screen next to the explanation.
  const expandedGroups = (['clear', 'unsubscribe'] as const).filter(decision => store.groupViewStates[decision]?.expanded).join(',');
  const previousExpandedGroups = useRef(expandedGroups);
  useEffect(() => {
    const before = new Set(previousExpandedGroups.current.split(',').filter(Boolean));
    previousExpandedGroups.current = expandedGroups;
    const opened = expandedGroups.split(',').filter(Boolean).find(decision => !before.has(decision));
    const element = listRef.current;
    if (!opened || !element) return;
    const layout = layoutRef.current;
    const headerIndex = layout.items.findIndex(item => item.kind === 'sectionHeader' && item.decision === opened);
    if (headerIndex === -1) return;
    const next = Math.max(0, Math.min(layout.offsets.offsets[headerIndex] ?? 0, element.scrollHeight - element.clientHeight));
    element.scrollTop = next;
    setViewport(prev => ({ ...prev, scrollTop: next }));
    // `items` so the scroll runs once the expanded rows are laid out.
  }, [expandedGroups, items]);

  // --- Section jump (the bar above the list, `[` / `]`, the Prepared pane) ------
  const jumpTargets = useMemo(() => (store.sectioned ? sectionJumpTargets(items) : []), [items, store.sectioned]);
  // Where the last jump left the list; see `resolveCurrentSection` for how long it counts.
  const [jumpAnchor, setJumpAnchor] = useState<SectionJumpAnchor | null>(null);
  const targetItemIndex = useMemo(
    () => (jumpTargets.length > 0 ? itemIndexForThread(items, targetThreadId) : -1),
    [items, jumpTargets.length, targetThreadId],
  );
  const current = resolveCurrentSection({
    targets: jumpTargets,
    offsets,
    scrollTop: viewport.scrollTop,
    viewportHeight: viewport.height,
    headerHeight: metrics.sectionHeader,
    targetItemIndex,
    targetThreadId,
    anchor: jumpAnchor,
  });
  // A jump counts only until the list scrolls or the keyboard moves. Forget it
  // then, so coming back to the same position does not bring it back.
  const anchorExpired = Boolean(jumpAnchor) && !current.anchored;
  useEffect(() => {
    if (anchorExpired) setJumpAnchor(null);
  }, [anchorExpired]);

  const jumpRef = useRef({
    jumpTo: (_decision: Decision): boolean => false,
    jumpBy: (_delta: 1 | -1): boolean => false,
  });
  const jumpToSection = (decision: Decision): boolean => {
    const element = listRef.current;
    const target = jumpTargets.find(candidate => candidate.decision === decision);
    // A hidden list (the reader replaces it in a narrow window) has no viewport to move.
    if (!element || !target || viewport.height <= 0) return false;
    element.scrollTop = Math.max(0, Math.min(offsets.offsets[target.index] ?? 0, element.scrollHeight - element.clientHeight));
    const scrollTop = element.scrollTop;
    setViewport(prev => ({ ...prev, scrollTop }));
    // With a conversation open the list only scrolls: the reader, its draft and
    // the opened row stay as they are. Otherwise the keyboard lands on the
    // section's first row (for a collapsed group, on the group row; it stays collapsed).
    const focusMoves = !store.openedThread && Boolean(target.firstThreadId);
    if (focusMoves) {
      store.setHandledRowFocused(false);
      if (store.focusedThreadId !== target.firstThreadId) {
        jumpFocusedThreadRef.current = target.firstThreadId;
        store.setFocusedThreadId(target.firstThreadId);
      }
    }
    setJumpAnchor({ decision, scrollTop, threadId: focusMoves ? target.firstThreadId : targetThreadId });
    return true;
  };
  const jumpBySection = (delta: 1 | -1): boolean => {
    if (jumpTargets.length === 0 || viewport.height <= 0) return false;
    // The keys continue from the section the bar marks as current.
    const destination = sectionJumpDestination(jumpTargets, current.decision, delta, current.atStart);
    // At the first / last section the key is handled and nothing moves.
    return destination ? jumpToSection(destination.decision) : true;
  };
  jumpRef.current = { jumpTo: jumpToSection, jumpBy: jumpBySection };
  const hasJumpTargets = jumpTargets.length > 0;
  useEffect(() => {
    if (!hasJumpTargets) return;
    return registerSectionJump({
      jumpTo: decision => jumpRef.current.jumpTo(decision),
      jumpBy: delta => jumpRef.current.jumpBy(delta),
    });
  }, [hasJumpTargets]);

  const virtualWindow = useMemo(() => calculateVariableVirtualWindow({
    index: offsets,
    viewportHeight: viewport.height || 600,
    scrollTop: viewport.scrollTop,
    overscan: 8,
  }), [offsets, viewport.height, viewport.scrollTop]);
  const windowItems = items.slice(virtualWindow.startIndex, virtualWindow.endIndex);

  const openThread = useCallback((thread: MailThread) => {
    store.setWorkspaceView('mail');
    void store.openThread(thread);
  }, [store]);

  const handleSelectToggle = (event: React.MouseEvent, threadId: string) => {
    const order = store.listNavigationThreads;
    if (event.shiftKey && lastSelectedThreadId && store.selectedThreadIds.has(lastSelectedThreadId)) {
      const lastIndex = order.findIndex(thread => thread.id === lastSelectedThreadId);
      const clickedIndex = order.findIndex(thread => thread.id === threadId);
      if (lastIndex !== -1 && clickedIndex !== -1) {
        const range = order.slice(Math.min(lastIndex, clickedIndex), Math.max(lastIndex, clickedIndex) + 1);
        const next = new Set(store.selectedThreadIds);
        const shouldSelect = !store.selectedThreadIds.has(threadId);
        for (const thread of range) {
          if (shouldSelect) next.add(thread.id);
          else next.delete(thread.id);
        }
        store.setSelectedThreadIds(next);
        setLastSelectedThreadId(threadId);
        return;
      }
    }
    store.toggleThreadSelection(threadId);
    setLastSelectedThreadId(threadId);
  };

  const hints = useMemo(() => actionKeyHints(store.settings.shortcuts), [store.settings.shortcuts]);
  // "All to tomorrow 09:00" in the Later header already says what each row's chip would repeat.
  const laterTimeInHeader = useMemo(() => {
    const later = store.decisionSections.find(section => section.decision === 'later');
    return Boolean(later && later.entries.length > 0 && laterSectionActionLabel(later.entries) !== 'All to their suggested times');
  }, [store.decisionSections]);
  const sectionAction = (decision: Decision, entries: DecisionEntry[], collapsed: boolean): SectionAction | undefined => {
    const first = entries[0]?.thread;
    switch (decision) {
      case 'people':
      case 'reply':
        return first ? { label: 'Open first', keys: ['↩'], onRun: () => openThread(first) } : undefined;
      case 'automated':
        return first ? { label: 'One by one', keys: ['↩'], onRun: () => openThread(first) } : undefined;
      case 'later':
        return { label: laterSectionActionLabel(entries), keys: hints.remindLaterSection.keys, ariaKeyShortcuts: hints.remindLaterSection.aria, onRun: () => void store.remindLaterGroup() };
      case 'clear': {
        const count = collapsed
          ? planClearBatch({ entries, frozenKeys: null }).length
          : store.clearBatchThreads.length;
        return {
          label: `Archive ${count}`,
          keys: hints.archiveClearSection.keys,
          ariaKeyShortcuts: hints.archiveClearSection.aria,
          onRun: () => void store.runClearGroupAction(),
        };
      }
      case 'unsubscribe':
        return {
          label: 'Review, asks first',
          keys: [],
          busy: store.unsubscribeReviewBusy,
          onRun: () => void store.reviewUnsubscribeGroup(),
        };
      default:
        return undefined;
    }
  };

  const renderItem = (item: MailboxListItem, index: number) => {
    const height = heights[virtualWindow.startIndex + index];
    switch (item.kind) {
      case 'searchHeader':
        return <SearchHeaderRow key={item.key} label={item.label} height={height} />;
      case 'sectionHeader':
        return (
          <SectionHeaderRow
            key={item.key}
            decision={item.decision}
            label={item.label}
            count={item.count}
            height={height}
            action={sectionAction(item.decision, item.entries, false)}
            includedCount={item.decision === 'clear' ? store.clearBatchThreads.length : undefined}
            collapsible={isCollapsibleSection(item.decision)}
            onCollapse={() => store.toggleSectionGroup(item.decision, false)}
          />
        );
      case 'collapsedGroup':
        return (
          <CollapsedGroupRow
            key={item.key}
            decision={item.decision}
            label={item.label}
            count={item.count}
            summary={item.summary}
            height={height}
            isFocused={!store.openedThread && !store.handledRowFocused && item.entries.some(entry => entry.thread.id === store.focusedThreadId)}
            action={sectionAction(item.decision, item.entries, true)}
            onExpand={() => {
              if (item.entries[0]) store.setFocusedThreadId(item.entries[0].thread.id);
              store.toggleSectionGroup(item.decision, true);
            }}
          />
        );
      case 'lateDivider':
        return <LateDividerRow key={item.key} count={item.count} height={height} />;
      case 'thread': {
        const thread = item.thread;
        if (item.layout === 'flat' || !item.section || !item.decision) {
          return (
            <div key={item.key} role="presentation" data-flat-row-wrapper style={{ height }} className="shrink-0 overflow-hidden">
              <ThreadRow
                thread={thread}
                isFocused={store.focusedThreadId === thread.id}
                isOpened={store.openedThread?.id === thread.id}
                showAvatars={showAvatars}
                isSelected={store.selectedThreadIds.has(thread.id)}
                isSelectionModeActive={store.selectedThreadIds.size > 0}
                isSemanticMatch={store.semanticMatchThreadIds.has(thread.id)}
                accountName={accountNames.get(thread.accountId)}
            accountTag={accountTags.get(thread.accountId)}
                positionInSet={item.position}
                setSize={threadRowCount}
                onClick={() => openThread(thread)}
                onToggleSelect={(event) => handleSelectToggle(event, thread.id)}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  onThreadContextMenu(event, thread);
                }}
              />
            </div>
          );
        }
        const group = item.group;
        return (
          <SectionThreadRow
            key={item.key}
            thread={thread}
            section={item.section}
            decision={item.decision}
            layout={item.layout}
            height={height}
            isFocused={!store.handledRowFocused && store.focusedThreadId === thread.id}
            isOpened={store.openedThread?.id === thread.id}
            isSelected={store.selectedThreadIds.has(thread.id)}
            isSelectionModeActive={store.selectedThreadIds.size > 0}
            positionInSet={item.position}
            setSize={threadRowCount}
            group={group ? { inBatch: group.inBatch, checked: group.checked } : undefined}
            onOpen={() => openThread(thread)}
            onToggleSelect={(event) => handleSelectToggle(event, thread.id)}
            onToggleChecked={group ? (checked) => store.setGroupRowChecked(group.decision, thread, checked) : undefined}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onThreadContextMenu(event, thread);
            }}
            accountName={accountNames.get(thread.accountId)}
            accountTag={accountTags.get(thread.accountId)}
            laterTimeInHeader={laterTimeInHeader}
            rsvp={threadNeedsInviteAnswer(thread) ? {
              calendarConnected: inviteRsvp.calendarConnected(thread.accountId),
              busy: inviteRsvp.isBusy(thread),
              onAnswer: (answer) => void inviteRsvp.answer(thread, answer),
              onConnectCalendar: () => inviteRsvp.connectCalendar(thread.accountId),
            } : undefined}
          />
        );
      }
    }
  };

  const openDraftFromList = async (draft: Draft) => {
    const thread = draft.threadId
      ? store.threads.find(candidate => candidate.id === draft.threadId && candidate.accountId === draft.accountId) || null
      : null;
    store.setWorkspaceView('mail');
    if (thread) {
      await store.openThread(thread);
      store.setComposeLayout('inline');
    } else {
      await store.openThread(null);
      store.setComposeLayout('floating');
    }
    store.setActiveDraft(draft);
  };

  const emptyCopy = mailboxEmptyCopy(
    store.mailboxView,
    isDrafts ? '' : store.searchQuery,
    store.settings.shortcuts,
    { fetchingInbox: store.fetchingInbox && !isDrafts },
  );
  const EmptyIcon = MAILBOX_ICONS[store.mailboxView];
  const rowCount = isDrafts ? store.draftsList.length : threadRowCount;
  const listLabel = `${MAILBOX_VIEW_LABELS[store.mailboxView]} mailbox, ${rowCount} ${
    isDrafts ? (rowCount === 1 ? 'draft' : 'drafts') : rowCount === 1 ? 'thread' : 'threads'
  }`;
  const hasRows = isDrafts ? store.draftsList.length > 0 : items.length > 0;

  // Sender rules (SPEC §7): offer first, then "Handled for you", above the first section.
  const accountEmail = store.activeAccount && store.activeAccount.id !== 'unified' ? store.activeAccount.email : '';
  const head = !isDrafts && (store.senderRuleOffer || store.handledItems.length > 0) ? (
    <div className="flex shrink-0 flex-col">
      {store.senderRuleOffer ? (
        <SenderRuleOfferRow
          offer={store.senderRuleOffer}
          accountEmail={accountEmail}
          busy={store.senderRuleOfferBusy}
          onAccept={() => void store.acceptSenderRuleOffer()}
          onDismiss={() => void store.dismissSenderRuleOffer()}
        />
      ) : null}
      {store.handledItems.length > 0 ? (
        <HandledForYouRow
          items={store.handledItems}
          expanded={store.handledExpanded}
          isFocused={store.handledRowFocused && !store.openedThread}
          onToggle={store.toggleHandledExpanded}
          onBringBack={(item) => void store.bringBackHandled(item)}
          onBringBackAll={() => void store.bringBackAllHandled()}
          onMarkReviewed={() => void store.markHandledReviewed()}
        />
      ) : null}
    </div>
  ) : null;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
    {!isDrafts && (
      <SectionJumpBar
        targets={jumpTargets}
        current={current.decision}
        onJump={decision => void jumpToSection(decision)}
        keysLabel={hints.jumpSection.keys.join(' ') || undefined}
      />
    )}
    {head}
    <div
      ref={listRef}
      data-mailbox-list={store.mailboxView}
      style={{ overflowAnchor: 'none' }}
      className="flex flex-1 flex-col overflow-y-auto"
      role={hasRows ? 'list' : undefined}
      aria-label={hasRows ? listLabel : undefined}
      onScroll={(event) => syncViewport(event.currentTarget)}
    >
      {isDrafts ? (
        store.draftsList.length === 0 ? (
          <MailboxEmptyState icon={EmptyIcon} copy={emptyCopy} onClearSearch={() => store.setSearchQuery('')} />
        ) : (
          store.draftsList.map(draft => (
            <DraftRow
              key={draft.id}
              draft={draft}
              onOpen={() => void openDraftFromList(draft)}
              onDiscard={() => void store.discardDraft(draft.id)}
            />
          ))
        )
      ) : items.length === 0 ? (
        <MailboxEmptyState icon={EmptyIcon} copy={emptyCopy} onClearSearch={() => store.setSearchQuery('')} />
      ) : (
        <div role="presentation" className="relative shrink-0" style={{ height: `${virtualWindow.totalHeight}px` }}>
          <div
            role="presentation"
            className="absolute left-0 right-0 top-0 flex flex-col"
            style={{ transform: `translateY(${virtualWindow.offsetTop}px)` }}
          >
            {windowItems.map(renderItem)}
          </div>
        </div>
      )}
    </div>
    </div>
  );
}
