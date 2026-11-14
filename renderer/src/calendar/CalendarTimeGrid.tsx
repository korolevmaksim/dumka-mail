import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { addCalendarDays, layoutCalendarAllDayLanes, startOfCalendarDay, startOfCalendarWeek } from '../../../shared/calendarWorkspace';
import { CALENDAR_EVENT_DRAG_TYPE, CalendarEventChip, calendarEventIsWritable } from './CalendarEventChip';
import { calendarEventKey, isAllDayRowEvent, layoutTimedEventsForDay, minuteAtOffset, timedBlockHasTwoLines } from './calendarTimeLayout';
import { spokenDayLabel, weekdayShort } from './calendarDateLabels';
import { CAL_FOCUS } from './calendarUi';

interface CalendarTimeGridProps {
  anchor: Date;
  mode: 'day' | 'week';
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  weekStartsOn: 0 | 1;
  showWeekends: boolean;
  workingDays: number[];
  workingHoursStart: string;
  workingHoursEnd: string;
  selectedEventKey: string | null;
  onSelectDate: (date: Date) => void;
  onOpenDay: (date: Date) => void;
  onCreateRange: (startAt: string, endAt: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onMoveEvent: (event: CalendarEvent, startAt: string, endAt: string) => void;
  onResizeEvent: (event: CalendarEvent, endAt: string) => void;
}

const HOUR_HEIGHT = 56;
const MIN_BLOCK_HEIGHT = 24;
const LINE_HEIGHT = 14;
const GUTTER = 56;
const ALL_DAY_LANES = 3;
const LANE_HEIGHT = 26;

function parseClock(value: string, fallback: number): number {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return fallback;
  const minutes = Number(match[1]) * 60 + Number(match[2]);
  return minutes >= 0 && minutes <= 1440 ? minutes : fallback;
}

function sameDay(a: Date, b: Date): boolean {
  return startOfCalendarDay(a).getTime() === startOfCalendarDay(b).getTime();
}

export function CalendarTimeGrid({
  anchor,
  mode,
  events,
  calendars,
  weekStartsOn,
  showWeekends,
  workingDays,
  workingHoursStart,
  workingHoursEnd,
  selectedEventKey,
  onSelectDate,
  onOpenDay,
  onCreateRange,
  onSelectEvent,
  onMoveEvent,
  onResizeEvent,
}: CalendarTimeGridProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const resizeRef = useRef<{
    event: CalendarEvent;
    startY: number;
    originalHeight: string;
    originalDurationMinutes: number;
    container: HTMLElement;
  } | null>(null);
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])), [calendars]);
  const days = useMemo(() => {
    const start = mode === 'day' ? startOfCalendarDay(anchor) : startOfCalendarWeek(anchor, weekStartsOn);
    return Array.from({ length: mode === 'day' ? 1 : 7 }, (_, index) => addCalendarDays(start, index))
      .filter(day => mode === 'day' || showWeekends || (day.getDay() !== 0 && day.getDay() !== 6));
  }, [anchor, mode, showWeekends, weekStartsOn]);
  const workingRange = useMemo(() => {
    const start = parseClock(workingHoursStart, 9 * 60);
    const end = parseClock(workingHoursEnd, 17 * 60);
    return end > start ? { start, end } : { start: 9 * 60, end: 17 * 60 };
  }, [workingHoursEnd, workingHoursStart]);
  const allDayEvents = useMemo(() => events.filter(isAllDayRowEvent), [events]);
  const timedEvents = useMemo(() => events.filter(event => !isAllDayRowEvent(event)), [events]);
  const allDaySpans = useMemo(() => layoutCalendarAllDayLanes(allDayEvents, days), [allDayEvents, days]);
  const laneCount = Math.min(ALL_DAY_LANES, allDaySpans.reduce((max, span) => Math.max(max, span.lane + 1), 0));
  const hiddenAllDayByColumn = days.map((_, column) => allDaySpans.filter(span => span.lane >= ALL_DAY_LANES && span.startColumn <= column && span.endColumn >= column).length);
  const allDayRowHeight = Math.max(1, laneCount) * LANE_HEIGHT + 6 + (hiddenAllDayByColumn.some(count => count > 0) ? 26 : 0);
  const columns = `${GUTTER}px repeat(${days.length}, minmax(0, 1fr))`;
  const today = new Date();
  const nowMinutes = today.getHours() * 60 + today.getMinutes();

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, (workingRange.start / 60) * HOUR_HEIGHT - HOUR_HEIGHT / 2);
    // Scroll once per view switch, not on every working-hours edit.
  }, [mode]);

  function eventFromDrag(dataTransfer: DataTransfer): CalendarEvent | null {
    try {
      const payload = JSON.parse(dataTransfer.getData(CALENDAR_EVENT_DRAG_TYPE)) as { accountId: string; calendarId: string; eventId: string };
      return events.find(item => item.accountId === payload.accountId && item.calendarId === payload.calendarId && item.id === payload.eventId) || null;
    } catch {
      return null;
    }
  }

  function resizePointerDown(pointerEvent: ReactPointerEvent<HTMLDivElement>, event: CalendarEvent) {
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const container = pointerEvent.currentTarget.parentElement;
    if (!container) return;
    pointerEvent.currentTarget.setPointerCapture(pointerEvent.pointerId);
    resizeRef.current = {
      event,
      startY: pointerEvent.clientY,
      originalHeight: container.style.height,
      originalDurationMinutes: Math.max(15, Math.round((Date.parse(event.endAt) - Date.parse(event.startAt)) / 60_000)),
      container,
    };
  }

  function resizedDuration(clientY: number): number {
    const state = resizeRef.current;
    if (!state) return 0;
    const deltaMinutes = Math.round(((clientY - state.startY) / HOUR_HEIGHT) * 60 / 15) * 15;
    return Math.max(15, state.originalDurationMinutes + deltaMinutes);
  }

  function resizePointerMove(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const state = resizeRef.current;
    if (!state) return;
    pointerEvent.preventDefault();
    state.container.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (resizedDuration(pointerEvent.clientY) / 60) * HOUR_HEIGHT)}px`;
  }

  function finishResize(pointerEvent: ReactPointerEvent<HTMLDivElement>, apply: boolean) {
    const state = resizeRef.current;
    if (!state) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    const durationMinutes = resizedDuration(pointerEvent.clientY);
    state.container.style.height = state.originalHeight;
    resizeRef.current = null;
    if (!apply) return;
    const endAt = new Date(Date.parse(state.event.startAt) + durationMinutes * 60_000).toISOString();
    if (endAt !== state.event.endAt) onResizeEvent(state.event, endAt);
  }

  function dayStartAtMinute(day: Date, minutes: number): Date {
    return new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
  }

  return (
    <div ref={scrollRef} className="relative h-full min-h-0 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]" aria-label={mode === 'day' ? 'Day calendar' : 'Week calendar'}>
      {/* Day names and the all-day row scroll with the grid (sticky), so their columns always match. */}
      <div className="sticky top-0 z-30 bg-[var(--panel-bg)]">
        <div className="grid border-b border-[var(--border)]" style={{ gridTemplateColumns: columns }}>
          <div className="border-r border-[var(--border)]" />
          {days.map(day => {
            const isToday = sameDay(day, today);
            return (
              <button
                key={day.toISOString()}
                type="button"
                onClick={() => (mode === 'week' ? onOpenDay(day) : onSelectDate(day))}
                aria-label={`${spokenDayLabel(day)}${isToday ? ', today' : ''}${mode === 'week' ? '. Open day' : ''}`}
                aria-current={isToday ? 'date' : undefined}
                className={`flex h-11 min-w-0 cursor-pointer items-center justify-center gap-1.5 border-r border-[var(--border)] px-1 hover:bg-[var(--hover-row)] ${CAL_FOCUS} focus-visible:-outline-offset-2`}
              >
                <span className={`truncate text-[calc(12px*var(--font-scale))] font-medium ${isToday ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>{weekdayShort(day)}</span>
                <span className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1 text-[calc(13px*var(--font-scale))] font-semibold tabular-nums ${isToday ? 'bg-[var(--accent-fill)] text-[var(--on-accent)]' : 'text-[var(--text-primary)]'}`}>
                  {day.getDate()}
                </span>
              </button>
            );
          })}
        </div>
        <div className="relative grid border-b border-[var(--strong-border)]" style={{ gridTemplateColumns: columns, minHeight: `${allDayRowHeight}px` }}>
          <div style={{ gridColumn: 1, gridRow: 1 }} className="flex items-start justify-end border-r border-[var(--border)] px-1.5 pt-1 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">All day</div>
          {days.map((day, column) => (
            <div
              key={day.toISOString()}
              className="relative border-r border-[var(--border)]"
              style={{ gridColumn: column + 2, gridRow: 1 }}
              onDragOver={event => event.preventDefault()}
              onDrop={dropEvent => {
                dropEvent.preventDefault();
                const calendarEvent = eventFromDrag(dropEvent.dataTransfer);
                if (!calendarEvent) return;
                const duration = Date.parse(calendarEvent.endAt) - Date.parse(calendarEvent.startAt);
                const previous = new Date(calendarEvent.startAt);
                const start = dayStartAtMinute(day, previous.getHours() * 60 + previous.getMinutes());
                onMoveEvent(calendarEvent, start.toISOString(), new Date(start.getTime() + duration).toISOString());
              }}
            >
              {hiddenAllDayByColumn[column] > 0 && (
                <button
                  type="button"
                  onClick={() => onOpenDay(day)}
                  className={`absolute bottom-0.5 right-1 z-10 h-6 rounded px-1 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:text-[var(--text-primary)] ${CAL_FOCUS}`}
                >
                  +{hiddenAllDayByColumn[column]} more
                </button>
              )}
            </div>
          ))}
          {allDaySpans.filter(span => span.lane < ALL_DAY_LANES).map(span => {
            const calendar = calendarById.get(`${span.event.accountId}:${span.event.calendarId}`);
            return (
              <div
                key={calendarEventKey(span.event)}
                className="z-10 px-0.5"
                style={{ gridColumn: `${span.startColumn + 2} / ${span.endColumn + 3}`, gridRow: 1, marginTop: `${3 + span.lane * LANE_HEIGHT}px`, alignSelf: 'start' }}
              >
                <CalendarEventChip
                  event={span.event}
                  calendar={calendar}
                  selected={calendarEventKey(span.event) === selectedEventKey}
                  continuesBefore={!calendarEventStartsIn(span.event, days[span.startColumn])}
                  continuesAfter={!calendarEventEndsIn(span.event, days[span.endColumn])}
                  onSelect={onSelectEvent}
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: columns, height: `${24 * HOUR_HEIGHT}px` }}>
        <div className="relative border-r border-[var(--border)]" aria-hidden="true">
          {Array.from({ length: 24 }, (_, hour) => hour === 0 ? null : (
            <div key={hour} className="absolute right-1.5 -translate-y-1/2 text-[calc(11px*var(--font-scale))] tabular-nums text-[var(--text-tertiary)]" style={{ top: `${hour * HOUR_HEIGHT}px` }}>
              {String(hour).padStart(2, '0')}:00
            </div>
          ))}
        </div>
        {days.map(day => {
          const positioned = layoutTimedEventsForDay(timedEvents, day, { hourHeight: HOUR_HEIGHT, minHeight: MIN_BLOCK_HEIGHT });
          const isToday = sameDay(day, today);
          const isWorkingDay = workingDays.includes(day.getDay());
          return (
            <div
              key={day.toISOString()}
              className="relative min-w-0 border-r border-[var(--border)] bg-[var(--app-bg)]"
              aria-label={`${spokenDayLabel(day)}, ${positioned.length} timed ${positioned.length === 1 ? 'event' : 'events'}`}
              role="group"
              onDoubleClick={mouseEvent => {
                const rect = mouseEvent.currentTarget.getBoundingClientRect();
                const start = dayStartAtMinute(day, minuteAtOffset(mouseEvent.clientY - rect.top, HOUR_HEIGHT));
                onCreateRange(start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString());
              }}
              onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
              onDrop={dropEvent => {
                dropEvent.preventDefault();
                const calendarEvent = eventFromDrag(dropEvent.dataTransfer);
                if (!calendarEvent) return;
                const rect = dropEvent.currentTarget.getBoundingClientRect();
                const start = dayStartAtMinute(day, minuteAtOffset(dropEvent.clientY - rect.top, HOUR_HEIGHT));
                const duration = Math.max(15 * 60_000, Date.parse(calendarEvent.endAt) - Date.parse(calendarEvent.startAt));
                onMoveEvent(calendarEvent, start.toISOString(), new Date(start.getTime() + duration).toISOString());
              }}
            >
              {/* Hours outside the working day are shaded; whole non-working days too. */}
              {isWorkingDay ? (
                <>
                  <div className="pointer-events-none absolute inset-x-0 top-0 bg-[var(--hover-row)]" style={{ height: `${(workingRange.start / 60) * HOUR_HEIGHT}px` }} />
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[var(--hover-row)]" style={{ top: `${(workingRange.end / 60) * HOUR_HEIGHT}px` }} />
                </>
              ) : <div className="pointer-events-none absolute inset-0 bg-[var(--hover-row)]" />}
              {Array.from({ length: 24 }, (_, hour) => (
                <div key={hour} className="pointer-events-none absolute inset-x-0 border-t border-[var(--border)]" style={{ top: `${hour * HOUR_HEIGHT}px` }} />
              ))}
              {isToday && (
                <div className="pointer-events-none absolute inset-x-0 z-20 border-t-2 border-[var(--danger-solid)]" style={{ top: `${(nowMinutes / 60) * HOUR_HEIGHT}px` }} aria-hidden="true">
                  <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-[var(--danger-solid)]" />
                </div>
              )}
              {positioned.map(item => {
                const calendar = calendarById.get(`${item.event.accountId}:${item.event.calendarId}`);
                const key = calendarEventKey(item.event);
                return (
                  <div
                    key={key}
                    className="group absolute z-10"
                    style={{
                      top: `${item.top}px`,
                      height: `${item.height}px`,
                      left: `calc(${(item.column / item.columns) * 100}% + 1px)`,
                      width: `calc(${100 / item.columns}% - 3px)`,
                    }}
                  >
                    <CalendarEventChip
                      event={item.event}
                      calendar={calendar}
                      variant="block"
                      twoLines={timedBlockHasTwoLines(item.height, LINE_HEIGHT)}
                      selected={key === selectedEventKey}
                      continuesBefore={false}
                      continuesAfter={false}
                      onSelect={onSelectEvent}
                    />
                    {calendarEventIsWritable(calendar) && !item.continuesAfter && (
                      <div
                        role="separator"
                        aria-label={`Resize ${item.event.summary}`}
                        aria-orientation="horizontal"
                        title="Drag to change the end time in 15-minute steps"
                        onPointerDown={pointerEvent => resizePointerDown(pointerEvent, item.event)}
                        onPointerMove={resizePointerMove}
                        onPointerUp={pointerEvent => finishResize(pointerEvent, true)}
                        onPointerCancel={pointerEvent => finishResize(pointerEvent, false)}
                        onDoubleClick={clickEvent => clickEvent.stopPropagation()}
                        className="absolute inset-x-1 bottom-0 z-20 h-1.5 cursor-ns-resize touch-none rounded-b opacity-0 transition-opacity group-hover:bg-[var(--strong-border)] group-hover:opacity-100 motion-reduce:transition-none"
                      />
                    )}
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

function eventStartDate(event: CalendarEvent): Date {
  return event.isAllDay && event.startDate ? new Date(`${event.startDate}T00:00:00`) : new Date(event.startAt);
}

function eventEndExclusive(event: CalendarEvent): Date {
  return event.isAllDay && event.endDate ? new Date(`${event.endDate}T00:00:00`) : new Date(event.endAt);
}

/** The event begins on `day` (not before it). */
export function calendarEventStartsIn(event: CalendarEvent, day: Date | undefined): boolean {
  if (!day) return true;
  return eventStartDate(event) >= startOfCalendarDay(day);
}

/** The event ends on `day` (not after it). */
export function calendarEventEndsIn(event: CalendarEvent, day: Date | undefined): boolean {
  if (!day) return true;
  return eventEndExclusive(event) <= addCalendarDays(startOfCalendarDay(day), 1);
}
