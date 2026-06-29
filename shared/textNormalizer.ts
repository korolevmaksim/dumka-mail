// Pure text-normalization helpers for mail previews / snippets.
//
// Direct TypeScript port of the macOS Swift original
// `Models/MailTextNormalizer.swift` (`MailTextNormalizer`). Keep this file
// dependency-free: it is imported by both the Electron main process and the
// React renderer via the `shared/` layer, so it must not reference electron,
// node:*, fs, react, the DOM, or any other host global.

// Named HTML entities supported by the Swift original. Uses a Map (rather than
// a plain object) so that entity names colliding with Object.prototype members
// (e.g. "constructor", "toString") cannot accidentally resolve to a function.
const NAMED_ENTITIES = new Map<string, string>([
  ['amp', '&'],
  ['apos', "'"],
  ['gt', '>'],
  ['hellip', '...'],
  ['lt', '<'],
  ['mdash', '-'],
  ['nbsp', ' '],
  ['ndash', '-'],
  ['quot', '"'],
]);

// Mirrors the `entity.count <= 16` guard in the Swift source: a sequence
// longer than this between `&` and `;` is treated as literal text, not an
// entity (cheap protection against scanning pathological input).
const MAX_ENTITY_LENGTH = 16;

// Largest valid Unicode scalar value.
const MAX_UNICODE_SCALAR = 0x10ffff;

/**
 * Decodes named and numeric (decimal `&#NN;` and hex `&#xNN;`) HTML entities.
 *
 * Faithful port of `MailTextNormalizer.decodedHTMLEntities`. Notably, when a
 * `&…;` run does not resolve to a known entity (or has no closing `;`, or is
 * too long), the leading `&` is emitted verbatim and scanning resumes right
 * after it — so malformed/unknown sequences pass through unchanged.
 */
export function decodeHtmlEntities(s: string): string {
  // Fast path matching the Swift `guard text.contains("&")`.
  if (!s.includes('&')) return s;

  let result = '';
  let cursor = 0;

  while (true) {
    const ampersand = s.indexOf('&', cursor);
    if (ampersand === -1) break;

    // Emit everything up to (but excluding) the ampersand.
    result += s.slice(cursor, ampersand);

    const semicolon = s.indexOf(';', ampersand);
    if (semicolon === -1) {
      // No terminator: leave the rest of the string untouched.
      cursor = ampersand;
      break;
    }

    const entityStart = ampersand + 1;
    const entity = s.slice(entityStart, semicolon);

    let decoded: string | null = null;
    if (entity.length <= MAX_ENTITY_LENGTH) {
      decoded = decodedEntity(entity);
    }

    if (decoded !== null) {
      result += decoded;
      cursor = semicolon + 1;
    } else {
      // Unknown/oversized entity: keep the literal '&' and re-scan from the
      // character right after it.
      result += '&';
      cursor = entityStart;
    }
  }

  result += s.slice(cursor);
  return result;
}

function decodedEntity(entity: string): string | null {
  const named = NAMED_ENTITIES.get(entity);
  if (named !== undefined) return named;

  if (entity.startsWith('#x') || entity.startsWith('#X')) {
    return unicodeScalar(entity.slice(2), 16);
  }

  if (entity.startsWith('#')) {
    return unicodeScalar(entity.slice(1), 10);
  }

  return null;
}

function unicodeScalar(digits: string, radix: number): string | null {
  const value = parseStrictUInt(digits, radix);
  if (value === null) return null;

  // Reject out-of-range and surrogate code points, matching Swift's
  // `UnicodeScalar(value)` failable initializer.
  if (value > MAX_UNICODE_SCALAR) return null;
  if (value >= 0xd800 && value <= 0xdfff) return null;

  return String.fromCodePoint(value);
}

/**
 * Strictly parses an unsigned integer in the given radix. Mirrors Swift's
 * `UInt32(digits, radix:)`: the entire string must consist of valid digits for
 * the radix (no signs, whitespace, or prefixes), and it must be non-empty.
 */
function parseStrictUInt(digits: string, radix: number): number | null {
  if (digits.length === 0) return null;

  const pattern = radix === 16 ? /^[0-9a-fA-F]+$/ : /^[0-9]+$/;
  if (!pattern.test(digits)) return null;

  const value = parseInt(digits, radix);
  if (!Number.isFinite(value)) return null;
  return value;
}

/**
 * Collapses every run of whitespace (spaces, tabs, newlines, etc.) into a
 * single space and trims the result.
 */
export function normalizeWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Produces a clean single-line preview string: decodes HTML entities, then
 * collapses whitespace.
 */
export function normalizePreview(s: string): string {
  return normalizeWhitespace(decodeHtmlEntities(s));
}

/**
 * Keeps Gmail signature HTML formatting while removing active/scriptable content
 * before the signature is rendered in-app or embedded into outgoing mail.
 */
export function sanitizeGmailSignatureHtml(html: string): string {
  if (!html) return '';

  return html
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*'[^']*'/gi, '')
    .replace(/\s+on[a-z]+\s*=\s*[^\s>]+/gi, '')
    .replace(/\s+(href|src)\s*=\s*"[^"]*(?:javascript|vbscript):[^"]*"/gi, '')
    .replace(/\s+(href|src)\s*=\s*'[^']*(?:javascript|vbscript):[^']*'/gi, '')
    .replace(/\s+(href|src)\s*=\s*[^\s>]*(?:javascript|vbscript):[^\s>]*/gi, '')
    .trim();
}

/**
 * Converts Gmail's send-as signature HTML into the plain-text signature format
 * used by the current composer/snippet pipeline while preserving intentional
 * line breaks.
 */
export function gmailSignatureHtmlToPlainText(html: string): string {
  if (!html) return '';

  const withLineBreaks = sanitizeGmailSignatureHtml(html)
    .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(div|p|li|tr|h[1-6])>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '');

  return decodeHtmlEntities(withLineBreaks)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[ \t\f\v]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
