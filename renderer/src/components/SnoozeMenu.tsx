import { REMINDER_PRESETS, reminderDate, describeReminder } from '../../../shared/reminders';

// Reminder preset popover (Swift ReminderPreset menu). Calls onPick with the
// resolved Date for the chosen preset; 'custom' is omitted (no date picker yet).
export function SnoozeMenu({
  onPick,
  onClose,
  align = 'right',
}: {
  onPick: (date: Date) => void;
  onClose: () => void;
  align?: 'left' | 'right';
}) {
  const now = new Date();
  return (
    <div
      className={`absolute top-full mt-1 ${align === 'right' ? 'right-0' : 'left-0'} w-[210px] panel-surface bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-xl shadow-2xl py-1.5 z-[60] scale-in`}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 pb-1.5 mb-1 text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border)]">
        Remind me…
      </div>
      {REMINDER_PRESETS.filter((p) => p.id !== 'custom').map((p) => {
        const d = reminderDate(p.id, now);
        if (!d) return null;
        return (
          <button
            key={p.id}
            onClick={() => { onPick(d); onClose(); }}
            className="w-full flex items-center justify-between gap-2 px-3 py-1.5 text-left hover:bg-[var(--hover-row)] cursor-pointer transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-[-2px] active:bg-[var(--hover-row)] active:translate-y-px"
          >
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{p.title}</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] whitespace-nowrap">{describeReminder(d, now)}</span>
          </button>
        );
      })}
    </div>
  );
}
