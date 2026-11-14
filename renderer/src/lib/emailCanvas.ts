// Does an HTML email carry its own canvas (backgrounds, colours, layout
// tables)? Such mail keeps the white page it was designed for; simple
// messages (a few paragraphs, quotes, links) are rendered in the app theme.
// Pure string heuristics: no DOM, so it runs in tests and before parsing.
//
// The input is raw, untrusted mail HTML, so the scan is linear and bounded:
// one pass over the tags with indexOf, no regex with an unbounded `[^>]*`
// over the whole document (those are quadratic on unclosed tags).

import { createForwardRegexFinder, MAIL_HTML_SCAN_LIMIT } from '../../../shared/htmlScan';

// Tested against a trimmed value with any trailing `;` removed. One whitespace group only:
// adjacent `\s*` groups made a long run of spaces backtrack in cubic time on hostile mail.
const NEUTRAL_VALUE = /^(?:transparent|inherit|initial|unset|none|currentcolor)(?:\s*!important)?$/i;

function isNeutralValue(value: string): boolean {
  let trimmed = value.trim();
  if (trimmed.endsWith(';')) trimmed = trimmed.slice(0, -1).trimEnd();
  return NEUTRAL_VALUE.test(trimmed);
}

/**
 * Mail larger than this is not scanned: it is almost always a designed
 * newsletter, and keeping its own white canvas is the safe default.
 */
export const EMAIL_CANVAS_SCAN_LIMIT = MAIL_HTML_SCAN_LIMIT;

const LAYOUT_WIDTH_PX = 480;

function declarationValues(css: string, property: RegExp): string[] {
  const values: string[] = [];
  const pattern = new RegExp(`(?:^|[;{\\s"'])(?:${property.source})\\s*:\\s*([^;}"']*)`, 'gi');
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(css)) !== null) values.push(match[1]);
  return values;
}

function hasNonNeutral(values: string[]): boolean {
  return values.some(value => value.trim() !== '' && !isNeutralValue(value));
}

function styleHasCanvas(css: string): boolean {
  if (!css) return false;
  if (hasNonNeutral(declarationValues(css, /background-color|background-image|background/))) return true;
  return hasNonNeutral(declarationValues(css, /(?<![-\w])color/));
}

const TAG_NAME = /^<([a-z][a-z0-9]*)/i;
const INLINE_STYLE_DOUBLE = /\sstyle\s*=\s*"([^"]*)"/gi;
const INLINE_STYLE_SINGLE = /\sstyle\s*=\s*'([^']*)'/gi;
const BACKGROUND_ATTR = /\sbackground\s*=\s*["']?[^\s"'>]/i;
const FONT_COLOR_ATTR = /\scolor\s*=/i;
const WIDTH_ATTR = /\swidth\s*=\s*["']?(\d+)(?:px)?["']?/i;
const WIDTH_STYLE = /width\s*:\s*(\d+)px/i;

function inlineStyles(tag: string): string {
  if (!/style/i.test(tag)) return '';
  const parts: string[] = [];
  for (const match of tag.matchAll(INLINE_STYLE_DOUBLE)) parts.push(match[1]);
  for (const match of tag.matchAll(INLINE_STYLE_SINGLE)) parts.push(match[1]);
  return parts.join(';');
}

function tableIsLayout(tag: string): boolean {
  const widthAttr = WIDTH_ATTR.exec(tag);
  if (widthAttr && Number(widthAttr[1]) >= LAYOUT_WIDTH_PX) return true;
  const widthStyle = WIDTH_STYLE.exec(tag);
  return Boolean(widthStyle && Number(widthStyle[1]) >= LAYOUT_WIDTH_PX);
}

export function htmlHasOwnCanvas(html: string): boolean {
  if (!html) return false;
  if (html.length > EMAIL_CANVAS_SCAN_LIMIT) return true;
  if (!html.trim()) return false;

  // Background attributes anywhere (linear: a literal followed by `\s*=`).
  if (/\bbgcolor\s*=/i.test(html)) return true;

  // Case-insensitive search on `html` itself: a lower-cased copy can change
  // length (some Unicode characters) and misalign indices.
  const nextStyleClose = createForwardRegexFinder(html, '</style');
  let tableCount = 0;
  let cursor = 0;
  while (cursor < html.length) {
    const open = html.indexOf('<', cursor);
    if (open === -1) break;
    const close = html.indexOf('>', open + 1);
    // No more closed tags: nothing left can match a tag pattern.
    if (close === -1) break;
    cursor = close + 1;

    const tag = html.slice(open, close + 1);
    const name = TAG_NAME.exec(tag)?.[1]?.toLowerCase();
    if (!name) continue;

    if (name === 'style') {
      // <style> blocks: backgrounds and explicit text colours. An unterminated
      // block runs to the end of the document, as a browser would parse it.
      const end = nextStyleClose(cursor);
      const css = html.slice(cursor, end === -1 ? html.length : end);
      if (styleHasCanvas(css)) return true;
      if (end === -1) break;
      cursor = end;
      continue;
    }

    if (BACKGROUND_ATTR.test(tag)) return true;
    // Quoted-reply blocks (Gmail, Apple Mail, Outlook) style their quote bar
    // and grey text; that is not a canvas.
    // A dark theme would make designed dark text unreadable, so any colour counts.
    if (name !== 'blockquote' && styleHasCanvas(inlineStyles(tag))) return true;
    if (name === 'font' && FONT_COLOR_ATTR.test(tag)) return true;

    // Newsletter layout: fixed-width tables, or three or more tables.
    if (name === 'table') {
      if (tableIsLayout(tag)) return true;
      tableCount += 1;
      if (tableCount >= 3) return true;
    }
  }

  return false;
}
