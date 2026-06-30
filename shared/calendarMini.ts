import type { CalendarEvent } from './types';

export interface MiniCalendarDay {
  date: Date;
  key: string;
  dayNumber: number;
  isCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
}

export type MiniCalendarWeek = MiniCalendarDay[];

const DAY_MS = 24 * 60 * 60 * 1000;

export const MINI_CALENDAR_WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

export function startOfLocalDay(date: Date): Date {
  const out = new Date(date);
  out.setHours(0, 0, 0, 0);
  return out;
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function sameLocalDay(a: Date, b: Date): boolean {
  return localDateKey(a) === localDateKey(b);
}

export function addLocalDays(date: Date, days: number): Date {
  const out = new Date(date);
  out.setDate(out.getDate() + days);
  return out;
}

export function addLocalMonths(date: Date, months: number): Date {
  const out = new Date(date.getFullYear(), date.getMonth(), 1);
  out.setMonth(out.getMonth() + months);
  return out;
}

export function monthTitle(date: Date): string {
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function monthStart(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function daysFromWeekStart(date: Date, weekStartsOn: number): number {
  return (date.getDay() - weekStartsOn + 7) % 7;
}

export function buildMiniCalendarMonth(
  visibleMonth: Date,
  selectedDate: Date,
  today = new Date(),
  weekStartsOn = 1,
): MiniCalendarWeek[] {
  const month = monthStart(visibleMonth);
  const gridStart = addLocalDays(month, -daysFromWeekStart(month, weekStartsOn));
  const selectedKey = localDateKey(selectedDate);
  const todayKey = localDateKey(today);
  const weeks: MiniCalendarWeek[] = [];

  for (let weekIndex = 0; weekIndex < 6; weekIndex += 1) {
    const week: MiniCalendarWeek = [];
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const date = addLocalDays(gridStart, weekIndex * 7 + dayIndex);
      const key = localDateKey(date);
      week.push({
        date,
        key,
        dayNumber: date.getDate(),
        isCurrentMonth: date.getMonth() === month.getMonth() && date.getFullYear() === month.getFullYear(),
        isToday: key === todayKey,
        isSelected: key === selectedKey,
      });
    }
    weeks.push(week);
  }

  return weeks;
}

export function visibleMiniCalendarRange(visibleMonth: Date, weekStartsOn = 1): { startAt: string; endAt: string } {
  const month = monthStart(visibleMonth);
  const start = addLocalDays(month, -daysFromWeekStart(month, weekStartsOn));
  const end = new Date(start.getTime() + 42 * DAY_MS);
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

export function countCalendarEventsByDay(events: CalendarEvent[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const event of events) {
    const start = new Date(event.startAt);
    if (!Number.isFinite(start.getTime())) continue;
    const key = localDateKey(start);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}
