import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarPlus, CalendarX, MapPin, Users } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarInvite } from '../../../shared/types';
import { calendarEventMatchesInvite, findCalendarInviteConflicts, type CalendarConflict } from '../../../shared/calendarAvailability';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';

interface CalendarInviteCardProps {
  invite: CalendarInvite;
  accountId: string;
}

function allDayRangeLabel(invite: CalendarInvite): string {
  const start = invite.startDate ? new Date(`${invite.startDate}T00:00:00`) : new Date(invite.startAt);
  const endExclusive = invite.endDate ? new Date(`${invite.endDate}T00:00:00`) : new Date(invite.endAt);
  const endInclusive = new Date(endExclusive.getTime() - 1);
  const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  if (start.toDateString() === endInclusive.toDateString()) {
    return `${start.toLocaleDateString(undefined, dateOptions)} · All day`;
  }
  return `${start.toLocaleDateString(undefined, dateOptions)} - ${endInclusive.toLocaleDateString(undefined, dateOptions)} · All day`;
}

function inviteTimeLabel(invite: CalendarInvite): string {
  if (invite.isAllDay) return allDayRangeLabel(invite);
  const start = new Date(invite.startAt);
  const end = new Date(invite.endAt);
  const dateOptions: Intl.DateTimeFormatOptions = { weekday: 'short', month: 'short', day: 'numeric' };
  const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  if (start.toDateString() === end.toDateString()) {
    return `${start.toLocaleDateString(undefined, dateOptions)}, ${start.toLocaleTimeString(undefined, timeOptions)} - ${end.toLocaleTimeString(undefined, timeOptions)}`;
  }
  return `${start.toLocaleString(undefined, { ...dateOptions, ...timeOptions })} - ${end.toLocaleString(undefined, { ...dateOptions, ...timeOptions })}`;
}

function conflictLabel(conflict: CalendarConflict): string {
  if (conflict.event.isAllDay) return `${conflict.event.summary} · All day`;
  const start = new Date(conflict.overlapStartAt);
  const end = new Date(conflict.overlapEndAt);
  const timeOptions: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${conflict.event.summary} · ${start.toLocaleTimeString(undefined, timeOptions)} - ${end.toLocaleTimeString(undefined, timeOptions)}`;
}

export function CalendarInviteCard({ invite, accountId }: CalendarInviteCardProps) {
  const store = useAppStore();
  const [isAdding, setIsAdding] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<CalendarAttendeeResponse | null>(null);
  const [calendarChecked, setCalendarChecked] = useState(false);
  const canUseCalendar = store.googleIntegrationStatus?.calendarEnabled === true;
  const matchingCalendarEvent = useMemo(
    () => store.calendarEvents.find(event => calendarEventMatchesInvite(event, invite)) || null,
    [invite, store.calendarEvents],
  );
  const conflicts = useMemo(
    () => findCalendarInviteConflicts(store.calendarEvents, invite, { maxConflicts: 3 }),
    [invite, store.calendarEvents],
  );

  useEffect(() => {
    if (!canUseCalendar || calendarChecked) return;
    setCalendarChecked(true);
    void store.syncCalendarAgenda(accountId, { startAt: invite.startAt, endAt: invite.endAt }).catch(error => {
      console.error('Calendar invite conflict sync failed:', error);
    });
  }, [accountId, calendarChecked, canUseCalendar, invite.endAt, invite.startAt, store.syncCalendarAgenda]);

  async function respond(responseStatus: CalendarAttendeeResponse) {
    setPendingResponse(responseStatus);
    try {
      await store.respondToCalendarInvite(invite, responseStatus, accountId);
      emitToast({ type: 'success', message: 'Calendar response saved.' });
    } catch (error) {
      console.error('Calendar RSVP failed:', error);
      emitToast({ type: 'error', message: 'Could not update calendar response.' });
    } finally {
      setPendingResponse(null);
    }
  }

  async function addToCalendar() {
    setIsAdding(true);
    try {
      await store.addCalendarEvent(invite, accountId);
      emitToast({ type: 'success', message: 'Event added to calendar.' });
    } catch (error) {
      console.error('Calendar event add failed:', error);
      emitToast({ type: 'error', message: 'Could not add event to calendar.' });
    } finally {
      setIsAdding(false);
    }
  }

  return (
    <div className="dm-inset rounded-[6px] border border-[var(--accent)]/30 bg-[var(--accent)]/8 p-3 select-none">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-[var(--accent)]" />
            <span className="truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{invite.summary}</span>
          </div>
          <div className="mt-1 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            {inviteTimeLabel(invite)}
          </div>
          {invite.location && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{invite.location}</span>
            </div>
          )}
          {invite.attendees.length > 0 && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
              <Users className="h-3 w-3 shrink-0" />
              <span className="truncate">{invite.attendees.map(attendee => attendee.displayName || attendee.email).join(', ')}</span>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="mt-2 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
              <div className="font-semibold">{conflicts.length === 1 ? 'Schedule conflict' : `${conflicts.length} schedule conflicts`}</div>
              <div className="mt-0.5 flex flex-col gap-0.5">
                {conflicts.map(conflict => (
                  <span key={`${conflict.event.calendarId}:${conflict.event.id}`} className="truncate">{conflictLabel(conflict)}</span>
                ))}
              </div>
            </div>
          )}
          {matchingCalendarEvent && (
            <div className="mt-2 text-[calc(10px*var(--font-scale))] font-medium text-[var(--success)]">
              Already on calendar
            </div>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {!canUseCalendar ? (
            <button
              type="button"
              onClick={() => void store.authorizeGoogleIntegration('calendar', accountId)}
              className="rounded-md bg-[var(--accent)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-white"
            >
              Enable Calendar
            </button>
          ) : (
            <>
              {!matchingCalendarEvent && (
                <button
                  type="button"
                  title="Add to Calendar"
                  disabled={isAdding || Boolean(pendingResponse)}
                  onClick={() => void addToCalendar()}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--accent)] disabled:opacity-50"
                >
                  <CalendarPlus className="h-4 w-4" />
                </button>
              )}
              <button
                type="button"
                title="Accept"
                disabled={Boolean(pendingResponse)}
                onClick={() => void respond('accepted')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--success)] disabled:opacity-50"
              >
                <CalendarCheck className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Maybe"
                disabled={Boolean(pendingResponse)}
                onClick={() => void respond('tentative')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--warning)] disabled:opacity-50"
              >
                <CalendarClock className="h-4 w-4" />
              </button>
              <button
                type="button"
                title="Decline"
                disabled={Boolean(pendingResponse)}
                onClick={() => void respond('declined')}
                className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger)] disabled:opacity-50"
              >
                <CalendarX className="h-4 w-4" />
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
