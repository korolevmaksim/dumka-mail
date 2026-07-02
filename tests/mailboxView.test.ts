import { describe, expect, it } from 'vitest';
import { hasFutureReminder, isMutedThread, isThreadInMailbox, threadHasLabel } from '../shared/mailboxView';
import type { MailThread } from '../shared/types';

const baseThread: MailThread = {
  id: 'thread-1',
  accountId: 'alex@example.com',
  subject: 'Subject',
  snippet: 'Snippet',
  lastMessageAt: '2026-06-30T10:00:00.000Z',
  senderNames: ['Sender'],
  senderEmail: 'sender@example.com',
  labelIds: [],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};

function thread(patch: Partial<MailThread>): MailThread {
  return { ...baseThread, ...patch };
}

describe('mailboxView', () => {
  it('matches labels case-insensitively', () => {
    expect(threadHasLabel(thread({ labelIds: ['sent'] }), 'SENT')).toBe(true);
  });

  it('keeps future reminders out of the inbox view', () => {
    const now = new Date('2026-06-30T10:00:00.000Z');
    const reminded = thread({
      labelIds: ['INBOX'],
      reminderAt: '2026-07-01T09:00:00.000Z',
    });

    expect(hasFutureReminder(reminded, now)).toBe(true);
    expect(isThreadInMailbox(reminded, 'inbox', now)).toBe(false);
  });

  it('shows sent threads even when they are no longer in the inbox', () => {
    const sent = thread({ labelIds: ['SENT'] });

    expect(isThreadInMailbox(sent, 'sent')).toBe(true);
    expect(isThreadInMailbox(sent, 'inbox')).toBe(false);
  });

  it('does not treat drafts as thread-backed mailbox content', () => {
    expect(isThreadInMailbox(thread({ labelIds: ['DRAFT'] }), 'drafts')).toBe(false);
  });

  it('shows trash and spam threads only in their system mailbox views', () => {
    const trashed = thread({ labelIds: ['TRASH'] });
    const spam = thread({ labelIds: ['SPAM'] });

    expect(isThreadInMailbox(trashed, 'trash')).toBe(true);
    expect(isThreadInMailbox(trashed, 'inbox')).toBe(false);
    expect(isThreadInMailbox(spam, 'spam')).toBe(true);
    expect(isThreadInMailbox(spam, 'inbox')).toBe(false);
  });

  it('lets a conversation appear in both inbox and sent when Gmail labels both sides', () => {
    const conversation = thread({ labelIds: ['INBOX', 'SENT'] });

    expect(isThreadInMailbox(conversation, 'inbox')).toBe(true);
    expect(isThreadInMailbox(conversation, 'sent')).toBe(true);
  });

  it('keeps ignored threads out of the inbox by account-specific muted label id', () => {
    const ignored = thread({ labelIds: ['INBOX', 'Label_muted'] });
    const options = {
      mutedLabelIdsByAccount: {
        'alex@example.com': ['Label_muted'],
      },
    };

    expect(isMutedThread(ignored, options)).toBe(true);
    expect(isThreadInMailbox(ignored, 'inbox', new Date('2026-06-30T10:00:00.000Z'), options)).toBe(false);
    expect(isThreadInMailbox(ignored, 'muted', new Date('2026-06-30T10:00:00.000Z'), options)).toBe(true);
  });

  it('does not let muted label ids leak between accounts', () => {
    const otherAccount = thread({
      accountId: 'other@example.com',
      labelIds: ['INBOX', 'Label_muted'],
    });
    const options = {
      mutedLabelIdsByAccount: {
        'alex@example.com': ['Label_muted'],
      },
    };

    expect(isMutedThread(otherAccount, options)).toBe(false);
    expect(isThreadInMailbox(otherAccount, 'inbox', new Date('2026-06-30T10:00:00.000Z'), options)).toBe(true);
  });
});
