// "Who is the other party?" for a thread: the reader header and the inbox row
// name the person the conversation is with, never the account itself.
//
// Rule: the sender of the first message, unless the account wrote it; then the
// latest sender who is not the account; then the first recipient who is not
// the account. Pure and dependency-free.
import type { MailMessage, MailThread, Recipient } from './types';

export interface Counterparty {
  name: string;
  email: string;
}

export interface AccountIdentity {
  email: string;
  displayName?: string | null;
}

type CounterpartyMessage = Pick<MailMessage, 'senderName' | 'senderEmail' | 'receivedAt'> & {
  labelIds?: readonly string[] | null;
  to?: readonly Recipient[] | null;
};

function normalized(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function isFromAccount(message: CounterpartyMessage, accountEmail: string): boolean {
  const account = normalized(accountEmail);
  if (account && normalized(message.senderEmail) === account) return true;
  // Send-as aliases do not match the account address but are labelled SENT.
  return (message.labelIds || []).some(label => String(label).toUpperCase() === 'SENT');
}

function fromMessage(message: CounterpartyMessage): Counterparty {
  const email = (message.senderEmail || '').trim();
  return { name: (message.senderName || '').trim() || email, email };
}

/** `messages` in any order; they are sorted oldest first. Null for an empty thread. */
export function messageCounterparty(
  messages: readonly CounterpartyMessage[],
  accountEmail: string,
): Counterparty | null {
  if (messages.length === 0) return null;
  const ordered = [...messages].sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));
  const first = ordered[0];
  if (!isFromAccount(first, accountEmail)) return fromMessage(first);

  for (let index = ordered.length - 1; index >= 0; index -= 1) {
    if (!isFromAccount(ordered[index], accountEmail)) return fromMessage(ordered[index]);
  }

  const account = normalized(accountEmail);
  for (const message of ordered) {
    const recipient = (message.to || []).find(entry => entry.email && normalized(entry.email) !== account);
    if (recipient) return { name: recipient.name.trim() || recipient.email.trim(), email: recipient.email.trim() };
  }
  return fromMessage(first);
}

/**
 * Row label from thread-level data only. `senderNames` lists every sender's
 * name (or address) in order of first appearance; the account is recognised by
 * its address and display name.
 */
export function threadRowSender(
  thread: Pick<MailThread, 'senderNames' | 'senderEmail' | 'accountId' | 'to'>,
  account?: AccountIdentity | null,
): string {
  const selfKeys = new Set(
    [thread.accountId, account?.email, account?.displayName].map(normalized).filter(Boolean),
  );
  const isSelf = (value: string) => selfKeys.has(normalized(value));
  const names = thread.senderNames.map(name => name.trim()).filter(Boolean);
  if (names.length === 0) return thread.senderEmail || 'Unknown sender';
  if (!isSelf(names[0])) return names[0];

  const others = names.filter(name => !isSelf(name));
  if (others.length > 0) return others[others.length - 1];

  const recipient = (thread.to || []).find(entry => entry.email && !isSelf(entry.email));
  if (recipient) return recipient.name.trim() || recipient.email.trim();
  return names[0];
}
