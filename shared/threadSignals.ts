// Header- and attachment-derived thread facts used by the decision engine
// (`shared/decision.ts`). Pure: runs in the main process when a thread is
// built from Gmail messages, in the signals backfill, and in tests.
import { decodeIcsAttachment, isCalendarInviteAttachment } from './calendar';
import type { AttachmentMetadata, MailHeader, MailMessage, ThreadSignals } from './types';

/** The message fields signal extraction reads; cached rows can supply just these. */
export type ThreadSignalMessage = Pick<MailMessage, 'id' | 'senderEmail' | 'labelIds'> & {
  headers?: MailHeader[] | null;
  attachments?: AttachmentMetadata[] | null;
};

export const EMPTY_THREAD_SIGNALS: Readonly<ThreadSignals> = Object.freeze({
  hasCalendarInvite: false,
  inviteNeedsAnswer: false,
  inviteStateKnown: false,
  hasListUnsubscribe: false,
  hasOneClickUnsubscribe: false,
  listId: null,
  isBulk: false,
  isAutoSubmitted: false,
  fromUser: false,
  lastMessageId: null,
});

function header(message: ThreadSignalMessage, name: string): string | null {
  const target = name.toLowerCase();
  for (const entry of message.headers || []) {
    if (typeof entry?.name === 'string' && entry.name.toLowerCase() === target && typeof entry.value === 'string') {
      return entry.value.trim();
    }
  }
  return null;
}

function normalizedEmail(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

export function isMessageFromAccount(message: ThreadSignalMessage, accountEmail: string): boolean {
  const account = normalizedEmail(accountEmail);
  if (account && normalizedEmail(message.senderEmail) === account) return true;
  // Send-as aliases do not match the account address but are still labelled SENT.
  return (message.labelIds || []).some(label => String(label).toUpperCase() === 'SENT');
}

/** RFC 8058 one-click: the POST marker plus at least one https URI in List-Unsubscribe. */
function isOneClickUnsubscribe(listUnsubscribe: string | null, listUnsubscribePost: string | null): boolean {
  if (!listUnsubscribe || !listUnsubscribePost) return false;
  if (!/list-unsubscribe\s*=\s*one-click/i.test(listUnsubscribePost)) return false;
  return /<\s*https:\/\/[^>]+>/i.test(listUnsubscribe);
}

/**
 * `Precedence: bulk | junk` only. `Precedence: list` is what Mailman and
 * Google Groups put on every discussion post, including a person's: it says
 * the mail came through a list, not that the sender is automated.
 */
function isBulkPrecedence(value: string | null): boolean {
  if (!value) return false;
  const token = value.split(/[;\s]/)[0].toLowerCase();
  return token === 'bulk' || token === 'junk';
}

function isAutoSubmittedValue(value: string | null): boolean {
  if (!value) return false;
  const token = value.split(/[;\s]/)[0].toLowerCase();
  return token !== '' && token !== 'no';
}

function unfoldIcs(text: string): string[] {
  const lines: string[] = [];
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (/^[ \t]/.test(line) && lines.length > 0) lines[lines.length - 1] += line.slice(1);
    else lines.push(line);
  }
  return lines;
}

export interface IcsInviteState {
  method: string | null;
  /** PARTSTAT of the matching attendee (upper case), `NEEDS-ACTION` when the parameter is absent; null if not listed. */
  accountPartstat: string | null;
}

/**
 * Minimal ICS scan for the two facts the decision engine needs. The full
 * parser in `shared/calendar.ts` drops attendee PARTSTAT, so it is read here.
 */
export function readIcsInviteState(text: string, accountEmail: string): IcsInviteState {
  const account = normalizedEmail(accountEmail);
  let method: string | null = null;
  let accountPartstat: string | null = null;
  let inEvent = false;
  for (const line of unfoldIcs(text)) {
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [rawName, ...params] = line.slice(0, colon).split(';');
    const name = rawName.trim().toUpperCase();
    const value = line.slice(colon + 1).trim();
    if (name === 'METHOD' && !inEvent) {
      method = value.toUpperCase() || null;
    } else if (name === 'BEGIN' && value.toUpperCase() === 'VEVENT') {
      inEvent = true;
    } else if (name === 'END' && value.toUpperCase() === 'VEVENT') {
      // The first VEVENT is the invite; later ones are overridden occurrences.
      break;
    } else if (inEvent && name === 'ATTENDEE' && accountPartstat === null) {
      const email = normalizedEmail(value.replace(/^mailto:/i, ''));
      if (!account || email !== account) continue;
      const partstat = params
        .map(param => param.split('='))
        .find(([key]) => key.trim().toUpperCase() === 'PARTSTAT')?.[1];
      accountPartstat = (partstat || 'NEEDS-ACTION').replace(/"/g, '').trim().toUpperCase();
    }
  }
  return { method, accountPartstat };
}

function inviteTexts(message: ThreadSignalMessage): { hasInvite: boolean; texts: string[] } {
  const texts: string[] = [];
  let hasInvite = false;
  for (const attachment of message.attachments || []) {
    if (!attachment || typeof attachment.mimeType !== 'string' || typeof attachment.filename !== 'string') continue;
    if (!isCalendarInviteAttachment(attachment)) continue;
    hasInvite = true;
    const decoded = decodeIcsAttachment(attachment);
    if (decoded) texts.push(decoded);
  }
  return { hasInvite, texts };
}

/**
 * `messages` must be in chronological order (oldest first), as threads are
 * built. List headers are read from the latest message not sent by the
 * account (the one that decides what the thread is); invite state from the
 * latest message carrying a calendar part.
 */
export function computeThreadSignals(messages: readonly ThreadSignalMessage[], accountEmail: string): ThreadSignals {
  if (messages.length === 0) return { ...EMPTY_THREAD_SIGNALS };

  const last = messages[messages.length - 1];
  const fromUser = isMessageFromAccount(last, accountEmail);

  let senderMessage = last;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (!isMessageFromAccount(messages[index], accountEmail)) {
      senderMessage = messages[index];
      break;
    }
  }

  const listUnsubscribe = header(senderMessage, 'List-Unsubscribe');
  const listId = header(senderMessage, 'List-Id');

  let hasCalendarInvite = false;
  let inviteNeedsAnswer = false;
  let inviteStateKnown = false;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const { hasInvite, texts } = inviteTexts(messages[index]);
    if (!hasInvite) continue;
    hasCalendarInvite = true;
    inviteStateKnown = texts.length > 0;
    // A message can carry the same invite twice (inline part + invite.ics);
    // any REQUEST still awaiting the account's answer counts. Undecodable
    // parts (fetched lazily by attachment id) give no answer either way.
    inviteNeedsAnswer = texts.some(text => {
      const state = readIcsInviteState(text, accountEmail);
      if (state.method !== 'REQUEST') return false;
      return state.accountPartstat === null || state.accountPartstat === 'NEEDS-ACTION';
    });
    break;
  }

  return {
    hasCalendarInvite,
    inviteNeedsAnswer,
    inviteStateKnown,
    hasListUnsubscribe: Boolean(listUnsubscribe),
    hasOneClickUnsubscribe: isOneClickUnsubscribe(listUnsubscribe, header(senderMessage, 'List-Unsubscribe-Post')),
    listId: listId || null,
    isBulk: isBulkPrecedence(header(senderMessage, 'Precedence')),
    isAutoSubmitted: isAutoSubmittedValue(header(senderMessage, 'Auto-Submitted')),
    fromUser,
    lastMessageId: last.id || null,
  };
}

/** Validates a parsed `signals_json` value; returns undefined for anything malformed. */
export function parseStoredThreadSignals(value: unknown): ThreadSignals | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const raw = value as Record<string, unknown>;
  const flag = (key: keyof ThreadSignals) => raw[key] === true;
  const text = (key: keyof ThreadSignals) => (typeof raw[key] === 'string' && raw[key] ? raw[key] as string : null);
  return {
    hasCalendarInvite: flag('hasCalendarInvite'),
    inviteNeedsAnswer: flag('inviteNeedsAnswer'),
    // Rows stored before this field existed: unknown, which keeps an invite protected.
    inviteStateKnown: flag('inviteStateKnown'),
    hasListUnsubscribe: flag('hasListUnsubscribe'),
    hasOneClickUnsubscribe: flag('hasOneClickUnsubscribe'),
    listId: text('listId'),
    isBulk: flag('isBulk'),
    isAutoSubmitted: flag('isAutoSubmitted'),
    fromUser: flag('fromUser'),
    lastMessageId: text('lastMessageId'),
  };
}
