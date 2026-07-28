/**
 * Serialization of locally cached mail into .mbox (mboxrd) entries.
 *
 * Format decisions:
 * - Line endings are LF throughout. mbox readers (Thunderbird, Apple Mail,
 *   Python `mailbox`) accept LF, and mixing CRLF into an LF-delimited archive
 *   would corrupt message splitting.
 * - Bodies are quoted-printable, not base64: QP keeps the archive
 *   human-readable and grep-able (most mail is ASCII-heavy), encodes UTF-8
 *   losslessly, and handles the 76-char line limit with soft breaks. Base64
 *   would obscure the text for no robustness gain.
 * - Non-ASCII header values use RFC 2047 encoded-words (`=?UTF-8?B?...?=`),
 *   chunked so each word stays well under the 75-char encoded-word limit.
 * - Attachments are NOT exported: the local cache stores attachment metadata
 *   only (bytes are fetched from Gmail on demand and never persisted), so an
 *   export contains message text and headers only. This is a deliberate
 *   local-first trade-off, mirrored in the export UI copy.
 */
import { htmlFragmentToPlainText } from './draftHtml';
import type { MailMessage, Recipient } from './types';

export type MailboxExportScope = 'all' | 'inbox' | 'sent';

export interface MailboxExportProgress {
  accountId: string;
  scope: MailboxExportScope;
  processedThreads: number;
  totalThreads: number;
  processedMessages: number;
  state: 'running' | 'done' | 'cancelled' | 'failed';
  filePath?: string;
  message?: string;
}

export interface MailboxExportSuccess {
  ok: true;
  cancelled?: false;
  filePath: string;
  exportedMessages: number;
}

export interface MailboxExportCancelled {
  ok: false;
  cancelled: true;
}

export interface MailboxExportFailed {
  ok: false;
  cancelled?: false;
  message: string;
}

export type MailboxExportResult = MailboxExportSuccess | MailboxExportCancelled | MailboxExportFailed;

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const HEADER_LINE_LIMIT = 78;
const QP_LINE_LIMIT = 76;
// 10 code points encode to at most 40 UTF-8 bytes / 56 Base64 chars, keeping
// every encoded-word comfortably below the RFC 2047 75-char limit.
const MAX_CODE_POINTS_PER_ENCODED_WORD = 10;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/** RFC 2822 date (`Tue, 28 Jul 2026 12:37:54 +0000`), rendered in UTC. */
export function formatRfc2822Date(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.replace(/[\r\n]+/g, ' ').trim();
  }
  return `${DAY_NAMES[date.getUTCDay()]}, ${pad2(date.getUTCDate())} ${MONTH_NAMES[date.getUTCMonth()]} `
    + `${date.getUTCFullYear()} ${pad2(date.getUTCHours())}:${pad2(date.getUTCMinutes())}:${pad2(date.getUTCSeconds())} +0000`;
}

/** Traditional `asctime()` date used after the mbox `From ` separator. */
export function formatMboxSeparatorDate(iso: string): string {
  const date = new Date(iso);
  const safe = Number.isNaN(date.getTime()) ? new Date(0) : date;
  // The day of month is space-padded, matching C asctime().
  return `${DAY_NAMES[safe.getUTCDay()]} ${MONTH_NAMES[safe.getUTCMonth()]} `
    + `${String(safe.getUTCDate()).padStart(2, ' ')} ${pad2(safe.getUTCHours())}:${pad2(safe.getUTCMinutes())}:${pad2(safe.getUTCSeconds())} `
    + `${safe.getUTCFullYear()}`;
}

function base64EncodeUtf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = '';
  const CHUNK_SIZE = 0x2000;
  for (let index = 0; index < bytes.length; index += CHUNK_SIZE) {
    binary += String.fromCharCode(...bytes.subarray(index, index + CHUNK_SIZE));
  }
  return btoa(binary);
}

/**
 * Header-safe text: printable ASCII goes out verbatim, anything else becomes
 * RFC 2047 encoded-words. CR/LF are stripped up front (header injection).
 */
export function encodeHeaderText(text: string): string {
  const clean = text.replace(/[\r\n]+/g, ' ').trim();
  if (!clean) return '';
  if (/^[\x20-\x7E]*$/.test(clean)) return clean;
  const codePoints = Array.from(clean);
  const words: string[] = [];
  for (let index = 0; index < codePoints.length; index += MAX_CODE_POINTS_PER_ENCODED_WORD) {
    const chunk = codePoints.slice(index, index + MAX_CODE_POINTS_PER_ENCODED_WORD).join('');
    words.push(`=?UTF-8?B?${base64EncodeUtf8(chunk)}?=`);
  }
  return words.join(' ');
}

function encodeMailbox(recipient: Recipient): string {
  const email = (recipient.email || '').replace(/[\r\n]+/g, '').trim();
  const name = (recipient.name || '').replace(/[\r\n]+/g, ' ').trim();
  if (!name || name === email) return email;
  if (/^[\x20-\x7E]*$/.test(name)) {
    // Quote display names containing RFC 2822 specials.
    if (/[()<>@,;:\\".[\]]/.test(name)) {
      return `"${name.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}" <${email}>`;
    }
    return `${name} <${email}>`;
  }
  return `${encodeHeaderText(name)} <${email}>`;
}

function encodeMailboxList(recipients: Recipient[]): string {
  return (recipients || []).map(encodeMailbox).filter(Boolean).join(', ');
}

/** Fold a header line to <= 78 columns; continuation lines start with a space. */
function foldHeader(name: string, value: string): string[] {
  const line = `${name}: ${value}`;
  if (line.length <= HEADER_LINE_LIMIT) return [line];
  const lines: string[] = [];
  let rest = line;
  let limit = HEADER_LINE_LIMIT;
  while (rest.length > limit) {
    let foldAt = rest.lastIndexOf(' ', limit);
    if (foldAt <= 0) foldAt = limit; // no fold point: hard-break the token
    lines.push(rest.slice(0, foldAt));
    rest = ` ${rest.slice(foldAt + 1)}`;
    limit = HEADER_LINE_LIMIT - 1;
  }
  lines.push(rest);
  return lines;
}

/**
 * Quoted-printable per RFC 2045: printable ASCII passes through, `=` and all
 * non-printable / UTF-8 bytes become `=XX`, trailing whitespace is encoded,
 * and lines soft-wrap at 76 chars with a trailing `=`.
 */
export function encodeQuotedPrintable(text: string): string {
  const normalized = text.replace(/\r\n?/g, '\n');
  const outLines: string[] = [];
  for (const sourceLine of normalized.split('\n')) {
    const bytes = new TextEncoder().encode(sourceLine);
    let line = '';
    for (let index = 0; index < bytes.length; index += 1) {
      const byte = bytes[index];
      const isLast = index === bytes.length - 1;
      let token: string;
      if (byte === 0x3d) {
        token = '=3D';
      } else if ((byte >= 33 && byte <= 60) || (byte >= 62 && byte <= 126)) {
        token = String.fromCharCode(byte);
      } else if ((byte === 0x20 || byte === 0x09) && !isLast) {
        token = String.fromCharCode(byte);
      } else {
        // Control bytes, UTF-8 lead/continuation bytes, trailing whitespace.
        token = `=${byte.toString(16).toUpperCase().padStart(2, '0')}`;
      }
      if (line.length + token.length > QP_LINE_LIMIT - 1) {
        outLines.push(`${line}=`);
        line = '';
      }
      line += token;
    }
    outLines.push(line);
  }
  return outLines.join('\n');
}

/**
 * mboxrd escaping: any line beginning with (zero or more `>` followed by)
 * `From ` gains one more `>`, so readers never mistake body content for a
 * message separator.
 */
export function escapeMboxFromLines(text: string): string {
  return text.replace(/^(>*)From /gm, '>$1From ');
}

function sanitizeHeaderValue(value: string): string {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

function chooseBoundary(message: MailMessage, bodyHtml: string): string {
  const seed = `${message.accountId}-${message.id}`.replace(/[^A-Za-z0-9]/g, '').slice(0, 40) || 'message';
  let boundary = `----=_Dumka_MBox_${seed}`;
  // Boundaries must not appear inside the body; extend until they do not.
  while (bodyHtml.includes(boundary)) {
    boundary += '_x';
  }
  return boundary;
}

/** Builds the RFC-822/MIME headers and body for one cached message. */
export function buildMimeEntity(message: MailMessage): { headers: string[]; body: string } {
  const headers: string[] = [];
  const pushHeader = (name: string, value: string) => {
    if (value) headers.push(...foldHeader(name, value));
  };

  pushHeader('From', encodeMailbox({ name: message.senderName, email: message.senderEmail }));
  pushHeader('To', encodeMailboxList(message.to || []));
  if (message.cc?.length) pushHeader('Cc', encodeMailboxList(message.cc));
  if (message.bcc?.length) pushHeader('Bcc', encodeMailboxList(message.bcc));
  pushHeader('Date', formatRfc2822Date(message.receivedAt));
  if (message.subject) pushHeader('Subject', encodeHeaderText(message.subject));
  const messageId = sanitizeHeaderValue(message.rfcMessageId || '');
  if (messageId) pushHeader('Message-ID', messageId.startsWith('<') ? messageId : `<${messageId}>`);
  const inReplyTo = sanitizeHeaderValue(message.rfcInReplyTo || '');
  if (inReplyTo) pushHeader('In-Reply-To', inReplyTo);
  const references = sanitizeHeaderValue(message.rfcReferences || '');
  if (references) pushHeader('References', references);
  if (message.labelIds?.length) {
    pushHeader('X-Gmail-Labels', message.labelIds.map(sanitizeHeaderValue).filter(Boolean).join(', '));
  }
  if (message.accountId) pushHeader('X-Dumka-Account', sanitizeHeaderValue(message.accountId));
  headers.push('MIME-Version: 1.0');

  const bodyPlain = (message.bodyPlain || '').trim();
  const bodyHtml = (message.bodyHtml || '').trim();
  // A plain part always exists: when the cache only holds HTML, the text is
  // derived from it so the export stays readable in plain-text clients.
  const effectivePlain = bodyPlain || (bodyHtml ? htmlFragmentToPlainText(bodyHtml) : '');

  let body: string;
  if (effectivePlain && bodyHtml) {
    const boundary = chooseBoundary(message, bodyHtml);
    headers.push(`Content-Type: multipart/alternative; boundary="${boundary}"`);
    body = [
      `--${boundary}`,
      'Content-Type: text/plain; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      encodeQuotedPrintable(effectivePlain),
      `--${boundary}`,
      'Content-Type: text/html; charset=utf-8',
      'Content-Transfer-Encoding: quoted-printable',
      '',
      encodeQuotedPrintable(bodyHtml),
      `--${boundary}--`,
    ].join('\n');
  } else if (bodyHtml) {
    // The derived plain text came out empty; keep the HTML as a single part.
    headers.push('Content-Type: text/html; charset=utf-8');
    headers.push('Content-Transfer-Encoding: quoted-printable');
    body = encodeQuotedPrintable(bodyHtml);
  } else {
    headers.push('Content-Type: text/plain; charset=utf-8');
    headers.push('Content-Transfer-Encoding: quoted-printable');
    body = encodeQuotedPrintable(effectivePlain);
  }

  return { headers, body };
}

/**
 * Serializes one cached message into a complete mbox entry: the `From `
 * separator line, the MIME message, and the trailing blank line that mbox
 * readers expect before the next entry.
 */
export function messageToMboxEntry(message: MailMessage): string {
  const { headers, body } = buildMimeEntity(message);
  const sender = (message.senderEmail || '').trim()
    || (message.accountId || '').trim()
    || 'unknown';
  const separator = `From ${sender} ${formatMboxSeparatorDate(message.receivedAt)}`;
  // Escaping runs over the whole serialized message. Header lines can never
  // begin with "From " (they are "Name: value"), so this only touches bodies.
  const escapedBody = escapeMboxFromLines(body);
  return `${separator}\n${headers.join('\n')}\n\n${escapedBody ? `${escapedBody}\n\n` : '\n'}`;
}

/** Default export file name: `dumka-export-<account>-YYYYMMDD.mbox` (UTC date). */
export function exportMboxFileName(accountId: string, date: Date): string {
  const safeAccount = accountId.trim().replace(/[^A-Za-z0-9._@-]+/g, '_') || 'mailbox';
  return `dumka-export-${safeAccount}-${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}.mbox`;
}
