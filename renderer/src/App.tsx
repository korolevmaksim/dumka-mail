import { useState, useRef, useEffect } from 'react';
import { useAppStore, AppStoreProvider } from './stores/AppStore';
import { useKeyboard } from './hooks/useKeyboard';
import {
  Inbox, Clock, CheckCircle, X, ArrowLeft,
  Reply, ReplyAll, Forward, SquarePen, Command, Mail, Sparkles,
  ChevronUp, ChevronDown, MailOpen
} from 'lucide-react';
import { ThreadRow } from './components/ThreadRow';
import { SnoozeMenu } from './components/SnoozeMenu';
import { ToastHost } from './components/Toast';
import { MessageCard } from './components/MessageCard';
import { SettingsPanel } from './components/settings/SettingsPanel';
import { LeftRail } from './components/layout/LeftRail';
import { AICopilotPanel } from './components/layout/AICopilotPanel';
import { SearchCockpitBar } from './components/layout/SearchCockpitBar';
import { BottomShortcutBar } from './components/layout/BottomShortcutBar';
import { RightContextPanel } from './components/layout/RightContextPanel';
import { CommandPalette } from './components/layout/CommandPalette';
import { InlineReplyComposer } from './components/layout/InlineReplyComposer';
import { FloatingComposeDrawer } from './components/layout/FloatingComposeDrawer';
import { emitToast } from './lib/toastBus';
import { resolveComposeAccountId } from './lib/composeAccount';

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

function AppContent() {
  const store = useAppStore();
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    thread: any;
  } | null>(null);

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
          const accountId = resolveComposeAccountId(store.activeAccount, store.accounts);
          if (!accountId) {
            store.setSettingsOpen(true);
            emitToast({ type: 'warning', message: 'Connect an account before composing.' });
            break;
          }
          store.setActiveDraft({
            id: crypto.randomUUID(),
            accountId,
            to: [], cc: [], bcc: [], subject: '', bodyPlain: '', attachments: [], updatedAt: new Date().toISOString()
          });
          break;
        }
        case 'edit.undo':
          store.undoLastAction();
          break;
        case 'view.toggleAiCopilot':
          store.setAiPanelOpen(!store.aiPanelOpen);
          break;
        case 'view.settings':
          store.setSettingsOpen(!store.settingsOpen);
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
    const canUndo = store.actionLog.some(l => l.status === 'completed' && ['markRead', 'markUnread', 'markDone', 'restoreInbox'].includes(l.kind));

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
    if (store.searchQuery.trim() && store.openedThread && !store.enablePreviewPane) {
      store.openThread(null);
    }
  }, [store.searchQuery, store.openedThread, store.enablePreviewPane]);

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
    onEscape: () => {
      if (threadSearchOpen) {
        setThreadSearchOpen(false);
        setThreadSearchQuery('');
      } else if (commandPaletteOpen) {
        setCommandPaletteOpen(false);
      } else if (store.settingsOpen) {
        store.setSettingsOpen(false);
      } else if (store.searchQuery) {
        store.setSearchQuery('');
      } else if (store.activeDraft) {
        store.setActiveDraft(null);
      } else if (store.openedThread) {
        store.openThread(null);
      }
    }
  });

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
              <div className="flex gap-1 h-full items-end">
                {store.tabCategories.filter(c => {
                  if (!c.active) return false;
                  if (c.isSystem) return true;
                  if (!store.activeAccount || store.activeAccount.id === 'unified') return true;
                  return !c.accountId || c.accountId === 'global' || c.accountId === store.activeAccount.email;
                }).map((category, i) => {
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
                        store.setActiveSplit(category.id);
                        store.setSettingsOpen(false);
                      }}
                      className={`px-3 pb-2 pt-1 border-b-2 text-tab transition-all cursor-grab flex items-center gap-1.5 ${
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
              
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const accountId = resolveComposeAccountId(store.activeAccount, store.accounts);
                    if (!accountId) {
                      store.setSettingsOpen(true);
                      emitToast({ type: 'warning', message: 'Connect an account before composing.' });
                      return;
                    }
                    store.setActiveDraft({
                      id: crypto.randomUUID(),
                      accountId,
                      to: [], cc: [], bcc: [], subject: '', bodyPlain: '', attachments: [], updatedAt: new Date().toISOString()
                    });
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
              {store.settingsOpen ? (
                <SettingsPanel />
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
                    <div className="flex-1 overflow-y-auto flex flex-col">
                      {store.visibleThreads.length === 0 ? (
                        <div className="flex flex-col items-center justify-center flex-1 p-6 text-center text-[var(--text-secondary)]">
                          <Inbox className="w-10 h-10 mb-2 opacity-30" />
                          <p className="font-semibold">Clear inbox split</p>
                          <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">Jump to other splits or press C to compose.</p>
                        </div>
                      ) : (
                        store.visibleThreads.map((thread) => (
                          <ThreadRow
                            key={thread.id}
                            thread={thread}
                            isFocused={store.focusedThreadId === thread.id}
                            isOpened={store.openedThread?.id === thread.id}
                            showAvatars={store.settings.appearance.showAvatars}
                            isSelected={store.selectedThreadIds.has(thread.id)}
                            isSelectionModeActive={store.selectedThreadIds.size > 0}
                            onClick={() => store.openThread(thread)}
                            onToggleSelect={(e) => handleThreadSelectToggle(e, thread.id)}
                            onContextMenu={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setContextMenu({ x: e.clientX, y: e.clientY, thread });
                            }}
                          />
                        ))
                      )}
                    </div>

                    {/* FLOATING BATCH ACTIONS BAR */}
                    {store.selectedThreadIds.size > 0 && (
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
                          <button
                            type="button"
                            onClick={() => store.executeBatchMailAction('markDone', Array.from(store.selectedThreadIds))}
                            title="Archive / Done"
                            className="p-1.5 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
                          >
                            <CheckCircle className="w-3.5 h-3.5" />
                          </button>
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
                        <div className="absolute top-4 right-6 z-20 flex items-center gap-2 px-3 py-1.5 bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-lg shadow-xl animate-fade-in select-none">
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
                                className="flex items-center gap-1 mb-3 text-[calc(11px*var(--font-scale))] text-[var(--accent)] font-medium hover:underline cursor-pointer select-none bg-[var(--hover-row)] px-2 py-1 rounded"
                              >
                                <ArrowLeft className="w-3.5 h-3.5" /> Back to List
                              </button>
                            )}
                            <h1 className="text-thread-title mb-2 text-[var(--text-primary)] select-text">
                              {store.openedThread.subject}
                            </h1>
                            <div className="flex items-center gap-2">
                              <span className="font-semibold text-[var(--text-primary)] text-[calc(12px*var(--font-scale))]">
                                {store.openedThread.senderNames.join(', ')}
                              </span>
                              <span className="text-[var(--text-secondary)] text-[calc(11px*var(--font-scale))]">
                                &lt;{store.openedThread.senderEmail}&gt;
                              </span>
                            </div>
                          </div>
                          
                          {/* Actions buttons */}
                          <div className="flex items-center gap-1">
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
                                />
                              )}
                            </div>
                            <button
                              onClick={() => store.executeMailAction('markDone', store.openedThread!.id)}
                              title="Archive Thread (E)"
                              className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <CheckCircle className="w-4 h-4 text-[var(--success)]" />
                            </button>
                            <button
                              onClick={() => store.openThread(null)}
                              className="p-1.5 rounded hover:bg-[var(--hover-row)] cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>
                        </div>

                        {/* Messages Body */}
                        <div className="flex-1 flex flex-col gap-6 select-text">
                          {store.openedThreadMessages.length === 0 ? (
                            <div className="text-[var(--text-secondary)] text-center py-10">
                              Loading message details…
                            </div>
                          ) : (
                            store.openedThreadMessages.map((msg) => (
                              <MessageCard key={msg.id} msg={msg} defaultLoadImages={store.settings.privacy.loadRemoteImages} />
                            ))
                          )}
                        </div>

                        {/* Inline Draft Reply Affordance */}
                        <InlineReplyComposer />

                        {!store.activeDraft && store.openedThreadMessages.length > 0 && (() => {
                          const lastMsg = store.openedThreadMessages[store.openedThreadMessages.length - 1];
                          return (
                            <div className="mt-6 flex gap-3 select-none shrink-0">
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
      <CommandPalette isOpen={commandPaletteOpen} onClose={() => setCommandPaletteOpen(false)} />

      {/* 6. BOTTOM SHORTCUTS HINTS BAR */}
      <BottomShortcutBar />

      {/* Floating Compose Drawer Overlay */}
      <FloatingComposeDrawer />

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
          
          <button
            onClick={() => {
              const tomorrow = new Date();
              tomorrow.setDate(tomorrow.getDate() + 1);
              tomorrow.setHours(9, 0, 0, 0);
              store.executeMailAction('autoMarkRead', contextMenu.thread.id, null, async () => {
                await window.electronAPI.saveReminder(contextMenu.thread.accountId, contextMenu.thread.id, tomorrow.toISOString());
              });
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
              store.openThread(contextMenu.thread).then(() => {
                store.runAITriagePlan();
              });
              setContextMenu(null);
            }}
            className="flex items-center gap-2 px-2.5 py-1.5 mx-1.5 rounded-md text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--accent)] hover:text-white transition-colors cursor-pointer"
          >
            <Sparkles className="w-3.5 h-3.5 opacity-80 text-[var(--ai-accent)] hover:text-white" />
            <span>AI Summarize</span>
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
