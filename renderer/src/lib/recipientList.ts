import { Recipient } from '../../../shared/types';

/**
 * Display name used in collapsed one-line recipient lists:
 * prefer the display name, fall back to the bare address.
 */
export function recipientDisplayName(recipient: Recipient): string {
  const name = (recipient.name || '').trim();
  return name || recipient.email;
}

/**
 * Full identity shown when a recipient list is expanded ("Name <address>"),
 * so every conversation participant is identifiable, not just their label.
 */
export function recipientFullIdentity(recipient: Recipient): string {
  const name = (recipient.name || '').trim();
  if (!name || name === recipient.email) return recipient.email;
  return `${name} <${recipient.email}>`;
}

/**
 * Comma-joined display names for the whole list, used for the hover tooltip
 * and accessible summary of a truncated recipient line.
 */
export function joinRecipientNames(recipients: Recipient[]): string {
  return recipients.map(recipientDisplayName).join(', ');
}

/**
 * Number of recipients hidden by one-line truncation, given how many
 * recipient chips fully fit inside the available width.
 */
export function countHiddenRecipients(total: number, fullyVisible: number): number {
  return Math.max(0, total - Math.max(0, fullyVisible));
}

/**
 * Identity for a recipient row that survives mailbox-refresh object copies.
 * Used so expanding To/Cc is not reset just because chat re-rendered the message.
 */
export function recipientsSignature(recipients: Recipient[]): string {
  return recipients.map(recipient => `${recipient.email}\t${recipient.name || ''}`).join('\n');
}
