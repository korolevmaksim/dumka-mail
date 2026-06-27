// Reminder presets — pure, dependency-free port of the Swift `ReminderPreset`
// snooze math (PersonalMailClient/Models/ReminderPreset.swift), reshaped to the
// preset set used by Dumka Mail. Runs in BOTH the Electron main process and the
// React renderer, so this file must stay free of Node/Electron/DOM imports.
//
// Preset semantics (local time, mirroring Calendar math in the Swift source):
//   laterToday  -> now + 3 hours
//   thisEvening -> today at 18:00:00, or next day 18:00:00 if already past
//   tomorrow    -> next calendar day at 09:00:00
//   thisWeekend -> next Saturday at 09:00:00 (strictly after now, weekday rollover)
//   nextWeek    -> next Monday at 09:00:00 (strictly after now, weekday rollover)
//   custom      -> null (caller supplies an explicit date)

export type ReminderPresetId =
  | 'laterToday'
  | 'thisEvening'
  | 'tomorrow'
  | 'thisWeekend'
  | 'nextWeek'
  | 'custom';

export interface ReminderPreset {
  id: ReminderPresetId;
  title: string;
}

export const REMINDER_PRESETS: ReminderPreset[] = [
  { id: 'laterToday', title: 'Later today' },
  { id: 'thisEvening', title: 'This evening' },
  { id: 'tomorrow', title: 'Tomorrow' },
  { id: 'thisWeekend', title: 'This weekend' },
  { id: 'nextWeek', title: 'Next week' },
  { id: 'custom', title: 'Custom…' },
];

const HOUR_MS = 60 * 60 * 1000;

// JS Date.getDay(): 0 = Sunday, 1 = Monday, ... 6 = Saturday.
const SATURDAY = 6;
const MONDAY = 1;

/**
 * Returns the next local datetime strictly after `now` whose day-of-week equals
 * `targetDow` and whose time-of-day is exactly `hour:00:00.000`. Mirrors Swift's
 * `Calendar.nextDate(after:matching:)` with `.nextTime` / `.forward`.
 */
function nextWeekdayAt(now: Date, targetDow: number, hour: number): Date {
  const d = new Date(now.getTime());
  d.setHours(hour, 0, 0, 0);
  // Advance one day at a time until the weekday matches AND the candidate is in
  // the future. The loop runs at most 7 times.
  while (d.getDay() !== targetDow || d.getTime() <= now.getTime()) {
    d.setDate(d.getDate() + 1);
    d.setHours(hour, 0, 0, 0);
  }
  return d;
}

/**
 * Computes the concrete reminder datetime for a preset. Returns `null` for
 * `'custom'` (the caller is responsible for supplying an explicit date).
 */
export function reminderDate(id: ReminderPresetId, now: Date = new Date()): Date | null {
  switch (id) {
    case 'laterToday':
      return new Date(now.getTime() + 3 * HOUR_MS);

    case 'thisEvening': {
      const d = new Date(now.getTime());
      d.setHours(18, 0, 0, 0);
      if (d.getTime() <= now.getTime()) {
        // setDate preserves the 18:00:00 time-of-day across the day rollover.
        d.setDate(d.getDate() + 1);
      }
      return d;
    }

    case 'tomorrow': {
      const d = new Date(now.getTime());
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    }

    case 'thisWeekend':
      return nextWeekdayAt(now, SATURDAY, 9);

    case 'nextWeek':
      return nextWeekdayAt(now, MONDAY, 9);

    case 'custom':
      return null;

    default: {
      // Exhaustiveness guard: if a new preset id is added without a branch here,
      // this assignment fails to typecheck.
      const _exhaustive: never = id;
      return _exhaustive;
    }
  }
}

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
});

const weekdayFormatter = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

const monthDayFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
});

function startOfDay(d: Date): number {
  const x = new Date(d.getTime());
  x.setHours(0, 0, 0, 0);
  return x.getTime();
}

/**
 * Produces a short, human-readable description of a reminder's due time relative
 * to `now`, e.g. "Overdue", "Today at 6:00 PM", "Tomorrow at 9:00 AM",
 * "Saturday at 9:00 AM", or "Jul 26 at 9:00 AM".
 */
export function describeReminder(date: Date, now: Date = new Date()): string {
  if (date.getTime() < now.getTime()) {
    return 'Overdue';
  }

  const time = timeFormatter.format(date);
  const dayDiff = Math.round((startOfDay(date) - startOfDay(now)) / 86_400_000);

  if (dayDiff <= 0) {
    return `Today at ${time}`;
  }
  if (dayDiff === 1) {
    return `Tomorrow at ${time}`;
  }
  if (dayDiff <= 6) {
    return `${weekdayFormatter.format(date)} at ${time}`;
  }
  return `${monthDayFormatter.format(date)} at ${time}`;
}
