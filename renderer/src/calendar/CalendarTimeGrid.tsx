import { useEffect, useMemo, useRef, type PointerEvent as ReactPointerEvent } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { addCalendarDays, calendarEventsForDate, layoutTimedCalendarEvents, startOfCalendarDay, startOfCalendarWeek } from '../../../shared/calendarWorkspace';
import { CalendarEventChip } from './CalendarEventChip';

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
  onSelectDate: (date: Date) => void;
  onCreateRange: (startAt: string, endAt: string) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onMoveEvent: (event: CalendarEvent, startAt: string, endAt: string) => void;
  onResizeEvent: (event: CalendarEvent, endAt: string) => void;
}

const HOUR_HEIGHT = 56;

function dayLabel(date: Date): string {
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
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
  onSelectDate,
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
      .filter(day => showWeekends || (day.getDay() !== 0 && day.getDay() !== 6));
  }, [anchor, mode, showWeekends, weekStartsOn]);
  const workingRange = useMemo(() => {
    const parse = (value: string, fallback: number) => {
      const match = /^(\d{1,2}):(\d{2})$/.exec(value);
      if (!match) return fallback;
      const minutes = Number(match[1]) * 60 + Number(match[2]);
      return minutes >= 0 && minutes <= 1440 ? minutes : fallback;
    };
    const start = parse(workingHoursStart, 9 * 60);
    const end = parse(workingHoursEnd, 17 * 60);
    return end > start ? { start, end } : { start: 9 * 60, end: 17 * 60 };
  }, [workingHoursEnd, workingHoursStart]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = HOUR_HEIGHT * 7.5;
  }, [mode]);

  function eventFromDrag(dataTransfer: DataTransfer): CalendarEvent | null {
    try {
      const payload = JSON.parse(dataTransfer.getData('application/x-dumka-calendar-event')) as { accountId: string; calendarId: string; eventId: string };
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
      originalDurationMinutes: Math.max(15, Math.round((new Date(event.endAt).getTime() - new Date(event.startAt).getTime()) / 60_000)),
      container,
    };
  }

  function resizePointerMove(pointerEvent: ReactPointerEvent<HTMLDivElement>) {
    const state = resizeRef.current;
    if (!state) return;
    pointerEvent.preventDefault();
    const deltaMinutes = Math.round(((pointerEvent.clientY - state.startY) / HOUR_HEIGHT) * 60 / 15) * 15;
    const durationMinutes = Math.max(15, state.originalDurationMinutes + deltaMinutes);
    state.container.style.height = `${(durationMinutes / 60) * HOUR_HEIGHT}px`;
  }

  function finishResize(pointerEvent: ReactPointerEvent<HTMLDivElement>, apply: boolean) {
    const state = resizeRef.current;
    if (!state) return;
    pointerEvent.preventDefault();
    pointerEvent.stopPropagation();
    state.container.style.height = state.originalHeight;
    resizeRef.current = null;
    if (!apply) return;
    const deltaMinutes = Math.round(((pointerEvent.clientY - state.startY) / HOUR_HEIGHT) * 60 / 15) * 15;
    const durationMinutes = Math.max(15, state.originalDurationMinutes + deltaMinutes);
    const endAt = new Date(new Date(state.event.startAt).getTime() + durationMinutes * 60_000).toISOString();
    if (endAt !== state.event.endAt) onResizeEvent(state.event, endAt);
  }

  return (
    <div className="flex h-full min-h-0 flex-col" aria-label={`${mode} calendar`}>
      <div className="grid shrink-0 border-b border-[var(--border)] bg-[var(--panel-bg)]" style={{ gridTemplateColumns: `54px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <div className="border-r border-[var(--border)]" />
        {days.map(day => {
          const isToday = startOfCalendarDay(day).getTime() === startOfCalendarDay(new Date()).getTime();
          return (
            <button key={day.toISOString()} type="button" onClick={() => onSelectDate(day)} className={`border-r border-[var(--border)] px-2 py-2 text-center text-[calc(11px*var(--font-scale))] font-semibold ${isToday ? 'text-[var(--accent)]' : 'text-[var(--text-secondary)]'}`}>
              {dayLabel(day)}
            </button>
          );
        })}
      </div>
      <div className="grid shrink-0 border-b border-[var(--border)] bg-[var(--app-bg)]" style={{ gridTemplateColumns: `54px repeat(${days.length}, minmax(120px, 1fr))` }}>
        <div className="border-r border-[var(--border)] px-1 py-1 text-right text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">all-day</div>
        {days.map(day => (
          <div
            key={day.toISOString()}
            className="min-h-8 border-r border-[var(--border)] p-1"
            onDragOver={event => event.preventDefault()}
            onDrop={dropEvent => {
              dropEvent.preventDefault();
              const calendarEvent = eventFromDrag(dropEvent.dataTransfer);
              if (!calendarEvent) return;
              const duration = new Date(calendarEvent.endAt).getTime() - new Date(calendarEvent.startAt).getTime();
              const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), new Date(calendarEvent.startAt).getHours(), new Date(calendarEvent.startAt).getMinutes());
              onMoveEvent(calendarEvent, start.toISOString(), new Date(start.getTime() + duration).toISOString());
            }}
          >
            <div className="flex flex-col gap-0.5">
              {calendarEventsForDate(events, day).filter(event => event.isAllDay).slice(0, 3).map(event => (
                <CalendarEventChip key={`${event.accountId}:${event.calendarId}:${event.id}`} event={event} calendar={calendarById.get(`${event.accountId}:${event.calendarId}`)} compact onSelect={onSelectEvent} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto">
        <div className="grid" style={{ gridTemplateColumns: `54px repeat(${days.length}, minmax(120px, 1fr))`, height: `${24 * HOUR_HEIGHT}px` }}>
          <div className="relative border-r border-[var(--border)]">
            {Array.from({ length: 24 }, (_, hour) => (
              <div key={hour} className="absolute right-1 -translate-y-1/2 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]" style={{ top: `${hour * HOUR_HEIGHT}px` }}>
                {String(hour).padStart(2, '0')}:00
              </div>
            ))}
          </div>
          {days.map(day => {
            const positioned = layoutTimedCalendarEvents(events, day);
            const isToday = startOfCalendarDay(day).getTime() === startOfCalendarDay(new Date()).getTime();
            const isWorkingDay = workingDays.includes(day.getDay());
            const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
            return (
              <div
                key={day.toISOString()}
                className="relative border-r border-[var(--border)] bg-[var(--app-bg)]"
                onDoubleClick={mouseEvent => {
                  const rect = mouseEvent.currentTarget.getBoundingClientRect();
                  const minutes = Math.max(0, Math.min(1439, Math.round(((mouseEvent.clientY - rect.top) / rect.height) * 24 * 60 / 15) * 15));
                  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
                  onCreateRange(start.toISOString(), new Date(start.getTime() + 30 * 60_000).toISOString());
                }}
                onDragOver={event => { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; }}
                onDrop={dropEvent => {
                  dropEvent.preventDefault();
                  const calendarEvent = eventFromDrag(dropEvent.dataTransfer);
                  if (!calendarEvent) return;
                  const rect = dropEvent.currentTarget.getBoundingClientRect();
                  const minutes = Math.max(0, Math.min(1439, Math.round(((dropEvent.clientY - rect.top) / rect.height) * 24 * 60 / 15) * 15));
                  const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), Math.floor(minutes / 60), minutes % 60);
                  const duration = Math.max(15 * 60_000, new Date(calendarEvent.endAt).getTime() - new Date(calendarEvent.startAt).getTime());
                  onMoveEvent(calendarEvent, start.toISOString(), new Date(start.getTime() + duration).toISOString());
                }}
              >
                {isWorkingDay ? (
                  <div
                    className="pointer-events-none absolute left-0 right-0 bg-[var(--accent)]/[0.035]"
                    style={{ top: `${(workingRange.start / 1440) * 100}%`, height: `${((workingRange.end - workingRange.start) / 1440) * 100}%` }}
                  />
                ) : <div className="pointer-events-none absolute inset-0 bg-[var(--raised-surface)]/35" />}
                {Array.from({ length: 24 }, (_, hour) => (
                  <div key={hour} className="pointer-events-none absolute left-0 right-0 border-t border-[var(--border)]" style={{ top: `${hour * HOUR_HEIGHT}px` }} />
                ))}
                {isToday && (
                  <div className="pointer-events-none absolute left-0 right-0 z-20 border-t border-[var(--danger)]" style={{ top: `${(nowMinutes / 1440) * 100}%` }}>
                    <span className="absolute -left-1 -top-1 h-2 w-2 rounded-full bg-[var(--danger)]" />
                  </div>
                )}
                {positioned.map(item => (
                  <div
                    key={`${item.event.accountId}:${item.event.calendarId}:${item.event.id}`}
                    className="group absolute z-10 px-0.5"
                    style={{
                      top: `${item.topPercent}%`,
                      height: `${item.heightPercent}%`,
                      left: `${(item.column / item.columnCount) * 100}%`,
                      width: `${100 / item.columnCount}%`,
                    }}
                  >
                    <CalendarEventChip event={item.event} calendar={calendarById.get(`${item.event.accountId}:${item.event.calendarId}`)} draggable onSelect={onSelectEvent} />
                    {(() => {
                      const calendar = calendarById.get(`${item.event.accountId}:${item.event.calendarId}`);
                      if (calendar?.accessRole !== 'writer' && calendar?.accessRole !== 'owner') return null;
                      return (
                        <div
                          role="separator"
                          aria-label={`Resize ${item.event.summary}`}
                          aria-orientation="horizontal"
                          title="Drag to resize in 15-minute steps"
                          onPointerDown={pointerEvent => resizePointerDown(pointerEvent, item.event)}
                          onPointerMove={resizePointerMove}
                          onPointerUp={pointerEvent => finishResize(pointerEvent, true)}
                          onPointerCancel={pointerEvent => finishResize(pointerEvent, false)}
                          className="absolute bottom-0 left-1 right-1 z-20 h-2 cursor-ns-resize touch-none rounded-b opacity-0 transition-opacity hover:bg-white/50 group-hover:opacity-100"
                        />
                      );
                    })()}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
