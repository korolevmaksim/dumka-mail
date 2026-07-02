import { describe, expect, it } from 'vitest';
import { buildAutoReplyDraft, shouldAutoReplyToMessage } from '../shared/autoReply';
import type { MailMessage } from '../shared/types';

const baseMessage: MailMessage = {
  id: 'msg-1',
  threadId: 'thread-1',
  accountId: 'me@example.com',
  senderName: 'Alice',
  senderEmail: 'alice@example.com',
  subject: 'Question',
  snippet: 'Can you take a look?',
  receivedAt: '2026-07-02T10:00:00.000Z',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  isUnread: true,
  to: [{ name: 'Me', email: 'me@example.com' }],
  cc: [],
  bcc: [],
  bodyPlain: 'Can you take a look?',
  bodyHtml: null,
  attachments: [],
  headers: [],
  rfcMessageId: '<msg-1@example.com>',
  rfcReferences: '<root@example.com>',
  rfcInReplyTo: null,
};

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return { ...baseMessage, ...overrides };
}

describe('auto reply safety', () => {
  it('allows direct inbox messages from a real sender', () => {
    expect(shouldAutoReplyToMessage(message(), 'me@example.com', 'Thanks, I will reply soon.')).toEqual({
      allowed: true,
    });
  });

  it('blocks self, bulk, automated, and non-direct messages', () => {
    expect(shouldAutoReplyToMessage(
      message({ senderEmail: 'me@example.com' }),
      'me@example.com',
      'Thanks',
    ).reason).toBe('sentBySelf');

    expect(shouldAutoReplyToMessage(
      message({ headers: [{ name: 'List-Id', value: 'news.example.com' }] }),
      'me@example.com',
      'Thanks',
    ).reason).toBe('bulkOrList');

    expect(shouldAutoReplyToMessage(
      message({ senderEmail: 'noreply@example.com' }),
      'me@example.com',
      'Thanks',
    ).reason).toBe('automatedSender');

    expect(shouldAutoReplyToMessage(
      message({ to: [{ name: 'Other', email: 'other@example.com' }] }),
      'me@example.com',
      'Thanks',
    ).reason).toBe('notDirect');
  });

  it('blocks non-inbox, spam/trash, auto-submitted, and empty replies', () => {
    expect(shouldAutoReplyToMessage(message({ labelIds: ['UNREAD'] }), 'me@example.com', 'Thanks').reason).toBe('notInbox');
    expect(shouldAutoReplyToMessage(message({ labelIds: ['INBOX', 'SPAM'] }), 'me@example.com', 'Thanks').reason).toBe('spamOrTrash');
    expect(shouldAutoReplyToMessage(
      message({ headers: [{ name: 'Auto-Submitted', value: 'auto-generated' }] }),
      'me@example.com',
      'Thanks',
    ).reason).toBe('autoSubmitted');
    expect(shouldAutoReplyToMessage(message(), 'me@example.com', '   ').reason).toBe('emptyBody');
  });

  it('builds a threaded reply draft without quoted source content', () => {
    const draft = buildAutoReplyDraft(message(), 'me@example.com', 'I am away today.');

    expect(draft.to).toEqual([{ name: 'Alice', email: 'alice@example.com' }]);
    expect(draft.cc).toEqual([]);
    expect(draft.subject).toBe('Re: Question');
    expect(draft.bodyPlain).toBe('I am away today.');
    expect(draft.bodyHtml).toBeNull();
    expect(draft.threadId).toBe('thread-1');
    expect(draft.replyMessageId).toBe('<msg-1@example.com>');
    expect(draft.replyReferences).toBe('<root@example.com> <msg-1@example.com>');
  });
});
