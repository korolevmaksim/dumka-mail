import type { CalendarEvent } from '../../../shared/types';
import { formatTimeRange, formatWeekdayDay } from '../../../shared/dateFormat';

/** "14:00–14:45", or "All day". Uses the app's shared 24-hour vocabulary. */
export function agendaEventTime(event: CalendarEvent, now: Date = new Date()): string {
  if (event.isAllDay) return 'All day';
  return formatTimeRange(event.startAt, event.endAt, now);
}

/** "Thu, Nov 12 · 14:00–14:45" */
export function upcomingAgendaDateTimeLabel(event: CalendarEvent, now: Date = new Date()): string {
  const start = event.isAllDay && event.startDate ? new Date(`${event.startDate}T00:00:00`) : new Date(event.startAt);
  return `${formatWeekdayDay(start, now)} · ${agendaEventTime(event, now)}`;
}
