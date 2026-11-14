// Event colours. An event takes its own Google colour (colorId) when it has one,
// otherwise its calendar's colour from Google, otherwise a stable colour for its
// account, so work and personal calendars are told apart at a glance.
//
// Blocks are drawn as a light tint of that colour over the app background with
// a solid bar on the left, and the text uses the theme's own text colours. The
// tint is weak enough that the text passes WCAG AA on every theme whatever the
// calendar colour is (tests/calendarEventColors.test.ts checks this). Colour is
// never the only cue: the calendar and account names are in the event details.
import type { CalendarEvent, CalendarListEntry } from '../../../shared/types';

/** Google Calendar's event palette (colorId → hex), as shown by Google. */
export const GOOGLE_EVENT_COLORS: Readonly<Record<string, string>> = {
  '1': '#7986cb',
  '2': '#33b679',
  '3': '#8e24aa',
  '4': '#e67c73',
  '5': '#f6bf26',
  '6': '#f4511e',
  '7': '#039be5',
  '8': '#616161',
  '9': '#3f51b5',
  '10': '#0b8043',
  '11': '#d50000',
};

/** Distinct hues for accounts whose calendars carry no colour. */
export const ACCOUNT_EVENT_COLORS: readonly string[] = [
  '#4f7fe8',
  '#e0703a',
  '#2f9e6e',
  '#a35bd6',
  '#d6457a',
  '#b8901a',
  '#1d9bb2',
  '#7a8794',
];

/** Share of the event colour in a block's background (rest is `--app-bg`). */
export const EVENT_TINT = 0.2;
/** Stronger tint for the selected event. */
export const EVENT_TINT_SELECTED = 0.28;

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** `#rgb` / `#rrggbb` (any case) → `#rrggbb`; anything else → null. */
export function normalizeHexColor(value: string | null | undefined): string | null {
  const text = value?.trim().toLowerCase() || '';
  const short = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(text);
  if (short) return `#${short[1]}${short[1]}${short[2]}${short[2]}${short[3]}${short[3]}`;
  return /^#[0-9a-f]{6}$/.test(text) ? text : null;
}

/** Stable colour for an account (same email → same colour on every launch). */
export function accountEventColor(accountId: string): string {
  let hash = 0x811c9dc5;
  for (const char of accountId.trim().toLowerCase()) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return ACCOUNT_EVENT_COLORS[hash % ACCOUNT_EVENT_COLORS.length];
}

/** The colour an event is drawn in: event colour, then calendar colour, then account colour. */
export function calendarEventColor(
  event: Pick<CalendarEvent, 'accountId' | 'colorId'>,
  calendar?: Pick<CalendarListEntry, 'backgroundColor'> | null,
): string {
  const eventColor = event.colorId ? GOOGLE_EVENT_COLORS[event.colorId] : undefined;
  return eventColor
    || normalizeHexColor(calendar?.backgroundColor)
    || accountEventColor(event.accountId);
}

/** Colour of a calendar's dot in lists (calendar colour, else account colour). */
export function calendarListColor(calendar: Pick<CalendarListEntry, 'accountId' | 'backgroundColor'>): string {
  return normalizeHexColor(calendar.backgroundColor) || accountEventColor(calendar.accountId);
}

/** CSS background for an event block: a tint of `color` over the app background. */
export function eventTintCss(color: string, weight: number = EVENT_TINT): string {
  return `color-mix(in srgb, ${color} ${Math.round(weight * 100)}%, var(--app-bg))`;
}

// --- Contrast arithmetic (WCAG 2.x), used by the tests to prove the tint is safe ---

export function parseHexColor(value: string): Rgb | null {
  const hex = normalizeHexColor(value);
  if (!hex) return null;
  return {
    r: parseInt(hex.slice(1, 3), 16),
    g: parseInt(hex.slice(3, 5), 16),
    b: parseInt(hex.slice(5, 7), 16),
  };
}

/** `weight` of `top` over `bottom` (sRGB mix, like `color-mix(in srgb, …)` and alpha compositing). */
export function mixRgb(top: Rgb, bottom: Rgb, weight: number): Rgb {
  const w = Math.max(0, Math.min(1, weight));
  return {
    r: top.r * w + bottom.r * (1 - w),
    g: top.g * w + bottom.g * (1 - w),
    b: top.b * w + bottom.b * (1 - w),
  };
}

export function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (value: number) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: Rgb, b: Rgb): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
