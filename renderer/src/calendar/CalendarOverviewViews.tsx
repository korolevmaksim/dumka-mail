import { useMemo } from 'react';
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';
import { addCalendarDays, calendarDateKey, calendarEventsForDate, calendarMonthDays, startOfCalendarDay } from '../../../shared/calendarWorkspace';
import { formatDay } from '../../../shared/dateFormat';
import { CalendarEventChip } from './CalendarEventChip';
import { calendarEventKey } from './calendarTimeLayout';
import { monthYearLabel, spokenDayLabel, weekdayInitials, weekdayShort } from './calendarDateLabels';
import { CAL_BUTTON, CAL_FOCUS } from './calendarUi';

interface CalendarAgendaViewProps {
  anchor: Date;
  events: CalendarEvent[];
  calendars: CalendarListEntry[];
  selectedEventKey: string | null;
  onSelectDate: (date: Date) => void;
  onSelectEvent: (event: CalendarEvent) => void;
  onCreate: (date: Date) => void;
}

export function CalendarAgendaView({ anchor, events, calendars, selectedEventKey, onSelectDate, onSelectEvent, onCreate }: CalendarAgendaViewProps) {
  const calendarById = useMemo(() => new Map(calendars.map(calendar => [`${calendar.accountId}:${calendar.id}`, calendar])), [calendars]);
  const days = useMemo(() => Array.from({ length: 31 }, (_, index) => addCalendarDays(startOfCalendarDay(anchor), index)), [anchor]);
  const populated = days.map(date => ({ date, events: calendarEventsForDate(events, date) })).filter(item => item.events.length > 0);
  const now = new Date();
  if (populated.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-[calc(13px*var(--font-scale))] font-medium text-[var(--text-primary)]">Nothing in the next 31 days</p>
        <button type="button" onClick={() => onCreate(anchor)} className={CAL_BUTTON}>New event</button>
      </div>
    );
  }
  return (
    <div className="h-full overflow-y-auto px-6 py-2">
      <ul className="mx-auto flex max-w-[880px] flex-col" aria-label="Upcoming events">
        {populated.map(({ date, events: dayEvents }) => {
          const isToday = calendarDateKey(date) === calendarDateKey(now);
          return (
            <li key={calendarDateKey(date)} className="grid grid-cols-[96px_minmax(0,1fr)] gap-3 border-b border-[var(--border)] py-3">
              <button type="button" onClick={() => onSelectDate(date)} aria-label={`${spokenDayLabel(date)}${isToday ? ', today' : ''}`} className={`h-fit rounded px-1 py-0.5 text-left ${CAL_FOCUS}`}>
                <span className={`block text-[calc(11px*var(--font-scale))] font-medium ${isToday ? 'text-[var(--accent-ink)]' : 'text-[var(--text-secondary)]'}`}>{isToday ? 'Today' : weekdayShort(date)}</span>
                <span className="block text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{formatDay(date, now)}</span>
              </button>
              <div className="flex min-w-0 flex-col gap-1">
                {dayEvents.map(event => (
                  <CalendarEventChip
                    key={calendarEventKey(event)}
                    event={event}
                    calendar={calendarById.get(`${event.accountId}:${event.calendarId}`)}
                    variant="row"
                    selected={calendarEventKey(event) === selectedEventKey}
                    draggable={false}
                    onSelect={onSelectEvent}
                  />
                ))}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface CalendarOverviewProps {
  anchor: Date;
  events: CalendarEvent[];
  mode: 'quarter' | 'year';
  weekStartsOn: 0 | 1;
  onSelectDate: (date: Date) => void;
  onCreate: (date: Date) => void;
}

export function CalendarOverviewView({ anchor, events, mode, weekStartsOn, onSelectDate, onCreate }: CalendarOverviewProps) {
  const startMonth = mode === 'quarter' ? Math.floor(anchor.getMonth() / 3) * 3 : 0;
  const count = mode === 'quarter' ? 3 : 12;
  const months = Array.from({ length: count }, (_, index) => new Date(anchor.getFullYear(), startMonth + index, 1));
  const initials = weekdayInitials(weekStartsOn);
  return (
    <div className={`grid h-full auto-rows-max content-start items-start gap-4 overflow-y-auto p-5 ${mode === 'quarter' ? 'grid-cols-[repeat(auto-fit,minmax(240px,1fr))]' : 'grid-cols-[repeat(auto-fill,minmax(220px,1fr))]'}`}>
      {months.map(month => {
        const days = calendarMonthDays(month, weekStartsOn);
        return (
          <section key={month.toISOString()} aria-label={monthYearLabel(month)} className="dm-panel rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <button type="button" onClick={() => onSelectDate(month)} className={`mb-2 rounded px-1 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:underline ${CAL_FOCUS}`}>
              {monthYearLabel(month)}
            </button>
            <div className="grid grid-cols-7 text-center">
              {initials.map((label, index) => <span key={`${label}-${index}`} aria-hidden="true" className="py-1 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-tertiary)]">{label}</span>)}
              {days.map(day => {
                const countForDay = calendarEventsForDate(events, day.date).length;
                return (
                  <button
                    type="button"
                    key={day.key}
                    onClick={() => onSelectDate(day.date)}
                    onDoubleClick={() => onCreate(day.date)}
                    aria-label={`${spokenDayLabel(day.date)}${day.isToday ? ', today' : ''}${countForDay > 0 ? `, ${countForDay} ${countForDay === 1 ? 'event' : 'events'}` : ''}`}
                    aria-current={day.isToday ? 'date' : undefined}
                    className={`relative mx-auto flex h-7 w-7 items-center justify-center rounded-full text-[calc(11px*var(--font-scale))] tabular-nums ${CAL_FOCUS} ${
                      day.isToday
                        ? 'bg-[var(--accent-fill)] font-semibold text-[var(--on-accent)]'
                        : day.inMonth ? 'text-[var(--text-primary)] hover:bg-[var(--hover-row)]' : 'text-[var(--text-tertiary)] hover:bg-[var(--hover-row)]'
                    } ${!day.inMonth ? 'invisible' : ''}`}
                  >
                    {day.date.getDate()}
                    {countForDay > 0 && !day.isToday && <span aria-hidden="true" className="absolute bottom-0.5 h-1 w-1 rounded-full bg-[var(--accent-ink)]" />}
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
