import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { sectionOrder } from '../../../../shared/decision';
import { SECTION_LABELS } from '../../../../shared/inboxSections';
import { senderSectionPopoverHint } from '../../../../shared/senderSections';
import type { Decision, MailThread } from '../../../../shared/types';
import { Kbd } from './SectionRows';

interface MoveToSectionPopoverProps {
  thread: MailThread;
  hasModel: boolean;
  currentSection: Decision | null;
  /**
   * The sender's name when the choice can be made standing for the sender
   * (`⇧` + a section); null when it cannot (the account's own message, an
   * invitation, a security notice).
   */
  alwaysForSender?: string | null;
  onChoose: (decision: Decision, options: { always: boolean }) => void;
  onClose: () => void;
}

/** The section a digit key stands for, read from the physical key so `⇧1` is still 1. */
export function sectionDigitIndex(event: Pick<KeyboardEvent, 'key' | 'code'>): number | null {
  const fromCode = /^(?:Digit|Numpad)([1-9])$/.exec(event.code || '');
  if (fromCode) return Number(fromCode[1]) - 1;
  return /^[1-9]$/.test(event.key) ? Number(event.key) - 1 : null;
}

/**
 * `V`: move a thread to another section (number keys or arrows, `Esc`
 * closes). With `⇧` the choice also becomes standing for the thread's sender.
 */
export function MoveToSectionPopover({ thread, hasModel, currentSection, alwaysForSender = null, onChoose, onClose }: MoveToSectionPopoverProps) {
  const options = sectionOrder(hasModel);
  const initialIndex = Math.max(0, options.findIndex(option => option !== currentSection));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  useDialogFocus(dialogRef, listRef, close);

  const choose = (index: number, always = false) => {
    const decision = options[index];
    if (!decision) return;
    const standing = always && Boolean(alwaysForSender);
    // The current section is still a choice when it is made standing for the sender.
    if (decision !== currentSection || standing) onChoose(decision, { always: standing });
    onClose();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Keep mail shortcuts from acting on the list behind the popover.
    event.stopPropagation();
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(index => (index + delta + options.length) % options.length);
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(activeIndex, event.shiftKey);
      return;
    }
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const digit = sectionDigitIndex(event);
    if (digit !== null) {
      event.preventDefault();
      choose(digit, event.shiftKey);
    }
  };

  const subject = thread.subject.trim() || '(no subject)';
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/20 px-4 pt-24" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        data-move-to-section
        onKeyDown={handleKeyDown}
        className="dm-overlay w-[min(320px,92vw)] overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl select-none"
      >
        <div className="border-b border-[var(--border)] px-3 py-2.5">
          <h2 id={titleId} className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Move to section</h2>
          <p className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{subject}</p>
        </div>
        <ul
          ref={listRef}
          role="listbox"
          tabIndex={0}
          aria-label="Sections"
          aria-activedescendant={`${titleId}-option-${activeIndex}`}
          className="p-1 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
        >
          {options.map((decision, index) => {
            const isCurrent = decision === currentSection;
            const isActive = index === activeIndex;
            return (
              <li
                key={decision}
                id={`${titleId}-option-${index}`}
                role="option"
                aria-selected={isActive}
                aria-current={isCurrent ? 'true' : undefined}
                data-section-option={decision}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={(event) => choose(index, event.shiftKey)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[calc(12px*var(--font-scale))] ${
                  isActive ? 'bg-[var(--selected-row)] text-[var(--text-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Kbd>{index + 1}</Kbd>
                  <span className="truncate">{SECTION_LABELS[decision]}</span>
                </span>
                {isCurrent && <span className="shrink-0 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">current</span>}
              </li>
            );
          })}
        </ul>
        <p data-move-to-section-hint className="border-t border-[var(--border)] px-3 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
          {senderSectionPopoverHint(alwaysForSender)}
        </p>
      </div>
    </div>
  );
}
