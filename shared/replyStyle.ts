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
import { boundText, messagePlainText, stripQuotedHistory } from './agentPrompts';
import { redactSecrets } from './aiContext';
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
 * Who a reply to this conversation is written to: the sender of the newest
 * message that is not the account's own; when every message is the
 * account's, the first recipient of the newest one. '' when unknown.
 */
export function replyRecipientEmail(messages: readonly RecipientMessage[], accountEmail: string): string {
  const account = normalize(accountEmail);
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    const sender = normalize(ordered[index].senderEmail);
    if (sender && !isOwn(ordered[index], account)) return sender;
  }
  const last = ordered[ordered.length - 1];
  const recipient = (last?.to || []).map(entry => normalize(entry.email)).find(email => email && email !== account);
  return recipient || '';
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

/** The person's own words in a message: no quoted history, no signature, keys and tokens redacted, bounded. */
export function replyStyleText(message: Pick<MailMessage, 'bodyPlain' | 'bodyHtml' | 'snippet'>, signaturePlain?: string | null): string {
  const own = stripSignature(stripQuotedHistory(messagePlainText(message)), signaturePlain);
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
