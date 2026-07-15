import type { CalendarEventRecurrence } from './types';

export interface CalendarEventFormDefaults {
  date: string;
  startTime: string;
  durationMinutes: number;
}

export interface ParsedCalendarAttendees {
  emails: string[];
  invalid: string[];
}

export interface NaturalLanguageCalendarEventDraft extends CalendarEventFormDefaults {
  title: string;
  location: string | null;
  attendees: string[];
  recurrence: CalendarEventRecurrence;
  hasExplicitDate: boolean;
  hasExplicitTime: boolean;
}

const WEEKDAY_INDEX: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const RECURRENCE_RULES: Record<Exclude<CalendarEventRecurrence, 'none'>, string> = {
  daily: 'RRULE:FREQ=DAILY',
  weekly: 'RRULE:FREQ=WEEKLY',
  monthly: 'RRULE:FREQ=MONTHLY',
  yearly: 'RRULE:FREQ=YEARLY',
};

const EMAIL_PATTERN = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

function isValidCalendarTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format(new Date(0));
    return true;
  } catch {
    return false;
  }
}

export function localDateInputValue(date: Date): string {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

export function localTimeInputValue(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function roundUpLocalTime(date: Date, stepMinutes = 30): Date {
  const stepMs = Math.max(5, stepMinutes) * 60_000;
  const rounded = new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
  rounded.setSeconds(0, 0);
  return rounded;
}

export function defaultCalendarEventFormForDate(
  selectedDate: Date,
  durationMinutes: number,
  now = new Date(),
): CalendarEventFormDefaults {
  const selected = new Date(selectedDate);
  const sameDay = selected.getFullYear() === now.getFullYear()
    && selected.getMonth() === now.getMonth()
    && selected.getDate() === now.getDate();
  const start = sameDay ? roundUpLocalTime(now) : selected;
  if (!sameDay) start.setHours(9, 0, 0, 0);
  return {
    date: localDateInputValue(selected),
    startTime: localTimeInputValue(start),
    durationMinutes: Math.max(15, Math.floor(durationMinutes || 30)),
  };
}

export function calendarEventFormDefaultsFromRange(
  startAt: string,
  endAt: string,
  fallbackDurationMinutes: number,
): CalendarEventFormDefaults | null {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return null;

  const durationMinutes = Math.max(15, Math.round((endMs - startMs) / 60_000) || Math.floor(fallbackDurationMinutes || 30));
  return {
    date: localDateInputValue(start),
    startTime: localTimeInputValue(start),
    durationMinutes,
  };
}

export function calendarEventTimesFromLocalInput(
  dateValue: string,
  timeValue: string,
  durationMinutes: number,
): { startAt: string; endAt: string } | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
  if (!dateMatch || !timeMatch) return null;

  const [, year, month, day] = dateMatch;
  const [, hour, minute] = timeMatch;
  const yearNumber = Number(year);
  const monthNumber = Number(month);
  const dayNumber = Number(day);
  const hourNumber = Number(hour);
  const minuteNumber = Number(minute);
  if (
    monthNumber < 1
    || monthNumber > 12
    || dayNumber < 1
    || dayNumber > 31
    || hourNumber > 23
    || minuteNumber > 59
  ) {
    return null;
  }

  const start = new Date(yearNumber, monthNumber - 1, dayNumber, hourNumber, minuteNumber, 0, 0);
  if (!Number.isFinite(start.getTime())) return null;
  if (
    start.getFullYear() !== yearNumber
    || start.getMonth() !== monthNumber - 1
    || start.getDate() !== dayNumber
    || start.getHours() !== hourNumber
    || start.getMinutes() !== minuteNumber
  ) {
    return null;
  }
  const end = new Date(start.getTime() + Math.max(15, Math.floor(durationMinutes || 30)) * 60_000);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function recurrenceRuleForCalendarCreate(recurrence: CalendarEventRecurrence | null | undefined): string[] | undefined {
  if (!recurrence || recurrence === 'none') return undefined;
  return [RECURRENCE_RULES[recurrence]];
}

export function normalizeCalendarRecurrenceRule(value: string): string | null {
  const normalized = value.trim().toUpperCase().replace(/^RRULE:/, '');
  if (!normalized.startsWith('FREQ=') || !/^[A-Z0-9=,;+-]+$/.test(normalized)) return null;
  return `RRULE:${normalized}`;
}

export function localCalendarTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return timeZone && isValidCalendarTimeZone(timeZone) ? timeZone : 'UTC';
}

export function normalizeCalendarTimeZone(value: string | null | undefined): string | null {
  const timeZone = value?.trim();
  if (!timeZone || !isValidCalendarTimeZone(timeZone)) return null;
  return timeZone;
}

export function calendarTimeZoneForCreate(
  recurrence: CalendarEventRecurrence | null | undefined,
  timeZone: string | null | undefined,
  fallbackTimeZone = localCalendarTimeZone(),
): string | undefined {
  const normalized = normalizeCalendarTimeZone(timeZone);
  if (normalized) return normalized;
  if (recurrence && recurrence !== 'none') return normalizeCalendarTimeZone(fallbackTimeZone) || 'UTC';
  return undefined;
}

export function parseCalendarAttendeeEmails(input: string): ParsedCalendarAttendees {
  const emails = new Set<string>();
  const invalid: string[] = [];
  const chunks = input
    .split(/[,;\n]+/)
    .map(chunk => chunk.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const matches = chunk.match(EMAIL_PATTERN) || [];
    if (matches.length === 0) {
      invalid.push(chunk);
      continue;
    }
    for (const email of matches) {
      emails.add(email.toLowerCase());
    }
  }

  return {
    emails: [...emails],
    invalid,
  };
}

export function parseNaturalLanguageCalendarEvent(
  input: string,
  selectedDate: Date,
  defaultDurationMinutes: number,
  now = new Date(),
): NaturalLanguageCalendarEventDraft | null {
  const original = input.trim();
  if (!original) return null;

  const defaults = defaultCalendarEventFormForDate(selectedDate, defaultDurationMinutes, now);
  let working = original;
  let date = defaults.date;
  let startTime = defaults.startTime;
  let durationMinutes = defaults.durationMinutes;
  let recurrence: CalendarEventRecurrence = 'none';
  let hasExplicitDate = false;
  let hasExplicitTime = false;

  const durationMatch = /\bfor\s+(\d+(?:\.\d+)?)\s*(hours?|hrs?|h|minutes?|mins?|m)\b/i.exec(working);
  if (durationMatch) {
    const amount = Number(durationMatch[1]);
    const unit = durationMatch[2].toLowerCase();
    durationMinutes = unit.startsWith('h') ? Math.round(amount * 60) : Math.round(amount);
    durationMinutes = Math.max(15, Math.min(480, durationMinutes));
    working = removeMatchedText(working, durationMatch);
  }

  const timeRange = /\b(?:(from|at)\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|–|—|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i.exec(working);
  const parsedTimeRange = timeRange ? timeRangeFromMatch(timeRange) : null;
  if (timeRange && parsedTimeRange) {
    startTime = parsedTimeRange.startTime;
    durationMinutes = parsedTimeRange.durationMinutes;
    hasExplicitTime = true;
    working = removeMatchedText(working, timeRange);
  } else {
    const timeWithMeridiem = /\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i.exec(working);
    if (timeWithMeridiem) {
      const parsed = timeFromParts(timeWithMeridiem[1], timeWithMeridiem[2] || '00', timeWithMeridiem[3]);
      if (parsed) {
        startTime = parsed;
        hasExplicitTime = true;
        working = removeMatchedText(working, timeWithMeridiem);
      }
    } else {
      const twentyFourHour = /\bat\s+(\d{1,2}):(\d{2})\b/i.exec(working);
      if (twentyFourHour) {
        const parsed = timeFromParts(twentyFourHour[1], twentyFourHour[2]);
        if (parsed) {
          startTime = parsed;
          hasExplicitTime = true;
          working = removeMatchedText(working, twentyFourHour);
        }
      }
    }
  }

  const recurringWeekday = /\bevery\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(working);
  if (recurringWeekday) {
    const weekdayName = recurringWeekday[1].toLowerCase();
    recurrence = 'weekly';
    date = localDateInputValue(resolveWeekday(now, WEEKDAY_INDEX[weekdayName], false));
    hasExplicitDate = true;
    working = removeMatchedText(working, recurringWeekday);
  } else {
    const everyRecurrence = /\bevery\s+(day|week|month|year)\b/i.exec(working);
    if (everyRecurrence) {
      recurrence = recurrenceFromToken(everyRecurrence[1]);
      working = removeMatchedText(working, everyRecurrence);
    } else {
      const standaloneRecurrence = /\b(daily|weekly|monthly|yearly|annually)\b/i.exec(working);
      if (standaloneRecurrence) {
        recurrence = recurrenceFromToken(standaloneRecurrence[1]);
        working = removeMatchedText(working, standaloneRecurrence);
      }
    }
  }

  const isoDate = /\b(?:on\s+)?(\d{4})-(\d{1,2})-(\d{1,2})\b/i.exec(working);
  if (isoDate) {
    const parsed = dateFromParts(Number(isoDate[1]), Number(isoDate[2]), Number(isoDate[3]));
    if (parsed) {
      date = parsed;
      hasExplicitDate = true;
      working = removeMatchedText(working, isoDate);
    }
  } else {
    const slashDate = /\b(?:on\s+)?(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/i.exec(working);
    if (slashDate) {
      const year = slashDate[3]
        ? normalizeYear(Number(slashDate[3]))
        : now.getFullYear();
      const parsed = dateFromParts(year, Number(slashDate[1]), Number(slashDate[2]));
      if (parsed) {
        date = parsed;
        hasExplicitDate = true;
        working = removeMatchedText(working, slashDate);
      }
    } else {
      const relativeDate = /\b(today|tomorrow)\b/i.exec(working);
      if (relativeDate) {
        const parsedDate = startOfLocalDate(now);
        if (relativeDate[1].toLowerCase() === 'tomorrow') parsedDate.setDate(parsedDate.getDate() + 1);
        date = localDateInputValue(parsedDate);
        hasExplicitDate = true;
        working = removeMatchedText(working, relativeDate);
      } else {
        const nextWeekday = /\bnext\s+(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(working);
        const weekday = nextWeekday || /\b(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i.exec(working);
        if (weekday) {
          const weekdayName = (nextWeekday ? nextWeekday[1] : weekday[1]).toLowerCase();
          date = localDateInputValue(resolveWeekday(now, WEEKDAY_INDEX[weekdayName], Boolean(nextWeekday)));
          hasExplicitDate = true;
          working = removeMatchedText(working, weekday);
        }
      }
    }
  }

  const locationMatch = /(?:^|\s)(?:@|at|in)\s+(.+)$/i.exec(working.trim());
  let location: string | null = null;
  if (locationMatch && locationMatch[1].trim()) {
    location = cleanNaturalLanguageText(locationMatch[1]);
    working = working.trim().slice(0, locationMatch.index).trim();
  }

  const attendeeResult = extractAttendeeEmails(working);
  working = attendeeResult.text;

  const title = cleanNaturalLanguageText(working) || 'New event';
  return {
    title,
    date,
    startTime,
    durationMinutes,
    location,
    attendees: attendeeResult.attendees,
    recurrence,
    hasExplicitDate,
    hasExplicitTime,
  };
}

function recurrenceFromToken(value: string): CalendarEventRecurrence {
  const token = value.toLowerCase();
  if (token === 'day' || token === 'daily') return 'daily';
  if (token === 'week' || token === 'weekly') return 'weekly';
  if (token === 'month' || token === 'monthly') return 'monthly';
  if (token === 'year' || token === 'yearly' || token === 'annually') return 'yearly';
  return 'none';
}

function removeMatchedText(text: string, match: RegExpExecArray): string {
  return `${text.slice(0, match.index)} ${text.slice(match.index + match[0].length)}`.replace(/\s+/g, ' ').trim();
}

function cleanNaturalLanguageText(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/^[,;:\s]+|[,;:\s]+$/g, '')
    .trim();
}

function extractAttendeeEmails(text: string): { text: string; attendees: string[] } {
  const attendees = new Set<string>();
  const matches = text.match(EMAIL_PATTERN) || [];
  for (const email of matches) attendees.add(email.toLowerCase());
  if (attendees.size === 0) return { text, attendees: [] };

  const cleaned = cleanNaturalLanguageText(
    text
      .replace(EMAIL_PATTERN, ' ')
      .replace(/\s+(?:with|invite|inviting|including|guests?|attendees?|and)\s*$/i, ''),
  );
  return {
    text: cleaned,
    attendees: [...attendees],
  };
}

function timeRangeFromMatch(match: RegExpExecArray): { startTime: string; durationMinutes: number } | null {
  const marker = match[1];
  const startHour = match[2];
  const startMinute = match[3] || '00';
  let startMeridiem = match[4];
  const endHour = match[5];
  const endMinute = match[6] || '00';
  let endMeridiem = match[7];
  const hasClockSignal = Boolean(marker || match[3] || match[4] || match[6] || match[7]);
  if (!hasClockSignal) return null;

  if (!startMeridiem && endMeridiem) {
    const startHourNumber = Number(startHour);
    const endHourNumber = Number(endHour);
    startMeridiem = endMeridiem.toLowerCase() === 'pm' && endHourNumber < startHourNumber ? 'am' : endMeridiem;
  }
  if (!endMeridiem && startMeridiem) endMeridiem = startMeridiem;

  const startTime = timeFromParts(startHour, startMinute, startMeridiem);
  const endTime = timeFromParts(endHour, endMinute, endMeridiem);
  if (!startTime || !endTime) return null;

  const startMinutes = minutesFromTime(startTime);
  let endMinutes = minutesFromTime(endTime);
  if (endMinutes <= startMinutes) endMinutes += 24 * 60;
  const durationMinutes = endMinutes - startMinutes;
  if (durationMinutes <= 0) return null;
  return {
    startTime,
    durationMinutes: Math.max(15, Math.min(480, durationMinutes)),
  };
}

function timeFromParts(hourValue: string, minuteValue: string, meridiem?: string): string | null {
  let hour = Number(hourValue);
  const minute = Number(minuteValue);
  if (!Number.isInteger(hour) || !Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    const lower = meridiem.toLowerCase();
    if (lower === 'pm' && hour < 12) hour += 12;
    if (lower === 'am' && hour === 12) hour = 0;
  } else if (hour < 0 || hour > 23) {
    return null;
  }
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

function minutesFromTime(value: string): number {
  const [hour, minute] = value.split(':').map(Number);
  return hour * 60 + minute;
}

function dateFromParts(year: number, month: number, day: number): string | null {
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const date = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    date.getFullYear() !== year
    || date.getMonth() !== month - 1
    || date.getDate() !== day
  ) {
    return null;
  }
  return localDateInputValue(date);
}

function normalizeYear(year: number): number {
  if (year < 100) return year + 2000;
  return year;
}

function startOfLocalDate(date: Date): Date {
  const next = new Date(date);
  next.setHours(0, 0, 0, 0);
  return next;
}

function resolveWeekday(anchor: Date, weekday: number, forceNext: boolean): Date {
  const date = startOfLocalDate(anchor);
  let delta = weekday - date.getDay();
  if (delta < 0 || (forceNext && delta === 0)) delta += 7;
  date.setDate(date.getDate() + delta);
  return date;
}
