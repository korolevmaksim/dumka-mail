// Pure, dependency-free port of the Swift `MessageBodyRenderPlan` logic
// (PersonalMailClient/UI/Thread/MessageBodyRenderPlan.swift).
//
// This module runs in BOTH the Electron main process and the React renderer,
// so it must stay free of electron / node / fs / react / DOM imports. Only
// standard JS/TS and relative imports from other `shared/` files are allowed.

import type { AttachmentMetadata } from './types';
import { htmlToText } from './aiContext';

/**
 * Maximum number of characters rendered inline for a plain-text body before it
 * is truncated behind a "Show full text" affordance. Mirrors the Swift
 * `initialPlainTextCharacterLimit = 12_000`.
 */
export const INITIAL_PLAINTEXT_LIMIT = 12000;

export interface MessageBodyRenderPlan {
  /** The text to render immediately (truncated copy when `truncated` is true). */
  text: string;
  /** True when the source text exceeded the cap and `text` is a shortened copy. */
  truncated: boolean;
  /** Length (in JS string units) of the untruncated source text. */
  fullLength: number;
}

/**
 * True when an HTML body has enough content to prefer it over the plain-text
 * alternative. Some Gmail messages contain either empty HTML wrappers or only
 * an HTML signature while the multipart/alternative plain-text part contains
 * the complete message.
 */
export function hasRenderableHtmlBody(
  html: string | null | undefined,
  plainText?: string | null,
): boolean {
  if (!html?.trim()) {
    return false;
  }

  const readableHtml = normalizeBodyText(htmlToText(html));
  const readablePlain = normalizeBodyText(plainText || '');
  if (readableHtml) {
    const plainContainsHtml = readablePlain.includes(readableHtml);
    const substantialMissingText = readablePlain.length - readableHtml.length >= 80;
    if (plainContainsHtml && substantialMissingText) {
      return false;
    }
    return true;
  }

  // Keep image-only and other intentionally visual email bodies on the HTML
  // path even when they have no readable text nodes.
  return /<(?:img|picture|svg|canvas|video|audio|hr)\b/i.test(html)
    || /\bbackground\s*=/i.test(html)
    || /\bbackground(?:-image)?\s*:\s*[^;}]*\b(?:url|linear-gradient|radial-gradient)\s*\(/i.test(html);
}

function normalizeBodyText(text: string): string {
  return text
    .replace(/\uFFFC/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Build a render plan for a plain-text message body.
 *
 * When `text` is at or below `cap` characters it is returned verbatim and
 * `truncated` is false. When longer, the result is cut to `cap` characters,
 * backed off to the nearest preceding word boundary (so a word is never split),
 * trimmed of surrounding whitespace, and suffixed with `"\n\n..."` — mirroring
 * the Swift `cappedPlainText` behavior with an added word-boundary refinement.
 *
 * @param cap maximum inline characters (default {@link INITIAL_PLAINTEXT_LIMIT}).
 */
export function planPlainText(text: string, cap: number = INITIAL_PLAINTEXT_LIMIT): MessageBodyRenderPlan {
  const fullLength = text.length;

  if (cap < 0 || fullLength <= cap) {
    return { text, truncated: false, fullLength };
  }

  let cut = cap;

  // Only back off to a word boundary when the cap would split a word, i.e. the
  // character at the boundary and the one before it are both non-whitespace.
  const boundaryChar = text.charAt(cap);
  const precedingChar = text.charAt(cap - 1);
  const splitsWord =
    boundaryChar !== '' && !isWhitespace(boundaryChar) && !isWhitespace(precedingChar);

  if (splitsWord) {
    const lastBoundary = lastWhitespaceIndex(text, cap);
    if (lastBoundary > 0) {
      cut = lastBoundary;
    }
  }

  const prefix = text.slice(0, cut).trim();
  return { text: `${prefix}\n\n...`, truncated: true, fullLength };
}

/**
 * Replace `cid:` references in inline HTML images with `data:` URIs sourced from
 * matching attachments.
 *
 * An attachment qualifies when it has a non-empty `contentId`, an image MIME
 * type (`image/*`), and inline `base64Data`. Content-IDs are normalized on both
 * sides (percent-decoded, trimmed, angle-brackets stripped, lowercased) before
 * matching, mirroring the Swift `resolvingInlineImageCIDs`. References whose
 * content-id has no qualifying attachment are left untouched.
 *
 * The regex matches any `cid:<token>` occurrence, covering `src="cid:x"`,
 * `src='cid:x'`, and `url(cid:x)` forms alike.
 */
export function resolveInlineCids(html: string, attachments: AttachmentMetadata[]): string {
  if (!html) {
    return html;
  }

  const dataUrlByContentId = new Map<string, string>();
  for (const attachment of attachments ?? []) {
    const contentId = normalizeContentId(attachment?.contentId);
    if (!contentId || dataUrlByContentId.has(contentId)) {
      continue;
    }
    const inlineData = normalizeInlineBase64(attachment?.base64Data);
    if (!inlineData) {
      continue;
    }
    const mimeType = attachment?.mimeType ?? '';
    if (!mimeType.toLowerCase().startsWith('image/')) {
      continue;
    }
    dataUrlByContentId.set(contentId, `data:${mimeType};base64,${inlineData}`);
  }

  if (dataUrlByContentId.size === 0) {
    return html;
  }

  return html.replace(/cid:([^"'\s>)]+)/g, (whole, rawReference: string) => {
    const contentId = normalizeContentId(rawReference);
    if (!contentId) {
      return whole;
    }
    return dataUrlByContentId.get(contentId) ?? whole;
  });
}

function isWhitespace(char: string): boolean {
  return /\s/.test(char);
}

function lastWhitespaceIndex(text: string, limit: number): number {
  for (let index = limit - 1; index >= 0; index -= 1) {
    if (isWhitespace(text.charAt(index))) {
      return index;
    }
  }
  return -1;
}

function normalizeContentId(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  let decoded = value;
  try {
    decoded = decodeURIComponent(value);
  } catch {
    decoded = value;
  }
  let normalized = decoded.trim();
  if (normalized.startsWith('<')) {
    normalized = normalized.slice(1);
  }
  if (normalized.endsWith('>')) {
    normalized = normalized.slice(0, -1);
  }
  normalized = normalized.trim().toLowerCase();
  return normalized.length === 0 ? null : normalized;
}

function normalizeInlineBase64(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim().replace(/\s/g, '');
  if (trimmed.length === 0) {
    return null;
  }
  const normalized = trimmed.replace(/-/g, '+').replace(/_/g, '/');
  const remainder = normalized.length % 4;
  return remainder === 0 ? normalized : `${normalized}${'='.repeat(4 - remainder)}`;
}
