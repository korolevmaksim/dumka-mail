import type { CalendarEvent } from './types';

export function calendarEventReminderMinutes(event: CalendarEvent, fallback: number): number {
  if (!event.reminders || event.reminders.useDefault) return Math.max(0, fallback);
  const popup = event.reminders.overrides.find(override => override.method === 'popup');
  return Math.max(0, popup?.minutes ?? fallback);
}

export function isCalendarReminderDue(event: CalendarEvent, fallbackMinutes: number, now: Date): boolean {
  if (event.isAllDay) {
    const date = event.startDate ? new Date(`${event.startDate}T09:00:00`) : new Date(event.startAt);
    if (!Number.isFinite(date.getTime())) return false;
    const endOfReminderDay = new Date(date);
    endOfReminderDay.setHours(24, 0, 0, 0);
    return date.getTime() <= now.getTime() && now.getTime() < endOfReminderDay.getTime();
  }
  const startsAt = new Date(event.startAt).getTime();
  if (!Number.isFinite(startsAt)) return false;
  const reminderAt = startsAt - calendarEventReminderMinutes(event, fallbackMinutes) * 60_000;
  return reminderAt <= now.getTime() && startsAt > now.getTime() - 5 * 60_000;
}
