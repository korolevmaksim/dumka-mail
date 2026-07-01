import type { CalendarBusyInterval, CalendarEvent, CalendarEventRecurrence, CalendarInvite, CalendarSettings } from './types';

export interface CalendarAvailabilitySlot {
  startAt: string;
  endAt: string;
  dayLabel: string;
  timeLabel: string;
  label: string;
}

export interface CalendarConflict {
  event: CalendarEvent;
  overlapStartAt: string;
  overlapEndAt: string;
  occurrenceStartAt?: string;
  occurrenceEndAt?: string;
}

type AvailabilitySettings = Pick<
  CalendarSettings,
  'availabilityLookaheadDays' | 'availabilityStartTime' | 'availabilityEndTime' | 'availabilitySlotStepMinutes' | 'defaultMeetingDurationMinutes'
>;

interface TimeParts {
  hours: number;
  minutes: number;
}

function parseTime(value: string, fallback: TimeParts): TimeParts {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return fallback;
  }
  return { hours, minutes };
}

function atLocalTime(day: Date, parts: TimeParts): Date {
  const date = new Date(day);
  date.setHours(parts.hours, parts.minutes, 0, 0);
  return date;
}

function startOfLocalDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

function addMonthsPreservingDate(date: Date, months: number): Date | null {
  const out = new Date(date);
  const originalMonth = out.getMonth();
  const originalDay = out.getDate();
  out.setDate(1);
  out.setMonth(originalMonth + months);
  const targetMonth = out.getMonth();
  out.setDate(originalDay);
  if (out.getMonth() !== targetMonth) return null;
  return out;
}

function addYearsPreservingDate(date: Date, years: number): Date | null {
  const out = new Date(date);
  const targetYear = out.getFullYear() + years;
  const originalMonth = out.getMonth();
  out.setFullYear(targetYear, originalMonth, date.getDate());
  if (out.getFullYear() !== targetYear || out.getMonth() !== originalMonth) return null;
  return out;
}

function roundUp(date: Date, stepMinutes: number): Date {
  const stepMs = Math.max(5, stepMinutes) * 60_000;
  return new Date(Math.ceil(date.getTime() / stepMs) * stepMs);
}

function formatTimeRange(start: Date, end: Date): string {
  const options: Intl.DateTimeFormatOptions = { hour: 'numeric', minute: '2-digit' };
  return `${start.toLocaleTimeString(undefined, options)} - ${end.toLocaleTimeString(undefined, options)}`;
}

function formatDay(date: Date): string {
  return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

function overlaps(startA: number, endA: number, startB: number, endB: number): boolean {
  return startA < endB && startB < endA;
}

function eventBlocksAvailability(event: CalendarEvent): boolean {
  return event.status !== 'cancelled';
}

export function findCalendarConflicts(
  events: CalendarEvent[],
  startAt: string,
  endAt: string,
  options: { excludeEventId?: string } = {},
): CalendarConflict[] {
  const startMs = new Date(startAt).getTime();
  const endMs = new Date(endAt).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];

  return events
    .filter(eventBlocksAvailability)
    .filter(event => !options.excludeEventId || event.id !== options.excludeEventId)
    .flatMap(event => {
      const eventStart = new Date(event.startAt).getTime();
      const eventEnd = new Date(event.endAt).getTime();
      if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) return [];
      if (!overlaps(startMs, endMs, eventStart, eventEnd)) return [];
      return [{
        event,
        overlapStartAt: new Date(Math.max(startMs, eventStart)).toISOString(),
        overlapEndAt: new Date(Math.min(endMs, eventEnd)).toISOString(),
      }];
    })
    .sort((a, b) => new Date(a.event.startAt).getTime() - new Date(b.event.startAt).getTime());
}

export function calendarEventMatchesInvite(event: CalendarEvent, invite: CalendarInvite): boolean {
  const sameUid = Boolean(event.iCalUID && event.iCalUID === invite.uid);
  const sameTimeAndTitle = event.summary === invite.summary
    && event.startAt === invite.startAt
    && event.endAt === invite.endAt;
  return sameUid || sameTimeAndTitle;
}

export function findCalendarInviteConflicts(
  events: CalendarEvent[],
  invite: CalendarInvite,
  options: { maxConflicts?: number } = {},
): CalendarConflict[] {
  const matchingEvent = events.find(event => calendarEventMatchesInvite(event, invite));
  return findCalendarConflicts(events, invite.startAt, invite.endAt, {
    excludeEventId: matchingEvent?.id,
  })
    .filter(conflict => !calendarEventMatchesInvite(conflict.event, invite))
    .slice(0, Math.max(1, Math.floor(options.maxConflicts || 3)));
}

function occurrenceStartAtIndex(start: Date, recurrence: Exclude<CalendarEventRecurrence, 'none'>, index: number): Date | null {
  switch (recurrence) {
    case 'daily':
      return addDays(start, index);
    case 'weekly':
      return addDays(start, index * 7);
    case 'monthly':
      return addMonthsPreservingDate(start, index);
    case 'yearly':
      return addYearsPreservingDate(start, index);
  }
}

export function expandCalendarCreateOccurrences(
  startAt: string,
  endAt: string,
  recurrence: CalendarEventRecurrence | null | undefined,
  options: { horizonDays?: number; maxOccurrences?: number } = {},
): Array<{ startAt: string; endAt: string }> {
  const start = new Date(startAt);
  const end = new Date(endAt);
  const startMs = start.getTime();
  const endMs = end.getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) return [];
  if (!recurrence || recurrence === 'none') return [{ startAt: start.toISOString(), endAt: end.toISOString() }];

  const horizonDays = Math.max(1, Math.floor(options.horizonDays || 90));
  const maxOccurrences = Math.max(1, Math.floor(options.maxOccurrences || 24));
  const durationMs = endMs - startMs;
  const horizonEndMs = startMs + horizonDays * 24 * 60 * 60_000;
  const occurrences: Array<{ startAt: string; endAt: string }> = [];
  const maxScan = maxOccurrences * 24;

  for (let index = 0; index < maxScan && occurrences.length < maxOccurrences; index += 1) {
    const cursor = occurrenceStartAtIndex(start, recurrence, index);
    if (!cursor) continue;
    if (cursor.getTime() > horizonEndMs) break;
    occurrences.push({
      startAt: cursor.toISOString(),
      endAt: new Date(cursor.getTime() + durationMs).toISOString(),
    });
  }

  return occurrences;
}

export function findRecurringCalendarConflicts(
  events: CalendarEvent[],
  startAt: string,
  endAt: string,
  recurrence: CalendarEventRecurrence | null | undefined,
  options: { excludeEventId?: string; horizonDays?: number; maxOccurrences?: number } = {},
): CalendarConflict[] {
  const occurrences = expandCalendarCreateOccurrences(startAt, endAt, recurrence, options);
  return occurrences
    .flatMap(occurrence => findCalendarConflicts(events, occurrence.startAt, occurrence.endAt, options)
      .map(conflict => ({
        ...conflict,
        occurrenceStartAt: occurrence.startAt,
        occurrenceEndAt: occurrence.endAt,
      })))
    .sort((a, b) => new Date(a.occurrenceStartAt || a.overlapStartAt).getTime() - new Date(b.occurrenceStartAt || b.overlapStartAt).getTime());
}

function busyIntervalsForWindow(events: CalendarEvent[], windowStart: Date, windowEnd: Date): { start: number; end: number }[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const busy = events
    .filter(eventBlocksAvailability)
    .flatMap(event => {
      const eventStart = new Date(event.startAt).getTime();
      const eventEnd = new Date(event.endAt).getTime();
      if (!Number.isFinite(eventStart) || !Number.isFinite(eventEnd) || eventEnd <= eventStart) return [];
      if (!overlaps(eventStart, eventEnd, startMs, endMs)) return [];
      return [{
        start: Math.max(eventStart, startMs),
        end: Math.min(eventEnd, endMs),
      }];
    });
  return normalizeBusyIntervals(busy);
}

function freeBusyIntervalsForWindow(intervals: CalendarBusyInterval[], windowStart: Date, windowEnd: Date): { start: number; end: number }[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  const busy = intervals.flatMap(interval => {
    const intervalStart = new Date(interval.startAt).getTime();
    const intervalEnd = new Date(interval.endAt).getTime();
    if (!Number.isFinite(intervalStart) || !Number.isFinite(intervalEnd) || intervalEnd <= intervalStart) return [];
    if (!overlaps(intervalStart, intervalEnd, startMs, endMs)) return [];
    return [{
      start: Math.max(intervalStart, startMs),
      end: Math.min(intervalEnd, endMs),
    }];
  });
  return normalizeBusyIntervals(busy);
}

function normalizeBusyIntervals(intervals: { start: number; end: number }[]): { start: number; end: number }[] {
  const sorted = intervals
    .filter(interval => Number.isFinite(interval.start) && Number.isFinite(interval.end) && interval.end > interval.start)
    .sort((a, b) => a.start - b.start);
  const normalized: { start: number; end: number }[] = [];
  for (const interval of sorted) {
    const previous = normalized[normalized.length - 1];
    if (previous && interval.start <= previous.end) {
      previous.end = Math.max(previous.end, interval.end);
    } else {
      normalized.push({ ...interval });
    }
  }
  return normalized;
}

export function findAvailabilitySlots(
  events: CalendarEvent[],
  settings: AvailabilitySettings,
  now = new Date(),
  maxSlots = 3,
): CalendarAvailabilitySlot[] {
  const durationMinutes = Math.max(15, Math.floor(settings.defaultMeetingDurationMinutes || 30));
  const stepMinutes = Math.max(15, Math.floor(settings.availabilitySlotStepMinutes || durationMinutes));
  const lookaheadDays = Math.max(1, Math.floor(settings.availabilityLookaheadDays || 5));
  const startParts = parseTime(settings.availabilityStartTime || '09:00', { hours: 9, minutes: 0 });
  const endParts = parseTime(settings.availabilityEndTime || '17:00', { hours: 17, minutes: 0 });
  const slots: CalendarAvailabilitySlot[] = [];

  for (let dayOffset = 0; dayOffset < lookaheadDays && slots.length < maxSlots; dayOffset += 1) {
    const day = addDays(startOfLocalDay(now), dayOffset);
    const windowStart = atLocalTime(day, startParts);
    const windowEnd = atLocalTime(day, endParts);
    if (windowEnd <= windowStart) continue;

    let cursor = dayOffset === 0 ? roundUp(new Date(Math.max(now.getTime(), windowStart.getTime())), stepMinutes) : windowStart;
    const busy = busyIntervalsForWindow(events, windowStart, windowEnd);

    for (const interval of busy) {
      while (cursor.getTime() + durationMinutes * 60_000 <= interval.start && slots.length < maxSlots) {
        const end = new Date(cursor.getTime() + durationMinutes * 60_000);
        slots.push(slotFromRange(cursor, end));
        cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
      }
      if (cursor.getTime() < interval.end) {
        cursor = roundUp(new Date(interval.end), stepMinutes);
      }
    }

    while (cursor.getTime() + durationMinutes * 60_000 <= windowEnd.getTime() && slots.length < maxSlots) {
      const end = new Date(cursor.getTime() + durationMinutes * 60_000);
      slots.push(slotFromRange(cursor, end));
      cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
    }
  }

  return slots;
}

export function findAvailabilitySlotsFromBusyIntervals(
  busyIntervals: CalendarBusyInterval[],
  settings: AvailabilitySettings,
  now = new Date(),
  maxSlots = 3,
): CalendarAvailabilitySlot[] {
  const durationMinutes = Math.max(15, Math.floor(settings.defaultMeetingDurationMinutes || 30));
  const stepMinutes = Math.max(15, Math.floor(settings.availabilitySlotStepMinutes || durationMinutes));
  const lookaheadDays = Math.max(1, Math.floor(settings.availabilityLookaheadDays || 5));
  const startParts = parseTime(settings.availabilityStartTime || '09:00', { hours: 9, minutes: 0 });
  const endParts = parseTime(settings.availabilityEndTime || '17:00', { hours: 17, minutes: 0 });
  const slots: CalendarAvailabilitySlot[] = [];

  for (let dayOffset = 0; dayOffset < lookaheadDays && slots.length < maxSlots; dayOffset += 1) {
    const day = addDays(startOfLocalDay(now), dayOffset);
    const windowStart = atLocalTime(day, startParts);
    const windowEnd = atLocalTime(day, endParts);
    if (windowEnd <= windowStart) continue;

    let cursor = dayOffset === 0 ? roundUp(new Date(Math.max(now.getTime(), windowStart.getTime())), stepMinutes) : windowStart;
    const busy = freeBusyIntervalsForWindow(busyIntervals, windowStart, windowEnd);

    for (const interval of busy) {
      while (cursor.getTime() + durationMinutes * 60_000 <= interval.start && slots.length < maxSlots) {
        const end = new Date(cursor.getTime() + durationMinutes * 60_000);
        slots.push(slotFromRange(cursor, end));
        cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
      }
      if (cursor.getTime() < interval.end) {
        cursor = roundUp(new Date(interval.end), stepMinutes);
      }
    }

    while (cursor.getTime() + durationMinutes * 60_000 <= windowEnd.getTime() && slots.length < maxSlots) {
      const end = new Date(cursor.getTime() + durationMinutes * 60_000);
      slots.push(slotFromRange(cursor, end));
      cursor = new Date(cursor.getTime() + stepMinutes * 60_000);
    }
  }

  return slots;
}

function slotFromRange(start: Date, end: Date): CalendarAvailabilitySlot {
  const dayLabel = formatDay(start);
  const timeLabel = formatTimeRange(start, end);
  return {
    startAt: start.toISOString(),
    endAt: end.toISOString(),
    dayLabel,
    timeLabel,
    label: `${dayLabel}, ${timeLabel}`,
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function availabilitySlotsPlainText(slots: CalendarAvailabilitySlot[]): string {
  if (slots.length === 0) return '';
  return [
    'A few times that work for me:',
    ...slots.map(slot => `- ${slot.label}`),
  ].join('\n');
}

export function availabilitySlotsHtml(slots: CalendarAvailabilitySlot[]): string {
  if (slots.length === 0) return '';
  const items = slots.map(slot => `<li>${escapeHtml(slot.label)}</li>`).join('');
  return `<p>A few times that work for me:</p><ul>${items}</ul>`;
}
