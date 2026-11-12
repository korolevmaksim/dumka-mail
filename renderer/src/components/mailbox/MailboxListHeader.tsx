import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { ChevronDown, Command, SquarePen } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { composeOrConnectAccount } from '../../lib/composeOrConnect';
import { keymapShortcut } from '../../../../shared/appKeymap';
import { MAILBOX_VIEW_LABELS, MAILBOX_VIEW_ORDER } from '../../../../shared/mailboxNavigation';
import type { MailboxView } from '../../../../shared/types';
import { MAILBOX_ICONS } from './MailboxList';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';

interface MailboxListHeaderProps {
  onOpenCommandPalette: () => void;
}

/** "Inbox  28 left · Basic sorting" plus the mailbox switcher (replaces the split tab bar). */
export function MailboxListHeader({ onOpenCommandPalette }: MailboxListHeaderProps) {
  const store = useAppStore();
  const [menuOpen, setMenuOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const view = store.mailboxView;
  const label = MAILBOX_VIEW_LABELS[view];
  const composeShortcut = keymapShortcut('compose', store.settings.shortcuts) || '⌘N';
  const countFor = (id: MailboxView) => (id === 'drafts' ? store.draftsList.length : store.mailboxCounts[id] || 0);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    const frame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    });
    return () => {
      window.removeEventListener('mousedown', close);
      window.cancelAnimationFrame(frame);
    };
  }, [menuOpen]);

  useEffect(() => setMenuOpen(false), [view]);

  useEscapeLayer(menuOpen, () => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  });

  const choose = (id: MailboxView) => {
    store.setWorkspaceView('mail');
    store.setMailboxView(id);
    store.setSettingsOpen(false);
    store.setCleanupOpen(false);
    setMenuOpen(false);
    triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The switcher owns its keys while open (mail shortcuts must not fire behind it).
    event.stopPropagation();
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') || []);
    const current = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      options[(current + delta + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setMenuOpen(false);
    }
  };

  const inboxCount = store.mailboxCounts.inbox || 0;
  const subtitle = view === 'inbox' && !store.searchQuery.trim()
    ? store.fetchingInbox && inboxCount === 0
      ? 'fetching…'
      : inboxCount === 0 ? 'clear' : `${inboxCount} left`
    : view === 'drafts'
      ? `${store.draftsList.length}`
      : `${store.visibleThreads.length}`;
  const ActiveIcon = MAILBOX_ICONS[view];

  return (
    <div className="dm-mail-tabs dm-toolbar flex h-[var(--split-tabs-h)] min-h-[36px] shrink-0 select-none items-center justify-between gap-2 border-b border-[var(--border)] bg-[var(--panel-bg)] px-[var(--row-px)]">
      <div className="flex min-w-0 items-center gap-2">
        <div className="relative">
          {/* The heading holds the switcher button (a heading inside a button is invalid). */}
          <h2 className="m-0 text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            <button
              ref={triggerRef}
              type="button"
              data-mailbox-switcher
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(open => !open)}
              title="Switch mailbox (G / ⇧G)"
              className="dm-mailbox-switcher -ml-1.5 flex items-center gap-1.5 rounded-[var(--control-radius)] px-1.5 py-1 font-semibold hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <ActiveIcon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />
              <span>{label}</span>
              <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
            </button>
          </h2>
          {menuOpen && (
            <div
              ref={menuRef}
              role="menu"
              aria-label="Mailboxes"
              onKeyDown={handleMenuKeyDown}
              className="dm-overlay absolute left-0 top-[calc(100%+4px)] z-40 w-52 rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
            >
              {MAILBOX_VIEW_ORDER.map(id => {
                const Icon = MAILBOX_ICONS[id];
                const isActive = id === view;
                const count = countFor(id);
                return (
                  <button
                    key={id}
                    type="button"
                    role="menuitemradio"
                    aria-checked={isActive}
                    data-mailbox-option={id}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => choose(id)}
                    className={`flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
                      isActive
                        ? 'bg-[var(--accent-surface)] font-semibold text-[var(--text-primary)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{MAILBOX_VIEW_LABELS[id]}</span>
                    </span>
                    {count > 0 && (
                      <span className="shrink-0 tabular-nums text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{count}</span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <span data-inbox-left className="truncate text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">{subtitle}</span>
      </div>

      <div className="flex shrink-0 items-center gap-1">
        {store.sectioned && !store.hasModel && (
          <span data-basic-sorting className="mr-1 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]" title="No model is configured: sections come from local rules only.">
            Basic sorting
          </span>
        )}
        <button
          type="button"
          onClick={() => composeOrConnectAccount(store)}
          title={`Compose Message (${composeShortcut})`}
          aria-label="Compose message"
          className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <SquarePen aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          onClick={onOpenCommandPalette}
          title="Command Palette (⌘K)"
          aria-label="Open command palette"
          className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <Command aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
