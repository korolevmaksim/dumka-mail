import { useMemo, useState } from 'react';
import { Clock, Send } from 'lucide-react';

interface SendLaterMenuProps {
  onSchedule: (date: Date) => void;
  onClose?: () => void;
  align?: 'left' | 'right';
  floating?: boolean;
}

function nextAt(hour: number, minute: number, dayOffset = 0): Date {
  const date = new Date();
  date.setDate(date.getDate() + dayOffset);
  date.setHours(hour, minute, 0, 0);
  if (date.getTime() <= Date.now()) {
    date.setDate(date.getDate() + 1);
  }
  return date;
}

function nextWeekdayAt(weekday: number, hour: number, minute: number): Date {
  const date = new Date();
  const daysUntil = (weekday - date.getDay() + 7) % 7 || 7;
  date.setDate(date.getDate() + daysUntil);
  date.setHours(hour, minute, 0, 0);
  return date;
}

function toDatetimeLocalValue(date: Date): string {
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

function fromDatetimeLocalValue(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function SendLaterMenu({ onSchedule, onClose, align = 'right', floating = true }: SendLaterMenuProps) {
  const [customValue, setCustomValue] = useState(() => toDatetimeLocalValue(nextAt(9, 0, 1)));
  const [error, setError] = useState('');
  const presets = useMemo(() => [
    { label: 'Tomorrow morning', date: nextAt(9, 0, 1) },
    { label: 'Tomorrow afternoon', date: nextAt(14, 0, 1) },
    { label: 'Next Monday', date: nextWeekdayAt(1, 9, 0) },
  ], []);

  const schedule = (date: Date | null) => {
    if (!date || date.getTime() <= Date.now()) {
      setError('Choose a future time.');
      return;
    }
    onSchedule(date);
    onClose?.();
  };
  const surfaceClass = floating
    ? `absolute bottom-10 z-50 w-[260px] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl ${align === 'right' ? 'right-0' : 'left-0'}`
    : 'w-full';

  return (
    <div className={surfaceClass}>
      <div className="px-2.5 py-1 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        Send later
      </div>
      {presets.map(preset => (
        <button
          key={preset.label}
          type="button"
          onClick={() => schedule(preset.date)}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
        >
          <Clock className="h-3.5 w-3.5" />
          <span className="flex min-w-0 flex-1 flex-col">
            <span>{preset.label}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
              {preset.date.toLocaleString([], { weekday: 'short', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </span>
          </span>
        </button>
      ))}

      <div className="mt-1 border-t border-[var(--border)] px-2.5 py-2">
        <label className="flex flex-col gap-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          Custom time
          <input
            type="datetime-local"
            value={customValue}
            onChange={(event) => {
              setCustomValue(event.target.value);
              setError('');
            }}
            className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)]"
          />
        </label>
        {error && <div className="mt-1 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">{error}</div>}
        <button
          type="button"
          onClick={() => schedule(fromDatetimeLocalValue(customValue))}
          className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white hover:opacity-95"
        >
          <Send className="h-3.5 w-3.5" />
          Schedule send
        </button>
      </div>
    </div>
  );
}
