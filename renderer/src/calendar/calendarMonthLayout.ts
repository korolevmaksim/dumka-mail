// How much of a month cell is shown. A week row draws its multi-day and
// all-day bars in lanes across the whole week (with the title on every week
// segment); the remaining lines of each day hold its timed events, and when a
// day has more than fits, the last line says `+N more` and opens that day.
// Pure, tested in tests/calendarMonthLayout.test.ts.

/** Lines (event rows) that fit in a cell of `cellHeight` px. */
export function monthCellLines(cellHeight: number, labelHeight: number, lineHeight: number): number {
  if (!Number.isFinite(cellHeight) || cellHeight <= 0) return 3;
  return Math.max(1, Math.floor((cellHeight - labelHeight - 4) / lineHeight));
}

/** Bar lanes drawn for a week: leave one line free for `+N more` whenever lanes would fill the cell. */
export function monthWeekLanesShown(lines: number, weekLaneCount: number): number {
  if (weekLaneCount <= 0) return 0;
  if (weekLaneCount <= lines - 1) return weekLaneCount;
  return Math.max(0, Math.min(weekLaneCount, lines - 1));
}

export interface MonthCellOverflow {
  /** Timed events listed in the cell. */
  timedShown: number;
  /** Events of the day not visible in the cell (hidden bars + hidden timed events). */
  more: number;
}

/**
 * `spanLanes`: lanes of the bars covering this day; `lanesShown`: lanes drawn
 * for the week; `timedCount`: the day's other events.
 */
export function monthCellOverflow(lines: number, lanesShown: number, spanLanes: readonly number[], timedCount: number): MonthCellOverflow {
  const hiddenBars = spanLanes.filter(lane => lane >= lanesShown).length;
  const free = Math.max(0, lines - lanesShown);
  if (hiddenBars === 0 && timedCount <= free) return { timedShown: timedCount, more: 0 };
  const timedShown = Math.max(0, Math.min(timedCount, free - 1));
  return { timedShown, more: hiddenBars + (timedCount - timedShown) };
}
