import { describe, expect, it, vi } from 'vitest';
import type { MailThread, TabCategory } from '../shared/types';
import {
  buildMailboxIndexCooperatively,
  replaceThreadInMailboxIndex,
  threadsForMailboxIndex,
} from '../renderer/src/stores/mailboxIndex';

const categories: TabCategory[] = [
  { id: 'important', displayName: 'Important', isSystem: true, active: true },
  { id: 'other', displayName: 'Other', isSystem: true, active: true },
];

function thread(id: string, labels: string[] = ['INBOX'], isUnread = false): MailThread {
  return {
    id,
    accountId: 'me@example.com',
    subject: id,
    snippet: '',
    lastMessageAt: `2026-07-10T10:${id.padStart(2, '0')}:00.000Z`,
    senderNames: ['Sender'],
    senderEmail: 'sender@example.com',
    labelIds: labels,
    hasAttachments: false,
    isUnread,
    reminderAt: null,
  };
}

describe('mailbox index', () => {
  it('classifies each thread once and reuses prepared split buckets', async () => {
    const getThreadCategory = vi.fn((item: MailThread) => item.isUnread ? 'important' : 'other');
    const index = await buildMailboxIndexCooperatively({
      threads: [thread('1', ['INBOX'], true), thread('2'), thread('3', ['SENT'])],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(index).not.toBeNull();
    expect(getThreadCategory).toHaveBeenCalledTimes(3);
    expect(threadsForMailboxIndex(index!, 'inbox', 'important').map(item => item.id)).toEqual(['1']);
    expect(threadsForMailboxIndex(index!, 'sent', 'important').map(item => item.id)).toEqual(['3']);
    expect(index?.splitCounts).toMatchObject({ important: 1, other: 1 });
  });

  it('updates one thread without reclassifying the rest of the mailbox', async () => {
    const getThreadCategory = vi.fn((item: MailThread) => item.isUnread ? 'important' : 'other');
    const first = thread('1', ['INBOX'], true);
    const second = thread('2');
    const index = await buildMailboxIndexCooperatively({
      threads: [first, second],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });
    getThreadCategory.mockClear();

    const next = replaceThreadInMailboxIndex({
      index: index!,
      previousThread: first,
      nextThread: { ...first, isUnread: false },
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(getThreadCategory).toHaveBeenCalledTimes(1);
    expect(threadsForMailboxIndex(next, 'inbox', 'important')).toEqual([]);
    expect(threadsForMailboxIndex(next, 'inbox', 'other').map(item => item.id)).toEqual(['2', '1']);
  });

  it('removes a newly reminded thread from the prepared inbox immediately', async () => {
    const getThreadCategory = vi.fn(() => 'important');
    const first = thread('1');
    const second = thread('2');
    const index = await buildMailboxIndexCooperatively({
      threads: [first, second],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    const next = replaceThreadInMailboxIndex({
      index: index!,
      previousThread: first,
      nextThread: { ...first, reminderAt: '2099-07-24T10:00:00.000Z' },
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(threadsForMailboxIndex(next, 'inbox', 'important').map(item => item.id)).toEqual(['2']);
    expect(next.splitCounts.important).toBe(1);
    expect(next.mailboxCounts.inbox).toBe(1);
  });

  it('aggregates unread counts per split during the cooperative build', async () => {
    const getThreadCategory = (item: MailThread) => (item.id === '1' || item.id === '2' ? 'important' : 'other');
    const index = await buildMailboxIndexCooperatively({
      threads: [
        thread('1', ['INBOX'], true),
        thread('2', ['INBOX'], true),
        thread('3'),
        thread('4', ['SENT'], true),
      ],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(index?.splitCounts).toMatchObject({ important: 2, other: 1 });
    expect(index?.splitUnreadCounts).toMatchObject({ important: 2, other: 0 });
  });

  it('tracks unread counts when a thread is marked read and unread again', async () => {
    const getThreadCategory = (item: MailThread) => (item.id === '1' ? 'important' : 'other');
    const first = thread('1', ['INBOX'], true);
    const second = thread('2');
    const index = await buildMailboxIndexCooperatively({
      threads: [first, second],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });
    expect(index?.splitUnreadCounts).toMatchObject({ important: 1, other: 0 });

    const markedRead = replaceThreadInMailboxIndex({
      index: index!,
      previousThread: first,
      nextThread: { ...first, isUnread: false },
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });
    expect(markedRead.splitCounts.important).toBe(1);
    expect(markedRead.splitUnreadCounts).toMatchObject({ important: 0, other: 0 });

    const markedUnread = replaceThreadInMailboxIndex({
      index: markedRead,
      previousThread: { ...first, isUnread: false },
      nextThread: { ...first, isUnread: true },
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });
    expect(markedUnread.splitUnreadCounts).toMatchObject({ important: 1, other: 0 });
  });

  it('drops the unread count when an unread thread leaves the inbox', async () => {
    const getThreadCategory = () => 'important';
    const first = thread('1', ['INBOX'], true);
    const index = await buildMailboxIndexCooperatively({
      threads: [first],
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });
    expect(index?.splitUnreadCounts.important).toBe(1);

    const next = replaceThreadInMailboxIndex({
      index: index!,
      previousThread: first,
      nextThread: { ...first, reminderAt: '2099-07-24T10:00:00.000Z' },
      tabCategories: categories,
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(next.splitCounts.important).toBe(0);
    expect(next.splitUnreadCounts.important).toBe(0);
  });
});
