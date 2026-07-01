import { MailMessage, MailThread } from '../../../shared/types';

export type ThreadHeaderMessagesStatus = 'idle' | 'loading' | 'ready';

export interface ThreadHeaderIdentity {
  senderName: string;
  senderEmail: string;
  source: 'message' | 'thread-fallback';
}

interface ThreadHeaderIdentityOptions {
  messagesKey?: string | null;
  status?: ThreadHeaderMessagesStatus;
}

function threadMessagesKey(thread: Pick<MailThread, 'accountId' | 'id'>): string {
  return `${thread.accountId}:${thread.id}`;
}

export function resolveThreadHeaderIdentity(
  thread: MailThread,
  messages: MailMessage[],
  options: ThreadHeaderIdentityOptions = {},
): ThreadHeaderIdentity | null {
  const expectedKey = threadMessagesKey(thread);
  const messagesKey = options.messagesKey ?? expectedKey;
  const status = options.status ?? 'ready';

  if (status !== 'ready' || messagesKey !== expectedKey) {
    return null;
  }

  const threadMessages = messages.filter(message => (
    message.threadId === thread.id && message.accountId === thread.accountId
  )).sort((a, b) => a.receivedAt.localeCompare(b.receivedAt));

  const firstMessage = threadMessages[0];
  if (firstMessage) {
    return {
      senderName: (firstMessage.senderName || firstMessage.senderEmail).trim(),
      senderEmail: firstMessage.senderEmail,
      source: 'message',
    };
  }

  return {
    senderName: (thread.senderNames[0] || thread.senderEmail).trim(),
    senderEmail: thread.senderEmail,
    source: 'thread-fallback',
  };
}
