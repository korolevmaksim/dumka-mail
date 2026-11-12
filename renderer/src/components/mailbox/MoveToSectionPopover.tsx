import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { sectionOrder } from '../../../../shared/decision';
import { SECTION_LABELS } from '../../../../shared/inboxSections';
import type { Decision, MailThread } from '../../../../shared/types';
import { Kbd } from './SectionRows';

interface MoveToSectionPopoverProps {
  thread: MailThread;
  hasModel: boolean;
  currentSection: Decision | null;
  onChoose: (decision: Decision) => void;
  onClose: () => void;
}

/** `V`: move a thread to another section (number keys or arrows, `Esc` closes). */
export function MoveToSectionPopover({ thread, hasModel, currentSection, onChoose, onClose }: MoveToSectionPopoverProps) {
  const options = sectionOrder(hasModel);
  const initialIndex = Math.max(0, options.findIndex(option => option !== currentSection));
  const [activeIndex, setActiveIndex] = useState(initialIndex);
  const dialogRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const titleId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  useDialogFocus(dialogRef, listRef, close);

  const choose = (index: number) => {
    const decision = options[index];
    if (!decision) return;
    if (decision !== currentSection) onChoose(decision);
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
      choose(activeIndex);
      return;
    }
    if (/^[1-9]$/.test(event.key) && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault();
      choose(Number(event.key) - 1);
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
                onClick={() => choose(index)}
                className={`flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[calc(12px*var(--font-scale))] ${
                  isActive ? 'bg-[var(--selected-row)] text-[var(--text-primary)]' : 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Kbd>{index + 1}</Kbd>
                  <span className="truncate">{SECTION_LABELS[decision]}</span>
                </span>
                {isCurrent && <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">current</span>}
              </li>
            );
          })}
        </ul>
        <p className="border-t border-[var(--border)] px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
          Applies to this conversation only.
        </p>
      </div>
    </div>
  );
}
