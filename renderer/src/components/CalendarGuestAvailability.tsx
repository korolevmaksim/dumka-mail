import { Search } from 'lucide-react';
import type { CalendarAvailabilitySlot } from '../../../shared/calendarAvailability';

interface CalendarGuestAvailabilityProps {
  guestCount: number;
  canFindTimes: boolean;
  isFindingTimes: boolean;
  availabilityError: string | null;
  suggestedSlots: CalendarAvailabilitySlot[];
  onFindTimes: () => void;
  onApplySlot: (slot: CalendarAvailabilitySlot) => void;
}

export function CalendarGuestAvailability({
  guestCount,
  canFindTimes,
  isFindingTimes,
  availabilityError,
  suggestedSlots,
  onFindTimes,
  onApplySlot,
}: CalendarGuestAvailabilityProps) {
  if (guestCount === 0) return null;

  return (
    <div className="dm-inset rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          {guestCount} guest{guestCount === 1 ? '' : 's'}
        </span>
        <button
          type="button"
          onClick={onFindTimes}
          disabled={!canFindTimes || isFindingTimes}
          className="flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--strong-border)] disabled:opacity-50"
        >
          <Search className="h-3 w-3" />
          {isFindingTimes ? 'Checking...' : 'Find times'}
        </button>
      </div>
      {availabilityError && (
        <div className="mt-1.5 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">{availabilityError}</div>
      )}
      {suggestedSlots.length > 0 && (
        <div className="mt-1.5 flex flex-col gap-1">
          {suggestedSlots.map(slot => (
            <button
              key={slot.startAt}
              type="button"
              onClick={() => onApplySlot(slot)}
              className="flex min-w-0 items-center justify-between gap-2 rounded border border-[var(--border)] px-2 py-1 text-left text-[calc(10px*var(--font-scale))] hover:border-[var(--accent)]"
            >
              <span className="min-w-0 truncate text-[var(--text-primary)]">{slot.dayLabel}</span>
              <span className="shrink-0 text-[var(--text-secondary)]">{slot.timeLabel}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
