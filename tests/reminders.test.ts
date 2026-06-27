import { describe, it, expect } from 'vitest';
import {
  REMINDER_PRESETS,
  ReminderPresetId,
  reminderDate,
  describeReminder,
} from '../shared/reminders';

describe('REMINDER_PRESETS', () => {
  it('exposes every preset id with a non-empty title', () => {
    const ids = REMINDER_PRESETS.map((p) => p.id);
    expect(ids).toEqual([
      'laterToday',
      'thisEvening',
      'tomorrow',
      'thisWeekend',
      'nextWeek',
      'custom',
    ]);
    for (const preset of REMINDER_PRESETS) {
      expect(preset.title.length).toBeGreaterThan(0);
    }
  });
});

describe('reminderDate', () => {
  it('laterToday returns now + 3 hours exactly', () => {
    const now = new Date(2026, 5, 26, 10, 30, 15, 250); // Fri Jun 26 2026, 10:30:15.250
    const result = reminderDate('laterToday', now)!;
    expect(result.getTime()).toBe(now.getTime() + 3 * 60 * 60 * 1000);
  });

  it('thisEvening returns today at 18:00 when evening is still ahead', () => {
    const now = new Date(2026, 5, 26, 9, 0, 0); // 09:00
    const result = reminderDate('thisEvening', now)!;
    expect(result.getFullYear()).toBe(2026);
    expect(result.getMonth()).toBe(5);
    expect(result.getDate()).toBe(26);
    expect(result.getHours()).toBe(18);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
    expect(result.getMilliseconds()).toBe(0);
  });

  it('thisEvening rolls to next day 18:00 when already past 18:00', () => {
    const now = new Date(2026, 5, 26, 19, 30, 0); // 19:30
    const result = reminderDate('thisEvening', now)!;
    expect(result.getDate()).toBe(27);
    expect(result.getHours()).toBe(18);
  });

  it('thisEvening rolls to next day when exactly at 18:00 (strictly future)', () => {
    const now = new Date(2026, 5, 26, 18, 0, 0);
    const result = reminderDate('thisEvening', now)!;
    expect(result.getDate()).toBe(27);
    expect(result.getHours()).toBe(18);
  });

  it('tomorrow returns the next calendar day at 09:00', () => {
    const now = new Date(2026, 5, 26, 23, 45, 0); // late Friday
    const result = reminderDate('tomorrow', now)!;
    expect(result.getDate()).toBe(27); // Saturday
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('tomorrow rolls month boundary correctly', () => {
    const now = new Date(2026, 5, 30, 12, 0, 0); // Jun 30
    const result = reminderDate('tomorrow', now)!;
    expect(result.getMonth()).toBe(6); // July
    expect(result.getDate()).toBe(1);
    expect(result.getHours()).toBe(9);
  });

  it('thisWeekend returns the upcoming Saturday at 09:00 from a weekday', () => {
    const now = new Date(2026, 5, 24, 14, 0, 0); // Wed Jun 24 2026
    const result = reminderDate('thisWeekend', now)!;
    expect(result.getDay()).toBe(6); // Saturday
    expect(result.getDate()).toBe(27);
    expect(result.getHours()).toBe(9);
    expect(result.getMinutes()).toBe(0);
    expect(result.getSeconds()).toBe(0);
  });

  it('thisWeekend returns the same Saturday when it is Saturday before 09:00', () => {
    const now = new Date(2026, 5, 27, 7, 0, 0); // Sat Jun 27 2026, 07:00
    const result = reminderDate('thisWeekend', now)!;
    expect(result.getDay()).toBe(6);
    expect(result.getDate()).toBe(27); // same day
    expect(result.getHours()).toBe(9);
  });

  it('thisWeekend rolls to next Saturday when it is Saturday after 09:00', () => {
    const now = new Date(2026, 5, 27, 11, 0, 0); // Sat Jun 27 2026, 11:00
    const result = reminderDate('thisWeekend', now)!;
    expect(result.getDay()).toBe(6);
    expect(result.getDate()).toBe(4); // next Saturday, Jul 4
    expect(result.getMonth()).toBe(6);
    expect(result.getHours()).toBe(9);
  });

  it('nextWeek returns the upcoming Monday at 09:00', () => {
    const now = new Date(2026, 5, 24, 14, 0, 0); // Wed Jun 24 2026
    const result = reminderDate('nextWeek', now)!;
    expect(result.getDay()).toBe(1); // Monday
    expect(result.getDate()).toBe(29);
    expect(result.getHours()).toBe(9);
  });

  it('nextWeek rolls to next Monday when it is Monday after 09:00', () => {
    const now = new Date(2026, 5, 29, 10, 0, 0); // Mon Jun 29 2026, 10:00
    const result = reminderDate('nextWeek', now)!;
    expect(result.getDay()).toBe(1);
    expect(result.getDate()).toBe(6); // next Monday, Jul 6
    expect(result.getMonth()).toBe(6);
    expect(result.getHours()).toBe(9);
  });

  it('custom returns null', () => {
    expect(reminderDate('custom', new Date())).toBeNull();
  });

  it('defaults now to the current time and returns a future date for laterToday', () => {
    const before = Date.now();
    const result = reminderDate('laterToday')!;
    expect(result.getTime()).toBeGreaterThan(before);
  });

  it('every non-custom preset produces a strictly future date', () => {
    const now = new Date(2026, 5, 26, 10, 0, 0);
    const presets: ReminderPresetId[] = [
      'laterToday',
      'thisEvening',
      'tomorrow',
      'thisWeekend',
      'nextWeek',
    ];
    for (const id of presets) {
      const result = reminderDate(id, now)!;
      expect(result).not.toBeNull();
      expect(result.getTime()).toBeGreaterThan(now.getTime());
    }
  });
});

describe('describeReminder', () => {
  it('reports Overdue for a past date', () => {
    const now = new Date(2026, 5, 26, 12, 0, 0);
    const past = new Date(2026, 5, 26, 11, 0, 0);
    expect(describeReminder(past, now)).toBe('Overdue');
  });

  it('describes a same-day future reminder with a Today prefix', () => {
    const now = new Date(2026, 5, 26, 9, 0, 0);
    const evening = reminderDate('thisEvening', now)!;
    expect(describeReminder(evening, now).startsWith('Today at ')).toBe(true);
  });

  it('describes a next-day reminder with a Tomorrow prefix', () => {
    const now = new Date(2026, 5, 26, 23, 0, 0);
    const tomorrow = reminderDate('tomorrow', now)!;
    expect(describeReminder(tomorrow, now).startsWith('Tomorrow at ')).toBe(true);
  });

  it('describes a reminder later in the week by weekday name', () => {
    const now = new Date(2026, 5, 22, 9, 0, 0); // Monday Jun 22 2026
    const saturday = reminderDate('thisWeekend', now)!; // Sat Jun 27
    const label = describeReminder(saturday, now);
    expect(label.startsWith('Saturday at ')).toBe(true);
  });

  it('describes a far-future reminder by month and day', () => {
    const now = new Date(2026, 5, 26, 9, 0, 0);
    const far = new Date(2026, 6, 26, 9, 0, 0); // 30 days out
    const label = describeReminder(far, now);
    expect(label.startsWith('Jul 26 at ')).toBe(true);
  });

  it('includes a formatted clock time in the description', () => {
    const now = new Date(2026, 5, 26, 9, 0, 0);
    const tomorrow = reminderDate('tomorrow', now)!; // 09:00
    expect(describeReminder(tomorrow, now)).toMatch(/9:00\s?[AP]M/);
  });
});
