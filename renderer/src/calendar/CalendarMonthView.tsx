import { useMemo } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { calendarDateKey, calendarEventsForDate, calendarMonthDays, layoutCalendarAllDayLanes, moveCalendarEventToDate } from '../../../shared/calendarWorkspace';
import { CalendarEventChip } from './CalendarEventChip';

interface CalendarMonthViewProps {
  anchor: Date;
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  onSelectDate: (date: Date) => void;
  onCreate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onMoveEvent: (event: CalendarEvent, update: ReturnType<typeof moveCalendarEventToDate>) => void;
}

const WEEKDAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function CalendarMonthView({
  anchor,
  events,
  calendars,
  weekStartsOn,
  showWeekends,
  onSelectDate,
  onCreate,
  onSelectEvent,
  onMoveEvent,
}: CalendarMonthViewProps) {
  const days = useMemo(() => calendarMonthDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const visibleDays = useMemo(() => showWeekends ? days : days.filter(day => day.date.getDay() !== 0 && day.date.getDay() !== 6), [days, showWeekends]);
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])), [calendars]);
  const columns = showWeekends ? 7 : 5;
  const weekdayOrder = Array.from({ length: 7 }, (_, index) => (index + weekStartsOn) % 7)
    .filter(day => showWeekends || (day !== 0 && day !== 6));
  const weekSpans = useMemo(() => Array.from({ length: 6 }, (_, weekIndex) => (
    layoutCalendarAllDayLanes(events, visibleDays.slice(weekIndex * columns, (weekIndex + 1) * columns).map(day => day.date))
  )), [columns, events, visibleDays]);
  const anchorKey = calendarDateKey(anchor);
  const rovingKey = visibleDays.some(day => day.key === anchorKey) ? anchorKey : visibleDays[0]?.key;

  function focusDayAt(index: number) {
    const target = visibleDays[Math.max(0, Math.min(visibleDays.length - 1, index))];
    if (!target) return;
    onSelectDate(target.date);
    window.requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-calendar-date="${target.key}"]`)?.focus();
    });
  }

  return (
    <div className="flex h-full min-h-0 flex-col" role="grid" aria-label="Month calendar">
      <div className="grid shrink-0 border-b border-[var(--border)] bg-[var(--panel-bg)]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }} role="row">
        {weekdayOrder.map(day => (
          <div key={day} role="columnheader" className="px-2 py-2 text-center text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
            {WEEKDAY_LABELS[day]}
          </div>
        ))}
      </div>
      <div className="grid min-h-0 flex-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: 'repeat(6, minmax(84px, 1fr))' }}>
        {visibleDays.map((day, dayIndex) => {
          const dayEvents = calendarEventsForDate(events, day.date);
          const columnIndex = dayIndex % columns;
          const spansForDay = weekSpans[Math.floor(dayIndex / columns)]
            .filter(span => span.startColumn <= columnIndex && span.endColumn >= columnIndex);
          const spanEventKeys = new Set(spansForDay.map(span => `${span.event.accountId}:${span.event.calendarId}:${span.event.id}`));
          const timedEvents = dayEvents.filter(event => !spanEventKeys.has(`${event.accountId}:${event.calendarId}:${event.id}`));
          const laneCount = spansForDay.length > 0 ? Math.min(3, Math.max(...spansForDay.map(span => span.lane)) + 1) : 0;
          const visibleLanes = Array.from({ length: laneCount }, (_, lane) => spansForDay.find(span => span.lane === lane) || null);
          const visibleTimed = timedEvents.slice(0, Math.max(0, 4 - laneCount));
          const displayedCount = new Set([
            ...visibleLanes.filter(Boolean).map(span => `${span!.event.accountId}:${span!.event.calendarId}:${span!.event.id}`),
            ...visibleTimed.map(event => `${event.accountId}:${event.calendarId}:${event.id}`),
          ]).size;
          return (
            <div
              key={day.key}
              role="gridcell"
              tabIndex={day.key === rovingKey ? 0 : -1}
              data-calendar-date={day.key}
              aria-label={`${day.date.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}, ${dayEvents.length} events`}
              onClick={() => onSelectDate(day.date)}
              onDoubleClick={() => onCreate(day.date)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  onCreate(day.date);
                  return;
                }
                const rowStart = dayIndex - columnIndex;
                const targetIndex = event.key === 'ArrowLeft' ? dayIndex - 1
                  : event.key === 'ArrowRight' ? dayIndex + 1
                    : event.key === 'ArrowUp' ? dayIndex - columns
                      : event.key === 'ArrowDown' ? dayIndex + columns
                        : event.key === 'Home' ? rowStart
                          : event.key === 'End' ? rowStart + columns - 1
                            : null;
                if (targetIndex !== null) {
                  event.preventDefault();
                  focusDayAt(targetIndex);
                }
              }}
              onDragOver={(event) => {
                event.preventDefault();
                event.dataTransfer.dropEffect = 'move';
              }}
              onDrop={(dropEvent) => {
                dropEvent.preventDefault();
                try {
                  const payload = JSON.parse(dropEvent.dataTransfer.getData('application/x-dumka-calendar-event')) as { accountId: string; calendarId: string; eventId: string };
                  const calendarEvent = events.find(item => item.accountId === payload.accountId && item.calendarId === payload.calendarId && item.id === payload.eventId);
                  if (calendarEvent) onMoveEvent(calendarEvent, moveCalendarEventToDate(calendarEvent, day.date));
                } catch {
                  // Ignore drags from outside the calendar workspace.
                }
              }}
              className={`group min-h-0 overflow-hidden border-b border-r border-[var(--border)] p-1.5 outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--accent)] ${day.inMonth ? 'bg-[var(--app-bg)]' : 'bg-[var(--panel-bg)] opacity-60'}`}
            >
              <div className="mb-1 flex items-center justify-between">
                <span className={`flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[calc(11px*var(--font-scale))] font-semibold ${day.isToday ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-secondary)]'}`}>
                  {day.date.getDate()}
                </span>
                <button
                  type="button"
                  onClick={(event) => { event.stopPropagation(); onCreate(day.date); }}
                  aria-label={`Create event on ${day.date.toLocaleDateString()}`}
                  className="rounded px-1.5 py-0.5 text-[var(--text-tertiary)] opacity-0 hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus:opacity-100"
                >+</button>
              </div>
              <div className="flex min-h-0 flex-col gap-0.5 overflow-hidden">
                {visibleLanes.map((span, lane) => span ? (() => {
                  const calendar = calendarById.get(`${span.event.accountId}:${span.event.calendarId}`);
                  const writable = calendar?.accessRole === 'writer' || calendar?.accessRole === 'owner';
                  const startsHere = span.startColumn === columnIndex;
                  const endsHere = span.endColumn === columnIndex;
                  return (
                    <button
                      key={`lane-${lane}:${span.event.accountId}:${span.event.calendarId}:${span.event.id}`}
                      type="button"
                      draggable={writable}
                      onDragStart={dragEvent => {
                        dragEvent.dataTransfer.effectAllowed = 'move';
                        dragEvent.dataTransfer.setData('application/x-dumka-calendar-event', JSON.stringify({ accountId: span.event.accountId, calendarId: span.event.calendarId, eventId: span.event.id }));
                      }}
                      onClick={clickEvent => { clickEvent.stopPropagation(); onSelectEvent(span.event); }}
                      aria-label={`${span.event.summary}, ${span.event.startDate || new Date(span.event.startAt).toLocaleDateString()} through ${span.event.endDate || new Date(span.event.endAt).toLocaleDateString()}`}
                      className="dm-calendar-event h-[18px] min-w-0 truncate px-1.5 text-left text-[calc(9px*var(--font-scale))] font-medium shadow-sm focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                      style={{
                        backgroundColor: calendar?.backgroundColor || '#3b82f6',
                        color: calendar?.foregroundColor || '#ffffff',
                        borderTopLeftRadius: startsHere ? 4 : 0,
                        borderBottomLeftRadius: startsHere ? 4 : 0,
                        borderTopRightRadius: endsHere ? 4 : 0,
                        borderBottomRightRadius: endsHere ? 4 : 0,
                        marginLeft: startsHere ? 0 : -6,
                        marginRight: endsHere ? 0 : -6,
                      }}
                    >
                      {startsHere ? span.event.summary : '\u00a0'}
                    </button>
                  );
                })() : <div key={`empty-lane-${lane}`} className="h-[18px]" />)}
                {visibleTimed.map(event => (
                  <CalendarEventChip key={`${event.accountId}:${event.calendarId}:${event.id}`} event={event} calendar={calendarById.get(`${event.accountId}:${event.calendarId}`)} compact onSelect={onSelectEvent} />
                ))}
                {dayEvents.length > displayedCount && (
                  <button type="button" onClick={(event) => { event.stopPropagation(); onSelectDate(day.date); }} className="px-1 text-left text-[calc(9px*var(--font-scale))] font-medium text-[var(--text-tertiary)] hover:text-[var(--accent)]">
                    +{dayEvents.length - displayedCount} more
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
