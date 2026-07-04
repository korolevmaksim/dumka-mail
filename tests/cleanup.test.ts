import { describe, expect, it } from 'vitest';
import { CLEANUP_ARCHIVE_BATCH_LIMIT, suggestCleanupAction } from '../shared/cleanup';
import type { SenderCleanupStat } from '../shared/types';

function stat(partial: Partial<SenderCleanupStat> = {}): SenderCleanupStat {
  return {
    accountId: 'me@example.com',
    senderEmail: 'news@example.com',
    senderName: 'Example News',
    threadCount: 4,
    messageCount: 6,
    unreadCount: 1,
    lastReceivedAt: '2026-07-01T00:00:00.000Z',
    recent30dCount: 2,
    hasUnsubscribeHeader: false,
    trackerCount: 0,
    maxRiskLevel: null,
    attachmentBytes: 0,
    ...partial,
  };
}

describe('suggestCleanupAction', () => {
  it('exports the archive batch limit used by the panel', () => {
    expect(CLEANUP_ARCHIVE_BATCH_LIMIT).toBe(25);
  });

  it('recommends review for high-risk senders above every other rule', () => {
    expect(suggestCleanupAction(stat({
      maxRiskLevel: 'high',
      hasUnsubscribeHeader: true,
      recent30dCount: 50,
      threadCount: 20,
      messageCount: 20,
      unreadCount: 20,
    }))).toBe('review');
  });

  it('does not treat medium or low risk as review', () => {
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'medium' }))).toBe('none');
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'low' }))).toBe('none');
  });

  it('recommends unsubscribe at the recent30d >= 3 boundary when the header exists', () => {
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 3 }))).toBe('unsubscribe');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 2 }))).toBe('none');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: false, recent30dCount: 3 }))).toBe('none');
  });

  it('prefers unsubscribe over archiveOld when both match', () => {
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 15 }))).toBe('unsubscribe');
  });

  it('recommends archiveOld at the recent30d >= 10 boundary', () => {
    expect(suggestCleanupAction(stat({ recent30dCount: 10 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ recent30dCount: 9 }))).toBe('none');
  });

  it('recommends archiveOld for 10+ threads with unread ratio >= 0.7', () => {
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 10, unreadCount: 7, recent30dCount: 0 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 10, unreadCount: 6, recent30dCount: 0 }))).toBe('none');
    expect(suggestCleanupAction(stat({ threadCount: 9, messageCount: 10, unreadCount: 9, recent30dCount: 0 }))).toBe('none');
  });

  it('never divides by zero for senders with no messages', () => {
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 0, unreadCount: 0, recent30dCount: 0 }))).toBe('none');
  });
});
