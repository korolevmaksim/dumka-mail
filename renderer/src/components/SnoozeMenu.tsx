import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { parseReminderInput } from '../../../shared/reminderInput';
import { REMINDER_PRESETS, reminderDate, describeReminder } from '../../../shared/reminders';
import { CalendarClock, Check, Clock, Search, X } from 'lucide-react';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDateInputValue(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function toTimeInputValue(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function dateFromInputs(dateValue: string, timeValue: string): Date | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]) - 1;
  const day = Number(dateMatch[3]);
  const hours = Number(timeMatch[1]);
  const minutes = Number(timeMatch[2]);
  const date = new Date(year, month, day, hours, minutes, 0, 0);

  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== hours ||
    date.getMinutes() !== minutes
  ) {
    return null;
  }

  return date;
}

// Reminder picker. It keeps the old preset behavior, but makes H usable without
// a mouse: the query input receives focus, arrows/Enter choose presets, and
// custom date/time inputs cover exact reminder scheduling.
export function SnoozeMenu({
  onPick,
  onClose,
  align = 'right',
  floating = false,
  targetSubject,
}: {
  onPick: (date: Date) => void | Promise<void>;
  onClose: () => void;
  align?: 'left' | 'right';
  floating?: boolean;
  targetSubject?: string;
}) {
  const now = useMemo(() => new Date(), []);
  const presetOptions = useMemo(() => (
    REMINDER_PRESETS
      .filter((p) => p.id !== 'custom')
      .map((preset) => ({ preset, date: reminderDate(preset.id, now) }))
      .filter((item): item is { preset: typeof REMINDER_PRESETS[number]; date: Date } => Boolean(item.date))
  ), [now]);
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const defaultCustomDate = useMemo(() => reminderDate('tomorrow', now) || new Date(now.getTime() + 24 * 60 * 60 * 1000), [now]);
  const [customDate, setCustomDate] = useState(() => toDateInputValue(defaultCustomDate));
  const [customTime, setCustomTime] = useState(() => toTimeInputValue(defaultCustomDate));
  const parsedQueryDate = useMemo(() => parseReminderInput(query, now), [query, now]);
  const customDateTime = useMemo(() => dateFromInputs(customDate, customTime), [customDate, customTime]);
  const customIsFuture = Boolean(customDateTime && customDateTime.getTime() > Date.now());
  const containerClass = floating
    ? 'fixed left-1/2 top-1/2 z-[80] w-[360px] max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-1/2'
    : `absolute top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'} z-[60] w-[340px]`;

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const pick = (date: Date) => {
    void onPick(date);
    onClose();
  };

  const pickActivePreset = () => {
    const option = presetOptions[activeIndex];
    if (option) pick(option.date);
  };

  const pickCustomDateTime = () => {
    if (!customDateTime || customDateTime.getTime() <= Date.now()) return;
    pick(customDateTime);
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isButton = target.tagName === 'BUTTON';
    const isCustomInput = target.getAttribute('data-reminder-custom-input') === 'true';

    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }

    if (e.key === 'ArrowDown' && !isCustomInput) {
      e.preventDefault();
      setActiveIndex((prev) => (presetOptions.length > 0 ? (prev + 1) % presetOptions.length : 0));
      return;
    }

    if (e.key === 'ArrowUp' && !isCustomInput) {
      e.preventDefault();
      setActiveIndex((prev) => (presetOptions.length > 0 ? (prev - 1 + presetOptions.length) % presetOptions.length : 0));
      return;
    }

    if (e.key !== 'Enter' || isButton) return;

    if (isCustomInput) {
      e.preventDefault();
      pickCustomDateTime();
      return;
    }

    e.preventDefault();
    if (parsedQueryDate) {
      pick(parsedQueryDate);
      return;
    }
    pickActivePreset();
  };

  return (
    <div
      className={`${containerClass} rounded-xl border border-[var(--strong-border)] bg-[var(--raised-surface)] shadow-2xl scale-in`}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={handleKeyDown}
      role="dialog"
      aria-label="Remind me"
    >
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-3 py-2.5">
        <div className="flex min-w-0 gap-2">
          <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[var(--accent)]/12 text-[var(--accent)]">
            <CalendarClock className="h-4 w-4" />
          </div>
          <div className="min-w-0">
            <div className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Remind me</div>
            {targetSubject && (
              <div className="mt-0.5 truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{targetSubject}</div>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          title="Close"
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="border-b border-[var(--border)] p-2">
        <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2 focus-within:border-[var(--accent)]">
          <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Tomorrow 9am"
            className="min-w-0 flex-1 bg-transparent text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
          />
          {parsedQueryDate && (
            <span className="max-w-[150px] truncate text-[calc(10px*var(--font-scale))] font-medium text-[var(--accent)]">
              {describeReminder(parsedQueryDate, now)}
            </span>
          )}
        </div>
      </div>
      <div className="py-1.5">
        {presetOptions.map(({ preset, date }, index) => (
          <button
            key={preset.id}
            type="button"
            onMouseEnter={() => setActiveIndex(index)}
            onFocus={() => setActiveIndex(index)}
            onClick={() => pick(date)}
            className={`w-full flex items-center justify-between gap-3 px-3 py-2 text-left cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px] active:translate-y-px ${
              index === activeIndex ? 'bg-[var(--hover-row)]' : 'hover:bg-[var(--hover-row)]'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
              <span className="truncate text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">{preset.title}</span>
            </span>
            <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{describeReminder(date, now)}</span>
          </button>
        ))}
      </div>
      <div className="border-t border-[var(--border)] px-3 py-2.5">
        <div className="mb-2 flex items-center justify-between gap-3">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Custom</span>
          {customDateTime && (
            <span className={`truncate text-[calc(10px*var(--font-scale))] ${customIsFuture ? 'text-[var(--text-secondary)]' : 'text-[var(--danger)]'}`}>
              {customIsFuture ? describeReminder(customDateTime, now) : 'Past time'}
            </span>
          )}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_96px_32px] gap-2">
          <input
            data-reminder-custom-input="true"
            type="date"
            value={customDate}
            onChange={(e) => setCustomDate(e.target.value)}
            className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <input
            data-reminder-custom-input="true"
            type="time"
            value={customTime}
            onChange={(e) => setCustomTime(e.target.value)}
            className="min-w-0 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:border-[var(--accent)]"
          />
          <button
            type="button"
            disabled={!customIsFuture}
            onClick={pickCustomDateTime}
            title="Set custom reminder"
            className="flex h-[31px] w-8 items-center justify-center rounded-lg bg-[var(--accent)] text-white transition-opacity disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Check className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
