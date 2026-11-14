import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_EVENT_COLORS,
  EVENT_TINT,
  EVENT_TINT_SELECTED,
  GOOGLE_EVENT_COLORS,
  accountEventColor,
  calendarEventColor,
  calendarListColor,
  contrastRatio,
  eventTintCss,
  mixRgb,
  normalizeHexColor,
  parseHexColor,
  type Rgb,
} from '../renderer/src/calendar/calendarEventColors';

// The four theme surfaces and text colours from renderer/src/index.css
// (classic light/dark, soft light/dark). Text alphas are composited over the block.
const THEMES: Array<{ name: string; appBg: string; primary: { color: string; alpha: number } }> = [
  { name: 'light', appBg: '#FBFCFE', primary: { color: '#000000', alpha: 0.86 } },
  { name: 'dark', appBg: '#0E0F12', primary: { color: '#FFFFFF', alpha: 0.9 } },
  { name: 'soft light', appBg: '#F5F8FC', primary: { color: '#161D2D', alpha: 1 } },
  { name: 'soft dark', appBg: '#0D1524', primary: { color: '#F3F6FB', alpha: 1 } },
];

// Every palette colour plus the extremes a Google calendar could carry.
const EVENT_COLORS = [
  ...Object.values(GOOGLE_EVENT_COLORS),
  ...ACCOUNT_EVENT_COLORS,
  '#ffffff', '#000000', '#9fe1e7', '#fbe983', '#ffff00', '#00ff00', '#0000ff', '#ff0000',
];

function rgb(hex: string): Rgb {
  const value = parseHexColor(hex);
  if (!value) throw new Error(`bad colour ${hex}`);
  return value;
}

describe('calendar event colours', () => {
  it('prefers the event colour, then the calendar colour, then the account colour', () => {
    const calendar = { backgroundColor: '#9FE1E7' };
    expect(calendarEventColor({ accountId: 'me@work.example', colorId: '11' }, calendar)).toBe('#d50000');
    expect(calendarEventColor({ accountId: 'me@work.example', colorId: null }, calendar)).toBe('#9fe1e7');
    expect(calendarEventColor({ accountId: 'me@work.example', colorId: null }, { backgroundColor: '' }))
      .toBe(accountEventColor('me@work.example'));
    expect(calendarEventColor({ accountId: 'me@work.example', colorId: 'unknown' }, null))
      .toBe(accountEventColor('me@work.example'));
  });

  it('gives each account a stable colour from the palette', () => {
    const color = accountEventColor('Alex@Personal.example');
    expect(ACCOUNT_EVENT_COLORS).toContain(color);
    expect(accountEventColor('alex@personal.example')).toBe(color);
    expect(calendarListColor({ accountId: 'alex@personal.example', backgroundColor: 'not-a-colour' })).toBe(color);
  });

  it('tells two typical accounts apart', () => {
    expect(accountEventColor('alex.morgan@northwind.example')).not.toBe(accountEventColor('alex@personal.example'));
  });

  it('accepts only hex colours from calendar data', () => {
    expect(normalizeHexColor('#ABC')).toBe('#aabbcc');
    expect(normalizeHexColor(' #A1B2C3 ')).toBe('#a1b2c3');
    expect(normalizeHexColor('red')).toBeNull();
    expect(normalizeHexColor('url(x)')).toBeNull();
    expect(normalizeHexColor(undefined)).toBeNull();
  });

  it('builds the tint from the app background token', () => {
    expect(eventTintCss('#3f51b5')).toBe('color-mix(in srgb, #3f51b5 20%, var(--app-bg))');
    expect(eventTintCss('#3f51b5', EVENT_TINT_SELECTED)).toBe('color-mix(in srgb, #3f51b5 28%, var(--app-bg))');
  });

  for (const theme of THEMES) {
    it(`keeps event text at WCAG AA on the ${theme.name} theme for any calendar colour`, () => {
      for (const weight of [EVENT_TINT, EVENT_TINT_SELECTED]) {
        for (const color of EVENT_COLORS) {
          const block = mixRgb(rgb(color), rgb(theme.appBg), weight);
          const primary = mixRgb(rgb(theme.primary.color), block, theme.primary.alpha);
          // Both lines of an event (title and time) use --text-primary; the secondary
          // text colour is not used on tinted blocks because it fails on the soft themes.
          expect(contrastRatio(primary, block), `${color} ${weight}`).toBeGreaterThanOrEqual(4.5);
        }
      }
    });
  }

  it('computes WCAG contrast correctly', () => {
    expect(contrastRatio(rgb('#000000'), rgb('#ffffff'))).toBeCloseTo(21, 5);
    expect(contrastRatio(rgb('#777777'), rgb('#ffffff'))).toBeCloseTo(4.48, 2);
  });
});
