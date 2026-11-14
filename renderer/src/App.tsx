import { mailboxListScopeKey } from './lib/mailboxFocus';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useAppStore, AppStoreProvider } from './stores/AppStore';
import { useKeyboard } from './hooks/useKeyboard';
import { useEscapeLayer } from './hooks/useEscapeLayer';
import {
  ArchiveRestore, Bell, Inbox, Clock, CheckCircle, X,
  Mail, Sparkles, MailOpen, Trash2, OctagonAlert, BellOff, Tags,
} from 'lucide-react';
import { SnoozeMenu } from './components/SnoozeMenu';
import { ToastHost } from './components/Toast';
import { GoogleAuthBanner } from './components/GoogleAuthBanner';
import { MailboxSyncBanner } from './components/MailboxSyncBanner';
import { ConnectGmailPanel } from './components/ConnectGmailPanel';
import { ThreadLabelMoveMenu } from './components/ThreadLabelMoveMenu';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { LeftRail } from './components/layout/LeftRail';
import { AICopilotPanel } from './components/layout/AICopilotPanel';
import { SearchCockpitBar } from './components/layout/SearchCockpitBar';
import { BottomShortcutBar } from './components/layout/BottomShortcutBar';
import { CommandPalette } from './components/layout/CommandPalette';
import { FloatingComposeDrawer } from './components/layout/FloatingComposeDrawer';
import { ShortcutGuideOverlay } from './components/layout/ShortcutGuideOverlay';
import { MailboxList } from './components/mailbox/MailboxList';
import { ListResizeHandle } from './components/mailbox/ListResizeHandle';
import { resolveListWidth, type ListWidthMode } from '../../shared/listLayout';
import { MailboxListHeader } from './components/mailbox/MailboxListHeader';
import { ClearGroupPane, DoneSummaryPane, FetchingInboxPane, PreparedPane } from './components/mailbox/ReadingAreaPanes';
import { MoveToSectionPopover } from './components/mailbox/MoveToSectionPopover';
import { SenderRuleConsentDialog } from './components/mailbox/SenderRuleRows';
import { UnsubscribeConfirmSheet } from './components/UnsubscribeConfirmSheet';
import { NARROW_MAIL_LAYOUT_QUERY, useMediaQuery } from './hooks/useMediaQuery';
import { useInviteRsvp } from './hooks/useInviteRsvp';
import { useNoReplyReminders } from './hooks/useNoReplyReminders';
import { ThreadReader, type ThreadFindState } from './components/reader/ThreadReader';
import { CalendarWorkspace } from './calendar/CalendarWorkspace';
import { emitToast } from './lib/toastBus';
import { composeOrConnectAccount } from './lib/composeOrConnect';
import { resolveComposeAccountId } from './lib/composeAccount';
import { shouldCloseReaderForSearchChange } from './lib/searchReaderBehavior';
import { applyEmailSearchHighlights, clearEmailSearchHighlights, EMAIL_BODY_READY_EVENT } from './lib/emailSearchHighlights';
import { isTextEditingElement } from './lib/undoRouting';
import { buildLabelTree, flattenLabelTree, labelDefinitionsForAccount, labelPresenceInThreads } from '../../shared/labels';
import { reverseMailActionKind } from '../../shared/mailActions';
import { aggregateMailActionResults, isUndoableMailActionLog } from '../../shared/mailActionFeedback';
import { presentMailActionFeedback, undoPayloadJson } from './lib/presentMailAction';
import { threadNeedsInviteAnswer } from '../../shared/inviteRsvp';
import type { MailThread } from '../../shared/types';

function AppContent() {
  const store = useAppStore();
  const inviteRsvp = useInviteRsvp();
  useNoReplyReminders();
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutGuideOpen, setShortcutGuideOpen] = useState(false);
  const [reminderTargetThread, setReminderTargetThread] = useState<MailThread | null>(null);
  const [batchLabelMenuOpen, setBatchLabelMenuOpen] = useState(false);
  const [moveToSectionThread, setMoveToSectionThread] = useState<MailThread | null>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    thread: MailThread;
  } | null>(null);
  const narrowLayout = useMediaQuery(NARROW_MAIL_LAYOUT_QUERY);
  // The mailbox list's width: remembered per layout, previewed live while its divider is dragged.
  const listColumnRef = useRef<HTMLDivElement>(null);
  const [listWidthPreview, setListWidthPreview] = useState<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setViewportWidth(window.innerWidth);
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);
  const previousSearchQueryRef = useRef(store.searchQuery);
  const startupBehaviorAppliedRef = useRef(false);
  const selectedThreads = useMemo(
    () => store.threads.filter(thread => store.selectedThreadIds.has(thread.id)),
    [store.selectedThreadIds, store.threads],
  );
  const selectedThreadsAccountId = useMemo(() => {
    const accountIds = Array.from(new Set(selectedThreads.map(thread => thread.accountId)));
    return accountIds.length === 1 ? accountIds[0] : null;
  }, [selectedThreads]);
  const selectedUserLabelNodes = useMemo(
    () => flattenLabelTree(buildLabelTree(
      labelDefinitionsForAccount(store.labelDefinitions, selectedThreadsAccountId).filter(label => label.type !== 'system')
    )),
    [selectedThreadsAccountId, store.labelDefinitions],
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

  // Set platform attribute for cross-platform layout padding overrides (macOS vs Windows/Linux titlebars)
  useEffect(() => {
    const isMac = window.navigator.platform.includes('Mac');
    document.documentElement.setAttribute('data-platform', isMac ? 'darwin' : 'other');
  }, []);

  useEffect(() => {
    if (!store.settingsLoaded || startupBehaviorAppliedRef.current) return;
    startupBehaviorAppliedRef.current = true;
    store.setSettingsOpen(false);
    store.setCleanupOpen(false);
    // Today is no longer a screen of its own (SPEC §2): a saved "today"
    // startup preference opens the inbox.
    store.setWorkspaceView('mail');
    if (store.settings.general.startupBehavior === 'commandPalette') {
      setCommandPaletteOpen(true);
    }
  }, [store.settings.general.startupBehavior, store.settingsLoaded]);

  // Listen to native Electron menu commands
  useEffect(() => {
    if (!window.electronAPI || !window.electronAPI.onExecuteCommand) return;
    const unsubscribe = window.electronAPI.onExecuteCommand((cmdId: string) => {
      switch (cmdId) {
        case 'file.newDraft': {
          if (store.workspaceView === 'today') break;
          composeOrConnectAccount(store);
          break;
        }
        case 'edit.undo':
          if (isTextEditingElement(document.activeElement)) {
            window.electronAPI.undoFocusedInput().catch(err => {
              console.error('Failed to undo focused text input:', err);
            });
            break;
          }
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

  const hasActiveDraft = Boolean(store.activeDraft);

  useEffect(() => {
    if (!window.electronAPI?.setMenuCommandState) return;

    const canCreateDraft = store.accounts.length === 0
      || Boolean(resolveComposeAccountId(store.activeAccount, store.accounts));
    const canUndo = hasActiveDraft
      || store.actionLog.some(isUndoableMailActionLog);

    window.electronAPI.setMenuCommandState({ canCreateDraft, canUndo }).catch(err => {
      console.error('Failed to update native menu command state:', err);
    });
  }, [store.activeAccount, store.accounts, store.actionLog, hasActiveDraft]);

  const searchInputRef = useRef<HTMLInputElement>(null);

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

  const threadFind: ThreadFindState = {
    open: threadSearchOpen,
    query: threadSearchQuery,
    matchesCount: threadMatchesCount,
    activeIndex: threadActiveMatchIndex,
    setQuery: (query) => {
      setThreadSearchQuery(query);
      setThreadActiveMatchIndex(0);
    },
    next: nextThreadMatch,
    prev: prevThreadMatch,
    close: () => {
      setThreadSearchOpen(false);
      setThreadSearchQuery('');
    },
  };

  // Manage highlights in the thread reader pane DOM. Re-run when a mail iframe
  // finishes writing so the first find-in-email pass is not racing doc.write.
  useEffect(() => {
    const apply = () => {
      const pane = document.getElementById('thread-reader-pane');
      if (!pane) return;

      clearEmailSearchHighlights(pane);

      if (!threadSearchOpen || !threadSearchQuery.trim()) {
        setThreadMatchesCount(0);
        setThreadActiveMatchIndex(0);
        return;
      }

      const { count } = applyEmailSearchHighlights(pane, threadSearchQuery, threadActiveMatchIndex);
      setThreadMatchesCount(count);
    };

    apply();
    window.addEventListener(EMAIL_BODY_READY_EVENT, apply);
    return () => window.removeEventListener(EMAIL_BODY_READY_EVENT, apply);
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

  useEffect(() => {
    if (!reminderTargetThread) return;
    const close = () => setReminderTargetThread(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [reminderTargetThread]);

  useEffect(() => {
    if (!batchLabelMenuOpen) return;
    const close = () => setBatchLabelMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [batchLabelMenuOpen]);

  useEffect(() => {
    if (store.selectedThreadIds.size === 0) setBatchLabelMenuOpen(false);
  }, [store.selectedThreadIds.size]);

  const runSelectedLabelAction = (kind: 'moveToLabel' | 'applyLabel' | 'removeLabel', labelId: string) => {
    const threadIds = Array.from(store.selectedThreadIds);
    if (threadIds.length === 0) return;
    setBatchLabelMenuOpen(false);
    store.clearThreadSelection();
    const batchId = crypto.randomUUID();
    void (async () => {
      const results = await Promise.all(threadIds.map(threadId =>
        store.executeMailAction(kind, threadId, null, undefined, JSON.stringify({ labelId, silent: true, batchId }))
      ));
      const aggregated = aggregateMailActionResults(results);
      const reverseKind = reverseMailActionKind(kind);
      presentMailActionFeedback({
        result: aggregated,
        kind,
        count: results.length,
        succeeded: aggregated.succeeded,
        failed: aggregated.failed,
      }, {
        onUndo: reverseKind
          ? () => {
              const redoBatchId = crypto.randomUUID();
              void Promise.all(threadIds.map(threadId =>
                store.executeMailAction(
                  reverseKind,
                  threadId,
                  null,
                  undefined,
                  undoPayloadJson(JSON.stringify({ labelId }), {
                    silent: threadIds.length > 1,
                    batchId: redoBatchId,
                  }),
                )
              )).then(undoResults => {
                const undoAggregated = aggregateMailActionResults(undoResults);
                presentMailActionFeedback({
                  result: undoAggregated,
                  kind: reverseKind,
                  count: undoResults.length,
                  succeeded: undoAggregated.succeeded,
                  failed: undoAggregated.failed,
                }, {
                  onUndo: () => runSelectedLabelAction(kind, labelId),
                  onRetry: () => runSelectedLabelAction(kind, labelId),
                });
              }).catch(error => {
                console.error('Failed to undo label action:', error);
                emitToast({ type: 'error', message: 'Could not undo.' });
              });
            }
          : undefined,
        onRetry: () => runSelectedLabelAction(kind, labelId),
      });
    })();
  };

  const unmuteSelectedThreads = () => {
    const threadIds = Array.from(store.selectedThreadIds);
    if (threadIds.length === 0) return;
    store.clearThreadSelection();
    const batchId = crypto.randomUUID();
    void (async () => {
      const results = await Promise.all(threadIds.map(threadId =>
        store.unmuteThread(threadId, { silent: true, batchId })
      ));
      const aggregated = aggregateMailActionResults(results);
      presentMailActionFeedback({
        result: aggregated,
        kind: 'unmuteThread',
        count: results.length,
        succeeded: aggregated.succeeded,
        failed: aggregated.failed,
      }, {
        onUndo: () => {
          const redoBatchId = crypto.randomUUID();
          void Promise.all(threadIds.map(threadId =>
            store.muteThread(threadId, { silent: threadIds.length > 1, batchId: redoBatchId })
          )).then(muteResults => {
            const muteAggregated = aggregateMailActionResults(muteResults);
            presentMailActionFeedback({
              result: muteAggregated,
              kind: 'muteThread',
              count: muteResults.length,
              succeeded: muteAggregated.succeeded,
              failed: muteAggregated.failed,
            });
          }).catch(error => {
            console.error('Failed to remute threads:', error);
            emitToast({ type: 'error', message: 'Could not undo.' });
          });
        },
        onRetry: () => unmuteSelectedThreads(),
      });
    })().catch(error => {
      console.error('Failed to unmute selected threads:', error);
      emitToast({ type: 'error', message: 'Could not unmute the selected threads.' });
    });
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

  // The row context menu is the innermost layer while open: Esc closes only it.
  useEscapeLayer(Boolean(contextMenu), () => setContextMenu(null));
  // Stable, so the popover's dialog focus effect does not re-run each render.
  const closeMoveToSection = useCallback(() => setMoveToSectionThread(null), []);

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

  const openReminderPicker = (thread: MailThread) => {
    setCommandPaletteOpen(false);
    setReminderTargetThread(thread);
  };

  const openReminderForCurrentTarget = () => {
    const target = store.openedThread || store.listNavigationThreads.find(t => t.id === store.focusedThreadId) || store.listNavigationThreads[0];
    if (!target) {
      emitToast({ type: 'info', message: 'No thread selected.' });
      return;
    }
    openReminderPicker(target);
  };

  const openMoveToSectionForCurrentTarget = () => {
    const target = store.openedThread
      || (store.focusedCollapsedGroup ? null : store.listNavigationThreads.find(t => t.id === store.focusedThreadId));
    if (!target || store.mailboxView !== 'inbox') {
      emitToast({ type: 'info', message: 'Open or focus an inbox conversation to move it.' });
      return;
    }
    setMoveToSectionThread(target);
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
    onOpenMoveToSection: (thread) => {
      setCommandPaletteOpen(false);
      setMoveToSectionThread(thread);
    },
    onAnswerInvite: (thread, answer) => {
      setCommandPaletteOpen(false);
      void inviteRsvp.answer(thread, answer);
    },
    // Layers close innermost first. Popovers and menus (compose menus, More,
    // the mailbox switcher, search filters, the row context menu) take Esc
    // before this chain via `useEscapeLayer`; dialogs with `useDialogFocus`
    // stop it too. Here: find-in-thread bar → sheets / dialogs → Ask Dumka →
    // reply dock → Today → reader → search.
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
      } else if (moveToSectionThread) {
        setMoveToSectionThread(null);
      } else if (store.settingsOpen) {
        store.setSettingsOpen(false);
      } else if (store.cleanupOpen) {
        store.setCleanupOpen(false);
      } else if (store.aiPanelOpen) {
        // The floating Ask Dumka panel sits over the reader and the reply dock;
        // it returns focus to where it was opened from when it unmounts.
        store.setAiPanelOpen(false);
      } else if (store.activeDraft) {
        // Esc in the reply/compose editor keeps the draft (SPEC §3).
        void store.closeDraftKeepingIt();
      } else if (store.workspaceView === 'today') {
        store.setWorkspaceView('mail');
      } else if (store.openedThread) {
        void store.closeOpenedThread();
      } else if (store.searchQuery) {
        store.setSearchQuery('');
      }
    }
  });

  const hasOpenThread = Boolean(store.openedThread);
  // Three columns at most: rail, list, reading area (SPEC §2/§3). Below
  // 1100 px (or with the preview pane off) an open thread replaces the list;
  // Esc goes back.
  const readerReplacesList = hasOpenThread && (narrowLayout || !store.enablePreviewPane);
  const showReadingArea = hasOpenThread || (store.enablePreviewPane && !narrowLayout);
  const listWidthMode: ListWidthMode = hasOpenThread ? 'reading' : 'home';
  const storedListWidth = listWidthMode === 'reading' ? store.settings.appearance.listWidthReading : store.settings.appearance.listWidthHome;
  // The list and the reading area share what the window leaves after the rail.
  const sharedWidth = Math.max(0, viewportWidth - (listColumnRef.current?.getBoundingClientRect().left ?? 0));
  const listWidth = !showReadingArea
    ? '100%'
    : listWidthPreview !== null ? `${listWidthPreview}px` : resolveListWidth(storedListWidth, listWidthMode, sharedWidth);
  const inboxHome = store.mailboxView === 'inbox' && !store.searchQuery.trim() && store.accounts.length > 0;
  const idleReadingPane = !inboxHome ? null
    : store.groupViewStates.clear?.expanded ? <ClearGroupPane />
    : store.fetchingInbox ? <FetchingInboxPane />
    : store.visibleThreads.length > 0 ? <PreparedPane />
    : <DoneSummaryPane />;

  return (
    <div className="dm-app-shell flex flex-col h-screen w-full overflow-hidden select-none text-[calc(12px*var(--font-scale))] leading-tight">
      {/* Main columns container */}
      <div className="dm-app-layout flex flex-row flex-1 overflow-hidden relative">
        {/* 1. LEFT RAIL (Account Tabs switcher) */}
        <LeftRail />

        {/* MAIN LAYOUT SPLIT: Left Workspace | Right Context panels */}
        <div className="dm-workspace-frame flex flex-1 flex-col overflow-hidden bg-[var(--app-bg)]">
          <GoogleAuthBanner />
          <MailboxSyncBanner />
          <div className="flex min-h-0 flex-1 overflow-hidden">
          {/* The assistant (⌘J) floats over the reading area; it is no longer a column. */}
          {store.aiPanelOpen && <AICopilotPanel floatingOnly />}

          <div className="dm-workspace relative flex flex-col flex-1 overflow-hidden">
            {store.workspaceView === 'calendar' && (
              <div className="absolute inset-0 z-30">
                <CalendarWorkspace />
              </div>
            )}
            {store.workspaceView !== 'calendar' && (
              <SearchCockpitBar ref={searchInputRef} />
            )}

            <div className="flex flex-1 overflow-hidden">
              {store.settingsOpen ? (
                <SettingsPanel />
              ) : store.accounts.length === 0 ? (
                <ConnectGmailPanel />
              ) : (
                <>
                  {/* MAILBOX LIST */}
                  <div
                    ref={listColumnRef}
                    className="dm-thread-list relative flex h-full shrink-0 flex-col overflow-hidden border-r border-[var(--border)]"
                    data-list-width={hasOpenThread ? 'reading' : 'home'}
                    style={{
                      width: listWidth,
                      display: readerReplacesList ? 'none' : 'flex',
                    }}
                  >
                    {showReadingArea && !readerReplacesList && (
                      <ListResizeHandle mode={listWidthMode} listRef={listColumnRef} onPreview={setListWidthPreview} />
                    )}
                    <MailboxListHeader onOpenCommandPalette={() => setCommandPaletteOpen(true)} />
                    <MailboxList
                      key={mailboxListScopeKey(store.activeAccount?.id, store.mailboxView)}
                      onThreadContextMenu={(event, thread) => setContextMenu({ x: event.clientX, y: event.clientY, thread })}
                    />

                    {/* FLOATING BATCH ACTIONS BAR */}
                    {!isDraftsMailbox && store.selectedThreadIds.size > 0 && (
                      <div className="dm-overlay absolute bottom-4 left-4 right-4 z-10 bg-[var(--panel-bg)]/90 backdrop-blur-md border border-[var(--strong-border)] shadow-xl rounded-xl px-3 py-2.5 flex items-center justify-between animate-fade-in gap-3">
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
                                onClose={() => setBatchLabelMenuOpen(false)}
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
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success-solid)] cursor-pointer transition-colors"
                            >
                              <Inbox className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('reportSpam', Array.from(store.selectedThreadIds))}
                              title="Move to Spam"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--warning-solid)] cursor-pointer transition-colors"
                            >
                              <OctagonAlert className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {store.mailboxView === 'trash' ? (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('restoreFromTrash', Array.from(store.selectedThreadIds))}
                              title="Restore from Trash"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success-solid)] cursor-pointer transition-colors"
                            >
                              <ArchiveRestore className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => store.executeBatchMailAction('moveToTrash', Array.from(store.selectedThreadIds))}
                              title="Move to Trash"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--danger-solid)] cursor-pointer transition-colors"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {store.mailboxView === 'muted' && (
                            <button
                              type="button"
                              onClick={unmuteSelectedThreads}
                              title="Unmute selected"
                              className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--success-solid)] cursor-pointer transition-colors"
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

                  {/* READING AREA */}
                  {showReadingArea && (store.openedThread ? (
                    <ThreadReader
                      key={`${store.openedThread.accountId}:${store.openedThread.id}`}
                      thread={store.openedThread}
                      readerReplacesList={readerReplacesList}
                      find={threadFind}
                      onOpenReminder={openReminderPicker}
                      onOpenMoveToSection={(thread) => setMoveToSectionThread(thread)}
                    />
                  ) : idleReadingPane ? (
                    idleReadingPane
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
          </div>
        </div>
      </div>

      {/* 4. UNDO SEND TRANSITIONAL BANNER */}
      {store.pendingSend && (
        <div className="dm-overlay absolute bottom-8 left-1/2 -translate-x-1/2 panel-surface bg-[var(--panel-bg)] border border-[var(--warning)]/40 rounded-xl shadow-2xl px-4 py-2.5 flex items-center gap-3.5 z-50 select-none fade-in-up">
          <span className="flex items-center justify-center w-6 h-6 rounded-full bg-[var(--warning)]/15 text-[var(--warning-solid)]">
            <Inbox className="w-3.5 h-3.5" />
          </span>
          <div className="flex flex-col leading-tight">
            <span className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">
              Sending in {store.pendingSendSeconds}s…
            </span>
            <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">Undo window active</span>
          </div>
          <button
            onClick={() => void store.cancelPendingSend()}
            className="px-3 py-1.5 text-[calc(11px*var(--font-scale))] bg-[var(--warning-fill)] text-[var(--on-accent)] rounded-lg cursor-pointer font-semibold hover:opacity-90 transition-opacity"
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
        onOpenMoveToSection={openMoveToSectionForCurrentTarget}
        onAnswerInvite={(answer) => {
          const target = store.openedThread
            || (store.focusedCollapsedGroup ? null : store.listNavigationThreads.find(t => t.id === store.focusedThreadId));
          if (!target || !threadNeedsInviteAnswer(target)) {
            emitToast({ type: 'info', message: 'Open or focus an invitation that still needs an answer.' });
            return;
          }
          void inviteRsvp.answer(target, answer);
        }}
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

      {moveToSectionThread && (
        <MoveToSectionPopover
          thread={moveToSectionThread}
          hasModel={store.hasModel}
          currentSection={store.sectionOfThread(moveToSectionThread)}
          onChoose={(decision) => void store.moveThreadToSection(moveToSectionThread, decision)}
          onClose={closeMoveToSection}
        />
      )}

      {store.unsubscribeReviewTargets && (
        <UnsubscribeConfirmSheet
          targets={store.unsubscribeReviewTargets}
          busy={store.unsubscribeReviewBusy}
          onConfirm={(options) => void store.confirmUnsubscribeReview(options)}
          onCancel={store.cancelUnsubscribeReview}
        />
      )}

      {contextMenu && (
        <div
          className="dm-overlay fixed z-50 w-[180px] bg-[var(--panel-bg)]/85 backdrop-blur-md border border-[var(--border)] rounded-xl shadow-2xl py-1.5 flex flex-col select-none scale-in"
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
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
          >
            <MailOpenIcon className="w-3.5 h-3.5 opacity-80" />
            <span>Open Email</span>
          </button>
          
          <button
            onClick={() => {
              store.executeMailAction(contextMenu.thread.isUnread ? 'markRead' : 'markUnread', contextMenu.thread.id);
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
            >
              <BellOff className="w-3.5 h-3.5 opacity-80" />
              <span>Ignore</span>
            </button>
          )}

          {store.mailboxView === 'spam' ? (
            <button
              onClick={() => {
                store.executeMailAction('restoreFromSpam', contextMenu.thread.id);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
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
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
          >
            <Clock className="w-3.5 h-3.5 opacity-80" />
            <span>Later: tomorrow</span>
          </button>

          {store.mailboxView === 'inbox' && (
            <button
              onClick={() => {
                setMoveToSectionThread(contextMenu.thread);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
            >
              <Tags className="w-3.5 h-3.5 opacity-80" />
              <span>Move to Section…</span>
            </button>
          )}

          <div className="h-[1px] bg-[var(--border)] my-1 mx-2" />

          <button
            onClick={() => {
              store.setWorkspaceView('mail');
              store.openThread(contextMenu.thread).then(() => {
                store.saveDraftLocally('', contextMenu.thread.senderEmail, '', contextMenu.thread);
              });
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
          >
            <CornerUpLeftIcon className="w-3.5 h-3.5 opacity-80" />
            <span>Reply</span>
          </button>

          {store.senderRuleMenuState(contextMenu.thread) === 'available' && (
            <button
              data-context-sender-rule
              onClick={() => {
                store.requestSenderRule(contextMenu.thread);
                setContextMenu(null);
              }}
              className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent-fill)] hover:text-[var(--on-accent)] transition-colors cursor-pointer"
            >
              <Sparkles className="w-3.5 h-3.5 opacity-80 text-[var(--ai-solid)] hover:text-white" />
              <span>Always archive from this sender…</span>
            </button>
          )}
        </div>
      )}

      {store.senderRuleConsent && (
        <SenderRuleConsentDialog
          consent={store.senderRuleConsent}
          onConfirm={() => void store.confirmSenderRuleConsent()}
          onCancel={store.cancelSenderRuleConsent}
        />
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

export default function App() {
  return (
    <AppStoreProvider>
      <AppContent />
      <ToastHost />
    </AppStoreProvider>
  );
}
