import { useMemo, useRef, type DragEvent as ReactDragEvent } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { calendarDateKey, calendarEventsForDate, calendarMonthDays, layoutCalendarAllDayLanes, moveCalendarEventToDate } from '../../../shared/calendarWorkspace';
import { CALENDAR_EVENT_DRAG_TYPE, CalendarEventChip } from './CalendarEventChip';
import { calendarEventKey, isAllDayRowEvent } from './calendarTimeLayout';
import { calendarEventEndsIn, calendarEventStartsIn } from './CalendarTimeGrid';
import { monthCellLines, monthCellOverflow, monthWeekLanesShown } from './calendarMonthLayout';
import { shortDayLabel, spokenDayLabel, weekdayOrder, weekdayShortNames } from './calendarDateLabels';
import { CAL_FOCUS } from './calendarUi';
import { useElementSize } from './useElementSize';

interface CalendarMonthViewProps {
  anchor: Date;
  selectedDate: Date;
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  selectedEventKey: string | null;
  onSelectDate: (date: Date) => void;
  onOpenDay: (date: Date) => void;
  onCreate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onMoveEvent: (event: CalendarEvent, update: ReturnType<typeof moveCalendarEventToDate>) => void;
}

const HEADER_HEIGHT = 32;
const LABEL_HEIGHT = 28;
const LINE_HEIGHT = 26;
const MIN_ROW_HEIGHT = 92;

export function CalendarMonthView({
  anchor,
  selectedDate,
  events,
  calendars,
  weekStartsOn,
  showWeekends,
  selectedEventKey,
  onSelectDate,
  onOpenDay,
  onCreate,
  onSelectEvent,
  onMoveEvent,
}: CalendarMonthViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const { height } = useElementSize(containerRef);
  const days = useMemo(() => calendarMonthDays(anchor, weekStartsOn), [anchor, weekStartsOn]);
  const columns = showWeekends ? 7 : 5;
  const visibleDays = useMemo(() => showWeekends ? days : days.filter(day => day.date.getDay() !== 0 && day.date.getDay() !== 6), [days, showWeekends]);
  const weeks = useMemo(() => Array.from({ length: 6 }, (_, index) => visibleDays.slice(index * columns, (index + 1) * columns)), [columns, visibleDays]);
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])), [calendars]);
  const barEvents = useMemo(() => events.filter(event => isAllDayRowEvent(event) || !sameLocalDay(event.startAt, event.endAt)), [events]);
  const weekSpans = useMemo(() => weeks.map(week => layoutCalendarAllDayLanes(barEvents, week.map(day => day.date))), [barEvents, weeks]);
  const weekdayNames = weekdayShortNames(weekStartsOn);
  const headerNames = weekdayOrder(weekStartsOn)
    .map((day, index) => ({ day, name: weekdayNames[index] }))
    .filter(item => showWeekends || (item.day !== 0 && item.day !== 6));
  const rowHeight = Math.max(MIN_ROW_HEIGHT, (height - HEADER_HEIGHT) / 6);
  const lines = monthCellLines(rowHeight, LABEL_HEIGHT, LINE_HEIGHT);
  const anchorKey = calendarDateKey(anchor);
  const selectedKey = calendarDateKey(selectedDate);
  const rovingKey = visibleDays.some(day => day.key === selectedKey) ? selectedKey : visibleDays.some(day => day.key === anchorKey) ? anchorKey : visibleDays[0]?.key;
  const now = new Date();

  function focusDayAt(index: number) {
    const target = visibleDays[Math.max(0, Math.min(visibleDays.length - 1, index))];
    if (!target) return;
    onSelectDate(target.date);
    window.requestAnimationFrame(() => {
      containerRef.current?.querySelector<HTMLElement>(`[data-calendar-date="${target.key}"]`)?.focus();
    });
  }

  function dropOnWeek(dropEvent: ReactDragEvent<HTMLDivElement>, weekIndex: number) {
    dropEvent.preventDefault();
    const rect = dropEvent.currentTarget.getBoundingClientRect();
    const column = Math.max(0, Math.min(columns - 1, Math.floor(((dropEvent.clientX - rect.left) / rect.width) * columns)));
    const day = weeks[weekIndex]?.[column];
    if (!day) return;
    try {
      const payload = JSON.parse(dropEvent.dataTransfer.getData(CALENDAR_EVENT_DRAG_TYPE)) as { accountId: string; calendarId: string; eventId: string };
      const calendarEvent = events.find(item => item.accountId === payload.accountId && item.calendarId === payload.calendarId && item.id === payload.eventId);
      if (calendarEvent) onMoveEvent(calendarEvent, moveCalendarEventToDate(calendarEvent, day.date));
    } catch {
      // Drags from outside the calendar carry no event.
    }
  }

  return (
    <div ref={containerRef} className="flex h-full min-h-0 flex-col overflow-y-auto [scrollbar-gutter:stable]" role="grid" aria-label="Month calendar">
      <div className="sticky top-0 z-20 grid shrink-0 border-b border-[var(--border)] bg-[var(--panel-bg)]" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height: HEADER_HEIGHT }} role="row">
        {headerNames.map(item => (
          <div key={item.day} role="columnheader" className="flex min-w-0 items-center border-r border-[var(--border)] px-2 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-secondary)] last:border-r-0">
            {item.name}
          </div>
        ))}
      </div>
      <div className="grid flex-1" style={{ gridTemplateRows: `repeat(6, minmax(${MIN_ROW_HEIGHT}px, 1fr))` }}>
        {weeks.map((week, weekIndex) => {
          const spans = weekSpans[weekIndex] || [];
          const weekLaneCount = spans.reduce((max, span) => Math.max(max, span.lane + 1), 0);
          const lanesShown = monthWeekLanesShown(lines, weekLaneCount);
          const spanKeys = new Set(spans.map(span => calendarEventKey(span.event)));
          return (
            <div
              key={week[0]?.key || weekIndex}
              role="row"
              className="relative grid min-h-0"
              style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={event => dropOnWeek(event, weekIndex)}
            >
              {week.map((day, columnIndex) => {
                const dayIndex = weekIndex * columns + columnIndex;
                const dayEvents = calendarEventsForDate(events, day.date);
                const timed = dayEvents.filter(event => !spanKeys.has(calendarEventKey(event)));
                const spanLanes = spans.filter(span => span.startColumn <= columnIndex && span.endColumn >= columnIndex).map(span => span.lane);
                const { timedShown, more } = monthCellOverflow(lines, lanesShown, spanLanes, timed.length);
                const isSelected = day.key === selectedKey;
                const showMonth = day.date.getDate() === 1;
                return (
                  <div
                    key={day.key}
                    role="gridcell"
                    tabIndex={day.key === rovingKey ? 0 : -1}
                    aria-selected={isSelected}
                    data-calendar-date={day.key}
                    aria-label={`${spokenDayLabel(day.date)}${day.isToday ? ', today' : ''}, ${dayEvents.length === 0 ? 'no events' : `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`}`}
                    onClick={() => onSelectDate(day.date)}
                    onDoubleClick={() => onCreate(day.date)}
                    onKeyDown={(event) => {
                      if (event.target !== event.currentTarget) return;
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        onOpenDay(day.date);
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
                        event.stopPropagation();
                        focusDayAt(targetIndex);
                      }
                    }}
                    className={`group relative min-w-0 overflow-hidden border-b border-r border-[var(--border)] outline-none focus-visible:z-10 focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--accent)] ${
                      isSelected ? 'bg-[var(--selected-row)]' : day.inMonth ? 'bg-[var(--app-bg)] hover:bg-[var(--hover-row)]' : 'bg-[var(--rail-bg)] hover:bg-[var(--hover-row)]'
                    }`}
                    style={{ gridColumn: columnIndex + 1, gridRow: 1 }}
                  >
                    <div className="flex items-center justify-between px-1.5" style={{ height: LABEL_HEIGHT }}>
                      <span
                        className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-[calc(12px*var(--font-scale))] font-semibold tabular-nums ${
                          day.isToday ? 'bg-[var(--accent-fill)] text-[var(--on-accent)]' : day.inMonth ? 'text-[var(--text-primary)]' : 'text-[var(--text-tertiary)]'
                        }`}
                      >
                        {showMonth ? shortDayLabel(day.date, now) : day.date.getDate()}
                      </span>
                      <button
                        type="button"
                        onClick={(event) => { event.stopPropagation(); onCreate(day.date); }}
                        aria-label={`New event on ${spokenDayLabel(day.date)}`}
                        title="New event"
                        className={`inline-flex h-6 w-6 items-center justify-center rounded text-[calc(14px*var(--font-scale))] text-[var(--text-secondary)] opacity-0 hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] group-hover:opacity-100 focus-visible:opacity-100 ${CAL_FOCUS}`}
                      >+</button>
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5 px-1" style={{ paddingTop: lanesShown * LINE_HEIGHT }}>
                      {timed.slice(0, timedShown).map(event => (
                        <CalendarEventChip
                          key={calendarEventKey(event)}
                          event={event}
                          calendar={calendarById.get(`${event.accountId}:${event.calendarId}`)}
                          selected={calendarEventKey(event) === selectedEventKey}
                          onSelect={onSelectEvent}
                        />
                      ))}
                      {more > 0 && (
                        <button
                          type="button"
                          onClick={(event) => { event.stopPropagation(); onOpenDay(day.date); }}
                          aria-label={`${more} more ${more === 1 ? 'event' : 'events'} on ${spokenDayLabel(day.date)}. Open day`}
                          className={`h-6 shrink-0 rounded px-1 text-left text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] ${CAL_FOCUS}`}
                        >
                          +{more} more
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* Bars lie over the week; each week segment carries the title. */}
              {spans.filter(span => span.lane < lanesShown).map(span => {
                const startDay = week[span.startColumn]?.date;
                const endDay = week[span.endColumn]?.date;
                return (
                  <div
                    key={`${calendarEventKey(span.event)}:${weekIndex}`}
                    className="pointer-events-none absolute z-10 px-1"
                    style={{
                      top: LABEL_HEIGHT + span.lane * LINE_HEIGHT,
                      left: `${(span.startColumn / columns) * 100}%`,
                      width: `${((span.endColumn - span.startColumn + 1) / columns) * 100}%`,
                    }}
                  >
                    <div className="pointer-events-auto">
                      <CalendarEventChip
                        event={span.event}
                        calendar={calendarById.get(`${span.event.accountId}:${span.event.calendarId}`)}
                        selected={calendarEventKey(span.event) === selectedEventKey}
                        continuesBefore={!calendarEventStartsIn(span.event, startDay)}
                        continuesAfter={!calendarEventEndsIn(span.event, endDay)}
                        onSelect={onSelectEvent}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function sameLocalDay(startIso: string, endIso: string): boolean {
  const start = new Date(startIso);
  // An event ending exactly at midnight belongs to its start day.
  const end = new Date(Date.parse(endIso) - 1);
  return start.getFullYear() === end.getFullYear() && start.getMonth() === end.getMonth() && start.getDate() === end.getDate();
}
