import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarClock, CalendarPlus, MapPin, Users } from 'lucide-react';
import type { CalendarAttendeeResponse, CalendarInvite } from '../../../shared/types';
import { calendarEventMatchesInvite, findCalendarInviteConflicts, type CalendarConflict } from '../../../shared/calendarAvailability';
import { formatTimeRange } from '../../../shared/dateFormat';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { useInviteRsvp } from '../hooks/useInviteRsvp';
import { actionKeyHints, hintLabel, type ActionKeyHint } from '../lib/actionKeyHints';
import { calendarEventWhenLabel } from '../calendar/calendarDateLabels';
import { CAL_BUTTON, CAL_PRIMARY_BUTTON, CalendarKeyCap } from '../calendar/calendarUi';

interface CalendarInviteCardProps {
  invite: CalendarInvite;
  accountId: string;
}

/** "Thu, Nov 12, 14:00–14:45" or "Fri, Nov 13 · All day", in the app's shared vocabulary. */
export function inviteTimeLabel(invite: CalendarInvite, now: Date = new Date()): string {
  return calendarEventWhenLabel(invite, now);
}

function conflictLabel(conflict: CalendarConflict): string {
  if (conflict.event.isAllDay) return `${conflict.event.summary} · All day`;
  return `${conflict.event.summary} · ${formatTimeRange(conflict.overlapStartAt, conflict.overlapEndAt)}`;
}

const ANSWERS: Array<{ status: Exclude<CalendarAttendeeResponse, 'needsAction'>; label: string; title: string; hint: 'acceptInvite' | 'declineInvite' | null }> = [
  { status: 'accepted', label: 'Yes', title: 'Yes, I will attend', hint: 'acceptInvite' },
  { status: 'tentative', label: 'Maybe', title: 'Maybe', hint: null },
  { status: 'declined', label: 'No', title: 'No, I will not attend', hint: 'declineInvite' },
];

const PRESSED = 'inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-[var(--control-radius)] border border-[var(--accent)] bg-[var(--raised-surface)] px-2.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--accent-ink)] transition-colors hover:bg-[var(--hover-row)] disabled:cursor-default disabled:opacity-45 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] motion-reduce:transition-none';

export function CalendarInviteCard({ invite, accountId }: CalendarInviteCardProps) {
  const store = useAppStore();
  const [isAdding, setIsAdding] = useState(false);
  const [pendingResponse, setPendingResponse] = useState<CalendarAttendeeResponse | null>(null);
  const [calendarChecked, setCalendarChecked] = useState(false);
  const rsvp = useInviteRsvp();
  // Per account: a unified inbox can show invites for an account other than the primary one.
  const calendarAccess = rsvp.calendarConnected(accountId);
  const canUseCalendar = calendarAccess === true;
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

  const hints = actionKeyHints(store.settings.shortcuts);
  const currentAnswer = matchingCalendarEvent?.selfResponseStatus || null;
  const busy = Boolean(pendingResponse) || isAdding;

  function keyHint(name: 'acceptInvite' | 'declineInvite' | null): ActionKeyHint | null {
    return name ? hints[name] : null;
  }

  return (
    <div className="dm-inset rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--raised-surface)] p-3" data-calendar-invite-card>
      <div className="flex min-w-0 items-start gap-2.5">
        <CalendarClock aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
        <div className="min-w-0 flex-1">
          <div className="break-words text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{invite.summary || '(no title)'}</div>
          <div className="mt-0.5 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">{inviteTimeLabel(invite)}</div>
          {invite.location && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">
              <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={invite.location}>{invite.location}</span>
            </div>
          )}
          {invite.attendees.length > 0 && (
            <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">
              <Users aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate" title={invite.attendees.map(attendee => attendee.displayName || attendee.email).join(', ')}>
                {invite.attendees.map(attendee => attendee.displayName || attendee.email).join(', ')}
              </span>
            </div>
          )}
          {conflicts.length > 0 && (
            <div className="mt-2 rounded-[var(--control-radius)] border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">
              <div className="font-semibold text-[var(--warning-solid)]">{conflicts.length === 1 ? 'Overlaps another event' : `Overlaps ${conflicts.length} events`}</div>
              <ul className="mt-0.5 flex flex-col gap-0.5">
                {conflicts.map(conflict => (
                  <li key={`${conflict.event.calendarId}:${conflict.event.id}`} className="truncate">{conflictLabel(conflict)}</li>
                ))}
              </ul>
            </div>
          )}
          {matchingCalendarEvent && (
            <div className="mt-2 flex items-center gap-1.5 text-[calc(11px*var(--font-scale))] font-medium text-[var(--success-solid)]">
              <CalendarCheck aria-hidden="true" className="h-3.5 w-3.5" />
              Already in your calendar
            </div>
          )}
        </div>
      </div>

      {calendarAccess !== null && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-[var(--border)] pt-3 select-none">
          {!canUseCalendar ? (
            <>
              <span className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">Connect Google Calendar to answer here.</span>
              <button
                type="button"
                onClick={() => rsvp.connectCalendar(accountId)}
                data-invite-connect-calendar
                className={`${CAL_PRIMARY_BUTTON} ml-auto`}
              >
                Connect Calendar
              </button>
            </>
          ) : (
            <>
              <span id={`invite-answer-${invite.uid}`} className="text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">Going?</span>
              <div role="group" aria-labelledby={`invite-answer-${invite.uid}`} className="flex flex-wrap items-center gap-1.5">
                {ANSWERS.map(answer => {
                  const hint = keyHint(answer.hint);
                  const keyText = hint ? hintLabel(hint) : undefined;
                  const pressed = currentAnswer === answer.status;
                  return (
                    <button
                      key={answer.status}
                      type="button"
                      data-invite-answer={answer.status}
                      disabled={Boolean(pendingResponse)}
                      aria-pressed={pressed}
                      aria-keyshortcuts={hint?.aria}
                      title={keyText ? `${answer.title} (${keyText})` : answer.title}
                      onClick={() => void respond(answer.status)}
                      className={pressed ? PRESSED : CAL_BUTTON}
                    >
                      {pendingResponse === answer.status ? 'Saving…' : answer.label}
                      {hint && hint.keys.length > 0 && <CalendarKeyCap>{keyText}</CalendarKeyCap>}
                    </button>
                  );
                })}
              </div>
              {matchingCalendarEvent ? (
                <button
                  type="button"
                  data-invite-open-calendar
                  onClick={() => store.openCalendarEvent(matchingCalendarEvent)}
                  className={`${CAL_BUTTON} ml-auto`}
                >
                  <CalendarCheck aria-hidden="true" className="h-3.5 w-3.5" />
                  Open in calendar
                </button>
              ) : (
                <button
                  type="button"
                  data-invite-add-calendar
                  disabled={busy}
                  onClick={() => void addToCalendar()}
                  className={`${CAL_BUTTON} ml-auto`}
                >
                  <CalendarPlus aria-hidden="true" className="h-3.5 w-3.5" />
                  {isAdding ? 'Adding…' : 'Add to calendar'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
