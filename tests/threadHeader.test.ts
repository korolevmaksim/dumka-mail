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
  it('uses the current loaded message identity when the opened thread snapshot has stale sender email', () => {
    const identity = resolveThreadHeaderIdentity(
      makeThread({
        senderNames: ['Stale Sender'],
        senderEmail: 'stale.sender@example.com',
      }),
      [
        makeMessage({
          senderName: 'Current Sender',
          senderEmail: 'current.sender@example.com',
        }),
      ],
      {
        messagesKey: 'social@example.com:thread-1',
        status: 'ready',
      },
    );

    expect(identity).toEqual({
      senderName: 'Current Sender',
      senderEmail: 'current.sender@example.com',
      source: 'message',
    });
  });

  it('returns null while current thread messages are loading instead of showing stale previous messages', () => {
    const identity = resolveThreadHeaderIdentity(
      makeThread(),
      [
        makeMessage({
          threadId: 'previous-thread',
          senderName: 'Previous Sender',
          senderEmail: 'previous@example.com',
        }),
      ],
      {
        messagesKey: 'social@example.com:previous-thread',
        status: 'loading',
      },
    );

    expect(identity).toBeNull();
  });

  it('returns null when the message state key does not match the opened thread', () => {
    const identity = resolveThreadHeaderIdentity(
      makeThread(),
      [makeMessage()],
      {
        messagesKey: 'social@example.com:previous-thread',
        status: 'ready',
      },
    );

    expect(identity).toBeNull();
  });

  it('uses the oldest current-thread message so the header matches the first rendered message card', () => {
    const identity = resolveThreadHeaderIdentity(
      makeThread(),
      [
        makeMessage({
          id: 'newer',
          senderName: 'Latest Sender',
          senderEmail: 'latest@example.com',
          receivedAt: '2026-06-30T11:00:00.000Z',
        }),
        makeMessage({
          id: 'older',
          senderName: 'Original Sender',
          senderEmail: 'original@example.com',
          receivedAt: '2026-06-30T09:00:00.000Z',
        }),
      ],
      {
        messagesKey: 'social@example.com:thread-1',
        status: 'ready',
      },
    );

    expect(identity).toEqual({
      senderName: 'Original Sender',
      senderEmail: 'original@example.com',
      source: 'message',
    });
  });

  it('falls back to thread metadata only after the current thread detail load is ready and empty', () => {
    const identity = resolveThreadHeaderIdentity(
      makeThread({
        senderNames: ['Fallback Sender'],
        senderEmail: 'fallback@example.com',
      }),
      [],
      {
        messagesKey: 'social@example.com:thread-1',
        status: 'ready',
      },
    );

    expect(identity).toEqual({
      senderName: 'Fallback Sender',
      senderEmail: 'fallback@example.com',
      source: 'thread-fallback',
    });
  });
});
