import { describe, expect, it } from 'vitest';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailMessage } from '../shared/types';

function message(partial: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'message-1',
    threadId: 'thread-1',
    accountId: 'me@example.com',
    senderName: 'Sender',
    senderEmail: 'sender@example.com',
    subject: 'Subject',
    snippet: 'Snippet',
    receivedAt: '2026-07-15T10:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain: '',
    attachments: [],
    ...partial,
  };
}

describe('buildMailThreadFromMessages', () => {
  it('aggregates and deduplicates To and Cc recipients across the thread', () => {
    const thread = buildMailThreadFromMessages('me@example.com', 'thread-1', [
      message({
        to: [{ name: '', email: 'Alias@Example.com' }],
        cc: [{ name: 'First Copy', email: 'copy@example.com' }],
      }),
      message({
        id: 'message-2',
        receivedAt: '2026-07-15T11:00:00.000Z',
        to: [
          { name: 'My Alias', email: 'alias@example.com' },
          { name: 'Second Alias', email: 'second@example.com' },
        ],
        cc: [{ name: 'Duplicate Copy', email: 'COPY@example.com' }],
      }),
    ]);

    expect(thread).toMatchObject({
      lastMessageAt: '2026-07-15T11:00:00.000Z',
      to: [
        { name: 'My Alias', email: 'alias@example.com' },
        { name: 'Second Alias', email: 'second@example.com' },
      ],
      cc: [{ name: 'First Copy', email: 'copy@example.com' }],
    });
  });

  it('returns null for an empty message list', () => {
    expect(buildMailThreadFromMessages('me@example.com', 'thread-1', [])).toBeNull();
  });
});
