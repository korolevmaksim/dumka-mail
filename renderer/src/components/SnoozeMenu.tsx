import { REMINDER_PRESETS, reminderDate, describeReminder } from '../../../shared/reminders';
import { CalendarClock, Clock, X } from 'lucide-react';

// Reminder preset popover (Swift ReminderPreset menu). Calls onPick with the
// resolved Date for the chosen preset; 'custom' is omitted (no date picker yet).
export function SnoozeMenu({
  onPick,
  onClose,
  align = 'right',
  floating = false,
  targetSubject,
}: {
  onPick: (date: Date) => void;
  onClose: () => void;
  align?: 'left' | 'right';
  floating?: boolean;
  targetSubject?: string;
}) {
  const now = new Date();
  const containerClass = floating
    ? 'fixed left-1/2 top-1/2 z-[80] w-[320px] -translate-x-1/2 -translate-y-1/2'
    : `absolute top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'} z-[60] w-[300px]`;

  return (
    <div
      className={`${containerClass} rounded-xl border border-[var(--strong-border)] bg-[var(--raised-surface)] shadow-2xl scale-in`}
      onClick={(e) => e.stopPropagation()}
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
      <div className="py-1.5">
        {REMINDER_PRESETS.filter((p) => p.id !== 'custom').map((p) => {
          const d = reminderDate(p.id, now);
          if (!d) return null;
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => { onPick(d); onClose(); }}
              className="w-full flex items-center justify-between gap-3 px-3 py-2 text-left hover:bg-[var(--hover-row)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px] active:bg-[var(--hover-row)] active:translate-y-px"
            >
              <span className="flex min-w-0 items-center gap-2">
                <Clock className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
                <span className="truncate text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">{p.title}</span>
              </span>
              <span className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{describeReminder(d, now)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
