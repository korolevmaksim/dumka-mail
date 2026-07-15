import type { MailMessage, MailThread, Recipient } from './types';

function uniqueRecipients(messages: MailMessage[], field: 'to' | 'cc'): Recipient[] {
  const recipientsByEmail = new Map<string, Recipient>();

  for (const message of messages) {
    for (const recipient of message[field]) {
      const email = recipient.email.trim();
      if (!email) continue;

      const key = email.toLowerCase();
      const name = recipient.name.trim();
      const existing = recipientsByEmail.get(key);
      if (!existing || (!existing.name && name)) {
        recipientsByEmail.set(key, { name, email });
      }
    }
  }

  return Array.from(recipientsByEmail.values());
}

export function buildMailThreadFromMessages(
  accountId: string,
  threadId: string,
  messages: MailMessage[],
): MailThread | null {
  if (messages.length === 0) return null;

  const lastMessage = messages[messages.length - 1];
  return {
    id: threadId,
    accountId,
    subject: lastMessage.subject || '',
    snippet: lastMessage.snippet || '',
    lastMessageAt: lastMessage.receivedAt,
    senderNames: Array.from(new Set(messages.map(message => message.senderName || message.senderEmail))),
    senderEmail: lastMessage.senderEmail,
    to: uniqueRecipients(messages, 'to'),
    cc: uniqueRecipients(messages, 'cc'),
    labelIds: Array.from(new Set(messages.flatMap(message => message.labelIds))),
    hasAttachments: messages.some(message => message.hasAttachments),
    isUnread: messages.some(message => message.isUnread),
  };
}
