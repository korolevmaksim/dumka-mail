import type { CalendarAttendeeResponse } from '../../../shared/types';
import { CalendarSegmented } from './calendarUi';

interface CalendarRsvpActionsProps {
  currentStatus: CalendarAttendeeResponse;
  disabled?: boolean;
  onRespond: (status: CalendarAttendeeResponse) => void;
}

type Answer = Exclude<CalendarAttendeeResponse, 'needsAction'>;

const RESPONSES: Array<{ id: Answer; label: string; title: string }> = [
  { id: 'accepted', label: 'Yes', title: 'Yes, I will attend' },
  { id: 'tentative', label: 'Maybe', title: 'Maybe' },
  { id: 'declined', label: 'No', title: 'No, I will not attend' },
];

/** "Going?  Yes | Maybe | No": the answer you gave is pressed. */
export function CalendarRsvpActions({ currentStatus, disabled = false, onRespond }: CalendarRsvpActionsProps) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span id="calendar-rsvp-label" className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">Going?</span>
      <CalendarSegmented
        label="Going?"
        options={RESPONSES}
        value={currentStatus === 'needsAction' ? null : currentStatus}
        disabled={disabled}
        onChange={onRespond}
      />
      {currentStatus === 'needsAction' && <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Not answered yet</span>}
    </div>
  );
}
