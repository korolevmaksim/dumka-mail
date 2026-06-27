// Ported from the Swift original `ThreadMessageDisplayPolicy` (PersonalMailClient).
//
// Long conversations are partially collapsed: the first few messages and the
// most recent few stay visible, while a contiguous middle block is hidden
// behind a "Show N hidden messages" affordance. This module computes *which*
// message indices stay visible and how many are hidden, leaving the actual
// rendering to the caller.
//
// Pure, dependency-free: safe to import from both the Electron main process and
// the React renderer.

/** Number of leading messages always kept visible when collapsing. */
export const LEADING_VISIBLE_COUNT = 2;
/** Number of trailing (most recent) messages always kept visible when collapsing. */
export const TRAILING_VISIBLE_COUNT = 6;
/**
 * Minimum size of the hidden middle block required to bother collapsing.
 * If fewer messages than this would be hidden, everything is shown instead.
 */
export const MINIMUM_HIDDEN_COUNT = 3;

export interface ThreadDisplayPlan {
  /** Indices (into the original message array) that should be rendered, in order. */
  visibleIndices: number[];
  /** Number of messages hidden in the collapsed middle block (0 when nothing is collapsed). */
  hiddenCount: number;
  /** True when the thread is currently collapsed (a hidden middle block exists). */
  collapsed: boolean;
}

/**
 * Decide which messages of a thread are visible.
 *
 * Mirrors `ThreadMessageDisplayPolicy.items(messages:showsFullHistory:)`:
 * when `expanded` is false and the thread is long enough that hiding the
 * middle would remove at least `MINIMUM_HIDDEN_COUNT` messages, the plan keeps
 * the leading `LEADING_VISIBLE_COUNT` and trailing `TRAILING_VISIBLE_COUNT`
 * messages and reports the rest as hidden. Otherwise every message is visible.
 *
 * @param count    Total number of messages in the thread.
 * @param expanded Whether the user has chosen to show the full history.
 */
export function planThreadMessages(count: number, expanded: boolean): ThreadDisplayPlan {
  // Defensive: a non-positive or non-integer count has nothing to show.
  const total = Number.isFinite(count) ? Math.max(0, Math.trunc(count)) : 0;

  const allVisible = (): ThreadDisplayPlan => ({
    visibleIndices: Array.from({ length: total }, (_, i) => i),
    hiddenCount: 0,
    collapsed: false,
  });

  if (expanded) {
    return allVisible();
  }

  const hiddenCount = total - LEADING_VISIBLE_COUNT - TRAILING_VISIBLE_COUNT;

  // Collapse only when the middle block is large enough AND the thread is
  // strictly longer than the leading + trailing windows (both guards from Swift).
  if (
    hiddenCount < MINIMUM_HIDDEN_COUNT ||
    total <= LEADING_VISIBLE_COUNT + TRAILING_VISIBLE_COUNT
  ) {
    return allVisible();
  }

  const leading = Array.from({ length: LEADING_VISIBLE_COUNT }, (_, i) => i);
  const trailing = Array.from(
    { length: TRAILING_VISIBLE_COUNT },
    (_, i) => total - TRAILING_VISIBLE_COUNT + i,
  );

  return {
    visibleIndices: [...leading, ...trailing],
    hiddenCount,
    collapsed: true,
  };
}
