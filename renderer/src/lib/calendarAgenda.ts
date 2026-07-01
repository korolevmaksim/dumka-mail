import type { CalendarEvent } from '../../../shared/types';

type LocaleArg = string | string[] | undefined;

export function agendaEventTime(event: CalendarEvent, locale?: LocaleArg): string {
  if (event.isAllDay) return 'All day';
  const start = new Date(event.startAt);
  const end = new Date(event.endAt);
  return `${start.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' })}`;
}

export function upcomingAgendaDateTimeLabel(event: CalendarEvent, locale?: LocaleArg): string {
  const start = new Date(event.startAt);
  const day = start.toLocaleDateString(locale, { weekday: 'short', month: 'short', day: 'numeric' });
  return `${day} · ${agendaEventTime(event, locale)}`;
}
