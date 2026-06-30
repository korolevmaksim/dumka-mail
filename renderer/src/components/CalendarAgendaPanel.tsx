import { CalendarCheck, CalendarDays, Clock, MapPin, RefreshCw } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import type { CalendarEvent } from '../../../shared/types';

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function dayLabel(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function eventTime(event: CalendarEvent): string {
  if (event.isAllDay) return 'All day';
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return `${start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function CalendarAgendaPanel() {
  const store = useAppStore();
  const enabled = store.googleIntegrationStatus?.calendarEnabled === true;
  const today = new Date();
  const todaysEvents = store.calendarEvents.filter(event => sameDay(new Date(event.startAt), today)).slice(0, 8);
  const upcoming = store.calendarEvents
    .filter(event => new Date(event.startAt).getTime() >= today.getTime() && !sameDay(new Date(event.startAt), today))
    .slice(0, 4);

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-chrome text-[var(--text-secondary)] flex items-center justify-between">
        <span className="flex items-center gap-1.5">
          AGENDA
          {enabled && (
            <button
              type="button"
              onClick={() => void store.syncCalendarAgenda()}
              title="Sync Calendar"
              className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-[background-color,color] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          )}
        </span>
        <span className={`w-2 h-2 rounded-full ${enabled ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]'}`} />
      </h3>

      <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--app-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
            <div className="flex flex-col">
              <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{dayLabel(today)}</span>
              <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{todaysEvents.length} event{todaysEvents.length === 1 ? '' : 's'} today</span>
            </div>
          </div>
        </div>

        {!enabled ? (
          <button
            type="button"
            onClick={() => void store.authorizeGoogleIntegration('calendar')}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-[var(--accent)] px-3 py-2 text-[calc(11px*var(--font-scale))] font-semibold text-white"
          >
            <CalendarCheck className="h-3.5 w-3.5" />
            Enable Calendar
          </button>
        ) : todaysEvents.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            No events left today.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {todaysEvents.map(event => (
              <div key={`${event.calendarId}:${event.id}`} className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-2">
                <div className="truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{event.summary}</div>
                <div className="mt-1 flex items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  <Clock className="h-3 w-3" />
                  <span>{eventTime(event)}</span>
                </div>
                {event.location && (
                  <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
                    <MapPin className="h-3 w-3 shrink-0" />
                    <span className="truncate">{event.location}</span>
                  </div>
                )}
                {event.conferenceUrl && (
                  <a
                    href={event.conferenceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex text-[calc(10px*var(--font-scale))] font-medium text-[var(--accent)] hover:underline"
                  >
                    Join call
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {enabled && upcoming.length > 0 && (
          <div className="border-t border-[var(--border)] pt-2">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Next</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {upcoming.map(event => (
                <div key={`${event.calendarId}:${event.id}`} className="flex min-w-0 items-center justify-between gap-2 text-[calc(10px*var(--font-scale))]">
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{event.summary}</span>
                  <span className="shrink-0 text-[var(--text-secondary)]">{dayLabel(new Date(event.startAt))}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
