import { describe, expect, it, vi } from 'vitest';
import type { MailThread } from '../shared/types';
import { filterVisibleThreadsCooperatively } from '../renderer/src/stores/mailThreadFilter';

const baseThread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Subject',
  snippet: 'Snippet',
  lastMessageAt: '2026-07-03T10:00:00.000Z',
  senderNames: ['Sender'],
  senderEmail: 'sender@example.com',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};

function thread(id: string, patch: Partial<MailThread> = {}): MailThread {
  return { ...baseThread, id, ...patch };
}

describe('mail thread cooperative filtering', () => {
  it('yields between batches while rebuilding the visible inbox list', async () => {
    const yieldToUI = vi.fn(async () => undefined);
    const threads = [
      thread('t1'),
      thread('t2'),
      thread('t3'),
      thread('t4'),
      thread('t5', { labelIds: ['SENT'] }),
    ];

    const result = await filterVisibleThreadsCooperatively({
      threads,
      searchQuery: '',
      matches: [],
      activeSplit: 'important',
      mailboxView: 'inbox',
      now: new Date('2026-07-03T10:00:00.000Z'),
      tabCategories: [],
      labelDefinitions: [],
      mutedLabelIdsByAccount: {},
      getThreadCategory: () => 'important',
      yieldToUI,
      batchSize: 2,
    });

    expect(result?.map(item => item.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(yieldToUI).toHaveBeenCalledTimes(2);
  });

  it('returns null when a newer search cancels the current filter job', async () => {
    let cancelled = false;
    const yieldToUI = vi.fn(async () => {
      cancelled = true;
    });

    const result = await filterVisibleThreadsCooperatively({
      threads: [thread('t1'), thread('t2'), thread('t3')],
      searchQuery: '',
      matches: [],
      activeSplit: 'important',
      mailboxView: 'inbox',
      now: new Date('2026-07-03T10:00:00.000Z'),
      tabCategories: [],
      labelDefinitions: [],
      mutedLabelIdsByAccount: {},
      getThreadCategory: () => 'important',
      yieldToUI,
      batchSize: 1,
      isCancelled: () => cancelled,
    });

    expect(result).toBeNull();
    expect(yieldToUI).toHaveBeenCalledTimes(1);
  });
});
