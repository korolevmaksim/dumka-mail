import type { CalendarAttendeeResponse } from '../../../shared/types';

interface CalendarRsvpActionsProps {
  currentStatus: CalendarAttendeeResponse;
  disabled?: boolean;
  onRespond: (status: CalendarAttendeeResponse) => void;
}

const RESPONSES: Array<{ status: CalendarAttendeeResponse; label: string }> = [
  { status: 'accepted', label: 'Accept' },
  { status: 'tentative', label: 'Maybe' },
  { status: 'declined', label: 'Decline' },
];

export function CalendarRsvpActions({ currentStatus, disabled = false, onRespond }: CalendarRsvpActionsProps) {
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Respond to invitation">
      {RESPONSES.map(response => (
        <button
          key={response.status}
          type="button"
          disabled={disabled}
          aria-pressed={currentStatus === response.status}
          onClick={() => onRespond(response.status)}
          className={`rounded border px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold disabled:opacity-50 ${currentStatus === response.status ? 'border-[var(--accent)] bg-[var(--accent)]/10 text-[var(--accent)]' : 'border-[var(--border)] text-[var(--text-secondary)] hover:bg-[var(--hover-row)]'}`}
        >
          {response.label}
        </button>
      ))}
    </div>
  );
}
