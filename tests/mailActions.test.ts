import { describe, expect, it } from 'vitest';
import {
  applyOptimisticThreadReminder,
  applyPendingLabelDeltas,
  isReversibleMailActionKind,
  reverseMailActionKind,
} from '../shared/mailActions';
import type { MailActionLog, MailThread } from '../shared/types';

describe('mail action helpers', () => {
  it('reverses destructive and ignore actions', () => {
    expect(reverseMailActionKind('moveToTrash')).toBe('restoreFromTrash');
    expect(reverseMailActionKind('restoreFromTrash')).toBe('moveToTrash');
    expect(reverseMailActionKind('reportSpam')).toBe('restoreFromSpam');
    expect(reverseMailActionKind('restoreFromSpam')).toBe('reportSpam');
    expect(reverseMailActionKind('muteThread')).toBe('unmuteThread');
    expect(reverseMailActionKind('unmuteThread')).toBe('muteThread');
  });

  it('reverses read, archive, and label actions without marking unrelated actions reversible', () => {
    expect(reverseMailActionKind('markDone')).toBe('restoreInbox');
    expect(reverseMailActionKind('markRead')).toBe('markUnread');
    expect(reverseMailActionKind('applyLabel')).toBe('removeLabel');
    expect(isReversibleMailActionKind('sendDraft')).toBe(false);
    expect(reverseMailActionKind('calendarRSVP')).toBeNull();
  });

  it('updates reminder state only for the matching account and thread', () => {
    const threads: MailThread[] = [
      {
        id: 'shared-thread-id',
        accountId: 'first@example.com',
        subject: 'First account',
        snippet: '',
        lastMessageAt: '2026-07-03T08:00:00.000Z',
        senderNames: ['Sender'],
        senderEmail: 'sender@example.com',
        labelIds: ['INBOX'],
        hasAttachments: false,
        isUnread: false,
        reminderAt: null,
      },
      {
        id: 'shared-thread-id',
        accountId: 'second@example.com',
        subject: 'Second account',
        snippet: '',
        lastMessageAt: '2026-07-03T08:00:00.000Z',
        senderNames: ['Sender'],
        senderEmail: 'sender@example.com',
        labelIds: ['INBOX'],
        hasAttachments: false,
        isUnread: false,
        reminderAt: null,
      },
    ];

    const reminderAt = '2026-07-10T09:00:00.000Z';
    const updated = applyOptimisticThreadReminder(
      threads,
      'first@example.com',
      'shared-thread-id',
      reminderAt,
    );

    expect(updated[0].reminderAt).toBe(reminderAt);
    expect(updated[1]).toBe(threads[1]);
    expect(updated[1].reminderAt).toBeNull();
  });

  it('re-applies pending label mutations so sync cannot overwrite an optimistic archive', () => {
    const thread: MailThread = {
      id: 't1',
      accountId: 'me@example.com',
      subject: 'Keep me archived',
      snippet: '',
      lastMessageAt: '2026-07-03T08:00:00.000Z',
      senderNames: ['Sender'],
      senderEmail: 'sender@example.com',
      labelIds: ['INBOX', 'UNREAD'],
      hasAttachments: false,
      isUnread: true,
      reminderAt: null,
    };
    const pending: MailActionLog = {
      id: 'a1',
      accountId: 'me@example.com',
      threadId: 't1',
      kind: 'markDone',
      status: 'pending_sync',
      createdAt: '2026-07-03T08:01:00.000Z',
    };

    const overlaid = applyPendingLabelDeltas(thread, [pending]);
    expect(overlaid.labelIds).toEqual(['UNREAD']);
    expect(overlaid).not.toBe(thread);
  });
});
