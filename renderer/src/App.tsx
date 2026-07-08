import { useState, useRef, useEffect, useMemo } from 'react';
import { useAppStore, AppStoreProvider } from './stores/AppStore';
import { useKeyboard } from './hooks/useKeyboard';
import {
  ArchiveRestore, Bell, Inbox, Clock, CheckCircle, X, ArrowLeft,
  Reply, ReplyAll, Forward, SquarePen, Command, Mail, Sparkles, Send,
  ChevronUp, ChevronDown, MailOpen, Trash2, OctagonAlert, BellOff, Tags, FileText, Printer
} from 'lucide-react';
import { ThreadRow } from './components/ThreadRow';
import { SnoozeMenu } from './components/SnoozeMenu';
import { ToastHost } from './components/Toast';
import { MessageCard } from './components/MessageCard';
import { AgenticThreadPanel } from './components/AgenticThreadPanel';
import { ThreadLabelMoveMenu } from './components/ThreadLabelMoveMenu';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { CleanupPanel } from './components/CleanupPanel';
import { LeftRail } from './components/layout/LeftRail';
import { AICopilotPanel } from './components/layout/AICopilotPanel';
import { SearchCockpitBar } from './components/layout/SearchCockpitBar';
import { BottomShortcutBar } from './components/layout/BottomShortcutBar';
import { RightContextPanel } from './components/layout/RightContextPanel';
import { CommandPalette } from './components/layout/CommandPalette';
import { InlineReplyComposer } from './components/layout/InlineReplyComposer';
import { FloatingComposeDrawer } from './components/layout/FloatingComposeDrawer';
import { ShortcutGuideOverlay } from './components/layout/ShortcutGuideOverlay';
import { TodayHome } from './components/today/TodayHome';
import { emitToast } from './lib/toastBus';
import { resolveComposeAccountId } from './lib/composeAccount';
import { resolveThreadHeaderIdentity } from './lib/threadHeader';
import { shouldCloseReaderForSearchChange } from './lib/searchReaderBehavior';
import { densityMetrics } from './lib/density';
import { calculateVirtualWindow, scrollTopForIndex } from './lib/virtualList';
import { buildLabelTree, flattenLabelTree, labelDefinitionsForAccount, labelPresenceInThreads } from '../../shared/labels';
import { isReversibleMailActionKind } from '../../shared/mailActions';
import { MAILBOX_VIEW_LABELS, MAILBOX_VIEW_ORDER } from '../../shared/mailboxNavigation';
import type { Draft, MailboxView, MailThread } from '../../shared/types';

const getMaxWidthStyle = (option?: string) => {
  switch (option) {
    case 'full': return '100%';
    case 'wide': return '1000px';
    case 'narrow': return '600px';
    case 'standard':
    default:
      return '800px';
  }
};

function formatDraftRecipientLine(draft: Draft): string {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc]
    .map(recipient => recipient.email)
    .filter(Boolean);
  return recipients.length > 0 ? `To ${recipients.join(', ')}` : 'No recipients';
}

function formatDraftUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatDraftSendAt(sendAt?: string | null): string | null {
  if (!sendAt) return null;
  const date = new Date(sendAt);
  if (!Number.isFinite(date.getTime())) return null;
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function DraftRow({
  draft,
  onOpen,
  onDiscard,
}: {
  draft: Draft;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const subject = draft.subject.trim() || '(no subject)';
  const snippet = draft.bodyPlain.trim() || 'No body text';
  const updatedAt = formatDraftUpdatedAt(draft.updatedAt);
  const sendAt = formatDraftSendAt(draft.sendAt);
  const recipientLine = formatDraftRecipientLine(draft);
  const draftStatus = sendAt ? `Scheduled for ${sendAt}` : recipientLine;
  const draftAccessibilityLabel = [
    sendAt ? 'Scheduled draft' : 'Draft',
    `subject ${subject}`,
    draftStatus,
    updatedAt ? `last updated ${updatedAt}` : null,
    snippet ? `preview ${snippet}` : null,
  ].filter(Boolean).join(', ');

  return (
    <div
      role="listitem"
      className="group flex w-full min-w-0 items-start gap-2 border-b border-[var(--border)] px-4 py-3 hover:bg-[var(--hover-row)]"
    >
      <button
        type="button"
        aria-label={`Open ${draftAccessibilityLabel}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--raised-surface)] text-[var(--accent)]">
          <FileText aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{subject}</span>
            {updatedAt && (
              <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{updatedAt}</span>
            )}
          </span>
          <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            {draftStatus}
          </span>
          <span className="line-clamp-2 text-[calc(11px*var(--font-scale))] leading-snug text-[var(--text-tertiary)]">{snippet}</span>
        </span>
      </button>
      <button
        type="button"
        title="Discard draft"
        aria-label={`Discard draft: ${subject}`}
        onClick={(event) => {
          event.stopPropagation();
          onDiscard();
        }}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--border)] hover:text-[var(--danger)] group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

function AppContent() {
  const store = useAppStore();
  const threadHeaderIdentity = store.openedThread
    ? resolveThreadHeaderIdentity(store.openedThread, store.openedThreadMessages, {
      messagesKey: store.openedThreadMessagesKey,
      status: store.openedThreadMessagesStatus,
    })
    : null;
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [reminderTargetThread, setReminderTargetThread] = useState<MailThread | null>(null);
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [batchLabelMenuOpen, setBatchLabelMenuOpen] = useState(false);
  const [mailboxMenuOpen, setMailboxMenuOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    thread: any;
  } | null>(null);
  const previousSearchQueryRef = useRef(store.searchQuery);
  const mailboxListRef = useRef<HTMLDivElement>(null);
  const [mailboxViewport, setMailboxViewport] = useState({ scrollTop: 0, height: 0 });
  const [measuredThreadRowHeight, setMeasuredThreadRowHeight] = useState<number | null>(null);
  const selectedThreads = useMemo(
    () => store.threads.filter(thread => store.selectedThreadIds.has(thread.id)),
    [store.selectedThreadIds, store.threads],
  );
  const selectedThreadsAccountId = useMemo(() => {
    const accountIds = Array.from(new Set(selectedThreads.map(thread => thread.accountId)));
    return accountIds.length === 1 ? accountIds[0] : null;
  }, [selectedThreads]);
  const openedThreadAccountId = store.openedThread?.accountId || null;
  const selectedUserLabelNodes = useMemo(
    () => flattenLabelTree(buildLabelTree(
      labelDefinitionsForAccount(store.labelDefinitions, selectedThreadsAccountId).filter(label => label.type !== 'system')
    )),
    [selectedThreadsAccountId, store.labelDefinitions],
  );
  const openedUserLabelNodes = useMemo(
    () => flattenLabelTree(buildLabelTree(
      labelDefinitionsForAccount(store.labelDefinitions, openedThreadAccountId).filter(label => label.type !== 'system')
    )),
    [openedThreadAccountId, store.labelDefinitions],
  );
  const selectedLabelPresenceById = useMemo(() => {
    const presenceById: Record<string, 'some' | 'all'> = {};
    for (const node of selectedUserLabelNodes) {
      if (!node.label) continue;
      const presence = labelPresenceInThreads(node.label.id, selectedThreads);
      if (presence !== 'none') presenceById[node.label.id] = presence;
    }
    return presenceById;
  }, [selectedThreads, selectedUserLabelNodes]);
  const isDraftsMailbox = store.mailboxView === 'drafts';
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
  const printOpenedThread = () => {
    if (!store.openedThread) return;
    window.print();
  };
  const estimatedThreadRowHeight = Math.max(
    56,
    Math.round(densityMetrics(store.settings.appearance.density).threadRowHeight * (store.settings.appearance.fontScale ?? 1)),
  );
  const threadRowHeight = measuredThreadRowHeight ?? estimatedThreadRowHeight;

  // Set platform attribute for cross-platform layout padding overrides (macOS vs Windows/Linux titlebars)
  useEffect(() => {
    const isMac = window.navigator.platform.includes('Mac');
    document.documentElement.setAttribute('data-platform', isMac ? 'darwin' : 'other');
  }, []);

  // Listen to native Electron menu commands
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onExecuteCommand) return;
    const unsubscribe = window.electronAPI.onExecuteCommand((cmdId: string) => {
      switch (cmdId) {
        case 'file.newDraft': {
          if (store.workspaceView === 'today') break;
          const draft = store.startNewDraft();
          if (!draft) {
            store.setWorkspaceView('mail');
            store.setSettingsOpen(true);
            store.setCleanupOpen(false);
            emitToast({ type: 'warning', message: 'Connect an account before composing.' });
            break;
          }
          break;
        }
        case 'edit.undo':
          if (store.workspaceView === 'today') break;
          store.undoLastAction();
          break;
        case 'view.toggleAiCopilot':
          store.setAiPanelOpen(!store.aiPanelOpen);
          break;
        case 'view.settings':
          store.setWorkspaceView('mail');
          store.setSettingsOpen(!store.settingsOpen);
          store.setCleanupOpen(false);
          break;
        case 'view.toggleTheme': {
          const nextTheme = store.theme === 'system' ? 'light' : (store.theme === 'light' ? 'dark' : 'system');
          store.setTheme(nextTheme);
          break;
        }
      }
    });
    return unsubscribe;
  }, [store]);

  useEffect(() => {
    if (!window.electronAPI?.setMenuCommandState) return;

    const canCreateDraft = Boolean(resolveComposeAccountId(store.activeAccount, store.accounts));
    const canUndo = store.actionLog.some(l => l.status === 'completed' && isReversibleMailActionKind(l.kind));

    window.electronAPI.setMenuCommandState({ canCreateDraft, canUndo }).catch(err => {
      console.error('Failed to update native menu command state:', err);
    });
  }, [store.activeAccount, store.accounts, store.actionLog]);

  const searchInputRef = useRef<HTMLInputElement>(null);

  const [lastSelectedThreadId, setLastSelectedThreadId] = useState<string | null>(null);

  const handleThreadSelectToggle = (e: React.MouseEvent, threadId: string) => {
    if (e.shiftKey && lastSelectedThreadId && store.selectedThreadIds.has(lastSelectedThreadId)) {
      const allVisible = store.visibleThreads;
      const lastIdx = allVisible.findIndex(t => t.id === lastSelectedThreadId);
      const clickedIdx = allVisible.findIndex(t => t.id === threadId);
      if (lastIdx !== -1 && clickedIdx !== -1) {
        const start = Math.min(lastIdx, clickedIdx);
        const end = Math.max(lastIdx, clickedIdx);
        const rangeThreads = allVisible.slice(start, end + 1);
        
        const newSelected = new Set(store.selectedThreadIds);
        const shouldSelect = !store.selectedThreadIds.has(threadId);
        
        rangeThreads.forEach(t => {
          if (shouldSelect) {
            newSelected.add(t.id);
          } else {
            newSelected.delete(t.id);
          }
        });
        
        store.setSelectedThreadIds(newSelected);
        setLastSelectedThreadId(threadId);
        return;
      }
    }

    store.toggleThreadSelection(threadId);
    setLastSelectedThreadId(threadId);
  };


  // Reader search states
  const [threadSearchOpen, setThreadSearchOpen] = useState(false);
  const [threadSearchQuery, setThreadSearchQuery] = useState('');
  const [threadMatchesCount, setThreadMatchesCount] = useState(0);
  const [threadActiveMatchIndex, setThreadActiveMatchIndex] = useState(0);

  const nextThreadMatch = () => {
    if (threadMatchesCount > 0) {
      setThreadActiveMatchIndex((prev) => (prev + 1) % threadMatchesCount);
    }
  };

  const prevThreadMatch = () => {
    if (threadMatchesCount > 0) {
      setThreadActiveMatchIndex((prev) => (prev - 1 + threadMatchesCount) % threadMatchesCount);
    }
  };

  const handleThreadInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (e.shiftKey) {
        prevThreadMatch();
      } else {
        nextThreadMatch();
      }
    }
  };

  // Manage highlights in the thread reader pane DOM
  useEffect(() => {
    const pane = document.getElementById('thread-reader-pane');
    if (!pane) return;

    // 1. Clear existing highlights first
    clearHighlights(pane);

    if (!threadSearchOpen || !threadSearchQuery.trim()) {
      setThreadMatchesCount(0);
      setThreadActiveMatchIndex(0);
      return;
    }

    // 2. Apply new highlights
    const { count } = applyHighlights(pane, threadSearchQuery, threadActiveMatchIndex);
    setThreadMatchesCount(count);
  }, [threadSearchOpen, threadSearchQuery, threadActiveMatchIndex, store.openedThreadMessages]);

  // Close search when opening a different thread
  useEffect(() => {
    setThreadSearchOpen(false);
    setThreadSearchQuery('');
  }, [store.openedThread?.id]);

  // Listen to Cmd+F to open search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!store.openedThread) return;
      const isCmdF = (window.navigator.platform.includes('Mac') ? e.metaKey : e.ctrlKey) && e.key.toLowerCase() === 'f';
      if (isCmdF) {
        e.preventDefault();
        setThreadSearchOpen(true);
        setTimeout(() => {
          const inputEl = document.getElementById('thread-search-input');
          if (inputEl) {
            (inputEl as HTMLInputElement).focus();
            (inputEl as HTMLInputElement).select();
          }
        }, 50);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [store.openedThread]);

  const handleDragStartTab = (e: React.DragEvent, id: string) => {
    setDraggedTabId(id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverTab = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const handleDragEnterTab = (e: React.DragEvent, id: string) => {
    e.preventDefault();
    setDragOverTabId(id);
  };

  const handleDropTab = (e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    if (draggedTabId && draggedTabId !== targetId) {
      const draggedIndex = store.tabCategories.findIndex(c => c.id === draggedTabId);
      const targetIndex = store.tabCategories.findIndex(c => c.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const newCategories = [...store.tabCategories];
        const [removed] = newCategories.splice(draggedIndex, 1);
        newCategories.splice(targetIndex, 0, removed);
        store.updateTabCategoriesOrder(newCategories);
      }
    }
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  const handleDragEndTab = () => {
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  useEffect(() => {
    if (!snoozeOpen) return;
    const close = () => setSnoozeOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [snoozeOpen]);

  useEffect(() => {
    if (!reminderTargetThread) return;
    const close = () => setReminderTargetThread(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [reminderTargetThread]);

  useEffect(() => {
    if (!labelMenuOpen) return;
    const close = () => setLabelMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [labelMenuOpen]);

  useEffect(() => {
    if (!batchLabelMenuOpen) return;
    const close = () => setBatchLabelMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [batchLabelMenuOpen]);

  useEffect(() => {
    if (!mailboxMenuOpen) return;
    const close = () => setMailboxMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [mailboxMenuOpen]);

  useEffect(() => {
    if (store.selectedThreadIds.size === 0) setBatchLabelMenuOpen(false);
  }, [store.selectedThreadIds.size]);

  useEffect(() => {
    setMailboxMenuOpen(false);
  }, [store.mailboxView]);

  const labelNameForToast = (labelId: string, accountId?: string | null) =>
    store.labelDefinitions.find(label =>
      label.id === labelId && (!accountId || label.accountId === accountId)
    )?.name || 'label';

  const runSelectedLabelAction = (kind: 'moveToLabel' | 'applyLabel' | 'removeLabel', labelId: string) => {
    const threadIds = Array.from(store.selectedThreadIds);
    if (threadIds.length === 0) return;
    setBatchLabelMenuOpen(false);
    store.clearThreadSelection();
    for (const threadId of threadIds) {
      void store.executeMailAction(kind, threadId, null, undefined, JSON.stringify({ labelId }));
    }
    const verb = kind === 'moveToLabel' ? 'Moved' : kind === 'applyLabel' ? 'Applied' : 'Removed';
    const labelName = labelNameForToast(labelId, selectedThreadsAccountId);
    const suffix = kind === 'removeLabel' ? ` from ${labelName}` : ` ${labelName}`;
    emitToast({ type: 'success', message: `${verb} ${threadIds.length} thread${threadIds.length === 1 ? '' : 's'}${suffix}.` });
  };

  const runOpenedThreadLabelAction = (kind: 'moveToLabel' | 'applyLabel' | 'removeLabel', labelId: string) => {
    const threadId = store.openedThread?.id;
    if (!threadId) return;
    setLabelMenuOpen(false);
    if (kind === 'removeLabel') {
      void store.executeMailAction('removeLabel', threadId, null, undefined, JSON.stringify({ labelId }));
      return;
    }
    void store.moveThreadToLabel(labelId, threadId, kind === 'moveToLabel');
  };

  const unmuteSelectedThreads = () => {
    const threadIds = Array.from(store.selectedThreadIds);
    if (threadIds.length === 0) return;
    store.clearThreadSelection();
    for (const threadId of threadIds) {
      void store.unmuteThread(threadId);
    }
    emitToast({ type: 'success', message: `Unmuted ${threadIds.length} thread${threadIds.length === 1 ? '' : 's'}.` });
  };

  useEffect(() => {
    const handleGlobalClick = () => {
      if (contextMenu) setContextMenu(null);
    };
    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('contextmenu', handleGlobalClick);
    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('contextmenu', handleGlobalClick);
    };
  }, [contextMenu]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && contextMenu) {
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

  useEffect(() => {
    const previousSearchQuery = previousSearchQueryRef.current;
    const nextSearchQuery = store.searchQuery;
    previousSearchQueryRef.current = nextSearchQuery;

    if (shouldCloseReaderForSearchChange({
      previousSearchQuery,
      nextSearchQuery,
      hasOpenedThread: Boolean(store.openedThread),
      enablePreviewPane: store.enablePreviewPane,
    })) {
      store.openThread(null);
    }
  }, [store.searchQuery, store.openedThread, store.enablePreviewPane]);

  useEffect(() => {
    const element = mailboxListRef.current;
    if (!element) return;

    const syncViewport = () => {
      setMailboxViewport(prev => {
        const next = { scrollTop: element.scrollTop, height: element.clientHeight };
        if (Math.abs(prev.scrollTop - next.scrollTop) < 1 && Math.abs(prev.height - next.height) < 1) {
          return prev;
        }
        return next;
      });
    };

    syncViewport();
    const observer = new ResizeObserver(syncViewport);
    observer.observe(element);
    return () => observer.disconnect();
  }, [store.settingsOpen, store.enablePreviewPane, store.previewPaneWidth, store.mailboxView]);

  useEffect(() => {
    if (isDraftsMailbox) {
      setMeasuredThreadRowHeight(null);
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      const row = mailboxListRef.current?.querySelector<HTMLElement>('[data-thread-row]');
      const measuredHeight = row?.getBoundingClientRect().height ?? 0;
      if (measuredHeight <= 0) return;
      setMeasuredThreadRowHeight(prev => {
        if (prev !== null && Math.abs(prev - measuredHeight) < 1) return prev;
        return Math.round(measuredHeight);
      });
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [
    isDraftsMailbox,
    store.visibleThreads.length,
    store.settings.appearance.density,
    store.settings.appearance.fontScale,
    mailboxViewport.height,
  ]);

  type MailboxRow =
    | { kind: 'header'; id: 'top' | 'all'; label: string }
    | { kind: 'thread'; thread: MailThread; threadIndex: number };

  const mailboxRows = useMemo<MailboxRow[]>(() => {
    const rows: MailboxRow[] = [];
    const topCount = store.searchTopCount;
    store.visibleThreads.forEach((thread, threadIndex) => {
      if (topCount > 0 && threadIndex === 0) rows.push({ kind: 'header', id: 'top', label: 'Top results' });
      if (topCount > 0 && threadIndex === topCount) rows.push({ kind: 'header', id: 'all', label: 'All matches' });
      rows.push({ kind: 'thread', thread, threadIndex });
    });
    return rows;
  }, [store.visibleThreads, store.searchTopCount]);

  useEffect(() => {
    if (isDraftsMailbox || store.visibleThreads.length === 0 || mailboxViewport.height <= 0) return;

    const targetId = store.openedThread?.id || store.focusedThreadId;
    if (!targetId) return;

    const targetIndex = mailboxRows.findIndex(row => row.kind === 'thread' && row.thread.id === targetId);
    if (targetIndex === -1) return;

    const element = mailboxListRef.current;
    if (!element) return;

    const nextScrollTop = scrollTopForIndex({
      index: targetIndex,
      rowHeight: threadRowHeight,
      viewportHeight: mailboxViewport.height,
      currentScrollTop: element.scrollTop,
      itemCount: mailboxRows.length,
      marginRows: 2,
    });

    if (Math.abs(element.scrollTop - nextScrollTop) < 1) return;
    element.scrollTop = nextScrollTop;
    setMailboxViewport(prev => ({ ...prev, scrollTop: nextScrollTop }));
  }, [
    isDraftsMailbox,
    store.focusedThreadId,
    store.openedThread?.id,
    mailboxRows,
    threadRowHeight,
    mailboxViewport.height,
  ]);

  const openReminderPicker = (thread: MailThread) => {
    setSnoozeOpen(false);
    setCommandPaletteOpen(false);
    setReminderTargetThread(thread);
  };

  const openReminderForCurrentTarget = () => {
    const target = store.openedThread || store.visibleThreads.find(t => t.id === store.focusedThreadId) || store.visibleThreads[0];
    if (!target) {
      emitToast({ type: 'info', message: 'No thread selected.' });
      return;
    }
    openReminderPicker(target);
  };

  useKeyboard({
    isComposeActive: !!store.activeDraft,
    isSearchActive: !!store.searchQuery,
    onSearchFocus: () => {
      if (searchInputRef.current) {
        searchInputRef.current.focus();
      }
    },
    commandPaletteOpen,
    setCommandPaletteOpen,
    onOpenShortcutGuide: () => {
      setCommandPaletteOpen(false);
      setShortcutGuideOpen(true);
    },
    onOpenReminder: openReminderPicker,
    onEscape: () => {
      if (threadSearchOpen) {
        setThreadSearchOpen(false);
        setThreadSearchQuery('');
      } else if (shortcutGuideOpen) {
        setShortcutGuideOpen(false);
      } else if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
      } else if (reminderTargetThread) {
        setReminderTargetThread(null);
      } else if (snoozeOpen) {
        setSnoozeOpen(false);
      } else if (mailboxMenuOpen) {
        setMailboxMenuOpen(false);
      } else if (store.settingsOpen) {
        store.setSettingsOpen(false);
      } else if (store.cleanupOpen) {
        store.setCleanupOpen(false);
      } else if (store.workspaceView === 'today') {
        store.setWorkspaceView('mail');
      } else if (store.searchQuery) {
        store.setSearchQuery('');
      } else if (store.activeDraft) {
        store.setActiveDraft(null);
      } else if (store.openedThread) {
        store.openThread(null);
      }
    }
  });

  const activeCategoryTabs = store.tabCategories.filter(c => {
    if (!c.active) return false;
    if (c.isSystem) return true;
    if (!store.activeAccount || store.activeAccount.id === 'unified') return true;
    return !c.accountId || c.accountId === 'global' || c.accountId === store.activeAccount.email;
  });
  const mailboxIcons: Record<MailboxView, typeof Inbox> = {
    inbox: Inbox,
    drafts: FileText,
    sent: Send,
    trash: Trash2,
    spam: OctagonAlert,
    muted: BellOff,
  };
  const mailboxSubtitles: Record<MailboxView, string> = {
    inbox: 'Split inbox categories',
    drafts: 'Local unsent drafts',
    sent: 'Recent sent conversations',
    trash: 'Deleted conversations',
    spam: 'Reported spam',
    muted: 'Ignored conversations',
  };
  const mailboxTabs = MAILBOX_VIEW_ORDER.map(id => ({
    id,
    label: MAILBOX_VIEW_LABELS[id],
    icon: mailboxIcons[id],
    count: id === 'drafts' ? store.draftsList.length : store.mailboxCounts[id],
    subtitle: mailboxSubtitles[id],
  }));
  const activeMailbox = mailboxTabs.find(mailbox => mailbox.id === store.mailboxView) || mailboxTabs[0];
  const EmptyMailboxIcon = activeMailbox.icon;
  const ActiveMailboxIcon = activeMailbox.icon;
  const emptyMailboxCopy = {
    inbox: {
      title: 'Clear inbox split',
      body: 'Jump to other splits or press C to compose.',
    },
    drafts: {
      title: 'No saved drafts',
      body: 'Unsent compose drafts appear here when draft restore is enabled.',
    },
    sent: {
      title: 'No sent conversations',
      body: 'Recent sent mail appears here after sync.',
    },
    trash: {
      title: 'Trash is empty',
      body: 'Deleted conversations appear here while they are cached locally.',
    },
    spam: {
      title: 'Spam is empty',
      body: 'Reported spam appears here while it is cached locally.',
    },
    muted: {
      title: 'No muted conversations',
      body: 'Ignored threads appear here when they carry the Dumka muted label.',
    },
  }[activeMailbox.id];
  const visibleMailboxRowCount = isDraftsMailbox ? store.draftsList.length : store.visibleThreads.length;
  const mailboxListLabel = `${activeMailbox.label} mailbox, ${visibleMailboxRowCount} ${
    isDraftsMailbox
      ? visibleMailboxRowCount === 1 ? 'draft' : 'drafts'
      : visibleMailboxRowCount === 1 ? 'thread' : 'threads'
  }`;
  const hasMailboxRows = visibleMailboxRowCount > 0;
  const virtualThreadWindow = useMemo(() => calculateVirtualWindow({
    itemCount: mailboxRows.length,
    rowHeight: threadRowHeight,
    viewportHeight: mailboxViewport.height || 600,
    scrollTop: mailboxViewport.scrollTop,
    overscan: 10,
  }), [mailboxRows.length, threadRowHeight, mailboxViewport.height, mailboxViewport.scrollTop]);
  const virtualRows = useMemo(
    () => mailboxRows.slice(virtualThreadWindow.startIndex, virtualThreadWindow.endIndex),
    [mailboxRows, virtualThreadWindow.startIndex, virtualThreadWindow.endIndex],
  );

  return (
    <div className="flex flex-col h-screen w-full overflow-hidden select-none text-[calc(12px*var(--font-scale))] leading-tight">
      {/* Main columns container */}
      <div className="flex flex-row flex-1 overflow-hidden relative">
        {/* 1. LEFT RAIL (Account Tabs switcher) */}
        <LeftRail />

        {/* MAIN LAYOUT SPLIT: Left Workspace | Right Context panels */}
        <div className="flex flex-1 overflow-hidden bg-[var(--app-bg)]">
          {/* 3. AI COPILOT PANEL (Moved next to Left Rail & Undockable) */}
          {store.aiPanelOpen && <AICopilotPanel />}

          {/* LEFT WORKSPACE (Header + Split Tabs + Lists) */}
          <div className="flex flex-col flex-1 overflow-hidden">
            {/* SEARCH COCKPIT BAR */}
            <SearchCockpitBar ref={searchInputRef} />

            {/* SPLIT TABS BAR */}
            <div className="flex items-center h-[var(--split-tabs-h)] min-h-[36px] px-4 border-b border-[var(--border)] bg-[var(--panel-bg)] justify-between select-none">
              <div className="flex min-w-0 h-full items-end gap-2">
                <div className="relative flex h-[var(--split-tab-h)] shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
                  <button
                    type="button"
                    onClick={() => setMailboxMenuOpen(value => !value)}
                    title="Switch mailbox (G / Shift+G)"
                    className="flex h-full min-w-[112px] items-center justify-between gap-2 rounded-md bg-transparent px-2 text-tab text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <ActiveMailboxIcon className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
                      <span className="truncate font-semibold">{activeMailbox.label}</span>
                      {activeMailbox.count > 0 && (
                        <span className="rounded-full bg-[var(--border)] px-1 text-[calc(10px*var(--font-scale))] font-normal text-[var(--text-primary)]">
                          {activeMailbox.count}
                        </span>
                      )}
                    </span>
                    <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
                  </button>
                  {mailboxMenuOpen && (
                    <div className="absolute left-0 top-[calc(100%+4px)] z-40 w-48 rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-1 shadow-lg">
                      {mailboxTabs.map(mailbox => {
                        const Icon = mailbox.icon;
                        const isActive = store.mailboxView === mailbox.id;
                        return (
                          <button
                            key={mailbox.id}
                            type="button"
                            onClick={() => {
                              store.setWorkspaceView('mail');
                              store.setMailboxView(mailbox.id);
                              store.setSettingsOpen(false);
                              store.setCleanupOpen(false);
                              setMailboxMenuOpen(false);
                            }}
                            className={`flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] ${
                              isActive
                                ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2">
                              <Icon className="h-3.5 w-3.5 shrink-0" />
                              <span className="truncate">{mailbox.label}</span>
                            </span>
                            {mailbox.count > 0 && (
                              <span className="shrink-0 rounded-full bg-[var(--border)] px-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)]">
                                {mailbox.count}
                              </span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {store.mailboxView === 'inbox' ? (
                  <div className="flex h-[var(--split-tab-h)] min-w-0 items-end gap-1 overflow-x-auto">
                    {activeCategoryTabs.map((category, i) => {
                      const count = store.splitCounts[category.id] || 0;
                      return (
                        <button
                          key={category.id}
                          draggable
                          onDragStart={(e) => handleDragStartTab(e, category.id)}
                          onDragOver={handleDragOverTab}
                          onDragEnter={(e) => handleDragEnterTab(e, category.id)}
                          onDragEnd={handleDragEndTab}
                          onDrop={(e) => handleDropTab(e, category.id)}
                          onClick={() => {
                            store.setWorkspaceView('mail');
                            store.setActiveSplit(category.id);
                            store.setSettingsOpen(false);
                            store.setCleanupOpen(false);
                          }}
                          className={`flex h-full items-center gap-1.5 border-b-2 px-3 text-tab transition-all cursor-grab ${
                            store.activeSplit === category.id
                              ? 'border-[var(--accent)] text-[var(--accent)] font-semibold'
                              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
                          } ${
                            draggedTabId === category.id ? 'opacity-40 scale-95' : ''
                          } ${
                            dragOverTabId === category.id && draggedTabId !== category.id
                              ? 'bg-[var(--accent)]/10 border-b-[var(--accent)] border-dashed'
                              : ''
                          }`}
                        >
                          {category.colorHex && (
                            <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: category.colorHex }} />
                          )}
                          <span>{category.displayName}</span>
                          {count > 0 && (
                            <span className="bg-[var(--border)] px-1 rounded-full text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] font-normal">
                              {count}
                            </span>
                          )}
                          <span className="text-[calc(8px*var(--font-scale))] opacity-40 font-normal">({i + 1})</span>
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <div className="flex h-full items-center min-w-0">
                    <div className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] truncate">
                      {activeMailbox.subtitle}
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const draft = store.startNewDraft();
                    if (!draft) {
                      store.setWorkspaceView('mail');
                      store.setSettingsOpen(true);
                      store.setCleanupOpen(false);
                      emitToast({ type: 'warning', message: 'Connect an account before composing.' });
                      return;
                    }
                  }}
                  title="Compose Message (C)"
                  className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all duration-150 active:scale-90"
                >
                  <SquarePen className="w-3.5 h-3.5" />
                </button>
                <button
                  onClick={() => setCommandPaletteOpen(true)}
                  title="Command Palette (Cmd+K)"
                  className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-all duration-150 active:scale-90"
                >
                  <Command className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>

            {/* SPLIT SCREEN WORKSPACE: Thread List + Reader pane OR Settings Panel */}
            <div className="flex flex-1 overflow-hidden">
              {store.workspaceView === 'today' ? (
                <TodayHome />
              ) : store.settingsOpen ? (
                <SettingsPanel />
              ) : store.cleanupOpen ? (
                <CleanupPanel />
              ) : (
                <>
                  {/* THREAD LIST CONTAINER */}
                  <div
                    className="relative flex flex-col border-r border-[var(--border)] h-full overflow-hidden"
                    style={{
                      width: store.enablePreviewPane 
                        ? `${store.previewPaneWidth}px` 
                        : (store.openedThread ? '0px' : '100%'),
                      display: !store.enablePreviewPane && store.openedThread ? 'none' : 'flex'
                    }}
                  >
                    {/* SCROLLABLE THREAD LIST */}
                    <div
                      ref={mailboxListRef}
                      className="flex-1 overflow-y-auto flex flex-col"
                      role={hasMailboxRows ? 'list' : undefined}
                      aria-label={hasMailboxRows ? mailboxListLabel : undefined}
                      onScroll={(event) => {
                        const element = event.currentTarget;
                        setMailboxViewport(prev => {
                          const next = { scrollTop: element.scrollTop, height: element.clientHeight };
                          if (Math.abs(prev.scrollTop - next.scrollTop) < 1 && Math.abs(prev.height - next.height) < 1) {
                            return prev;
                          }
                          return next;
                        });
                      }}
                    >
                      {isDraftsMailbox ? (
                        store.draftsList.length === 0 ? (
                          <div role="status" aria-live="polite" className="flex flex-col items-center justify-center flex-1 p-6 text-center text-[var(--text-secondary)]">
                            <EmptyMailboxIcon aria-hidden="true" className="w-10 h-10 mb-2 opacity-30" />
                            <p className="font-semibold">{emptyMailboxCopy.title}</p>
                            <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">{emptyMailboxCopy.body}</p>
                          </div>
                        ) : (
                          store.draftsList.map((draft) => (
                            <DraftRow
                              key={draft.id}
                              draft={draft}
                              onOpen={() => void openDraftFromList(draft)}
                              onDiscard={() => void store.discardDraft(draft.id)}
                            />
                          ))
                        )
                      ) : store.visibleThreads.length === 0 ? (
                        <div role="status" aria-live="polite" className="flex flex-col items-center justify-center flex-1 p-6 text-center text-[var(--text-secondary)]">
                          <EmptyMailboxIcon aria-hidden="true" className="w-10 h-10 mb-2 opacity-30" />
                          <p className="font-semibold">{emptyMailboxCopy.title}</p>
                          <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">{emptyMailboxCopy.body}</p>
                        </div>
                      ) : (
                        <div
                          role="presentation"
                          className="relative shrink-0"
                          style={{ height: `${virtualThreadWindow.totalHeight}px` }}
                        >
                          <div
                            role="presentation"
                            className="absolute left-0 right-0 top-0 flex flex-col"
                            style={{ transform: `translateY(${virtualThreadWindow.offsetTop}px)` }}
                          >
                            {virtualRows.map((row) => {
                              if (row.kind === 'header') {
                                return (
                                  <div
                                    key={`section-${row.id}`}
                                    role="presentation"
                                    style={{ height: `${threadRowHeight}px` }}
                                    className="flex items-end pb-1.5 px-3 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                                  >
                                    {row.label}
                                  </div>
                                );
                              }
                              const thread = row.thread;
                              return (
                                <ThreadRow
                                  key={thread.id}
                                  thread={thread}
                                  isFocused={store.focusedThreadId === thread.id}
                                  isOpened={store.openedThread?.id === thread.id}
                                  showAvatars={store.settings.appearance.showAvatars}
                                  isSelected={store.selectedThreadIds.has(thread.id)}
                                  isSelectionModeActive={store.selectedThreadIds.size > 0}
                                  isSemanticMatch={store.semanticMatchThreadIds.has(thread.id)}
                                  positionInSet={row.threadIndex + 1}
                                  setSize={store.visibleThreads.length}
                                  onClick={() => {
                                    store.setWorkspaceView('mail');
                                    store.openThread(thread);
                                  }}
                                  onToggleSelect={(e) => handleThreadSelectToggle(e, thread.id)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextMenu({ x: e.clientX, y: e.clientY, thread });
                                  }}
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* FLOATING BATCH ACTIONS BAR */}
                    {!isDraftsMailbox && store.selectedThreadIds.size > 0 && (
                      <div className="absolute bottom-4 left-4 right-4 z-10 bg-[var(--panel-bg)]/90 backdrop-blur-md border border-[var(--strong-border)] shadow-xl rounded-xl px-3 py-2.5 flex items-center justify-between animate-fade-in gap-3">
                        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
                          {store.selectedThreadIds.size} selected
                        </span>
                        
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => store.executeBatchMailAction('markRead', Array.from(store.selectedThreadIds))}
                            title="Mark as Read"
                            className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                          >
                            <MailOpen className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => store.executeBatchMailAction('markUnread', Array.from(store.selectedThreadIds))}
                            title="Mark as Unread"
                            className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                          >
                            <Mail className="w-3.5 h-3.5" />
                          </button>
                          {store.mailboxView === 'inbox' && (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('markDone', Array.from(store.selectedThreadIds))}
                              title="Archive / Done"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                            >
                              <CheckCircle className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <div className="relative">
                            <button
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                if (!selectedThreadsAccountId) {
                                  emitToast({ type: 'warning', message: 'Select threads from one account to apply Gmail labels.' });
                                  return;
                                }
                                setBatchLabelMenuOpen(value => !value);
                              }}
                              title="Label selected threads"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                            >
                              <Tags className="w-3.5 h-3.5" />
                            </button>
                            {batchLabelMenuOpen && (
                              <ThreadLabelMoveMenu
                                nodes={selectedUserLabelNodes}
                                onSyncLabels={() => {
                                  if (selectedThreadsAccountId) void store.syncLabels(selectedThreadsAccountId);
                                }}
                                onMove={(labelId) => runSelectedLabelAction('moveToLabel', labelId)}
                                onApply={(labelId) => runSelectedLabelAction('applyLabel', labelId)}
                                onRemove={(labelId) => runSelectedLabelAction('removeLabel', labelId)}
                                labelPresenceById={selectedLabelPresenceById}
                                className="absolute bottom-8 right-0"
                              />
                            )}
                          </div>
                          {store.mailboxView === 'spam' ? (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('restoreFromSpam', Array.from(store.selectedThreadIds))}
                              title="Not Spam"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success)] cursor-pointer transition-colors"
                            >
                              <Inbox className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('reportSpam', Array.from(store.selectedThreadIds))}
                              title="Move to Spam"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--warning)] cursor-pointer transition-colors"
                            >
                              <OctagonAlert className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {store.mailboxView === 'trash' ? (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('restoreFromTrash', Array.from(store.selectedThreadIds))}
                              title="Restore from Trash"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success)] cursor-pointer transition-colors"
                            >
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('moveToTrash', Array.from(store.selectedThreadIds))}
                              title="Move to Trash"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {store.mailboxView === 'muted' && (
                            <button
                              type="button"
                              onClick={unmuteSelectedThreads}
                              title="Unmute selected"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success)] cursor-pointer transition-colors"
                            >
                              <Bell className="w-3.5 h-3.5" />
                            </button>
                          )}
                          <div className="w-px h-3.5 bg-[var(--border)] mx-1" />
                          <button
                            type="button"
                            onClick={() => store.clearThreadSelection()}
                            title="Cancel Selection (Esc)"
                            className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </div>


                  {/* RESIZER BAR */}
                  {store.enablePreviewPane && (
                    <div
                      className="w-[4px] hover:w-[6px] active:w-[6px] bg-transparent hover:bg-[var(--accent)]/50 active:bg-[var(--accent)] cursor-col-resize transition-all h-full select-none shrink-0"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        const startX = e.clientX;
                        const startWidth = store.previewPaneWidth;
                        
                        const handleMouseMove = (moveEvent: MouseEvent) => {
                          const newWidth = Math.max(200, Math.min(600, startWidth + (moveEvent.clientX - startX)));
                          store.setPreviewPaneWidth(newWidth);
                        };
                        
                        const handleMouseUp = () => {
                          document.removeEventListener('mousemove', handleMouseMove);
                          document.removeEventListener('mouseup', handleMouseUp);
                        };
                        
                        document.addEventListener('mousemove', handleMouseMove);
                        document.addEventListener('mouseup', handleMouseUp);
                      }}
                    />
                  )}

                  {/* THREAD READER PANE */}
                  {(store.enablePreviewPane || store.openedThread) && (store.openedThread ? (
                    <div id="thread-reader-pane" className="panel-surface flex-1 flex flex-col overflow-y-auto bg-[var(--panel-bg)] p-6 relative">
                      
                      {/* Floating Reader Find in Page Bar */}
                      {threadSearchOpen && (
                        <div className="print-hidden absolute top-4 right-6 z-20 flex items-center gap-2 px-3 py-1.5 bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-lg shadow-xl animate-fade-in select-none">
                          <input
                            id="thread-search-input"
                            type="text"
                            placeholder="Find in email…"
                            value={threadSearchQuery}
                            onChange={(e) => {
                              setThreadSearchQuery(e.target.value);
                              setThreadActiveMatchIndex(0);
                            }}
                            onKeyDown={handleThreadInputKeyDown}
                            className="w-48 bg-transparent border-0 outline-none text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] placeholder-[var(--text-tertiary)]"
                          />
                          {threadSearchQuery && (
                            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] px-1 border-r border-[var(--border)] shrink-0 font-medium">
                              {threadMatchesCount > 0 ? `${threadActiveMatchIndex + 1} of ${threadMatchesCount}` : '0 of 0'}
                            </span>
                          )}
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={prevThreadMatch}
                              title="Previous match (Shift+Enter)"
                              className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              <ChevronUp className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={nextThreadMatch}
                              title="Next match (Enter)"
                              className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              <ChevronDown className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={() => {
                                  setThreadSearchOpen(false);
                                  setThreadSearchQuery('');
                              }}
                              className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      )}

                      <div
                        className="w-full mx-auto flex flex-col flex-1"
                        style={{ maxWidth: getMaxWidthStyle(store.settings.appearance.readerMaxWidth) }}
                      >
                        {/* Header Info */}
                        <div className="flex justify-between items-start border-b border-[var(--border)] pb-4 mb-4 select-text shrink-0">
                          <div>
                            {!store.enablePreviewPane && (
                              <button
                                onClick={() => store.openThread(null)}
                                className="print-hidden flex items-center gap-1 mb-3 text-[calc(11px*var(--font-scale))] text-[var(--accent)] font-medium hover:underline cursor-pointer select-none bg-[var(--hover-row)] px-2 py-1 rounded"
                              >
                                <ArrowLeft className="w-3.5 h-3.5" /> Back to List
                              </button>
                            )}
                            <h1 className="text-thread-title mb-2 text-[var(--text-primary)] select-text">
                              {store.openedThread.subject}
                            </h1>
                            <div className="flex items-center gap-2">
                              {threadHeaderIdentity ? (
                                <>
                                  <span className="font-semibold text-[var(--text-primary)] text-[calc(12px*var(--font-scale))]">
                                    {threadHeaderIdentity.senderName}
                                  </span>
                                  <span className="text-[var(--text-secondary)] text-[calc(11px*var(--font-scale))]">
                                    &lt;{threadHeaderIdentity.senderEmail}&gt;
                                  </span>
                                </>
                              ) : (
                                <span className="text-[var(--text-secondary)] text-[calc(11px*var(--font-scale))]">
                                  Loading sender...
                                </span>
                              )}
                            </div>
                          </div>
                          
                          {/* Actions buttons */}
                          <div className="print-hidden flex items-center gap-1">
                            {store.openedThreadMessages.length > 0 && (() => {
                              const lastMsg = store.openedThreadMessages[store.openedThreadMessages.length - 1];
                              return (
                                <>
                                  <button onClick={() => store.startReply(lastMsg)} title="Reply (R)" className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Reply className="w-4 h-4" /></button>
                                  <button onClick={() => store.startReply(lastMsg, true)} title="Reply All (A)" className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><ReplyAll className="w-4 h-4" /></button>
                                  <button onClick={() => store.startForward(lastMsg)} title="Forward (F)" className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"><Forward className="w-4 h-4" /></button>
                                  <span className="w-px h-4 bg-[var(--border)] mx-1" />
                                </>
                              );
                            })()}
                            <button
                              onClick={printOpenedThread}
                              title="Print Thread"
                              className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <Printer className="w-4 h-4" />
                            </button>
                            <div className="relative">
                              <button
                                onClick={(e) => { e.stopPropagation(); setSnoozeOpen(o => !o); }}
                                title="Snooze / Remind (H)"
                                className={`p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer ${store.openedThread?.reminderAt ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
                              >
                                <Clock className="w-4 h-4" />
                              </button>
                              {snoozeOpen && store.openedThread && (
                                <SnoozeMenu
                                  onPick={(d) => store.snoozeThread(store.openedThread!, d)}
                                  onClose={() => setSnoozeOpen(false)}
                                  targetSubject={store.openedThread.subject}
                                />
                              )}
                            </div>
                            {store.mailboxView === 'inbox' && (
                              <button
                                onClick={() => store.executeMailAction('markDone', store.openedThread!.id)}
                                title="Archive Thread (E)"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                <CheckCircle className="w-4 h-4 text-[var(--success)]" />
                              </button>
                            )}
                            <div className="relative">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setLabelMenuOpen(value => !value);
                                }}
                                title="Move or apply label"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                <Tags className="w-4 h-4" />
                              </button>
                            {labelMenuOpen && (
                                <ThreadLabelMoveMenu
                                  nodes={openedUserLabelNodes}
                                  onSyncLabels={() => {
                                    if (openedThreadAccountId) void store.syncLabels(openedThreadAccountId);
                                  }}
                                  onMove={(labelId) => runOpenedThreadLabelAction('moveToLabel', labelId)}
                                  onApply={(labelId) => runOpenedThreadLabelAction('applyLabel', labelId)}
                                  onRemove={(labelId) => runOpenedThreadLabelAction('removeLabel', labelId)}
                                  currentLabelIds={store.openedThread?.labelIds || []}
                                  className="absolute right-0 top-8"
                                />
                              )}
                            </div>
                            {store.mailboxView === 'muted' ? (
                              <button
                                onClick={() => store.unmuteThread(store.openedThread!.id)}
                                title="Unmute Thread"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--success)]"
                              >
                                <Bell className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => store.muteThread(store.openedThread!.id)}
                                title="Ignore / Mute Thread"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                              >
                                <BellOff className="w-4 h-4" />
                              </button>
                            )}
                            {store.mailboxView === 'spam' ? (
                              <button
                                onClick={() => store.executeMailAction('restoreFromSpam', store.openedThread!.id)}
                                title="Not Spam"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--success)]"
                              >
                                <Inbox className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => store.executeMailAction('reportSpam', store.openedThread!.id)}
                                title="Move to Spam"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--warning)]"
                              >
                                <OctagonAlert className="w-4 h-4" />
                              </button>
                            )}
                            {store.mailboxView === 'trash' ? (
                              <button
                                onClick={() => store.executeMailAction('restoreFromTrash', store.openedThread!.id)}
                                title="Restore from Trash"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--success)]"
                              >
                                <ArchiveRestore className="w-4 h-4" />
                              </button>
                            ) : (
                              <button
                                onClick={() => store.executeMailAction('moveToTrash', store.openedThread!.id)}
                                title="Move to Trash"
                                className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--danger)]"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                            <button
                              onClick={() => store.openThread(null)}
                              className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Messages Body */}
                        <AgenticThreadPanel />
                        <div className="flex-1 flex flex-col gap-6 select-text">
                          {store.openedThreadMessages.length === 0 ? (
                            <div className="text-[var(--text-secondary)] text-center py-10">
                              Loading message details…
                            </div>
                          ) : (
                            store.openedThreadMessages.map((msg) => (
                              <div key={msg.id} data-message-id={msg.id}>
                                <MessageCard msg={msg} defaultLoadImages={store.settings.privacy.loadRemoteImages} />
                              </div>
                            ))
                          )}
                        </div>

                        {/* Inline Draft Reply Affordance */}
                        <InlineReplyComposer />

                        {!store.activeDraft && store.openedThreadMessages.length > 0 && (() => {
                          const lastMsg = store.openedThreadMessages[store.openedThreadMessages.length - 1];
                          return (
                            <div className="print-hidden mt-6 flex gap-3 select-none shrink-0">
                              <button
                                onClick={() => store.startReply(lastMsg)}
                                className="px-4 py-2 bg-[var(--raised-surface)] border border-[var(--border)] rounded-[8px] text-[calc(13px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] cursor-pointer transition-all flex items-center gap-2 font-medium"
                              >
                                <Reply className="w-4 h-4" /> Reply
                              </button>
                              <button
                                onClick={() => store.startReply(lastMsg, true)}
                                className="px-4 py-2 bg-[var(--raised-surface)] border border-[var(--border)] rounded-[8px] text-[calc(13px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] hover:border-[var(--text-secondary)] cursor-pointer transition-all flex items-center gap-2 font-medium"
                              >
                                <ReplyAll className="w-4 h-4" /> Reply All
                              </button>
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ) : (
                    <div className="flex-1 flex flex-col items-center justify-center text-[var(--text-secondary)] bg-[var(--panel-bg)]">
                      <Mail className="w-12 h-12 mb-3 opacity-25" />
                      <p className="font-medium text-[calc(13px*var(--font-scale))]">No thread selected</p>
                      <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">Press Enter or O on any row to open the reader.</p>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* 2. RIGHT PANEL (Context + Diagnostics + Health + Ledger) */}
          <RightContextPanel />
        </div>
      </div>

      {/* 4. UNDO SEND TRANSITIONAL BANNER */}
      {store.pendingSend && (
        <div className="absolute bottom-8 left-1/2 -translate-x-1/2 panel-surface bg-[var(--panel-bg)] border border-[var(--warning)]/40 rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3.5 z-50 select-none fade-in-up">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--warning)]/15 text-[var(--warning)]">
            <Inbox className="w-3.5 h-3.5" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">
              Sending in {store.pendingSendSeconds}s…
            </span>
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">Undo window active</span>
          </div>
          <button
            onClick={() => store.cancelPendingSend()}
            className="px-3 py-1.5 text-[calc(11px*var(--font-scale))] bg-[var(--warning)] text-white rounded-lg cursor-pointer font-semibold hover:opacity-90 transition-opacity"
          >
            Cancel Send
          </button>
        </div>
      )}

      {/* 5. COMMAND PALETTE OVERLAY */}
      <CommandPalette
        isOpen={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
        onOpenReminder={openReminderForCurrentTarget}
      />

      <ShortcutGuideOverlay
        isOpen={shortcutGuideOpen}
        settings={store.settings.shortcuts}
        onClose={() => setShortcutGuideOpen(false)}
      />

      {/* 6. BOTTOM SHORTCUTS HINTS BAR */}
      <BottomShortcutBar />

      {/* Floating Compose Drawer Overlay */}
      <FloatingComposeDrawer />

      {reminderTargetThread && (
        <SnoozeMenu
          floating
          targetSubject={reminderTargetThread.subject}
          onPick={(date) => store.snoozeThread(reminderTargetThread, date)}
          onClose={() => setReminderTargetThread(null)}
        />
      )}

      {contextMenu && (
        <div
          className="fixed z-50 w-[180px] bg-[var(--panel-bg)]/85 backdrop-blur-md border border-[var(--border)] rounded-xl shadow-2xl py-1.5 flex flex-col select-none scale-in"
          style={{
            left: `${Math.min(contextMenu.x, window.innerWidth - 190)}px`,
            top: `${Math.min(contextMenu.y, window.innerHeight - 250)}px`,
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              store.setWorkspaceView('mail');
              store.openThread(contextMenu.thread);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <MailOpenIcon className="w-3.5 h-3.5 opacity-80" />
            <span>Open Email</span>
          </button>
          
          <button
            onClick={() => {
              store.executeMailAction(contextMenu.thread.isUnread ? 'markRead' : 'markUnread', contextMenu.thread.id);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <Mail className="w-3.5 h-3.5 opacity-80" />
            <span>Mark {contextMenu.thread.isUnread ? 'Read' : 'Unread'}</span>
          </button>
          
          {store.mailboxView === 'inbox' && (
            <button
              onClick={() => {
                store.executeMailAction('markDone', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <CheckCircle className="w-3.5 h-3.5 opacity-80" />
              <span>Archive / Done</span>
            </button>
          )}

          {store.mailboxView === 'muted' ? (
            <button
              onClick={() => {
                store.unmuteThread(contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <Bell className="w-3.5 h-3.5 opacity-80" />
              <span>Unmute Thread</span>
            </button>
          ) : (
            <button
              onClick={() => {
                store.muteThread(contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <BellOff className="w-3.5 h-3.5 opacity-80" />
              <span>Ignore Thread</span>
            </button>
          )}

          {store.mailboxView === 'spam' ? (
            <button
              onClick={() => {
                store.executeMailAction('restoreFromSpam', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <Inbox className="w-3.5 h-3.5 opacity-80" />
              <span>Not Spam</span>
            </button>
          ) : (
            <button
              onClick={() => {
                store.executeMailAction('reportSpam', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <OctagonAlert className="w-3.5 h-3.5 opacity-80" />
              <span>Move to Spam</span>
            </button>
          )}

          {store.mailboxView === 'trash' ? (
            <button
              onClick={() => {
                store.executeMailAction('restoreFromTrash', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <ArchiveRestore className="w-3.5 h-3.5 opacity-80" />
              <span>Restore from Trash</span>
            </button>
          ) : (
            <button
              onClick={() => {
                store.executeMailAction('moveToTrash', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
            >
              <Trash2 className="w-3.5 h-3.5 opacity-80" />
              <span>Move to Trash</span>
            </button>
          )}
          
          <button
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(9, 0, 0, 0);
              store.snoozeThread(contextMenu.thread, tomorrow);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 opacity-80" />
            <span>Remind Tomorrow</span>
          </button>

          <div className="h-[1px] bg-[var(--border)] my-1 mx-2" />

          <button
            onClick={() => {
              store.setWorkspaceView('mail');
              store.openThread(contextMenu.thread).then(() => {
                store.saveDraftLocally('', contextMenu.thread.senderEmail, `Re: ${contextMenu.thread.subject}`);
              });
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <CornerUpLeftIcon className="w-3.5 h-3.5 opacity-80" />
            <span>Reply</span>
          </button>

          <button
            onClick={() => {
              store.setWorkspaceView('mail');
              store.openThread(contextMenu.thread).then(() => {
                store.runAITriagePlan();
              });
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 opacity-80 text-[var(--ai-accent)] hover:text-white" />
            <span>AI Triage Queue</span>
          </button>
        </div>
      )}
    </div>
  );
}

// Fallback subicons since they were renamed/resolved from old definitions
function MailOpenIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 9v.906a2.25 2.25 0 0 1-1.183 1.981l-6.478 3.488M2.25 9v.906a2.25 2.25 0 0 0 1.183 1.981l6.478 3.488m8.839 2.51-4.66-2.51m0 0-1.023-.55a2.25 2.25 0 0 0-2.134 0l-1.022.55m0 0-4.661 2.51m16.5-16.5L12 12.75 2.25 4.5" />
    </svg>
  );
}

function CornerUpLeftIcon({ className }: { className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className={className}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 15 3 9m0 0 6-6M3 9h12a6 6 0 0 1 0 12h-3" />
    </svg>
  );
}

function clearHighlights(root: HTMLElement) {
  const highlights: HTMLElement[] = [];
  
  const findHighlights = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'MARK' && el.classList.contains('email-search-highlight')) {
        highlights.push(el);
      }
      if (el.tagName === 'IFRAME') {
        const iframe = el as HTMLIFrameElement;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            findHighlights(doc.body);
          }
        } catch (e) {}
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      findHighlights(node.childNodes[i]);
    }
  };

  findHighlights(root);

  for (const mark of highlights) {
    const parent = mark.parentNode;
    if (parent) {
      const textNode = document.createTextNode(mark.textContent || '');
      parent.replaceChild(textNode, mark);
    }
  }

  const normalizeNode = (node: Node) => {
    node.normalize();
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'IFRAME') {
        const iframe = el as HTMLIFrameElement;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            doc.body.normalize();
            for (let i = 0; i < doc.body.childNodes.length; i++) {
              normalizeNode(doc.body.childNodes[i]);
            }
          }
        } catch (e) {}
      }
    }
    for (let i = 0; i < node.childNodes.length; i++) {
      normalizeNode(node.childNodes[i]);
    }
  };
  
  normalizeNode(root);
}

function applyHighlights(root: HTMLElement, query: string, activeIdx: number): { count: number; elements: HTMLElement[] } {
  const elements: HTMLElement[] = [];
  if (!query.trim()) return { count: 0, elements };

  const escaped = query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
  const regex = new RegExp(`(${escaped})`, 'gi');

  const traverse = (node: Node) => {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el.tagName === 'SCRIPT' || el.tagName === 'STYLE' || el.tagName === 'NOSCRIPT') {
        return;
      }
      if (el.tagName === 'IFRAME') {
        const iframe = el as HTMLIFrameElement;
        try {
          const doc = iframe.contentDocument || iframe.contentWindow?.document;
          if (doc && doc.body) {
            traverse(doc.body);
          }
        } catch (e) {}
        return;
      }
    }

    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue || '';
      regex.lastIndex = 0;
      if (regex.test(text)) {
        regex.lastIndex = 0;
        const parts = text.split(regex);
        const fragment = document.createDocumentFragment();
        
        for (const part of parts) {
          if (part.toLowerCase() === query.toLowerCase()) {
            const mark = document.createElement('mark');
            mark.className = 'email-search-highlight';
            mark.textContent = part;
            
            mark.style.backgroundColor = 'rgba(235, 140, 61, 0.4)';
            mark.style.color = 'inherit';
            mark.style.borderRadius = '2px';
            mark.style.padding = '0 2px';
            mark.style.borderBottom = '1px solid var(--warning)';
            mark.style.fontWeight = '600';
            
            fragment.appendChild(mark);
            elements.push(mark);
          } else if (part) {
            fragment.appendChild(document.createTextNode(part));
          }
        }
        
        const parent = node.parentNode;
        if (parent) {
          parent.replaceChild(fragment, node);
        }
      }
      return;
    }

    const children = Array.from(node.childNodes);
    for (const child of children) {
      traverse(child);
    }
  };

  traverse(root);

  if (elements.length > 0) {
    const safeIdx = (activeIdx + elements.length) % elements.length;
    elements.forEach((el, idx) => {
      if (idx === safeIdx) {
        el.style.backgroundColor = 'var(--accent)';
        el.style.color = '#ffffff';
        el.style.boxShadow = '0 0 0 2px var(--accent)';
        el.style.borderBottom = 'none';
        
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        el.style.backgroundColor = 'rgba(235, 140, 61, 0.4)';
        el.style.color = 'inherit';
        el.style.boxShadow = 'none';
        el.style.borderBottom = '1px solid var(--warning)';
      }
    });
  }

  return { count: elements.length, elements };
}

export default function App() {
  return (
    <AppStoreProvider>
      <AppContent />
      <ToastHost />
    </AppStoreProvider>
  );
}
