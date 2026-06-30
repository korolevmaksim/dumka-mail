import { describe, expect, it } from 'vitest';
import { resolveThreadHeaderIdentity } from '../renderer/src/lib/threadHeader';
import { MailMessage, MailThread } from '../shared/types';

function makeThread(overrides: Partial<MailThread> = {}): MailThread {
  return {
    id: 'thread-1',
    accountId: 'social@example.com',
    subject: 'Subject',
    snippet: 'Snippet',
    lastMessageAt: '2026-06-30T10:00:00.000Z',
    senderNames: ['Example Sender'],
    senderEmail: 'stale@example.com',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    ...overrides,
  };
}

function makeMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    accountId: 'social@example.com',
    senderName: 'Example Sender',
    senderEmail: 'info@example.com',
    subject: 'Subject',
    snippet: 'Snippet',
    receivedAt: '2026-06-30T10:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
    ...overrides,
  };
}

describe('resolveThreadHeaderIdentity', () => {
  it('uses loaded message identity when the opened thread snapshot has stale sender email', () => {
    const identity = resolveThreadHeaderIdentity(makeThread(), [makeMessage()]);

    expect(identity.senderNames).toEqual(['Example Sender']);
    expect(identity.senderEmail).toBe('info@example.com');
  });

  it('ignores messages from a previous opened thread', () => {
    const identity = resolveThreadHeaderIdentity(makeThread(), [
      makeMessage({
        threadId: 'previous-thread',
        senderName: 'Previous Sender',
        senderEmail: 'previous@example.com',
      }),
    ]);

    expect(identity.senderNames).toEqual(['Example Sender']);
    expect(identity.senderEmail).toBe('stale@example.com');
  });
});
