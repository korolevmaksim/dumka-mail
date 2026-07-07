import { describe, expect, it } from 'vitest';
import {
  boundedMailboxSnippet,
  MAILBOX_SEARCH_DEFAULT_LIMIT,
  MAILBOX_SEARCH_MAX_LIMIT,
  mergeMailboxSearchSources,
  normalizeMailboxSearchLimit,
  type MailboxSearchSourceCandidate,
} from '../shared/mailboxSearchTool';
import type { RankedSourceList } from '../shared/searchRanking';

const source = (
  threadId: string,
  sourceKind: 'fts' | 'semantic',
  receivedAt = '2026-07-01T10:00:00.000Z',
): MailboxSearchSourceCandidate => ({
  accountId: 'a@example.com',
  threadId,
  messageId: `${threadId}-m`,
  subject: `Subject ${threadId}`,
  sender: 'Ada',
  senderEmail: 'ada@example.com',
  receivedAt,
  lastMessageAt: receivedAt,
  snippet: 'A useful mailbox search snippet',
  sourceKind,
});

describe('mailbox search tool shaping', () => {
  it('clamps result limits to the bounded tool range', () => {
    expect(normalizeMailboxSearchLimit(undefined)).toBe(MAILBOX_SEARCH_DEFAULT_LIMIT);
    expect(normalizeMailboxSearchLimit(0)).toBe(1);
    expect(normalizeMailboxSearchLimit(999)).toBe(MAILBOX_SEARCH_MAX_LIMIT);
    expect(normalizeMailboxSearchLimit(4.8)).toBe(4);
  });

  it('normalizes whitespace and bounds snippets', () => {
    const snippet = boundedMailboxSnippet(` hello\n${'x'.repeat(400)} `, 20);
    expect(snippet).toHaveLength(20);
    expect(snippet.startsWith('hello')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
  });

  it('marks sources as hybrid when the same thread appears in FTS and semantic results', () => {
    const lists: RankedSourceList[] = [
      { accountId: 'a@example.com', source: 'fts', entries: [{ threadId: 't1', messageId: 'm1' }] },
      { accountId: 'a@example.com', source: 'semantic', entries: [{ threadId: 't1', messageId: 'm1', score: 0.9 }] },
    ];

    const merged = mergeMailboxSearchSources([source('t1', 'fts'), source('t1', 'semantic')], lists, 5);

    expect(merged).toHaveLength(1);
    expect(merged[0].sourceKind).toBe('hybrid');
    expect(merged[0].whyMatched).toContain('full-text and semantic');
  });

  it('orders by fused score before recency and applies the requested limit', () => {
    const lists: RankedSourceList[] = [
      { accountId: 'a@example.com', source: 'fts', entries: [{ threadId: 't1', messageId: 'm1' }, { threadId: 't2', messageId: 'm2' }] },
      { accountId: 'a@example.com', source: 'semantic', entries: [{ threadId: 't1', messageId: 'm1' }, { threadId: 't3', messageId: 'm3' }] },
    ];

    const merged = mergeMailboxSearchSources([
      source('t3', 'semantic', '2026-07-03T10:00:00.000Z'),
      source('t2', 'fts', '2026-07-02T10:00:00.000Z'),
      source('t1', 'fts', '2026-07-01T10:00:00.000Z'),
    ], lists, 2);

    expect(merged.map(item => item.threadId)).toEqual(['t1', 't3']);
  });
});
