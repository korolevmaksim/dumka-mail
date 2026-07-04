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

function tickingClock(stepMs: number): () => number {
  let current = 0;
  return () => {
    const value = current;
    current += stepMs;
    return value;
  };
}

describe('mail thread cooperative filtering', () => {
  it('yields once per exhausted time slice while rebuilding the visible inbox list', async () => {
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
      sliceMs: 8,
      nowMs: tickingClock(5),
    });

    expect(result?.map(item => item.id)).toEqual(['t1', 't2', 't3', 't4']);
    expect(yieldToUI).toHaveBeenCalledTimes(2);
  });

  it('processes a large thread list without yielding while the slice budget is not exhausted', async () => {
    const yieldToUI = vi.fn(async () => undefined);
    const threads = Array.from({ length: 500 }, (_, index) => thread(`t${index}`));

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
      sliceMs: 8,
      nowMs: () => 0,
    });

    expect(result).toHaveLength(500);
    expect(yieldToUI).not.toHaveBeenCalled();
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
      sliceMs: 1,
      nowMs: tickingClock(1),
      isCancelled: () => cancelled,
    });

    expect(result).toBeNull();
    expect(yieldToUI).toHaveBeenCalledTimes(1);
  });

  it('keeps only threads present in the search matches for a text query', async () => {
    const result = await filterVisibleThreadsCooperatively({
      threads: [thread('t1'), thread('t2'), thread('t3')],
      searchQuery: 'contract',
      matches: [{ threadId: 't2', messageId: 'm2' }],
      activeSplit: 'important',
      mailboxView: 'inbox',
      now: new Date('2026-07-03T10:00:00.000Z'),
      tabCategories: [],
      labelDefinitions: [],
      mutedLabelIdsByAccount: {},
      getThreadCategory: () => 'important',
    });

    expect(result?.map(item => item.id)).toEqual(['t2']);
  });

  it('filters by mailbox view and active split without a search query', async () => {
    const threads = [
      thread('t1'),
      thread('t2', { labelIds: ['TRASH'] }),
      thread('t3'),
    ];
    const getThreadCategory = (item: MailThread) => item.id === 't3' ? 'other' : 'important';

    const trashResult = await filterVisibleThreadsCooperatively({
      threads,
      searchQuery: '',
      matches: [],
      activeSplit: 'important',
      mailboxView: 'trash',
      now: new Date('2026-07-03T10:00:00.000Z'),
      tabCategories: [],
      labelDefinitions: [],
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(trashResult?.map(item => item.id)).toEqual(['t2']);

    const splitResult = await filterVisibleThreadsCooperatively({
      threads,
      searchQuery: '',
      matches: [],
      activeSplit: 'important',
      mailboxView: 'inbox',
      now: new Date('2026-07-03T10:00:00.000Z'),
      tabCategories: [],
      labelDefinitions: [],
      mutedLabelIdsByAccount: {},
      getThreadCategory,
    });

    expect(splitResult?.map(item => item.id)).toEqual(['t1']);
  });
});
