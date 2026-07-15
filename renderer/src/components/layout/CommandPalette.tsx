import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useAppStore, UNIFIED_ACCOUNT } from '../../stores/AppStore';
import { Command, Search, X } from 'lucide-react';
import { emitToast } from '../../lib/toastBus';
import { nextMailboxView } from '../../../../shared/mailboxNavigation';
import {
  DEFAULT_COMMAND_GROUP_ORDER,
  groupRankedCommands,
  rankCommands,
  type PaletteCommand,
} from '../../../../shared/commandPalette';

interface CommandPaletteProps {
  isOpen: boolean;
  onClose: () => void;
  onOpenReminder: () => void;
}

type PaletteCommandWithAction = PaletteCommand & { action: () => void };

export function CommandPalette({ isOpen, onClose, onOpenReminder }: CommandPaletteProps) {
  const store = useAppStore();
  const [paletteSearch, setPaletteSearch] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const activeRowRef = useRef<HTMLButtonElement | null>(null);

  // Rebuild each render so action closures always see current store fields.
  const commands: PaletteCommandWithAction[] = [
    {
      id: 'open-today',
      group: 'navigation',
      title: 'Open Today',
      shortcut: 'Home',
      keywords: ['operator', 'home', 'today'],
      action: () => {
        store.setWorkspaceView('today');
        store.setSettingsOpen(false);
        store.setCleanupOpen(false);
      },
    },
    {
      id: 'open-calendar',
      group: 'navigation',
      title: 'Open Calendar',
      shortcut: '⌘⇧C',
      keywords: ['calendar', 'schedule', 'agenda', 'events'],
      action: () => {
        store.setWorkspaceView('calendar');
        store.setSettingsOpen(false);
        store.setCleanupOpen(false);
      },
    },
    {
      id: 'mark-done',
      group: 'mail',
      title: 'Mark Done (Archive)',
      shortcut: 'E',
      keywords: ['archive', 'done'],
      action: () => store.executeMailAction('markDone'),
    },
    {
      id: 'mark-read',
      group: 'mail',
      title: 'Mark Read',
      shortcut: 'R',
      keywords: ['read'],
      action: () => store.executeMailAction('markRead'),
    },
    {
      id: 'mark-unread',
      group: 'mail',
      title: 'Mark Unread',
      shortcut: 'Shift+R',
      keywords: ['unread'],
      action: () => store.executeMailAction('markUnread'),
    },
    {
      id: 'move-trash',
      group: 'mail',
      title: 'Move to Trash',
      shortcut: '#',
      keywords: ['delete', 'remove'],
      action: () => store.executeMailAction('moveToTrash'),
    },
    {
      id: 'move-spam',
      group: 'mail',
      title: 'Move to Spam',
      shortcut: '!',
      keywords: ['spam', 'junk'],
      action: () => store.executeMailAction('reportSpam'),
    },
    {
      id: 'ignore-thread',
      group: 'mail',
      title: 'Ignore Thread',
      shortcut: 'M',
      keywords: ['mute'],
      action: () => store.muteThread(),
    },
    {
      id: 'set-reminder',
      group: 'mail',
      title: 'Set Reminder',
      shortcut: 'H',
      keywords: ['remind', 'snooze'],
      action: onOpenReminder,
    },
    {
      id: 'open-ai-assistant',
      group: 'ai',
      title: 'Open AI Assistant',
      shortcut: 'Cmd+J',
      keywords: ['ai', 'assistant'],
      action: () => store.setAiPanelOpen(true),
    },
    {
      id: 'ai-triage-queue',
      group: 'ai',
      title: 'AI Triage Queue',
      shortcut: 'S',
      keywords: ['triage', 'queue'],
      action: () => store.runAITriagePlan(),
    },
    {
      id: 'compose-message',
      group: 'compose',
      title: 'Compose Message',
      shortcut: 'C',
      keywords: ['new mail', 'draft'],
      action: () => {
        const draft = store.startNewDraft();
        if (!draft) {
          store.setWorkspaceView('mail');
          store.setSettingsOpen(true);
          store.setCleanupOpen(false);
          emitToast({ type: 'warning', message: 'Connect an account before composing.' });
        }
      },
    },
    {
      id: 'create-calendar-event-from-thread',
      group: 'compose',
      title: 'Create Calendar Event from Thread',
      keywords: ['calendar', 'meeting', 'schedule', 'thread'],
      action: () => store.startCalendarEventFromThread(),
    },
    {
      id: 'toggle-unified-inbox',
      group: 'navigation',
      title: 'Toggle Unified Inbox',
      shortcut: 'Cmd+0',
      keywords: ['unified', 'all accounts'],
      action: () => {
        store.setWorkspaceView('mail');
        store.setActiveAccount(store.activeAccount?.id === 'unified' ? (store.accounts[0] || null) : UNIFIED_ACCOUNT);
        store.setSettingsOpen(false);
        store.setCleanupOpen(false);
      },
    },
    {
      id: 'switch-mailbox',
      group: 'navigation',
      title: 'Switch Mailbox',
      shortcut: 'G',
      keywords: ['inbox', 'sent', 'trash', 'spam'],
      action: () => {
        store.setWorkspaceView('mail');
        store.setMailboxView(nextMailboxView(store.mailboxView));
        store.setSettingsOpen(false);
        store.setCleanupOpen(false);
      },
    },
    {
      id: 'undo-last-action',
      group: 'mail',
      title: 'Undo Last Action',
      shortcut: 'Z',
      keywords: ['undo'],
      action: () => store.undoLastAction(),
    },
    {
      id: 'toggle-theme',
      group: 'settings',
      title: 'Toggle Theme',
      shortcut: 'Cmd+Shift+T',
      keywords: ['theme', 'dark', 'light'],
      action: () => {
        const nextTheme = store.theme === 'system' ? 'light' : (store.theme === 'light' ? 'dark' : 'system');
        store.setTheme(nextTheme);
      },
    },
    {
      id: 'cache-visible-bodies',
      group: 'sync',
      title: 'Cache Visible Bodies',
      shortcut: 'Cmd+Shift+B',
      keywords: ['body', 'cache'],
      action: () => store.triggerVisibleBodyRepair(),
    },
    {
      id: 'resume-older-mail-indexing',
      group: 'sync',
      title: 'Resume Older Mail Indexing',
      shortcut: 'Cmd+Shift+I',
      keywords: ['backfill', 'index'],
      action: () => store.triggerBackfillManual(),
    },
  ];

  const isEmptyQuery = paletteSearch.trim().length === 0;
  const filteredCommands = rankCommands(paletteSearch, commands);
  const sections = groupRankedCommands(
    filteredCommands,
    isEmptyQuery ? DEFAULT_COMMAND_GROUP_ORDER : undefined,
  );
  // Visual / keyboard order follows grouped sections so ↑↓ matches the list.
  const orderedCommands = sections.flatMap((section) => section.commands);
  const effectiveActiveIndex = orderedCommands.length > 0
    ? Math.min(activeIndex, orderedCommands.length - 1)
    : 0;

  useEffect(() => {
    if (!isOpen) return;
    setPaletteSearch('');
    setActiveIndex(0);
    // Focus after paint so the dialog is in the tree.
    const frame = requestAnimationFrame(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    activeRowRef.current?.scrollIntoView({ block: 'nearest' });
  }, [isOpen, effectiveActiveIndex, orderedCommands.length]);

  if (!isOpen) return null;

  const runCommand = (cmd: PaletteCommandWithAction | undefined) => {
    if (!cmd) return;
    cmd.action();
    onClose();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((prev) => (
        orderedCommands.length > 0 ? (prev + 1) % orderedCommands.length : 0
      ));
      return;
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((prev) => (
        orderedCommands.length > 0
          ? (prev - 1 + orderedCommands.length) % orderedCommands.length
          : 0
      ));
      return;
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      runCommand(orderedCommands[effectiveActiveIndex]);
    }
  };

  const indexById = new Map(orderedCommands.map((cmd, index) => [cmd.id, index]));

  return (
    <div
      className="absolute inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-16 select-none"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="command-palette-title"
        className="dm-overlay flex w-[min(560px,calc(100vw-32px))] max-h-[min(560px,calc(100vh-96px))] flex-col overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl scale-in"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
      >
        {/* Header */}
        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/12 text-[var(--accent)]">
              <Command className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="command-palette-title"
                className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]"
              >
                Command Palette
              </h2>
              <p className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                Search actions and jump anywhere
              </p>
            </div>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Search */}
        <div className="border-b border-[var(--border)] p-2.5">
          <div className="dm-control flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--raised-surface)] px-2.5 py-2 focus-within:border-[var(--accent)]">
            <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
            <input
              ref={inputRef}
              autoFocus
              type="text"
              placeholder="Type a command…"
              value={paletteSearch}
              onChange={(e) => {
                setPaletteSearch(e.target.value);
                setActiveIndex(0);
              }}
              aria-controls="command-palette-results"
              aria-autocomplete="list"
              className="min-w-0 flex-1 bg-transparent text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
            />
            {paletteSearch.length > 0 && (
              <button
                type="button"
                title="Clear"
                onClick={() => {
                  setPaletteSearch('');
                  setActiveIndex(0);
                  inputRef.current?.focus();
                }}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        {/* Results */}
        <div
          id="command-palette-results"
          ref={listRef}
          role="listbox"
          aria-label="Commands"
          className="min-h-0 flex-1 overflow-y-auto py-1.5"
        >
          {orderedCommands.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-1 px-4 py-10 text-center">
              <p className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                No matching commands
              </p>
              <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                Try a different keyword, or clear the search
              </p>
            </div>
          ) : (
            sections.map((section) => (
              <section key={section.group} className="mb-1 last:mb-0">
                <h3 className="px-4 pb-1 pt-2 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                  {section.label}
                </h3>
                <div className="px-1.5">
                  {section.commands.map((cmd) => {
                    const index = indexById.get(cmd.id) ?? 0;
                    const isActive = index === effectiveActiveIndex;
                    return (
                      <button
                        key={cmd.id}
                        type="button"
                        role="option"
                        aria-selected={isActive}
                        ref={isActive ? activeRowRef : undefined}
                        onMouseEnter={() => setActiveIndex(index)}
                        onFocus={() => setActiveIndex(index)}
                        onClick={() => runCommand(cmd)}
                        className={`flex w-full items-center justify-between gap-3 rounded-lg px-2.5 py-2 text-left transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px] ${
                          isActive
                            ? 'bg-[var(--selected-row)] text-[var(--text-primary)]'
                            : 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                        }`}
                      >
                        <span className="flex min-w-0 items-center gap-2.5">
                          <span
                            className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                              isActive ? 'bg-[var(--accent)]' : 'bg-transparent'
                            }`}
                            aria-hidden
                          />
                          <span className="truncate text-[calc(12px*var(--font-scale))] font-medium">
                            {cmd.title}
                          </span>
                        </span>
                        {cmd.shortcut && (
                          <kbd className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                            {cmd.shortcut}
                          </kbd>
                        )}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 border-t border-[var(--border)] px-3 py-2">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded bg-[var(--border)] px-1 py-0.5 font-mono text-[calc(9px*var(--font-scale))]">↑</kbd>
              <kbd className="rounded bg-[var(--border)] px-1 py-0.5 font-mono text-[calc(9px*var(--font-scale))]">↓</kbd>
              <span>navigate</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(9px*var(--font-scale))]">↵</kbd>
              <span>run</span>
            </span>
            <span className="inline-flex items-center gap-1">
              <kbd className="rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(9px*var(--font-scale))]">esc</kbd>
              <span>close</span>
            </span>
          </div>
          <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
            {orderedCommands.length > 0
              ? `${effectiveActiveIndex + 1} / ${orderedCommands.length}`
              : '0 results'}
          </span>
        </div>
      </div>
    </div>
  );
}
