import { useState } from 'react';
import { Users } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarEvent } from '../../../shared/types';
import { calendarEventParticipants, calendarParticipantDisplayName } from './calendarParticipants';

interface CalendarEventParticipantsProps {
  event: CalendarEvent;
}

const RESPONSE_LABELS: Record<CalendarAttendeeResponse, string> = {
  accepted: 'Accepted',
  declined: 'Declined',
  tentative: 'Tentative',
  needsAction: 'Awaiting reply',
};

const RESPONSE_COLORS: Record<CalendarAttendeeResponse, string> = {
  accepted: 'bg-[var(--success)]',
  declined: 'bg-[var(--danger)]',
  tentative: 'bg-[var(--warning)]',
  needsAction: 'bg-[var(--text-tertiary)]',
};

function participantInitials(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  return parts.slice(0, 2).map(part => part[0]?.toLocaleUpperCase()).join('');
}

export function CalendarEventParticipants({ event }: CalendarEventParticipantsProps) {
  const [expanded, setExpanded] = useState(false);
  const participants = calendarEventParticipants(event);
  const visibleParticipants = expanded ? participants : participants.slice(0, 5);
  const hiddenCount = participants.length - visibleParticipants.length;

  return (
    <section className="border-y border-[var(--border)] py-2" aria-labelledby={`calendar-participants-${event.accountId}-${event.calendarId}-${event.id}`}>
      <div className="mb-1.5 flex items-center gap-1.5">
        <Users className="h-3.5 w-3.5 text-[var(--text-tertiary)]" aria-hidden="true" />
        <h3 id={`calendar-participants-${event.accountId}-${event.calendarId}-${event.id}`} className="font-semibold text-[var(--text-primary)]">Participants</h3>
        <span className="text-[var(--text-tertiary)]">{participants.length}</span>
      </div>
      {participants.length === 0 ? (
        <p className="text-[var(--text-tertiary)]">No participants</p>
      ) : (
        <>
          <ul className="divide-y divide-[var(--border)]">
            {visibleParticipants.map(participant => {
              const name = calendarParticipantDisplayName(participant);
              const status = participant.responseStatus;
              return (
                <li key={participant.email.toLocaleLowerCase()} className="flex min-w-0 items-center gap-2 py-1.5">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-[var(--raised-surface)] text-[calc(8px*var(--font-scale))] font-semibold text-[var(--text-secondary)]" aria-hidden="true">
                    {participantInitials(name)}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-medium text-[var(--text-primary)]">{name}</span>
                      {participant.isSelf && <span className="shrink-0 text-[var(--text-tertiary)]">(you)</span>}
                    </span>
                    {participant.displayName && <span className="block truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{participant.email}</span>}
                  </span>
                  <span className="shrink-0 text-right text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                    {participant.isOrganizer && <span className="block">Organizer</span>}
                    {status && (
                      <span className="flex items-center justify-end gap-1">
                        <span className={`h-1.5 w-1.5 rounded-full ${RESPONSE_COLORS[status]}`} aria-hidden="true" />
                        {RESPONSE_LABELS[status]}
                      </span>
                    )}
                    {participant.optional && <span className="block">Optional</span>}
                  </span>
                </li>
              );
            })}
          </ul>
          {participants.length > 5 && (
            <button type="button" onClick={() => setExpanded(value => !value)} className="mt-1.5 font-semibold text-[var(--accent)] hover:underline">
              {expanded ? 'Show fewer' : `Show ${hiddenCount} more`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
