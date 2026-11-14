import { describe, expect, it } from 'vitest';
import { monthCellLines, monthCellOverflow, monthWeekLanesShown } from '../renderer/src/calendar/calendarMonthLayout';

describe('month cell layout', () => {
  it('counts the event lines that fit in a cell', () => {
    expect(monthCellLines(120, 28, 22)).toBe(4);
    expect(monthCellLines(60, 28, 22)).toBe(1);
    expect(monthCellLines(0, 28, 22)).toBe(3);
  });

  it('keeps a line free for "+N more" when bars would fill the cell', () => {
    expect(monthWeekLanesShown(4, 2)).toBe(2);
    expect(monthWeekLanesShown(4, 3)).toBe(3);
    expect(monthWeekLanesShown(4, 6)).toBe(3);
    expect(monthWeekLanesShown(1, 2)).toBe(0);
    expect(monthWeekLanesShown(4, 0)).toBe(0);
  });

  it('shows everything when it fits', () => {
    expect(monthCellOverflow(4, 1, [0], 3)).toEqual({ timedShown: 3, more: 0 });
  });

  it('turns the last line into "+N more" when the day has too many events', () => {
    // 4 lines, one bar lane, 5 timed events: 2 shown, the 3 others behind "+3 more".
    expect(monthCellOverflow(4, 1, [0], 5)).toEqual({ timedShown: 2, more: 3 });
  });

  it('counts bars of hidden lanes in "+N more"', () => {
    expect(monthCellOverflow(4, 3, [0, 1, 2, 3, 4], 1)).toEqual({ timedShown: 0, more: 3 });
  });
});
