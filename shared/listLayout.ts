// Width of the mailbox list next to the reading area. The person can drag
// the divider; the choice is remembered per layout (with and without a
// conversation open) in `settings.appearance`.

export type ListWidthMode = 'home' | 'reading';

export const LIST_MIN_WIDTH = 300;
/** The reading area never gets narrower than this while the list is beside it. */
export const READING_MIN_WIDTH = 420;
export const LIST_WIDTH_KEY_STEP = 24;

/** Widths used until the divider is moved (and again after a double-click resets it). */
export const DEFAULT_LIST_WIDTH: Record<ListWidthMode, string> = {
  home: 'clamp(380px, 43vw, 680px)',
  reading: 'clamp(320px, 30.5vw, 480px)',
};

/** Keeps a chosen width usable in the space the list and reading area share. */
export function clampListWidth(width: number, availableWidth: number): number {
  const max = Math.max(LIST_MIN_WIDTH, availableWidth - READING_MIN_WIDTH);
  if (!Number.isFinite(width)) return LIST_MIN_WIDTH;
  return Math.round(Math.min(max, Math.max(LIST_MIN_WIDTH, width)));
}

/** The CSS width for the list: the remembered one (kept in range), else the default. */
export function resolveListWidth(stored: unknown, mode: ListWidthMode, availableWidth: number): string {
  if (typeof stored !== 'number' || !Number.isFinite(stored) || stored <= 0) return DEFAULT_LIST_WIDTH[mode];
  return `${clampListWidth(stored, availableWidth)}px`;
}
