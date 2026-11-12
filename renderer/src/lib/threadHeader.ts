import { MailMessage, MailThread } from '../../../shared/types';
import { messageCounterparty } from '../../../shared/threadCounterparty';

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
  ));

  // The other party: the first sender, or the latest sender who is not the
  // account when the account started the thread.
  const counterparty = messageCounterparty(threadMessages, thread.accountId);
  if (counterparty) {
    return {
      senderName: counterparty.name,
      senderEmail: counterparty.email,
      source: 'message',
    };
  }

  return {
    senderName: (thread.senderNames[0] || thread.senderEmail).trim(),
    senderEmail: thread.senderEmail,
    source: 'thread-fallback',
  };
}
