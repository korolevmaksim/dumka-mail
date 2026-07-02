import { startReply } from './compose';
import { getHeader, isLikelyBulkMessage, normalizeHeaders } from './mailSecurity';
import type { MailMessage } from './types';

export type AutoReplyBlockReason =
  | 'sentBySelf'
  | 'notInbox'
  | 'spamOrTrash'
  | 'bulkOrList'
  | 'automatedSender'
  | 'autoSubmitted'
  | 'notDirect'
  | 'emptyBody'
  | 'noRecipient';

export interface AutoReplySafetyResult {
  allowed: boolean;
  reason?: AutoReplyBlockReason;
}

export interface AutoReplyDraft {
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  bcc: { name: string; email: string }[];
  subject: string;
  bodyPlain: string;
  bodyHtml: string | null;
  attachments: [];
  threadId: string;
  replyMessageId?: string | null;
  replyReferences?: string | null;
}

function hasLabel(message: MailMessage, label: string): boolean {
  const target = label.toUpperCase();
  return message.labelIds.some(item => item.toUpperCase() === target);
}

function normalizedEmail(value: string): string {
  return value.trim().toLowerCase();
}

function isDirectlyAddressedToAccount(message: MailMessage, accountId: string): boolean {
  const self = normalizedEmail(accountId);
  if (!self) return false;
  return [...(message.to || []), ...(message.cc || [])]
    .some(recipient => normalizedEmail(recipient.email) === self);
}

function isAutomatedSender(message: MailMessage): boolean {
  const sender = `${message.senderName || ''} ${message.senderEmail || ''}`.toLowerCase();
  return sender.includes('noreply') ||
    sender.includes('no-reply') ||
    sender.includes('do-not-reply') ||
    sender.includes('donotreply') ||
    sender.includes('mailer-daemon') ||
    sender.includes('postmaster') ||
    sender.includes('notification') ||
    sender.includes('newsletter');
}

export function shouldAutoReplyToMessage(message: MailMessage, accountId: string, bodyPlain: string): AutoReplySafetyResult {
  if (!bodyPlain.trim()) return { allowed: false, reason: 'emptyBody' };
  if (normalizedEmail(message.senderEmail) === normalizedEmail(accountId)) return { allowed: false, reason: 'sentBySelf' };
  if (!hasLabel(message, 'INBOX')) return { allowed: false, reason: 'notInbox' };
  if (hasLabel(message, 'SPAM') || hasLabel(message, 'TRASH')) return { allowed: false, reason: 'spamOrTrash' };

  const headers = normalizeHeaders(message.headers);
  const autoSubmitted = getHeader(headers, 'auto-submitted').trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== 'no') return { allowed: false, reason: 'autoSubmitted' };
  if (headers.some(header => ['list-id', 'list-unsubscribe', 'list-unsubscribe-post'].includes(header.name.trim().toLowerCase()))) {
    return { allowed: false, reason: 'bulkOrList' };
  }
  if (isLikelyBulkMessage(message)) return { allowed: false, reason: 'bulkOrList' };
  if (isAutomatedSender(message)) return { allowed: false, reason: 'automatedSender' };
  if (!isDirectlyAddressedToAccount(message, accountId)) return { allowed: false, reason: 'notDirect' };

  const seed = startReply(message, accountId, false);
  if (seed.to.length === 0) return { allowed: false, reason: 'noRecipient' };
  return { allowed: true };
}

export function buildAutoReplyDraft(message: MailMessage, accountId: string, bodyPlain: string): AutoReplyDraft {
  const seed = startReply(message, accountId, false);
  return {
    to: seed.to,
    cc: [],
    bcc: [],
    subject: seed.subject,
    bodyPlain: bodyPlain.trim(),
    bodyHtml: null,
    attachments: [],
    threadId: message.threadId,
    replyMessageId: seed.replyMessageId,
    replyReferences: seed.replyReferences,
  };
}
