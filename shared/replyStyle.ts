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
import { boundText } from './agentPrompts';
import { redactSecrets } from './aiContext';
import { replyRecipients, type ReplyRecipientSource } from './compose';
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

/**
 * Who a reply to this conversation is written to: exactly what the reply
 * editor resolves (`replyRecipients` in `shared/compose.ts`, reply-all, for
 * the newest message), so the examples are chosen for the reply's real
 * audience. An inbound message is answered to its sender; the account's own
 * one (a follow-up, including a send-as message) goes to the people it was
 * addressed to, a Cc recipient when To names nobody else. '' when the editor
 * would have no recipient either.
 */
export function replyRecipientEmail(
  messages: ReadonlyArray<ReplyRecipientSource & Pick<MailMessage, 'receivedAt'>>,
  accountEmail: string,
): string {
  if (messages.length === 0) return '';
  const last = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt))[messages.length - 1];
  return normalize(replyRecipients(last, accountEmail, true).to[0]?.email);
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

// --- Where the person's own text ends ---------------------------------------------
//
// An example is taken only from a plain-text body, whose lines are real:
// everything from the first line that announces or carries quoted mail is
// dropped, wherever that line is. At the very top the result is empty, and
// the message is simply not an example. A reply written under or between
// quotations loses what follows the first one.
//
// A message that has only an HTML body is never an example. Turning HTML
// into text loses the line and block structure that separates what the
// person wrote from what they quoted (nested blocks, preformatted text,
// inline runs), and no amount of pattern matching makes that reliable.
// Mail sent through Gmail, and mail sent from this app, carries a plain-text
// part, so little is lost. Losing the person's own text is acceptable here;
// passing on somebody else's as theirs is not.

const QUOTED_LINE = /^\s*>/;
const SEPARATOR_LINE = /^\s*(?:-{2,}|_{5,})\s*(?:Original Message|Forwarded message|Исходное сообщение|Пересылаемое сообщение|Пересланное сообщение|Ursprüngliche Nachricht|Weitergeleitete Nachricht|Message d'origine|Message transféré|Mensaje original|Mensaje reenviado)?\s*(?:-{2,}|_{5,})?\s*$/i;
const FORWARD_LINE = /^\s*Begin forwarded message\s*:\s*$/i;
// Outlook writes the quoted headers of rich mail as "*From:* …" in the plain part.
const HEADER_FROM = /^\s*\*?(?:From|От|Von|De|Da)\s*:\*?\s*\S/i;
const HEADER_NEXT = /^\s*\*?(?:Sent|Date|To|Subject|Cc|Отправлено|Дата|Кому|Тема|Копия|Gesendet|Datum|An|Betreff|Envoyé|Objet|À|Enviado el|Enviado|Para|Asunto|Inviato|Oggetto)\s*:/i;
/** "On <date>, <name> wrote:", possibly wrapped over up to three lines. */
const ON_WROTE = /^\s*On\s[\s\S]{1,400}?\swrote:\s*$/;
// Mail clients write the attribution in the language of their interface;
// the verb is not always last ("… schrieb Priya Raman:").
const ATTRIBUTION_LINE = /(?:\bwrote|\bwrites|пишет|написала?|написал\(а\)|schrieb|a écrit|escribió|ha scritto|napisał(?:\(a\))?|escreveu)[^\n]{0,120}:\s*$/i;
/** Gmail's attribution in several languages ends with the quoted address and a colon. */
const ADDRESS_ATTRIBUTION = /<[^<>\s]+@[^<>\s]+>\s*:\s*$/;

/** The index of the first line that is, or announces, quoted mail; -1 when there is none. */
function firstQuoteLine(lines: readonly string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!line.trim()) continue;
    if (QUOTED_LINE.test(line) || FORWARD_LINE.test(line)) return index;
    // A bare run of dashes is a signature or a rule, not necessarily a quotation;
    // only a named separator, or one followed by quoted headers, counts.
    if (SEPARATOR_LINE.test(line) && (/[A-Za-zА-Яа-я]/.test(line) || HEADER_FROM.test(lines[index + 1] || ''))) return index;
    if (HEADER_FROM.test(line) && lines.slice(index + 1, index + 5).some(next => HEADER_NEXT.test(next))) return index;
    if (/^\s*On\s/.test(line)) {
      for (let span = 1; span <= 3; span += 1) {
        if (ON_WROTE.test(lines.slice(index, index + span).join(' '))) return index;
      }
    }
    if (ATTRIBUTION_LINE.test(line) || ADDRESS_ATTRIBUTION.test(line)) {
      // A wrapped attribution: its first part sits on the lines just above,
      // in the same paragraph. Dropped with it (at most two lines).
      let cut = index;
      while (cut > 0 && index - cut < 2 && lines[cut - 1].trim()) cut -= 1;
      // Not when that would swallow the opening line of the message itself.
      return cut === 0 && index > 0 ? index : cut;
    }
  }
  return -1;
}

/** The same headers when they share a line with the person's own text. */
const INLINE_QUOTE_HEADERS: readonly RegExp[] = [
  /\bOn\s.{1,300}?\swrote:/,
  /-{2,}\s*(?:Original Message|Forwarded message|Исходное сообщение|Пересылаемое сообщение|Пересланное сообщение)\s*-{2,}/i,
  /\bFrom:\s.{1,200}?\s(?:Sent|Date):\s/i,
  /(?:пишет|написала?|написал\(а\)|schrieb|a écrit|escribió|ha scritto|escreveu)[^:\n]{0,120}:/i,
  /<[^<>\s]+@[^<>\s]+>\s*:/,
];
/**
 * A quotation mark inside a line: any `>` that starts a word. In plain text
 * that is how quoted words are marked, and whether it is a quotation or a
 * comparison ("3 > 2") cannot be told, so the line ends there either way.
 * An arrow or a tag (`->`, `=>`, `<b>`) does not start a word and stays.
 */
const INLINE_QUOTE_MARK = /\s>/;

function cutInlineQuote(text: string): string {
  let cut = text.length;
  for (const header of [...INLINE_QUOTE_HEADERS, INLINE_QUOTE_MARK]) {
    const match = header.exec(text);
    if (match && match.index < cut) cut = match.index;
  }
  return text.slice(0, cut);
}

/** Text with its line structure, up to where quoted mail starts. */
function cutAtQuotedMail(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const cut = firstQuoteLine(lines);
  const kept = (cut >= 0 ? lines.slice(0, cut) : lines).map(cutInlineQuote);
  // An inline cut ends the text there as well: what follows that line is past the quotation.
  const inlineCut = kept.findIndex((line, index) => line.length < (cut >= 0 ? lines.slice(0, cut) : lines)[index].length);
  return (inlineCut >= 0 ? kept.slice(0, inlineCut + 1) : kept).join('\n').trimEnd();
}

/**
 * What the person wrote in a message, without the mail it quotes: only from
 * a real plain-text body. A plain body that merely repeats the snippet is a
 * placeholder for an HTML-only message, and like any message without a
 * plain body it yields nothing.
 */
export function ownAuthoredText(message: Pick<MailMessage, 'bodyPlain' | 'bodyHtml' | 'snippet'>): string {
  const plain = (message.bodyPlain ?? '').trim();
  const html = (message.bodyHtml ?? '').trim();
  const snippet = (message.snippet ?? '').trim();
  if (!plain || (html && plain === snippet)) return '';
  return cutAtQuotedMail(plain);
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
