import type { CalendarEvent, CalendarSettings } from './types';

export interface CalendarAvailabilitySlot {
  startAt: string;
  endAt: string;
  dayLabel: string;
  timeLabel: string;
  label: string;
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

function busyIntervalsForWindow(events: CalendarEvent[], windowStart: Date, windowEnd: Date): { start: number; end: number }[] {
  const startMs = windowStart.getTime();
  const endMs = windowEnd.getTime();
  return events
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
    })
    .sort((a, b) => a.start - b.start);
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
