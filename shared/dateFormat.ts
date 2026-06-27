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
// Swift `messageHeaderFormatter`: timeStyle = .short -> "h:mm a".
const HEADER_TIME = new Intl.DateTimeFormat(LOCALE, { hour: 'numeric', minute: '2-digit', hour12: true });

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
 * Message-header / reminder timestamp, e.g. "Jun 26, 2026 at 3:42 PM".
 * Ports `DateFormatting.messageHeader` (medium date + short time). The " at "
 * separator mirrors Apple's `DateFormatter` medium+short rendering.
 */
export function messageHeaderDate(iso: string): string {
  const date = parse(iso);
  if (Number.isNaN(date.getTime())) return '';
  return `${HEADER_DATE.format(date)} at ${HEADER_TIME.format(date)}`;
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
