// Date and time fields of the event form. The native date and time inputs
// render in the system locale ("12.11.2026", "2:00 PM"), so these show the
// app's own vocabulary instead: "Thu, Nov 12" and 24-hour "14:00".
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react';
import { formatWeekdayDay } from '../../../shared/dateFormat';
import { addCalendarDays, calendarMonthDays } from '../../../shared/calendarWorkspace';
import { localDateInputValue } from '../../../shared/calendarCreate';
import { SETTINGS_INPUT_CLASS } from '../components/settings/SettingsControls';
import { parseClockInput, quarterHourTimes } from '../lib/calendarEventFormHelpers';
import { monthYearLabel, spokenDayLabel, weekdayInitials } from './calendarDateLabels';
import { CAL_FIELD_LABEL, CAL_FOCUS, CAL_SMALL_ICON_BUTTON } from './calendarUi';

function dateFromInput(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00`);
  return Number.isFinite(date.getTime()) ? date : null;
}

interface CalendarDateFieldProps {
  label: string;
  /** `YYYY-MM-DD` */
  value: string;
  min?: string;
  weekStartsOn: 0 | 1;
  onChange: (value: string) => void;
}

export function CalendarDateField({ label, value, min, weekStartsOn, onChange }: CalendarDateFieldProps) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const selected = dateFromInput(value) || new Date();
  const [focused, setFocused] = useState<Date>(selected);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const gridRef = useRef<HTMLDivElement>(null);
  const minDate = min ? dateFromInput(min) : null;
  const days = calendarMonthDays(focused, weekStartsOn);
  const focusedKey = localDateInputValue(focused);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [open]);

  // Focus follows the day while moving with the keyboard inside the grid, and
  // lands on it when the picker opens. The month buttons keep their own focus
  // so they can be pressed repeatedly.
  useEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    const insideGrid = Boolean(active && gridRef.current?.contains(active));
    const onTrigger = active === triggerRef.current || active === document.body;
    if (!insideGrid && !onTrigger) return;
    gridRef.current?.querySelector<HTMLElement>(`[data-date="${focusedKey}"]`)?.focus();
  }, [focusedKey, open]);

  function openPicker() {
    setFocused(selected);
    setOpen(true);
  }

  function choose(date: Date) {
    // Compared as calendar days: the grid's days are at midnight and `minDate`
    // is at noon, so comparing instants would refuse the first allowed day.
    if (minDate && localDateInputValue(date) < localDateInputValue(minDate)) return;
    onChange(localDateInputValue(date));
    setOpen(false);
    triggerRef.current?.focus();
  }

  function onGridKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    // The picker owns its keys: calendar shortcuts must not fire behind it.
    event.stopPropagation();
    const moves: Record<string, number> = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
    if (event.key in moves) {
      event.preventDefault();
      setFocused(current => addCalendarDays(current, moves[event.key]));
    } else if (event.key === 'PageUp' || event.key === 'PageDown') {
      event.preventDefault();
      setFocused(current => new Date(current.getFullYear(), current.getMonth() + (event.key === 'PageUp' ? -1 : 1), Math.min(current.getDate(), 28), 12));
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  }

  return (
    <div ref={rootRef} className="relative flex min-w-0 flex-col gap-1">
      <span id={`${id}-label`} className={CAL_FIELD_LABEL}>{label}</span>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-labelledby={`${id}-label ${id}-value`}
        onClick={() => (open ? setOpen(false) : openPicker())}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); openPicker(); } }}
        className={`${SETTINGS_INPUT_CLASS} flex items-center gap-2 text-left`}
      >
        <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
        <span id={`${id}-value`} className="min-w-0 truncate">{formatWeekdayDay(selected)}</span>
      </button>
      {open && (
        <div
          role="dialog"
          aria-label={`Choose ${label.toLowerCase()}`}
          className="dm-overlay absolute left-0 top-[calc(100%+4px)] z-50 w-[248px] rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-2 shadow-lg"
          onKeyDown={onGridKeyDown}
        >
          <div className="mb-1 flex items-center justify-between gap-2">
            <span className="pl-1 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]" aria-live="polite">{monthYearLabel(focused)}</span>
            <span className="flex">
              <button type="button" aria-label="Previous month" title="Previous month" onClick={() => setFocused(current => new Date(current.getFullYear(), current.getMonth() - 1, 1, 12))} className={CAL_SMALL_ICON_BUTTON}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
              <button type="button" aria-label="Next month" title="Next month" onClick={() => setFocused(current => new Date(current.getFullYear(), current.getMonth() + 1, 1, 12))} className={CAL_SMALL_ICON_BUTTON}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
            </span>
          </div>
          <div className="grid grid-cols-7 text-center" aria-hidden="true">
            {weekdayInitials(weekStartsOn).map((initial, index) => <span key={`${initial}-${index}`} className="py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">{initial}</span>)}
          </div>
          <div ref={gridRef} className="grid grid-cols-7 gap-y-0.5">
            {days.map(day => {
              const key = localDateInputValue(day.date);
              const isSelected = key === value;
              const disabled = Boolean(minDate && day.date < new Date(minDate.getFullYear(), minDate.getMonth(), minDate.getDate()));
              return (
                <button
                  key={day.key}
                  type="button"
                  data-date={key}
                  tabIndex={key === focusedKey ? 0 : -1}
                  disabled={disabled}
                  aria-pressed={isSelected}
                  aria-label={`${spokenDayLabel(day.date)}${day.isToday ? ', today' : ''}`}
                  onClick={() => choose(day.date)}
                  className={`mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[calc(12px*var(--font-scale))] tabular-nums disabled:cursor-default disabled:opacity-40 ${CAL_FOCUS} ${
                    isSelected
                      ? 'bg-[var(--accent-fill)] font-semibold text-[var(--on-accent)]'
                      : day.isToday
                        ? 'font-semibold text-[var(--accent-ink)] shadow-[inset_0_0_0_1.5px_var(--accent)] hover:bg-[var(--hover-row)]'
                        : day.inMonth ? 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'
                  }`}
                >
                  {day.date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

const TIME_SUGGESTIONS = quarterHourTimes();

interface CalendarTimeFieldProps {
  label: string;
  /** `HH:MM`, 24-hour */
  value: string;
  onChange: (value: string) => void;
  /** Told whenever the text stops or starts being a time, so the form cannot save a time the person did not type. */
  onValidityChange?: (valid: boolean) => void;
}

/** 24-hour time typed or picked from quarter hours; invalid input is kept and flagged until fixed. */
export function CalendarTimeField({ label, value, onChange, onValidityChange }: CalendarTimeFieldProps) {
  const id = useId();
  const [text, setText] = useState(value);
  const invalid = text.trim() !== '' && parseClockInput(text) === null;
  const validityRef = useRef(onValidityChange);
  validityRef.current = onValidityChange;

  useEffect(() => setText(value), [value]);
  useEffect(() => {
    validityRef.current?.(!invalid);
    return () => validityRef.current?.(true);
  }, [invalid]);

  function commit() {
    const parsed = parseClockInput(text);
    if (parsed) {
      setText(parsed);
      if (parsed !== value) onChange(parsed);
    } else if (!text.trim()) {
      setText(value);
    }
  }

  return (
    <label className="flex min-w-0 flex-col gap-1" htmlFor={`${id}-input`}>
      <span className={CAL_FIELD_LABEL}>{label}</span>
      <input
        id={`${id}-input`}
        value={text}
        inputMode="numeric"
        autoComplete="off"
        list={`${id}-times`}
        placeholder="14:00"
        aria-invalid={invalid}
        aria-describedby={invalid ? `${id}-error` : undefined}
        onChange={event => {
          setText(event.target.value);
          const parsed = parseClockInput(event.target.value);
          // Picking from the list or typing a full "14:30" applies at once.
          if (parsed && /^\d{1,2}:\d{2}$/.test(event.target.value.trim()) && parsed !== value) onChange(parsed);
        }}
        onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') commit(); }}
        className={`${SETTINGS_INPUT_CLASS} tabular-nums ${invalid ? 'border-[var(--danger-solid)]' : ''}`}
      />
      <datalist id={`${id}-times`}>
        {TIME_SUGGESTIONS.map(time => <option key={time} value={time} />)}
      </datalist>
      {invalid && <span id={`${id}-error`} className="text-[calc(11px*var(--font-scale))] text-[var(--danger-solid)]">Use 24-hour time, like 14:30.</span>}
    </label>
  );
}
