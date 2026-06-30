import { MailMessage, MailThread } from '../../../shared/types';

export interface ThreadHeaderIdentity {
  senderNames: string[];
  senderEmail: string;
}

export function resolveThreadHeaderIdentity(
  thread: MailThread,
  messages: MailMessage[],
): ThreadHeaderIdentity {
  const threadMessages = messages.filter(message => (
    message.threadId === thread.id && message.accountId === thread.accountId
  ));

  if (threadMessages.length === 0) {
    return {
      senderNames: thread.senderNames,
      senderEmail: thread.senderEmail,
    };
  }

  const senderNames = Array.from(new Set(
    threadMessages
      .map(message => (message.senderName || message.senderEmail).trim())
      .filter(Boolean),
  ));
  const lastMessage = threadMessages[threadMessages.length - 1];

  return {
    senderNames: senderNames.length > 0 ? senderNames : thread.senderNames,
    senderEmail: lastMessage.senderEmail || thread.senderEmail,
  };
}
