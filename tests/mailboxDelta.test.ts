import { describe, expect, it } from 'vitest';
import type { MailboxDelta, MailThread } from '../shared/types';
import { applyDeltaToThreads, readerMessagesAfterSync } from '../renderer/src/stores/mailboxDelta';
import type { MailMessage } from '../shared/types';

function readerMessage(id: string): MailMessage {
  return {
    id, threadId: 't1', accountId: 'me@example.com', senderName: 'Sender', senderEmail: 'sender@example.com', subject: id,
    snippet: '', receivedAt: '2026-07-10T10:00:00.000Z', labelIds: ['INBOX'], hasAttachments: false, isUnread: false,
    to: [], cc: [], bcc: [], attachments: [],
  };
}

describe('readerMessagesAfterSync', () => {
  const shown = [readerMessage('m1'), readerMessage('m2')];

  it('leaves the reader alone when every shown message is still stored', () => {
    expect(readerMessagesAfterSync(shown, [readerMessage('m1'), readerMessage('m2')])).toBeNull();
    // A new message alone does not re-render what the person is reading.
    expect(readerMessagesAfterSync(shown, [readerMessage('m1'), readerMessage('m2'), readerMessage('m3')])).toBeNull();
  });

  it('shows the stored conversation when a shown message was deleted for good', () => {
    const stored = [readerMessage('m2'), readerMessage('m3')];
    expect(readerMessagesAfterSync(shown, stored)).toBe(stored);
  });

  it('keeps what is shown while nothing is stored or nothing is shown yet', () => {
    expect(readerMessagesAfterSync(shown, [])).toBeNull();
    expect(readerMessagesAfterSync([], [readerMessage('m1')])).toBeNull();
  });
});

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
