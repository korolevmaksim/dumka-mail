// Menu button (WAI-ARIA menu button pattern): Enter / Space / ↓ open it on
// the first item, ↑ on the last; ↑ ↓ Home End move; Enter / Space run the
// item; Esc and Tab close it and focus returns to the trigger. Keys pressed
// inside the menu never reach the app's single-key shortcuts.
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';

export interface ActionMenuItem {
  id: string;
  label: string;
  /** Key hint shown at the right edge, e.g. `A` or `⌘P`. */
  shortcut?: string;
  icon?: LucideIcon;
  onSelect: () => void;
  disabled?: boolean;
  tone?: 'danger';
  /** Draws a divider above this item. */
  separatorBefore?: boolean;
}

interface ActionMenuProps {
  /** Accessible name of the trigger. */
  label: string;
  items: ActionMenuItem[];
  /** Trigger content (icon + visible label). */
  children: ReactNode;
  triggerClassName: string;
  triggerTitle?: string;
  /** `data-*` hook for the harness. */
  testId?: string;
  align?: 'left' | 'right';
}

export function ActionMenu({ label, items, children, triggerClassName, triggerTitle, testId, align = 'right' }: ActionMenuProps) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const triggerId = useId();
  const menuId = useId();

  const enabledIndexes = items.map((item, index) => (item.disabled ? -1 : index)).filter(index => index >= 0);

  const close = useCallback((restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);

  // Esc closes the menu and nothing behind it (the reader stays open).
  useEscapeLayer(open, () => close(true));

  const openAt = (position: 'first' | 'last') => {
    if (enabledIndexes.length === 0) return;
    setActiveIndex(position === 'first' ? enabledIndexes[0] : enabledIndexes[enabledIndexes.length - 1]);
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    itemRefs.current[activeIndex]?.focus();
  }, [activeIndex, open]);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && (menuRef.current?.contains(target) || triggerRef.current?.contains(target))) return;
      close(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [close, open]);

  const move = (direction: 1 | -1) => {
    if (enabledIndexes.length === 0) return;
    const position = enabledIndexes.indexOf(activeIndex);
    const next = (position + direction + enabledIndexes.length) % enabledIndexes.length;
    setActiveIndex(enabledIndexes[next]);
  };

  const runItem = (item: ActionMenuItem) => {
    if (item.disabled) return;
    close(true);
    item.onSelect();
  };

  const onMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep the app's single-key shortcuts (E, R, Esc closing the thread…) out of the menu.
    if (!event.metaKey && !event.ctrlKey) event.stopPropagation();
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        move(1);
        break;
      case 'ArrowUp':
        event.preventDefault();
        move(-1);
        break;
      case 'Home':
        event.preventDefault();
        if (enabledIndexes.length) setActiveIndex(enabledIndexes[0]);
        break;
      case 'End':
        event.preventDefault();
        if (enabledIndexes.length) setActiveIndex(enabledIndexes[enabledIndexes.length - 1]);
        break;
      case 'Escape':
        event.preventDefault();
        close(true);
        break;
      case 'Tab':
        close(false);
        break;
      case 'Enter':
      case ' ': {
        event.preventDefault();
        const item = items[activeIndex];
        if (item) runItem(item);
        break;
      }
      default:
        break;
    }
  };

  return (
    <div className="relative">
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={label}
        title={triggerTitle}
        data-reader-action={testId}
        onClick={(event) => {
          event.stopPropagation();
          if (open) close(false);
          else openAt('first');
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowDown' || event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            openAt('first');
          } else if (event.key === 'ArrowUp') {
            event.preventDefault();
            event.stopPropagation();
            openAt('last');
          } else if (event.key === 'Escape' && open) {
            event.preventDefault();
            event.stopPropagation();
            close(true);
          }
        }}
        className={triggerClassName}
      >
        {children}
      </button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-labelledby={triggerId}
          data-reader-menu={testId}
          onKeyDown={onMenuKeyDown}
          onClick={(event) => event.stopPropagation()}
          className={`dm-overlay absolute top-full z-40 mt-1 max-h-[min(70vh,520px)] w-[240px] overflow-y-auto rounded-[var(--control-radius)] border border-[var(--strong-border)] bg-[var(--panel-bg)] py-1 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`}
        >
          {items.map((item, index) => {
            const Icon = item.icon;
            return (
              <div key={item.id} role="none">
                {item.separatorBefore && index > 0 && <div role="separator" className="mx-2 my-1 h-px bg-[var(--border)]" />}
                <button
                  ref={element => { itemRefs.current[index] = element; }}
                  type="button"
                  role="menuitem"
                  tabIndex={index === activeIndex ? 0 : -1}
                  aria-disabled={item.disabled || undefined}
                  aria-keyshortcuts={item.shortcut && item.shortcut.length === 1 ? item.shortcut : undefined}
                  data-menu-item={item.id}
                  onMouseEnter={() => { if (!item.disabled) setActiveIndex(index); }}
                  onClick={() => runItem(item)}
                  className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[calc(12px*var(--font-scale))] outline-none focus-visible:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                    item.disabled
                      ? 'cursor-default text-[var(--text-tertiary)]'
                      : item.tone === 'danger'
                        ? 'text-[var(--danger)] hover:bg-[var(--hover-row)]'
                        : 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                  }`}
                >
                  {Icon ? <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 opacity-80" /> : <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />}
                  <span className="min-w-0 flex-1 truncate">{item.label}</span>
                  {item.shortcut && (
                    <kbd aria-hidden="true" className="shrink-0 font-mono text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{item.shortcut}</kbd>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
