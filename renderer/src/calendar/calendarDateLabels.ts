// Calendar wording for dates and times, built on the app's shared vocabulary
// (`shared/dateFormat.ts`): 24-hour, month before day, year only when it is not
// the current one. The few pieces the shared module has no helper for (month
// names, weekday initials, header ranges) are formatted here with the same
// pinned `en-US` locale, so nothing depends on the system locale.
import type { CalendarEvent, CalendarInvite, CalendarWorkspaceView } from '../../../shared/types';
import { formatDay, formatEventWhen, formatTime, formatTimeRange, formatWeekdayDay } from '../../../shared/dateFormat';
import { addCalendarDays, startOfCalendarWeek } from '../../../shared/calendarWorkspace';

const LOCALE = 'en-US';
const MONTH_LONG = new Intl.DateTimeFormat(LOCALE, { month: 'long' });
const MONTH_SHORT = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
const WEEKDAY_SHORT = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });
const LONG_DAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

/** "November" */
export function monthName(date: Date): string {
  return MONTH_LONG.format(date);
}

/** "November 2026" */
export function monthYearLabel(date: Date): string {
  return `${MONTH_LONG.format(date)} ${date.getFullYear()}`;
}

/** "Mon" */
export function weekdayShort(date: Date): string {
  return WEEKDAY_SHORT.format(date);
}

/** "Thursday, November 12, 2026": for screen readers only. */
export function spokenDayLabel(date: Date): string {
  return LONG_DAY.format(date);
}

/** Weekday initials in display order ("M T W T F S S" when weeks start on Monday). */
export function weekdayInitials(weekStartsOn: 0 | 1): string[] {
  return weekdayOrder(weekStartsOn).map(day => WEEKDAY_SHORT.format(new Date(2026, 0, 4 + day)).slice(0, 1));
}

/** Weekday names ("Mon" …) in display order. */
export function weekdayShortNames(weekStartsOn: 0 | 1): string[] {
  return weekdayOrder(weekStartsOn).map(day => WEEKDAY_SHORT.format(new Date(2026, 0, 4 + day)));
}

/** JS weekday numbers (0 = Sunday) in display order. */
export function weekdayOrder(weekStartsOn: 0 | 1): number[] {
  return Array.from({ length: 7 }, (_, index) => (index + weekStartsOn) % 7);
}

/** "Nov 12, 2026" (always with the year). */
function dayWithYear(date: Date): string {
  return `${MONTH_SHORT.format(date)} ${date.getDate()}, ${date.getFullYear()}`;
}

/** "Nov 9 – 15, 2026", "Nov 30 – Dec 6, 2026", "Dec 28, 2026 – Jan 3, 2027". */
export function dayRangeLabel(start: Date, end: Date): string {
  if (start.getFullYear() !== end.getFullYear()) return `${dayWithYear(start)} – ${dayWithYear(end)}`;
  if (start.getMonth() !== end.getMonth()) {
    return `${MONTH_SHORT.format(start)} ${start.getDate()} – ${MONTH_SHORT.format(end)} ${end.getDate()}, ${end.getFullYear()}`;
  }
  return `${MONTH_SHORT.format(start)} ${start.getDate()} – ${end.getDate()}, ${end.getFullYear()}`;
}

/** Title of the calendar header for the current view. */
export function calendarHeaderTitle(anchor: Date, view: CalendarWorkspaceView, weekStartsOn: 0 | 1 = 1): string {
  switch (view) {
    case 'day':
      return `${WEEKDAY_SHORT.format(anchor)}, ${dayWithYear(anchor)}`;
    case 'week': {
      const start = startOfCalendarWeek(anchor, weekStartsOn);
      return dayRangeLabel(start, addCalendarDays(start, 6));
    }
    case 'agenda':
      return dayRangeLabel(anchor, addCalendarDays(anchor, 30));
    case 'quarter':
      return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()}`;
    case 'year':
      return String(anchor.getFullYear());
    case 'month':
    default:
      return monthYearLabel(anchor);
  }
}

function dateOnly(value: string | null | undefined, fallbackIso: string): Date {
  if (value && /^\d{4}-\d{2}-\d{2}$/.test(value)) return new Date(`${value}T00:00:00`);
  return new Date(fallbackIso);
}

/**
 * All-day range; `endDate` is exclusive as in Google Calendar.
 * "Thu, Nov 12 · All day", "Thu, Nov 12 – Sat, Nov 14 · All day".
 */
export function allDayRangeLabel(
  range: { startAt: string; endAt: string; startDate?: string | null; endDate?: string | null },
  now: Date = new Date(),
): string {
  const start = dateOnly(range.startDate, range.startAt);
  const endExclusive = dateOnly(range.endDate, range.endAt);
  const lastDay = new Date(endExclusive.getTime() - 1);
  if (!Number.isFinite(lastDay.getTime()) || lastDay <= start || sameDay(start, lastDay)) {
    return `${formatWeekdayDay(start, now)} · All day`;
  }
  return `${formatWeekdayDay(start, now)} – ${formatWeekdayDay(lastDay, now)} · All day`;
}

/** Short time of an event for chips and lists: "14:00–14:45", "All day". */
export function calendarEventTimeLabel(event: Pick<CalendarEvent, 'isAllDay' | 'startAt' | 'endAt'>, now: Date = new Date()): string {
  if (event.isAllDay) return 'All day';
  return formatTimeRange(event.startAt, event.endAt, now);
}

/** The whole "when" of an event on one line: "Thu, Nov 12, 14:00–14:45". */
export function calendarEventWhenLabel(
  event: Pick<CalendarEvent | CalendarInvite, 'isAllDay' | 'startAt' | 'endAt' | 'startDate' | 'endDate'>,
  now: Date = new Date(),
): string {
  if (event.isAllDay) return allDayRangeLabel(event, now);
  return formatEventWhen(event.startAt, event.endAt, now);
}

/** Device time zone, e.g. "Europe/Berlin". */
export function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** "London" from "Europe/London", "New York" from "America/New_York". */
export function timeZoneCityName(timeZone: string): string {
  return timeZone.split('/').pop()?.replaceAll('_', ' ') || timeZone;
}

function timeInZone(iso: string, timeZone: string): string | null {
  try {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return null;
    return new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone }).format(date);
  } catch {
    return null;
  }
}

/**
 * When an event was planned in another time zone whose clock differs from
 * this device's, the time there: "14:00–14:45 in London". Otherwise null.
 */
export function calendarEventTimeZoneNote(
  event: Pick<CalendarEvent, 'isAllDay' | 'startAt' | 'endAt' | 'timeZone'>,
  deviceTimeZone: string = localTimeZone(),
): string | null {
  const zone = event.timeZone?.trim();
  if (!zone || event.isAllDay || zone === deviceTimeZone) return null;
  const startThere = timeInZone(event.startAt, zone);
  const endThere = timeInZone(event.endAt, zone);
  const startHere = timeInZone(event.startAt, deviceTimeZone);
  const endHere = timeInZone(event.endAt, deviceTimeZone);
  if (!startThere || !endThere || !startHere || !endHere) return null;
  if (startThere === startHere && endThere === endHere) return null;
  return `${startThere}–${endThere} in ${timeZoneCityName(zone)}`;
}

/** "14:30 London" for the header's second clock; null when the zone is unknown. */
export function secondaryClockLabel(timeZone: string, now: Date = new Date()): string | null {
  if (!timeZone) return null;
  const time = timeInZone(now.toISOString(), timeZone);
  return time ? `${time} ${timeZoneCityName(timeZone)}` : null;
}

/** "Nov 12" / "Nov 12, 2025". */
export function shortDayLabel(date: Date, now: Date = new Date()): string {
  return formatDay(date, now);
}

/** "14:30" */
export function clockLabel(value: Date | string): string {
  return formatTime(value);
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}
