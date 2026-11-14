// Date / time formatting helpers ported from the Swift `DateFormatting` enum
// (PersonalMailClient/Support/DateFormatting.swift).
//
// This module lives in the dependency-free `shared/` layer and is imported by
// both the Electron main process and the React renderer. It must stay pure:
// only standard JS/TS + `Intl` are allowed here.
//
// The reference Swift code relied on `DateFormatter` with the user's current
// locale. To keep output stable and matching the documented examples
// ("Jun 26, 2026 at 3:42 PM"), formatting here is pinned to the `en-US` locale
// while still rendering in the host's local time zone (mirroring
// `Calendar.current` / `DateFormatter` behavior on the original macOS app).

const LOCALE = 'en-US';

// Swift `listTimestampFormatter`: dateFormat = "MMM d" -> short month + day.
const LIST_DATE = new Intl.DateTimeFormat(LOCALE, { month: 'short', day: 'numeric' });
// Swift `listTimestampFormatter`: "HH:mm" -> 24h, zero-padded. `h23` keeps
// midnight as "00" instead of the "24" some locales emit with hour12:false.
const LIST_TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });

// Swift `messageHeaderFormatter`: dateStyle = .medium -> "MMM d, yyyy".
const HEADER_DATE = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });
// One time format for the whole app: 24-hour, zero-padded ("14:30").
const HEADER_TIME = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
const WEEKDAY = new Intl.DateTimeFormat(LOCALE, { weekday: 'short' });

// Short date used as the fallback once a timestamp is older than the relative
// window (e.g. "Jun 26, 2026").
const SHORT_DATE = new Intl.DateTimeFormat(LOCALE, { year: 'numeric', month: 'short', day: 'numeric' });

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

function parse(iso: string): Date {
  return new Date(iso);
}

/**
 * List/cell timestamp, e.g. "Jun 26, 14:30".
 * Ports `DateFormatting.listTimestamp` ("MMM d, HH:mm", 24h zero-padded).
 *
 * `now` is accepted for signature symmetry with the other helpers but does not
 * affect the output (the Swift formatter renders an absolute timestamp).
 */
export function listTimestamp(iso: string, _now: Date = new Date()): string {
  const date = parse(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${LIST_DATE.format(date)}, ${LIST_TIME.format(date)}`;
}

/**
 * The same moment for a row too narrow for the full form: "14:30" today,
 * "Nov 12" on another day of this year, "Nov 12, 2025" otherwise. The full
 * timestamp stays in the row's tooltip and accessible name.
 */
export function listTimestampCompact(iso: string, now: Date = new Date()): string {
  const date = parse(iso);
  if (Number.isNaN(date.getTime())) return '';
  const sameDay = date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate();
  if (sameDay) return LIST_TIME.format(date);
  return date.getFullYear() === now.getFullYear() ? LIST_DATE.format(date) : SHORT_DATE.format(date);
}

/** Message-header / reminder timestamp, e.g. "Jun 26, 2026, 15:42". */
export function messageHeaderDate(iso: string): string {
  const date = parse(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${HEADER_DATE.format(date)}, ${HEADER_TIME.format(date)}`;
}

// --- The app's date and time vocabulary ------------------------------------------
// Every screen (mail, invitations, calendar, settings) formats through these,
// so one moment never reads two different ways. Always 24-hour, month before
// day, year only when it is not the current one.

export type DateInput = Date | string | number;

function toDate(value: DateInput): Date | null {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** "14:30" */
export function formatTime(value: DateInput): string {
  const date = toDate(value);
  return date ? LIST_TIME.format(date) : '';
}

/** "Nov 12", or "Nov 12, 2025" when the year is not the current one. */
export function formatDay(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '';
  return date.getFullYear() === now.getFullYear() ? LIST_DATE.format(date) : HEADER_DATE.format(date);
}

/** "Thu, Nov 12" (with the year when it is not the current one). */
export function formatWeekdayDay(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  return date ? `${WEEKDAY.format(date)}, ${formatDay(date, now)}` : '';
}

/** "Nov 12, 14:30" (with the year when it is not the current one). */
export function formatDateTime(value: DateInput, now: Date = new Date()): string {
  const date = toDate(value);
  return date ? `${formatDay(date, now)}, ${LIST_TIME.format(date)}` : '';
}

/** "Thu, Nov 12, 2026, 14:30": the unambiguous form for headers and details. */
export function formatFullDateTime(value: DateInput): string {
  const date = toDate(value);
  return date ? `${WEEKDAY.format(date)}, ${HEADER_DATE.format(date)}, ${LIST_TIME.format(date)}` : '';
}

/** "14:00–14:45", or "Nov 12, 22:00 – Nov 13, 01:00" when the range crosses midnight. */
export function formatTimeRange(start: DateInput, end: DateInput, now: Date = new Date()): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from) return '';
  if (!to) return LIST_TIME.format(from);
  if (sameDay(from, to)) return `${LIST_TIME.format(from)}\u2013${LIST_TIME.format(to)}`;
  return `${formatDateTime(from, now)} \u2013 ${formatDateTime(to, now)}`;
}

/** "Thu, Nov 12, 14:00–14:45": a whole event on one line. */
export function formatEventWhen(start: DateInput, end: DateInput, now: Date = new Date()): string {
  const from = toDate(start);
  const to = toDate(end);
  if (!from) return '';
  if (!to || sameDay(from, to)) return `${formatWeekdayDay(from, now)}, ${formatTimeRange(from, to ?? from, now)}`;
  return formatTimeRange(from, to, now);
}

/** "45 min", "1 h", "1 h 30 min" */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Coarse relative time: "just now", "5m ago", "2h ago", "3d ago", then falls
 * back to a short absolute date ("Jun 26, 2026") once older than a week.
 * Future timestamps collapse to "just now".
 */
export function relativeTime(iso: string, now: Date = new Date()): string {
  const date = parse(iso);
  if (Number.isNaN(date.getTime())) return '';

  const diff = now.getTime() - date.getTime();
  if (diff < MINUTE_MS) return 'just now';
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)}m ago`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)}h ago`;
  if (diff < WEEK_MS) return `${Math.floor(diff / DAY_MS)}d ago`;
  return SHORT_DATE.format(date);
}
