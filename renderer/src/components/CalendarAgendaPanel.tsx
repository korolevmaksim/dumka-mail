import { useEffect, useMemo, useState } from 'react';
import { CalendarCheck, CalendarDays, ChevronLeft, ChevronRight, Clock, MapPin, RefreshCw } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import type { CalendarEvent } from '../../../shared/types';
import { findAvailabilitySlots } from '../../../shared/calendarAvailability';
import {
  MINI_CALENDAR_WEEKDAYS,
  addLocalDays,
  addLocalMonths,
  buildMiniCalendarMonth,
  countCalendarEventsByDay,
  monthTitle,
  sameLocalDay,
  startOfLocalDay,
  visibleMiniCalendarRange,
} from '../../../shared/calendarMini';

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
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visibleMonth, setVisibleMonth] = useState(() => new Date());
  const calendarWeeks = useMemo(
    () => buildMiniCalendarMonth(visibleMonth, selectedDate, today),
    [selectedDate, today, visibleMonth],
  );
  const eventCounts = useMemo(() => countCalendarEventsByDay(store.calendarEvents), [store.calendarEvents]);
  const selectedDayStart = startOfLocalDay(selectedDate);
  const selectedDayEnd = addLocalDays(selectedDayStart, 1);
  const selectedEvents = store.calendarEvents
    .filter(event => sameLocalDay(new Date(event.startAt), selectedDate))
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 8);
  const upcoming = store.calendarEvents
    .filter(event => new Date(event.startAt).getTime() >= selectedDayEnd.getTime())
    .sort((a, b) => new Date(a.startAt).getTime() - new Date(b.startAt).getTime())
    .slice(0, 4);
  const canShowAvailability = enabled && selectedDayStart.getTime() >= startOfLocalDay(today).getTime();
  const availabilityAnchor = sameLocalDay(selectedDate, today) ? today : selectedDayStart;
  const availabilitySlots = canShowAvailability
    ? findAvailabilitySlots(store.calendarEvents, store.settings.calendar, availabilityAnchor, 3)
    : [];

  useEffect(() => {
    if (!enabled) return;
    void store.syncCalendarAgenda(undefined, visibleMiniCalendarRange(visibleMonth));
  }, [enabled, store.syncCalendarAgenda, visibleMonth]);

  function showMonth(offset: number) {
    const nextMonth = addLocalMonths(visibleMonth, offset);
    setVisibleMonth(nextMonth);
    setSelectedDate(current => (
      current.getFullYear() === nextMonth.getFullYear() && current.getMonth() === nextMonth.getMonth()
        ? current
        : nextMonth
    ));
  }

  function selectDay(date: Date) {
    setSelectedDate(date);
    setVisibleMonth(new Date(date.getFullYear(), date.getMonth(), 1));
  }

  function selectToday() {
    const next = new Date();
    setSelectedDate(next);
    setVisibleMonth(new Date(next.getFullYear(), next.getMonth(), 1));
  }

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
              <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{dayLabel(selectedDate)}</span>
              <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{selectedEvents.length} event{selectedEvents.length === 1 ? '' : 's'}</span>
            </div>
          </div>
          {!sameLocalDay(selectedDate, today) && (
            <button
              type="button"
              onClick={selectToday}
              className="rounded-md border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
            >
              Today
            </button>
          )}
        </div>

        <div className="rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-2">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => showMonth(-1)}
              title="Previous month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <span className="min-w-0 truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              {monthTitle(visibleMonth)}
            </span>
            <button
              type="button"
              onClick={() => showMonth(1)}
              title="Next month"
              className="flex h-6 w-6 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">
            {MINI_CALENDAR_WEEKDAYS.map(day => <span key={day}>{day}</span>)}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {calendarWeeks.flat().map(day => {
              const count = eventCounts[day.key] || 0;
              return (
                <button
                  key={day.key}
                  type="button"
                  onClick={() => selectDay(day.date)}
                  title={`${day.key}${count > 0 ? `, ${count} event${count === 1 ? '' : 's'}` : ''}`}
                  className={`relative flex aspect-square min-h-7 items-center justify-center rounded-md text-[calc(10px*var(--font-scale))] font-medium transition-colors ${
                    day.isSelected
                      ? 'bg-[var(--accent)] text-white'
                      : day.isToday
                        ? 'border border-[var(--accent)] text-[var(--text-primary)]'
                        : day.isCurrentMonth
                          ? 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]'
                          : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'
                  }`}
                >
                  <span>{day.dayNumber}</span>
                  {count > 0 && (
                    <span className={`absolute bottom-1 h-1 w-1 rounded-full ${day.isSelected ? 'bg-white' : 'bg-[var(--accent)]'}`} />
                  )}
                </button>
              );
            })}
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
        ) : selectedEvents.length === 0 ? (
          <div className="rounded-md border border-dashed border-[var(--border)] px-3 py-4 text-center text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            No events on this day.
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {selectedEvents.map(event => (
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

        {canShowAvailability && availabilitySlots.length > 0 && (
          <div className="border-t border-[var(--border)] pt-2">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold uppercase text-[var(--text-secondary)]">Availability</span>
            <div className="mt-1.5 flex flex-col gap-1">
              {availabilitySlots.map(slot => (
                <div key={slot.startAt} className="flex min-w-0 items-center justify-between gap-2 text-[calc(10px*var(--font-scale))]">
                  <span className="min-w-0 truncate text-[var(--text-primary)]">{slot.dayLabel}</span>
                  <span className="shrink-0 text-[var(--text-secondary)]">{slot.timeLabel}</span>
                </div>
              ))}
            </div>
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
