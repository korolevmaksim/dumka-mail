import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type Ref } from 'react';
import { ChevronDown } from 'lucide-react';
import { SECTION_JUMP_LABELS } from '../../../../shared/inboxSections';
import type { Decision } from '../../../../shared/types';
import type { SectionJumpTarget } from '../../lib/inboxListItems';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';

interface SectionJumpBarProps {
  targets: readonly SectionJumpTarget[];
  /** Section the list is showing at its top (or the one just jumped to). */
  current: Decision | null;
  onJump: (decision: Decision) => void;
  /** Text form of the previous / next section keys for the tooltip; undefined when unbound. */
  keysLabel?: string;
}

const chipBase = 'inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-[var(--control-radius)] px-1.5 py-0.5 text-[calc(12px*var(--font-scale))] font-medium';
const countClass = 'font-normal tabular-nums text-[var(--text-tertiary)]';

/** The count as shown, with the noun for screen readers only: the accessible name starts with the visible text. */
function Count({ count, className = '' }: { count: number; className?: string }) {
  return (
    <span className={`${countClass} ${className}`}>
      {count}
      <span className="sr-only"> {count === 1 ? 'conversation' : 'conversations'}</span>
    </span>
  );
}

/** The sections as a menu, for a column too narrow for the links. */
export function SectionJumpMenu({ targets, current, onChoose, onKeyDown, menuRef }: {
  targets: readonly SectionJumpTarget[];
  current: Decision;
  onChoose: (event: MouseEvent<HTMLButtonElement>, decision: Decision) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLDivElement>) => void;
  menuRef?: Ref<HTMLDivElement>;
}) {
  return (
    <div
      ref={menuRef}
      role="menu"
      aria-label="Jump to section"
      onKeyDown={onKeyDown}
      className="dm-overlay absolute left-[calc(var(--row-px)-6px)] top-[calc(100%+2px)] z-40 w-56 max-w-[calc(100%-var(--row-px))] rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
    >
      {targets.map(target => {
        const isCurrent = target.decision === current;
        return (
          <button
            key={target.decision}
            type="button"
            role="menuitem"
            data-section-jump={target.decision}
            aria-current={isCurrent ? 'location' : undefined}
            tabIndex={isCurrent ? 0 : -1}
            onClick={(event) => onChoose(event, target.decision)}
            className={`flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[calc(12px*var(--font-scale))] outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
              isCurrent
                ? 'bg-[var(--accent-surface)] font-medium text-[var(--text-primary)]'
                : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
            }`}
          >
            <span className="min-w-0">{target.label}</span>
            <Count count={target.count} className="shrink-0" />
          </button>
        );
      })}
    </div>
  );
}

/**
 * One row under the mailbox header: a jump link per inbox section. The inbox
 * stays one list; a click scrolls it to that section and nothing is filtered,
 * so these are navigation links, not tabs. When the links do not fit the
 * column, the row becomes a single button with the same sections in a menu.
 */
export function SectionJumpBar({ targets, current, onJump, keysLabel }: SectionJumpBarProps) {
  const frameRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  // One section leaves nothing to jump to.
  const shown = targets.length > 1;

  // The links are always laid out once, invisibly, so their natural width is
  // known in both modes and the row can switch back when the column widens.
  useLayoutEffect(() => {
    const frame = frameRef.current;
    const measure = measureRef.current;
    if (!frame || !measure) return;
    const update = () => setCompact(measure.offsetWidth > frame.clientWidth + 0.5);
    update();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(update);
    observer.observe(frame);
    observer.observe(measure);
    return () => observer.disconnect();
  }, [shown]);

  useEffect(() => {
    if (!compact) setMenuOpen(false);
  }, [compact]);

  useEffect(() => {
    if (!menuOpen) return;
    const close = (event: globalThis.MouseEvent) => {
      if (menuRef.current?.contains(event.target as Node) || triggerRef.current?.contains(event.target as Node)) return;
      setMenuOpen(false);
    };
    window.addEventListener('mousedown', close);
    const frame = window.requestAnimationFrame(() => {
      const options = menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]');
      (menuRef.current?.querySelector<HTMLElement>('[aria-current="location"]') || options?.[0])?.focus();
    });
    return () => {
      window.removeEventListener('mousedown', close);
      window.cancelAnimationFrame(frame);
    };
  }, [menuOpen]);

  useEscapeLayer(menuOpen, () => {
    setMenuOpen(false);
    triggerRef.current?.focus();
  });

  if (!shown) return null;

  const active = targets.find(target => target.decision === current) || targets[0];
  const hint = keysLabel ? ` (${keysLabel})` : '';

  // A pointer click hands the keyboard back to the list (Enter then opens the
  // focused conversation instead of pressing the link again); keyboard
  // activation keeps focus where the person put it.
  const jumpFromLink = (event: MouseEvent<HTMLButtonElement>, decision: Decision) => {
    onJump(decision);
    if (event.detail > 0) event.currentTarget.blur();
  };

  const chooseFromMenu = (event: MouseEvent<HTMLButtonElement>, decision: Decision) => {
    setMenuOpen(false);
    onJump(decision);
    if (event.detail === 0) triggerRef.current?.focus();
  };

  const handleMenuKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The menu owns its keys while open (mail shortcuts must not fire behind it).
    event.stopPropagation();
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') || []);
    const index = options.indexOf(document.activeElement as HTMLElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      setMenuOpen(false);
      triggerRef.current?.focus();
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      options[(index + delta + options.length) % options.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      options[event.key === 'Home' ? 0 : options.length - 1]?.focus();
    } else if (event.key === 'Tab') {
      setMenuOpen(false);
    }
  };

  return (
    <nav
      aria-label="Jump to section"
      data-section-jump-bar={compact ? 'menu' : 'links'}
      className="dm-section-jump relative flex shrink-0 select-none items-center border-b border-[var(--border)] bg-[var(--panel-bg)] px-[var(--row-px)] py-1"
    >
      <div ref={frameRef} className="relative -mx-1.5 flex min-w-0 flex-1 items-center overflow-hidden">
        <div ref={measureRef} aria-hidden="true" className="pointer-events-none invisible absolute left-0 top-0 flex w-max items-center gap-0.5">
          {targets.map(target => (
            <span key={target.decision} className={chipBase}>
              <span>{SECTION_JUMP_LABELS[target.decision]}</span>
              <span className={countClass}>{target.count}</span>
            </span>
          ))}
        </div>

        {compact ? (
          <button
            ref={triggerRef}
            type="button"
            data-section-jump-trigger
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            title={`Jump to section${hint}`}
            onClick={() => setMenuOpen(open => !open)}
            onKeyDown={(event) => {
              if (event.key !== 'ArrowDown' || menuOpen) return;
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen(true);
            }}
            className="flex min-w-0 max-w-full items-center gap-1.5 rounded-[var(--control-radius)] px-1.5 py-0.5 text-[calc(12px*var(--font-scale))] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
          >
            <span className="shrink-0 text-[var(--text-tertiary)]">Section</span>
            <span className="truncate font-medium text-[var(--text-primary)]">{active.label}</span>
            <Count count={active.count} className="shrink-0" />
            <ChevronDown aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
          </button>
        ) : (
          <div className="flex items-center gap-0.5">
            {targets.map(target => {
              const isCurrent = target.decision === active.decision;
              return (
                <button
                  key={target.decision}
                  type="button"
                  data-section-jump={target.decision}
                  aria-current={isCurrent ? 'location' : undefined}
                  title={`Jump to ${target.label}${hint}`}
                  onClick={(event) => jumpFromLink(event, target.decision)}
                  className={`${chipBase} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
                    isCurrent
                      ? 'bg-[var(--accent-surface)] text-[var(--text-primary)]'
                      : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  <span>{SECTION_JUMP_LABELS[target.decision]}</span>
                  <Count count={target.count} />
                </button>
              );
            })}
          </div>
        )}
      </div>

      {compact && menuOpen && (
        <SectionJumpMenu
          menuRef={menuRef}
          targets={targets}
          current={active.decision}
          onChoose={chooseFromMenu}
          onKeyDown={handleMenuKeyDown}
        />
      )}
    </nav>
  );
}
