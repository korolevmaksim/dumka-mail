// "Reply in my voice": short excerpts of the person's own earlier messages,
// handed to the model with a reply-draft request so the draft is written the
// way they write (greeting, sign-off, length, formality, language habits)
// instead of in a generic assistant voice.
//
// What is chosen, in this order, newest first within each step:
//   1. messages they sent to the person they are now answering;
//   2. messages they sent to someone at the same organisation (never for a
//      public mail provider: two gmail.com addresses are not colleagues);
//   3. their other recent messages.
// Never drafts, never a message of the conversation being answered (the
// model already has those), never quoted history or the signature block, and
// only text with something to learn from.
//
// The excerpts are the person's own writing, bounded and passed through the
// same redaction as thread excerpts (API keys, tokens, addresses; it does not
// recognise every private detail). They leave the machine only with a draft
// request that the account already allows to carry mail text.
// Pure and dependency-free.
import { boundText, stripQuotedHistory } from './agentPrompts';
import { htmlToText, redactSecrets } from './aiContext';
import { isFreeMailDomain, registrableDomain } from './decision';
import type { MailMessage, Recipient } from './types';

export const REPLY_STYLE_MAX_SAMPLES = 3;
export const REPLY_STYLE_SAMPLE_MAX = 600;
/** Shorter than this teaches nothing ("Thanks!", "Ok"). */
export const REPLY_STYLE_SAMPLE_MIN = 40;
/** How many of the person's recent messages are looked at. */
export const REPLY_STYLE_SCAN_LIMIT = 300;

export type ReplyStyleMatch = 'recipient' | 'organisation' | 'recent';

export interface ReplyStyleSample {
  /** Who the earlier message was written to (first recipient). */
  to: string;
  date: string;
  text: string;
  match: ReplyStyleMatch;
}

/** The fields of an own message the selection reads. */
export type OwnMessage = Pick<MailMessage, 'id' | 'threadId' | 'receivedAt' | 'labelIds' | 'bodyPlain' | 'bodyHtml' | 'snippet'> & {
  to?: readonly Recipient[] | null;
  cc?: readonly Recipient[] | null;
};

export interface ReplyStyleSettingsSource {
  ai?: { replyStyleFromSent?: unknown } | null;
}

/** On unless switched off. */
export function replyStyleEnabled(settings: ReplyStyleSettingsSource | null | undefined): boolean {
  return settings?.ai?.replyStyleFromSent !== false;
}

function normalize(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

type RecipientMessage = Pick<MailMessage, 'senderEmail' | 'receivedAt'> & {
  labelIds?: readonly string[] | null;
  to?: readonly Recipient[] | null;
};

function isOwn(message: RecipientMessage, account: string): boolean {
  if (normalize(message.senderEmail) === account) return true;
  // Send-as aliases do not match the account address but are labelled SENT.
  return (message.labelIds || []).some(label => String(label).toUpperCase() === 'SENT');
}

/**
 * Who a reply to this conversation is written to, as the reply editor
 * resolves it: the newest message decides. An inbound one is answered to its
 * sender; the account's own one (a follow-up) goes to the people it was
 * addressed to. Only when that own message names nobody else does the newest
 * inbound sender stand in. '' when unknown.
 */
export function replyRecipientEmail(messages: readonly RecipientMessage[], accountEmail: string): string {
  const account = normalize(accountEmail);
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const last = ordered[ordered.length - 1];
  if (!last) return '';
  if (!isOwn(last, account)) {
    const sender = normalize(last.senderEmail);
    if (sender) return sender;
  } else {
    const recipient = (last.to || []).map(entry => normalize(entry.email)).find(email => email && email !== account);
    if (recipient) return recipient;
  }
  for (let index = ordered.length - 2; index >= 0; index -= 1) {
    const sender = normalize(ordered[index].senderEmail);
    if (sender && !isOwn(ordered[index], account)) return sender;
  }
  return '';
}

const SIGNATURE_DELIMITER = /^--\s*$/;

/**
 * Cuts the signature block: everything from a `--` delimiter line, or from
 * the first line of the account's own signature when it starts a line after
 * the opening one.
 */
export function stripSignature(text: string, signaturePlain?: string | null): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  let cut = lines.findIndex(line => SIGNATURE_DELIMITER.test(line));
  const firstSignatureLine = (signaturePlain || '').split('\n').map(line => line.trim()).find(line => line.length >= 4);
  if (firstSignatureLine) {
    const needle = firstSignatureLine.toLowerCase();
    const index = lines.findIndex((line, position) => position > 0 && line.trim().toLowerCase() === needle);
    if (index > 0 && (cut < 0 || index < cut)) cut = index;
  }
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trimEnd();
}

// Where quoted mail starts in an HTML body. Everything from the earliest of
// these on is somebody else's text (or the person's older text): a reply
// written above the quotation keeps its own part, an interleaved reply loses
// what follows the first quotation, which is the safe side.
const HTML_QUOTE_MARKERS: readonly RegExp[] = [
  /<blockquote\b/i,
  /<div\b[^>]*\bclass\s*=\s*["'][^"']*\b(?:gmail_quote|gmail_extra|gmail_attr|yahoo_quoted|moz-cite-prefix|protonmail_quote)\b/i,
  /<div\b[^>]*\bid\s*=\s*["'](?:divRplyFwdMsg|appendonsend|mail-editor-reference-message-container)["']/i,
  // Outlook's separator line above the quoted headers.
  /<div\b[^>]*\bstyle\s*=\s*["'][^"']*border-top\s*:\s*solid\s+#[0-9a-f]{6}/i,
  /<hr\b[^>]*\bid\s*=\s*["']stopSpelling["']/i,
];

/** An HTML body up to where quoted mail starts. */
export function stripQuotedHtml(html: string): string {
  let cut = html.length;
  for (const marker of HTML_QUOTE_MARKERS) {
    const match = marker.exec(html);
    if (match && match.index < cut) cut = match.index;
  }
  return html.slice(0, cut);
}

// Flattened text has no lines left, so the quote headers that
// `stripQuotedHistory` recognises at the start of a line are looked for
// anywhere. Everything from the first one on is dropped.
const FLAT_QUOTE_HEADERS: readonly RegExp[] = [
  // Case-sensitive: the header opens with a capital "On"; an ordinary "on
  // Monday" earlier in the person's own sentence must not start the cut.
  /\bOn\s.{1,300}?\swrote:/,
  /-{2,}\s*Original Message\s*-{2,}/i,
  /-{2,}\s*Forwarded message\s*-{2,}/i,
  /\bFrom:\s.{1,200}?\s(?:Sent|Date):\s/i,
];

// `stripQuotedHistory` knows the English quote headers. Mail clients write
// them in the language of their interface, and Outlook quotes without `>`
// marks, so everything below such a header is somebody else's text.
// The verb is not always last ("… schrieb Priya Raman:"), so the line only has to end with a colon.
const QUOTE_ATTRIBUTION = /(?:пишет|написала?|написал\(а\)|schrieb|a écrit|escribió|ha scritto|napisał(?:\(a\))?|escreveu)[^\n]{0,120}:\s*$/i;
/** Gmail's header in several languages ends with the quoted address and a colon. */
const ADDRESS_ATTRIBUTION = /<[^<>\s]+@[^<>\s]+>\s*:\s*$/;
const LOCAL_SEPARATOR = /^\s*-{2,}\s*(?:Исходное сообщение|Пересылаемое сообщение|Пересланное сообщение|Ursprüngliche Nachricht|Message d'origine|Mensaje original)\s*-{2,}\s*$/i;
const LOCAL_FROM = /^\s*(?:От|Von|De|Da)\s*:\s*\S/i;
const LOCAL_SENT = /^\s*(?:Отправлено|Дата|Gesendet|Envoyé|Enviado el|Enviado|Inviato)\s*:/i;

/** A plain body up to the first quote header written in another language than English. */
function cutAtLocalQuoteHeader(text: string): string {
  const lines = text.split('\n');
  const cut = lines.findIndex((line, index) => (
    QUOTE_ATTRIBUTION.test(line)
    || ADDRESS_ATTRIBUTION.test(line)
    || LOCAL_SEPARATOR.test(line)
    || (LOCAL_FROM.test(line) && LOCAL_SENT.test(lines[index + 1] || ''))
  ));
  return (cut >= 0 ? lines.slice(0, cut) : lines).join('\n').trimEnd();
}

/** The same attributions inside flattened text, where no line ends remain. */
const FLAT_LOCAL_ATTRIBUTION = /(?:пишет|написала?|написал\(а\)|schrieb|a écrit|escribió|ha scritto|escreveu)[^:]{0,120}:|<[^<>\s]+@[^<>\s]+>\s*:|-{2,}\s*(?:Исходное сообщение|Пересылаемое сообщение|Пересланное сообщение)\s*-{2,}/i;

function stripFlattenedQuote(text: string): string {
  let cut = text.length;
  for (const header of [...FLAT_QUOTE_HEADERS, FLAT_LOCAL_ATTRIBUTION]) {
    const match = header.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut).trimEnd();
}

/**
 * What the person wrote in a message, without the mail it quotes. The plain
 * body keeps its lines, so quoted history is cut there line by line. An
 * HTML-only body is cut where its quotation markup starts, before it is
 * flattened to text (afterwards a quotation is no longer distinguishable),
 * and then once more at a quote header left in the text.
 */
export function ownAuthoredText(message: Pick<MailMessage, 'bodyPlain' | 'bodyHtml' | 'snippet'>): string {
  const plain = (message.bodyPlain ?? '').trim();
  const html = (message.bodyHtml ?? '').trim();
  const snippet = (message.snippet ?? '').trim();
  // The same choice of body as `messagePlainText`: a plain body that only
  // repeats the snippet is a placeholder for the HTML one.
  if (plain && !(html && plain === snippet)) return cutAtLocalQuoteHeader(stripQuotedHistory(plain));
  if (html) return stripFlattenedQuote(htmlToText(stripQuotedHtml(html)));
  return stripFlattenedQuote(cutAtLocalQuoteHeader(stripQuotedHistory(plain || snippet)));
}

/** The person's own words in a message: no quoted history, no signature, keys and tokens redacted, bounded. */
export function replyStyleText(message: Pick<MailMessage, 'bodyPlain' | 'bodyHtml' | 'snippet'>, signaturePlain?: string | null): string {
  const own = stripSignature(ownAuthoredText(message), signaturePlain);
  return boundText(redactSecrets(own), REPLY_STYLE_SAMPLE_MAX);
}

export interface ReplyStyleSelection {
  accountEmail: string;
  /** Who the reply is for (`replyRecipientEmail`); '' selects recent messages only. */
  recipientEmail: string;
  /** The conversation being answered: its messages are never samples. */
  excludeThreadId?: string | null;
  /** The account's plain-text signature, cut from the samples. */
  signaturePlain?: string | null;
  limit?: number;
}

function hasLabel(message: OwnMessage, label: string): boolean {
  return message.labelIds.some(value => String(value).toUpperCase() === label);
}

function matchOf(message: OwnMessage, recipient: string, organisation: string, account: string): ReplyStyleMatch {
  const addresses = [...(message.to || []), ...(message.cc || [])].map(entry => normalize(entry.email)).filter(email => email && email !== account);
  if (recipient && (message.to || []).some(entry => normalize(entry.email) === recipient)) return 'recipient';
  if (organisation && addresses.some(email => registrableDomain(email) === organisation)) return 'organisation';
  return 'recent';
}

const MATCH_ORDER: readonly ReplyStyleMatch[] = ['recipient', 'organisation', 'recent'];

/**
 * Up to `limit` samples from the person's own messages (any order in, best
 * first out). See the module comment for what is chosen and what never is.
 */
export function selectReplyStyleSamples(messages: readonly OwnMessage[], selection: ReplyStyleSelection): ReplyStyleSample[] {
  const limit = Math.max(0, Math.min(REPLY_STYLE_MAX_SAMPLES, Math.floor(selection.limit ?? REPLY_STYLE_MAX_SAMPLES)));
  if (limit === 0) return [];
  const account = normalize(selection.accountEmail);
  const recipient = normalize(selection.recipientEmail);
  const recipientDomain = recipient ? registrableDomain(recipient) : '';
  const organisation = recipientDomain && !isFreeMailDomain(recipientDomain) ? recipientDomain : '';

  const candidates: Array<ReplyStyleSample & { time: number }> = [];
  const seenText = new Set<string>();
  const newestFirst = [...messages].sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
  for (const message of newestFirst) {
    if (hasLabel(message, 'DRAFT')) continue;
    if (selection.excludeThreadId && message.threadId === selection.excludeThreadId) continue;
    const firstRecipient = (message.to || []).map(entry => normalize(entry.email)).find(email => email && email !== account);
    // A note to oneself or a message without a recipient is not correspondence.
    if (!firstRecipient) continue;
    const text = replyStyleText(message, selection.signaturePlain);
    if (text.length < REPLY_STYLE_SAMPLE_MIN) continue;
    // The same text sent to several people teaches once.
    const fingerprint = text.toLowerCase().replace(/\s+/g, ' ').slice(0, 160);
    if (seenText.has(fingerprint)) continue;
    seenText.add(fingerprint);
    candidates.push({
      to: firstRecipient,
      date: message.receivedAt,
      text,
      match: matchOf(message, recipient, organisation, account),
      time: Date.parse(message.receivedAt) || 0,
    });
  }

  const chosen: ReplyStyleSample[] = [];
  for (const match of MATCH_ORDER) {
    for (const candidate of candidates) {
      if (chosen.length >= limit) break;
      if (candidate.match !== match) continue;
      chosen.push({ to: candidate.to, date: candidate.date, text: candidate.text, match: candidate.match });
    }
  }
  return chosen;
}

/** The plain-text signature an account signs with (its own, else the default one). */
export function accountSignaturePlain(
  settings: { compose?: { defaultSignature?: unknown; signaturesByAccount?: unknown } | null } | null | undefined,
  accountId: string,
): string {
  const compose = settings?.compose;
  const byAccount = compose?.signaturesByAccount;
  const key = normalize(accountId);
  if (byAccount && typeof byAccount === 'object' && !Array.isArray(byAccount)) {
    const entry = (byAccount as Record<string, unknown>)[key];
    const own = entry && typeof entry === 'object' ? (entry as { signaturePlain?: unknown }).signaturePlain : undefined;
    if (typeof own === 'string' && own.trim()) return own;
  }
  return typeof compose?.defaultSignature === 'string' ? compose.defaultSignature : '';
}
