import { useState } from 'react';
import { Users } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarEvent } from '../../../shared/types';
import { calendarEventParticipants, calendarParticipantDisplayName } from './calendarParticipants';

interface CalendarEventParticipantsProps {
  event: CalendarEvent;
}

const RESPONSE_LABELS: Record<CalendarAttendeeResponse, string> = {
  accepted: 'Yes',
  declined: 'No',
  tentative: 'Maybe',
  needsAction: 'No answer',
};

// Shape as well as colour: a filled dot for yes, a ring for maybe, a dash for no.
const RESPONSE_MARKS: Record<CalendarAttendeeResponse, string> = {
  accepted: 'h-2 w-2 rounded-full bg-[var(--success-solid)]',
  declined: 'h-[2px] w-2 bg-[var(--danger-solid)]',
  tentative: 'h-2 w-2 rounded-full border-2 border-[var(--warning-solid)]',
  needsAction: 'h-2 w-2 rounded-full border border-[var(--text-tertiary)]',
};

function participantInitials(name: string): string {
  const parts = name.replace(/@.*$/, '').split(/[\s._-]+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('');
}

export function CalendarEventParticipants({ event }: CalendarEventParticipantsProps) {
  const [expanded, setExpanded] = useState(false);
  const participants = calendarEventParticipants(event);
  const visibleParticipants = expanded ? participants : participants.slice(0, 5);
  const hiddenCount = participants.length - visibleParticipants.length;

  const headingId = `calendar-participants-${event.accountId}-${event.calendarId}-${event.id}`;
  return (
    <section aria-labelledby={headingId}>
      <div className="mb-1 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-[var(--text-secondary)]" aria-hidden="true" />
        <h3 id={headingId} className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          {participants.length === 0 ? 'No participants' : `${participants.length} ${participants.length === 1 ? 'participant' : 'participants'}`}
        </h3>
      </div>
      {participants.length > 0 && (
        <>
          <ul className="flex flex-col">
            {visibleParticipants.map(participant => {
              const name = calendarParticipantDisplayName(participant);
              const status = participant.responseStatus;
              const roles = [participant.isOrganizer ? 'Organizer' : null, participant.optional ? 'Optional' : null].filter(Boolean).join(' · ');
              return (
                <li key={participant.email.toLocaleLowerCase()} className="flex min-w-0 items-center gap-2 py-1">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--raised-surface)] text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)] shadow-[inset_0_0_0_1px_var(--border)]" aria-hidden="true">
                    {participantInitials(name)}
                  </span>
                  <span className="min-w-0 flex-1" title={participant.email}>
                    <span className="flex min-w-0 items-center gap-1 text-[calc(12px*var(--font-scale))]">
                      <span className="truncate font-medium text-[var(--text-primary)]">{name}</span>
                      {participant.isSelf && <span className="shrink-0 text-[var(--text-secondary)]">(you)</span>}
                    </span>
                    {(roles || participant.displayName) && (
                      <span className="block truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                        {[roles, participant.displayName ? participant.email : null].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  {status && (
                    <span className="flex shrink-0 items-center gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                      <span className={RESPONSE_MARKS[status]} aria-hidden="true" />
                      {RESPONSE_LABELS[status]}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
          {participants.length > 5 && (
            <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} className="mt-1 inline-flex min-h-6 items-center rounded text-[calc(12px*var(--font-scale))] font-medium text-[var(--accent-ink)] hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
