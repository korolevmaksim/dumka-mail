import { describe, expect, it } from 'vitest';
import {
  collectHistoryThreadIds,
  paginateGmailHistory,
  resolveIncrementalHistoryCursor,
} from '../shared/gmailHistory';

describe('collectHistoryThreadIds', () => {
  it('unions added, labeled, and deleted thread ids', () => {
    expect(collectHistoryThreadIds([
      { messagesAdded: [{ message: { threadId: 't1' } }] },
      { labelsAdded: [{ message: { threadId: 't2' } }], labelsRemoved: [{ message: { threadId: 't1' } }] },
      { messagesDeleted: [{ message: { threadId: 't3' } }] },
    ])).toEqual({
      updatedThreadIds: ['t1', 't2'],
      deletedThreadIds: ['t3'],
    });
  });
});

describe('resolveIncrementalHistoryCursor', () => {
  it('uses the last page historyId after a complete walk', () => {
    expect(resolveIncrementalHistoryCursor('10', [
      { historyId: '20', nextPageToken: 'p2' },
      { historyId: '30' },
    ])).toBe('30');
  });

  it('throws HISTORY_EXPIRED when the page cap is hit with more pages remaining', () => {
    expect(() => resolveIncrementalHistoryCursor('10', [
      { historyId: '20', nextPageToken: 'p2' },
      { historyId: '30', nextPageToken: 'p3' },
    ], 2)).toThrow('HISTORY_EXPIRED');
  });
});

describe('paginateGmailHistory', () => {
  it('throws HISTORY_EXPIRED when the page cap still has a leftover token', async () => {
    await expect(paginateGmailHistory({
      startHistoryId: '10',
      maxPages: 2,
      fetchPage: async (token) => ({
        history: [{ messagesAdded: [{ message: { threadId: token || 'a' } }] }],
        historyId: token === 'p2' ? '12' : '11',
        nextPageToken: token === 'p2' ? 'p3' : 'p2',
      }),
    })).rejects.toThrow('HISTORY_EXPIRED');
  });

  it('walks every page and returns the last cursor', async () => {
    const pages = [
      { history: [{ messagesAdded: [{ message: { threadId: 'a' } }] }], historyId: '11', nextPageToken: 'p2' },
      { history: [{ labelsAdded: [{ message: { threadId: 'b' } }] }], historyId: '12' },
    ];
    const result = await paginateGmailHistory({
      startHistoryId: '10',
      fetchPage: async (token) => token === 'p2' ? pages[1] : pages[0],
    });
    expect(result.updatedThreadIds.sort()).toEqual(['a', 'b']);
    expect(result.historyId).toBe('12');
  });
});
