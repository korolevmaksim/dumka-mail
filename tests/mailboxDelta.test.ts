import { describe, expect, it } from 'vitest';
import type { MailboxDelta, MailThread } from '../shared/types';
import { applyDeltaToThreads } from '../renderer/src/stores/mailboxDelta';

function thread(id: string, accountId = 'me@example.com', minute = 0): MailThread {
  return {
    id,
    accountId,
    subject: id,
    snippet: '',
    lastMessageAt: `2026-07-10T10:${String(minute).padStart(2, '0')}:00.000Z`,
    senderNames: ['Sender'],
    senderEmail: 'sender@example.com',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    reminderAt: null,
  };
}

function delta(overrides: Partial<MailboxDelta> = {}): MailboxDelta {
  return {
    accountId: 'me@example.com',
    upserts: [],
    deletedThreadIds: [],
    revision: 1,
    completedAt: '2026-07-10T10:00:00.000Z',
    ...overrides,
  };
}

describe('mailbox delta', () => {
  it('keeps the same array when a sync completed without changes', () => {
    const threads = [thread('1')];
    expect(applyDeltaToThreads(threads, delta())).toBe(threads);
  });

  it('upserts, deletes, preserves other accounts, and sorts by recency', () => {
    const threads = [thread('1', 'me@example.com', 1), thread('2', 'other@example.com', 2)];
    const result = applyDeltaToThreads(threads, delta({
      upserts: [thread('3', 'me@example.com', 5)],
      deletedThreadIds: ['1'],
    }));
    expect(result.map(item => `${item.accountId}:${item.id}`)).toEqual([
      'me@example.com:3',
      'other@example.com:2',
    ]);
  });
});
