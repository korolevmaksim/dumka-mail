import { describe, expect, it } from 'vitest';
import { htmlToText } from '../shared/aiContext';
import { detectTrackingPixelTags, stripTrackingPixelsFromHtml } from '../shared/mailContentSecurity';
import { hasRenderableHtmlBody } from '../shared/messageBody';
import { MAIL_HTML_SCAN_LIMIT, replaceAngleTags } from '../shared/htmlScan';
import { hasRemoteImages } from '../renderer/src/components/SafeHtmlRenderer';
import { htmlHasOwnCanvas } from '../renderer/src/lib/emailCanvas';

// --- The former regex implementations, kept here as the reference ----------
// (quadratic on hostile input, fine on the small fuzz cases below).

function referenceDecode(input: string): string {
  return input
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0*39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex: string) => safeCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeCodePoint(parseInt(dec, 10)));
}

function safeCodePoint(value: number): string {
  if (!Number.isFinite(value) || value < 0 || value > 0x10ffff) return '';
  try { return String.fromCodePoint(value); } catch { return ''; }
}

function referenceHtmlToText(html: string): string {
  if (!html) return '';
  return referenceDecode(
    html.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' '),
  ).replace(/\s+/g, ' ').trim();
}

function referenceHasRemoteImages(html: string): boolean {
  if (!html) return false;
  return /<(?:img|source)\b[^>]+\b(?:src|srcset)\s*=\s*(?:"[^"]*(?:https?:)?\/\/|'[^']*(?:https?:)?\/\/|[^\s>]*(?:https?:)?\/\/)/i.test(html)
    || /url\(\s*["']?\s*(?:https?:)?\/\//i.test(html);
}

function referenceCssBackgroundImage(html: string): boolean {
  return /\bbackground(?:-image)?\s*:\s*[^;}]*\b(?:url|linear-gradient|radial-gradient)\s*\(/i.test(html);
}

function referenceImgTags(html: string): string[] {
  return html.match(/<img\b[^>]*>/gi) || [];
}

// --- Deterministic fuzzing ----------------------------------------------------

function rng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function fuzzCases(fragments: readonly string[], count: number, maxParts: number, seed: number): string[] {
  const next = rng(seed);
  const cases: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const parts = 1 + Math.floor(next() * maxParts);
    let value = '';
    for (let part = 0; part < parts; part += 1) value += fragments[Math.floor(next() * fragments.length)];
    cases.push(value);
  }
  return cases;
}

const TAG_FRAGMENTS = [
  '<', '>', '<>', '<p', ' ', 'a', 'x', '"', "'", '/', '<script', '<SCRIPT ', '<style', '<Style>', '</style>',
  '</STYLE>', '</script>', '</scrip', '<scripts', 'body', '&amp;', '&#65;', '&nbsp;', '\n', '<b>', '</b>',
];

const IMAGE_FRAGMENTS = [
  '<img', '<IMG ', '<source', '<imgx', '<a ', ' ', '>', 'src', 'srcset', '=', ' = ', '"', "'", '//', 'http:',
  'https:', 'x', '/', 'url(', 'URL( ', 'cid:a', 'data:', '\t',
];

const CSS_FRAGMENTS = [
  'background', 'background-image', 'background-color', ':', ' ', ';', '}', 'url', '(', ' (', 'linear-gradient',
  'radial-gradient', 'x', '-', 'aurl', '_url',
];

const PIXEL_FRAGMENTS = [
  '<img', '<IMG', ' ', '>', 'src="https://t.example/p.gif"', "src='http://t.example/a'", 'src=cid:x',
  'width="1"', 'height=1', 'width="600"', 'style="display:none"', 'style="opacity:0"', '<imgx', '<p>', 'x',
];

describe('linear rewrites give the same answers as the former regexes', () => {
  it('htmlToText', () => {
    for (const input of fuzzCases(TAG_FRAGMENTS, 4000, 14, 1)) {
      expect(htmlToText(input), JSON.stringify(input)).toBe(referenceHtmlToText(input));
    }
  });

  it('replaceAngleTags', () => {
    for (const input of fuzzCases(TAG_FRAGMENTS, 3000, 12, 2)) {
      expect(replaceAngleTags(input, ' '), JSON.stringify(input)).toBe(input.replace(/<[^>]+>/g, ' '));
    }
  });

  it('hasRemoteImages', () => {
    for (const input of fuzzCases(IMAGE_FRAGMENTS, 6000, 14, 3)) {
      expect(hasRemoteImages(input), JSON.stringify(input)).toBe(referenceHasRemoteImages(input));
    }
  });

  it('the CSS background check in hasRenderableHtmlBody', () => {
    // An empty-text body reaches the visual checks; `<i>` keeps it non-empty HTML.
    for (const input of fuzzCases(CSS_FRAGMENTS, 4000, 12, 4)) {
      const html = `<i style="${input.replace(/"/g, '')}"></i>`;
      const expected = /<(?:img|picture|svg|canvas|video|audio|hr)\b/i.test(html)
        || /\bbackground\s*=/i.test(html)
        || referenceCssBackgroundImage(html);
      expect(hasRenderableHtmlBody(html, ''), JSON.stringify(html)).toBe(expected);
    }
  });

  it('tracking-pixel detection and stripping', () => {
    for (const input of fuzzCases(PIXEL_FRAGMENTS, 3000, 10, 5)) {
      const expectedTags = referenceImgTags(input);
      const detected = detectTrackingPixelTags(input);
      // Every detected tag is one of the regex's tags, in order.
      expect(detected.every(tag => expectedTags.includes(tag)), JSON.stringify(input)).toBe(true);
      const stripped = stripTrackingPixelsFromHtml(input);
      const referenceStripped = input.replace(/<img\b[^>]*>/gi, tag => (detected.includes(tag) ? '' : tag));
      expect(stripped, JSON.stringify(input)).toBe(referenceStripped);
    }
  });
});

// --- Adversarial inputs: linear and bounded ----------------------------------

const BUDGET_MS = 200;
const KB = 1024;
const repeatTo = (unit: string, length: number) => unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
const underCap = MAIL_HTML_SCAN_LIMIT - 64;

function timed(run: () => unknown): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

const timings: string[] = [];
function expectFast(label: string, run: () => unknown) {
  const ms = timed(run);
  timings.push(`${label}: ${ms.toFixed(1)} ms`);
  expect(ms, label).toBeLessThan(BUDGET_MS);
}

describe('adversarial mail HTML stays within budget', () => {
  it('htmlToText (no cap: also used for AI context in main)', () => {
    expectFast('htmlToText <p x 60k (180 KB)', () => htmlToText('<p '.repeat(60_000)));
    expectFast('htmlToText <p 1 MB', () => htmlToText(repeatTo('<p ', 1024 * KB)));
    expectFast('htmlToText <style x 30k', () => htmlToText('<style '.repeat(30_000)));
    expectFast('htmlToText <style> unclosed x 1 MB', () => htmlToText(repeatTo('<style>', 1024 * KB)));
    expectFast('htmlToText <script>…<style> mixed 1 MB', () => htmlToText(repeatTo('<script>a<style>b', 1024 * KB)));
  });

  it('hasRenderableHtmlBody', () => {
    expectFast('hasRenderableHtmlBody <p just under cap', () => hasRenderableHtmlBody(repeatTo('<p ', underCap), ''));
    expectFast('hasRenderableHtmlBody <style just under cap', () => hasRenderableHtmlBody(repeatTo('<style ', underCap), ''));
    expectFast('hasRenderableHtmlBody background: just under cap', () => hasRenderableHtmlBody(`<i>${repeatTo('background:', underCap)}`, ''));
    expect(hasRenderableHtmlBody(repeatTo('<p ', 1024 * KB), '')).toBe(true);
  });

  it('hasRemoteImages', () => {
    expectFast('hasRemoteImages url( + spaces just under cap', () => hasRemoteImages(`url(${' '.repeat(underCap)}x`));
    expectFast('hasRemoteImages url( + spaces repeated', () => hasRemoteImages(repeatTo(`url(${' '.repeat(40)}`, underCap)));
    expectFast('hasRemoteImages <img + src= repeated', () => hasRemoteImages(`<img ${repeatTo('src=', underCap)}`));
    expectFast('hasRemoteImages <img src=" repeated', () => hasRemoteImages(repeatTo('<img src="', underCap)));
    expectFast('hasRemoteImages <img x repeated', () => hasRemoteImages(repeatTo('<img ', underCap)));
    expectFast('hasRemoteImages <img a> without src', () => hasRemoteImages(repeatTo('<img a>', underCap)));
    expectFast('hasRemoteImages <img src=x > / spaced', () => hasRemoteImages(repeatTo('<img src=x y=/ >', underCap)));
    // Beyond the cap: treated as remote (stays blocked by default).
    expect(hasRemoteImages(repeatTo('<p>', 1024 * KB))).toBe(true);
  });

  it('tracking pixels (linear, never skipped)', () => {
    expectFast('stripTrackingPixelsFromHtml <img x 40k', () => stripTrackingPixelsFromHtml('<img '.repeat(40_000)));
    expectFast('stripTrackingPixelsFromHtml <img x 1 MB', () => stripTrackingPixelsFromHtml(repeatTo('<img ', 1024 * KB)));
    expectFast('stripTrackingPixelsFromHtml <img src= x 1 MB + >', () => stripTrackingPixelsFromHtml(`<img ${repeatTo('src="', 1024 * KB)}>`));
    expectFast('detectTrackingPixelTags <img x 1 MB', () => detectTrackingPixelTags(repeatTo('<img ', 1024 * KB)));
    const pixel = '<img src="https://t.example/p.gif" width="1" height="1">';
    const many = repeatTo(`<p>x</p>${pixel}`, 400 * KB);
    let stripped = '';
    expectFast('stripTrackingPixelsFromHtml 400 KB of real pixels', () => { stripped = stripTrackingPixelsFromHtml(many); });
    expect(stripped.includes('t.example')).toBe(false);
  });

  it('htmlHasOwnCanvas (unchanged budget, now case-safe)', () => {
    expectFast('htmlHasOwnCanvas <style just under cap', () => htmlHasOwnCanvas(repeatTo('<style>', underCap)));
    // Lower-casing İ changes the string length; the scan must not misalign.
    expect(htmlHasOwnCanvas(`${'İ'.repeat(50)}<style>p { color: #222 }</STYLE><p>x</p>`)).toBe(true);
  });

  it('reports timings', () => {
    // Printed for the review report; the assertions above enforce the budget.
    console.info(timings.join('\n'));
    expect(timings.length).toBeGreaterThan(0);
  });
});
