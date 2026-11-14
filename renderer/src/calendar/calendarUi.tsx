// Controls of the calendar, in mail's visual language: the reader's toolbar
// buttons (ThreadHeader), the settings inputs (SettingsControls) and mail's key
// caps. Tokens only; no colours of our own.
import type { ReactNode } from 'react';

const FOCUS = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]';

const BUTTON_BASE = `inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--control-radius)] border px-2.5 text-[calc(12px*var(--font-scale))] font-semibold transition-colors disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none ${FOCUS}`;

/** Outlined button, as `Reply` / `Archive` in the thread header. */
export const CAL_BUTTON = `${BUTTON_BASE} border-[var(--strong-border)] bg-[var(--raised-surface)] text-[var(--text-primary)] hover:bg-[var(--hover-row)]`;

/** The one filled button of a surface (`New event`, `Save`). */
export const CAL_PRIMARY_BUTTON = `${BUTTON_BASE} border-transparent bg-[var(--accent-fill)] text-[var(--on-accent)] hover:opacity-90`;

/** Borderless text button (`More`, `Cancel`). */
export const CAL_QUIET_BUTTON = `${BUTTON_BASE} border-transparent text-[var(--text-primary)] hover:bg-[var(--hover-row)]`;

/** Destructive action before confirmation. */
export const CAL_DANGER_BUTTON = `${BUTTON_BASE} border-[var(--strong-border)] bg-[var(--raised-surface)] text-[var(--danger-solid)] hover:bg-[var(--hover-row)]`;

/** Destructive action at confirmation. */
export const CAL_DANGER_FILL_BUTTON = `${BUTTON_BASE} border-transparent bg-[var(--danger-fill)] text-[var(--on-accent)] hover:opacity-90`;

/** 32 × 32 icon-only button; always pair with `title` and `aria-label`. */
export const CAL_ICON_BUTTON = `inline-flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] disabled:cursor-default disabled:opacity-45 ${FOCUS}`;

/** 24 × 24 icon button for dense places (sidebar, panel header). */
export const CAL_SMALL_ICON_BUTTON = `inline-flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-[var(--control-radius)] text-[var(--text-secondary)] transition-colors hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] ${FOCUS}`;

/** Inline text link in the accent ink colour. */
export const CAL_LINK = `inline-flex min-h-6 cursor-pointer items-center gap-1.5 rounded text-[calc(12px*var(--font-scale))] font-medium text-[var(--accent-ink)] hover:underline ${FOCUS}`;

/** Small field label above an input. */
export const CAL_FIELD_LABEL = 'text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-secondary)]';

/** Section heading inside a panel. */
export const CAL_SECTION_HEADING = 'text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)]';

export const CAL_FOCUS = FOCUS;

/** Mail's key cap (`Reply R`). Hidden from assistive tech; the button carries `aria-keyshortcuts`. */
export function CalendarKeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden="true" className="inline-flex min-w-[16px] items-center justify-center rounded border border-[var(--border)] px-1 font-mono text-[calc(10px*var(--font-scale))] font-medium leading-[14px] text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

export interface SegmentedOption<T extends string> {
  id: T;
  label: string;
  title?: string;
}

/** Segmented switch (view picker, RSVP). Buttons with `aria-pressed`. */
export function CalendarSegmented<T extends string>({
  label,
  options,
  value,
  onChange,
  disabled = false,
  className = '',
}: {
  label: string;
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T | null;
  onChange: (value: T) => void;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <div role="group" aria-label={label} className={`inline-flex h-8 shrink-0 items-stretch gap-0.5 rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--app-bg)] p-0.5 ${className}`}>
      {options.map(option => {
        const active = option.id === value;
        return (
          <button
            key={option.id}
            type="button"
            aria-pressed={active}
            disabled={disabled}
            title={option.title}
            onClick={() => onChange(option.id)}
            className={`dm-calendar-view-button inline-flex min-w-6 cursor-pointer items-center justify-center rounded-[calc(var(--control-radius)-1px)] px-2.5 text-[calc(12px*var(--font-scale))] transition-colors disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none ${FOCUS} ${
              active
                ? 'bg-[var(--raised-surface)] font-semibold text-[var(--text-primary)] shadow-[0_0_0_1px_var(--strong-border)]'
                : 'font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
