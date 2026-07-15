import { useMemo } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { addCalendarDays, calendarDateKey, calendarEventsForDate, calendarMonthDays, startOfCalendarDay } from '../../../shared/calendarWorkspace';
import { CalendarEventChip } from './CalendarEventChip';

interface CalendarAgendaViewProps {
  anchor: Date;
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreate: (date: Date) => void;
}

export function CalendarAgendaView({ anchor, events, calendars, onSelectDate, onSelectEvent, onCreate }: CalendarAgendaViewProps) {
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])), [calendars]);
  const days = useMemo(() => Array.from({ length: 31 }, (_, index) => addCalendarDays(startOfCalendarDay(anchor), index)), [anchor]);
  const populated = days.map(date => ({ date, events: calendarEventsForDate(events, date) })).filter(item => item.events.length > 0);
  return (
    <div className="h-full overflow-y-auto px-6 py-4" role="list" aria-label="Upcoming events">
      {populated.length === 0 ? (
        <div className="flex h-full flex-col items-center justify-center text-center text-[var(--text-secondary)]">
          <div className="mb-2 text-3xl opacity-40">◷</div>
          <p className="font-semibold">No events in the next 31 days</p>
          <button type="button" onClick={() => onCreate(anchor)} className="mt-3 rounded-md bg-[var(--accent)] px-3 py-2 text-white">Create event</button>
        </div>
      ) : populated.map(({ date, events: dayEvents }) => (
        <section key={calendarDateKey(date)} role="listitem" className="grid grid-cols-[120px_minmax(0,1fr)] border-b border-[var(--border)] py-4">
          <button type="button" onClick={() => onSelectDate(date)} className="text-left">
            <span className="block text-[calc(11px*var(--font-scale))] font-semibold uppercase text-[var(--text-tertiary)]">{date.toLocaleDateString([], { weekday: 'short' })}</span>
            <span className="mt-1 block text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{date.toLocaleDateString([], { month: 'short', day: 'numeric' })}</span>
          </button>
          <div className="flex flex-col gap-1.5">
            {dayEvents.map(event => (
              <CalendarEventChip key={`${event.accountId}:${event.calendarId}:${event.id}`} event={event} calendar={calendarById.get(`${event.accountId}:${event.calendarId}`)} draggable onSelect={onSelectEvent} />
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

interface CalendarOverviewProps extends Omit<CalendarAgendaViewProps, 'calendars' | 'onSelectEvent'> {
  mode: 'quarter' | 'year';
  weekStartsOn: 0 | 1;
}

export function CalendarOverviewView({ anchor, events, mode, weekStartsOn, onSelectDate, onCreate }: CalendarOverviewProps) {
  const startMonth = mode === 'quarter' ? Math.floor(anchor.getMonth() / 3) * 3 : 0;
  const count = mode === 'quarter' ? 3 : 12;
  const months = Array.from({ length: count }, (_, index) => new Date(anchor.getFullYear(), startMonth + index, 1));
  const weekdayLabels = Array.from({ length: 7 }, (_, index) => ['S', 'M', 'T', 'W', 'T', 'F', 'S'][(index + weekStartsOn) % 7]);
  return (
    <div className={`grid h-full overflow-y-auto p-5 ${mode === 'quarter' ? 'grid-cols-3 gap-5' : 'grid-cols-3 gap-4 xl:grid-cols-4'}`}>
      {months.map(month => {
        const days = calendarMonthDays(month, weekStartsOn);
        return (
          <section key={month.toISOString()} className="dm-panel min-h-[220px] rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 shadow-sm">
            <button type="button" onClick={() => onSelectDate(month)} className="mb-3 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]">
              {month.toLocaleDateString([], { month: 'long', year: 'numeric' })}
            </button>
            <div className="grid grid-cols-7 gap-0.5 text-center">
              {weekdayLabels.map((label, index) => <span key={`${label}-${index}`} className="py-1 text-[calc(8px*var(--font-scale))] font-semibold text-[var(--text-tertiary)]">{label}</span>)}
              {days.slice(0, 42).map(day => {
                const countForDay = calendarEventsForDate(events, day.date).length;
                return (
                  <button
                    type="button"
                    key={day.key}
                    onClick={() => onSelectDate(day.date)}
                    onDoubleClick={() => onCreate(day.date)}
                    className={`relative flex aspect-square items-center justify-center rounded text-[calc(9px*var(--font-scale))] ${day.inMonth ? 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)]' : 'text-[var(--text-tertiary)] opacity-30'} ${day.isToday ? 'bg-[var(--accent)] text-white' : ''}`}
                  >
                    {day.date.getDate()}
                    {countForDay > 0 && !day.isToday && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent)]" />}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}
    </div>
  );
}
