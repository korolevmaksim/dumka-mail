import { reminderDate } from './reminders';

interface ClockTime {
  hours: number;
  minutes: number;
}

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const DEFAULT_REMINDER_HOUR = 9;

const WEEKDAYS: Record<string, number> = {
  sun: 0,
  sunday: 0,
  mon: 1,
  monday: 1,
  tue: 2,
  tues: 2,
  tuesday: 2,
  wed: 3,
  wednesday: 3,
  thu: 4,
  thur: 4,
  thurs: 4,
  thursday: 4,
  fri: 5,
  friday: 5,
  sat: 6,
  saturday: 6,
};

const MONTHS: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

function normalizeReminderInput(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[,.]/g, ' ')
    .replace(/\bat\b/g, ' ')
    .replace(/\s+/g, ' ');
}

function futureOrNull(date: Date, now: Date): Date | null {
  return date.getTime() > now.getTime() ? date : null;
}

function dateFromParts(year: number, month: number, day: number, time: ClockTime): Date | null {
  const date = new Date(year, month, day, time.hours, time.minutes, 0, 0);
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month ||
    date.getDate() !== day ||
    date.getHours() !== time.hours ||
    date.getMinutes() !== time.minutes
  ) {
    return null;
  }
  return date;
}

function setLocalTime(date: Date, time: ClockTime): Date {
  const next = new Date(date.getTime());
  next.setHours(time.hours, time.minutes, 0, 0);
  return next;
}

function defaultClockTime(): ClockTime {
  return { hours: DEFAULT_REMINDER_HOUR, minutes: 0 };
}

function parseClockTime(text: string, allowBareHour = false): ClockTime | null {
  const amPmMatch = /\b(1[0-2]|0?[1-9])(?::([0-5]\d))?\s*(a|am|p|pm)\b/.exec(text);
  if (amPmMatch) {
    const suffix = amPmMatch[3].startsWith('p') ? 'pm' : 'am';
    let hours = Number(amPmMatch[1]) % 12;
    if (suffix === 'pm') hours += 12;
    return { hours, minutes: amPmMatch[2] ? Number(amPmMatch[2]) : 0 };
  }

  const twentyFourHourMatch = /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(text);
  if (twentyFourHourMatch) {
    return { hours: Number(twentyFourHourMatch[1]), minutes: Number(twentyFourHourMatch[2]) };
  }

  if (!allowBareHour) return null;

  const bareHourMatch = /^\s*([01]?\d|2[0-3])\s*$/.exec(text);
  if (!bareHourMatch) return null;
  return { hours: Number(bareHourMatch[1]), minutes: 0 };
}

function nextTodayOrTomorrowAt(now: Date, time: ClockTime): Date {
  const candidate = setLocalTime(now, time);
  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 1);
  }
  return candidate;
}

function addDaysAt(now: Date, days: number, time: ClockTime): Date {
  const candidate = new Date(now.getTime());
  candidate.setDate(candidate.getDate() + days);
  candidate.setHours(time.hours, time.minutes, 0, 0);
  return candidate;
}

function parseRelativeReminder(text: string, now: Date): Date | null {
  const match = /^(?:in\s+)?(\d{1,3})\s*(m|min|mins|minute|minutes|h|hr|hrs|hour|hours|d|day|days|w|week|weeks)$/.exec(text);
  if (!match) return null;

  const amount = Number(match[1]);
  const unit = match[2];
  if (!Number.isFinite(amount) || amount <= 0) return null;

  if (unit.startsWith('m')) return new Date(now.getTime() + amount * MINUTE_MS);
  if (unit.startsWith('h')) return new Date(now.getTime() + amount * HOUR_MS);
  if (unit.startsWith('d')) return new Date(now.getTime() + amount * DAY_MS);
  return new Date(now.getTime() + amount * 7 * DAY_MS);
}

function parseTodayTomorrowReminder(text: string, now: Date): Date | null {
  const todayMatch = /^today(?:\s+(.*))?$/.exec(text);
  if (todayMatch) {
    const timeText = todayMatch[1]?.trim() || '';
    if (!timeText) return reminderDate('laterToday', now);
    const time = parseClockTime(timeText, true);
    return time ? futureOrNull(setLocalTime(now, time), now) : null;
  }

  const tomorrowMatch = /^(tomorrow|tmrw)(?:\s+(.*))?$/.exec(text);
  if (tomorrowMatch) {
    const time = parseClockTime(tomorrowMatch[2]?.trim() || '', true) || defaultClockTime();
    return addDaysAt(now, 1, time);
  }

  return null;
}

function parseWeekdayReminder(text: string, now: Date): Date | null {
  const weekdayNames = Object.keys(WEEKDAYS).join('|');
  const match = new RegExp(`^(next\\s+)?(${weekdayNames})(?:\\s+(.*))?$`).exec(text);
  if (!match) return null;

  const forceNextWeek = Boolean(match[1]);
  const targetDow = WEEKDAYS[match[2]];
  const time = parseClockTime(match[3]?.trim() || '', true) || defaultClockTime();
  const candidate = setLocalTime(now, time);

  let daysAhead = (targetDow - now.getDay() + 7) % 7;
  if (forceNextWeek && daysAhead === 0) daysAhead = 7;
  candidate.setDate(candidate.getDate() + daysAhead);

  if (candidate.getTime() <= now.getTime()) {
    candidate.setDate(candidate.getDate() + 7);
  }

  return candidate;
}

function parseMonthDayReminder(text: string, now: Date): Date | null {
  const monthNames = Object.keys(MONTHS).join('|');
  const match = new RegExp(`^(${monthNames})\\s+(\\d{1,2})(?:\\s+(\\d{4}))?(?:\\s+(.*))?$`).exec(text);
  if (!match) return null;

  const month = MONTHS[match[1]];
  const day = Number(match[2]);
  const explicitYear = match[3] ? Number(match[3]) : null;
  const time = parseClockTime(match[4]?.trim() || '', false) || defaultClockTime();
  const year = explicitYear ?? now.getFullYear();
  let candidate = dateFromParts(year, month, day, time);
  if (!candidate) return null;

  if (!explicitYear && candidate.getTime() <= now.getTime()) {
    candidate = dateFromParts(year + 1, month, day, time);
  }

  return candidate ? futureOrNull(candidate, now) : null;
}

function parseNumericDateReminder(text: string, now: Date): Date | null {
  const isoMatch = /^(\d{4})-(\d{1,2})-(\d{1,2})(?:\s+(.*))?$/.exec(text);
  if (isoMatch) {
    const time = parseClockTime(isoMatch[4]?.trim() || '', false) || defaultClockTime();
    const candidate = dateFromParts(Number(isoMatch[1]), Number(isoMatch[2]) - 1, Number(isoMatch[3]), time);
    return candidate ? futureOrNull(candidate, now) : null;
  }

  const slashMatch = /^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?:\s+(.*))?$/.exec(text);
  if (!slashMatch) return null;

  const month = Number(slashMatch[1]) - 1;
  const day = Number(slashMatch[2]);
  const rawYear = slashMatch[3] ? Number(slashMatch[3]) : null;
  const explicitYear = rawYear === null ? null : rawYear < 100 ? 2000 + rawYear : rawYear;
  const year = explicitYear ?? now.getFullYear();
  const time = parseClockTime(slashMatch[4]?.trim() || '', false) || defaultClockTime();
  let candidate = dateFromParts(year, month, day, time);
  if (!candidate) return null;

  if (!explicitYear && candidate.getTime() <= now.getTime()) {
    candidate = dateFromParts(year + 1, month, day, time);
  }

  return candidate ? futureOrNull(candidate, now) : null;
}

/**
 * Parses compact keyboard-first reminder text without a natural-language date
 * dependency. Supported examples: "tomorrow 9am", "fri 14:30",
 * "jul 12 10am", "2026-07-04 09:00", "in 2h", or "5pm".
 */
export function parseReminderInput(input: string, now: Date = new Date()): Date | null {
  const text = normalizeReminderInput(input);
  if (!text) return null;

  if (text === 'later' || text === 'later today') return reminderDate('laterToday', now);
  if (text === 'next week') return reminderDate('nextWeek', now);
  if (text === 'weekend' || text === 'this weekend') return reminderDate('thisWeekend', now);

  const eveningMatch = /^(tonight|evening|this evening)(?:\s+(.*))?$/.exec(text);
  if (eveningMatch) {
    const time = parseClockTime(eveningMatch[2]?.trim() || '', true) || { hours: 18, minutes: 0 };
    return nextTodayOrTomorrowAt(now, time);
  }

  const relative = parseRelativeReminder(text, now);
  if (relative) return relative;

  const todayTomorrow = parseTodayTomorrowReminder(text, now);
  if (todayTomorrow) return todayTomorrow;

  const weekday = parseWeekdayReminder(text, now);
  if (weekday) return weekday;

  const monthDay = parseMonthDayReminder(text, now);
  if (monthDay) return monthDay;

  const numericDate = parseNumericDateReminder(text, now);
  if (numericDate) return numericDate;

  const timeOnly = parseClockTime(text, true);
  return timeOnly ? nextTodayOrTomorrowAt(now, timeOnly) : null;
}
