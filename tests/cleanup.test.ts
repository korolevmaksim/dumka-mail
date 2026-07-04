import { describe, expect, it } from 'vitest';
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../shared/agentPlan';
import { CLEANUP_ARCHIVE_BATCH_LIMIT, suggestCleanupAction } from '../shared/cleanup';
import type { MailThread, SenderCleanupStat, UnsubscribeCandidate } from '../shared/types';

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

const cleanupThread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Weekly digest',
  snippet: 'Here are the weekly product updates and links.',
  lastMessageAt: '2026-05-20T08:00:00.000Z',
  senderNames: ['Example News'],
  senderEmail: 'news@example.com',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};

function candidate(partial: Partial<UnsubscribeCandidate> = {}): UnsubscribeCandidate {
  return {
    accountId: 'me@example.com',
    threadId: 'thread-9',
    messageId: 'msg-9',
    senderEmail: 'news@example.com',
    senderName: 'Example News',
    methods: [{ kind: 'httpPost', url: 'https://example.com/unsub', isOneClick: true }],
    recommendedMethod: { kind: 'httpPost', url: 'https://example.com/unsub', isOneClick: true },
    canOneClick: true,
    ...partial,
  };
}

describe('buildCleanupArchiveItem', () => {
  it('builds a low-risk auto-selected archive proposal with batch evidence', () => {
    const item = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });

    expect(item).toMatchObject({
      id: 'agent:cleanup:archive:thread-1',
      accountId: 'me@example.com',
      threadId: 'thread-1',
      action: 'archive',
      title: 'Archive old thread',
      riskLevel: 'low',
      selectionPolicy: 'autoSelected',
      approvalState: 'proposed',
      sourceItemId: 'cleanup:news@example.com',
    });
    expect(item.citation.evidence).toBe(
      'Read thread from Example News, last activity 2026-05-20; part of Cleanup archive-old batch.'
    );
    expect(item.citation.snippet).toBe('Here are the weekly product updates and links.');
  });

  it('produces a stable id so re-clicks dedup through mergeAgentPlanItem', () => {
    const first = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });
    const second = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });
    expect(first.id).toBe(second.id);
  });
});

describe('buildCleanupUnsubscribeItem', () => {
  it('builds a high-risk manual-only unsubscribe proposal citing the one-click method', () => {
    const item = buildCleanupUnsubscribeItem({ stat: stat(), candidate: candidate() });

    expect(item).toMatchObject({
      id: 'agent:cleanup:unsubscribe:me-example-com-news-example-com',
      accountId: 'me@example.com',
      threadId: 'thread-9',
      action: 'unsubscribe',
      title: 'Unsubscribe from sender',
      riskLevel: 'high',
      selectionPolicy: 'manualOnly',
      approvalState: 'proposed',
      payload: { sourceMessageId: 'msg-9' },
    });
    expect(item.citation.evidence).toBe('One-click HTTP unsubscribe → https://example.com/unsub');
    expect(item.citation.messageId).toBe('msg-9');
  });

  it('describes mailto methods as a mail action', () => {
    const item = buildCleanupUnsubscribeItem({
      stat: stat(),
      candidate: candidate({
        methods: [{ kind: 'mailto', url: 'mailto:unsubscribe@example.com', isOneClick: false, email: 'unsubscribe@example.com' }],
        recommendedMethod: { kind: 'mailto', url: 'mailto:unsubscribe@example.com', isOneClick: false, email: 'unsubscribe@example.com' },
        canOneClick: false,
      }),
    });
    expect(item.citation.evidence).toBe('Mail to unsubscribe@example.com');
  });

  it('surfaces mailto subject and body in the evidence, truncated for display', () => {
    const longBody = `please remove me ${'x'.repeat(120)}`;
    const method = {
      kind: 'mailto' as const,
      url: 'mailto:unsub@x.com?subject=unsubscribe',
      isOneClick: false,
      email: 'unsub@x.com',
      subject: 'unsubscribe',
      body: longBody,
    };
    const item = buildCleanupUnsubscribeItem({
      stat: stat(),
      candidate: candidate({ methods: [method], recommendedMethod: method, canOneClick: false }),
    });
    expect(item.citation.evidence).toBe(
      `Mail to unsub@x.com — subject "unsubscribe", body "${longBody.slice(0, 120)}…"`
    );
  });

  it('falls back to a link description for plain http methods', () => {
    const item = buildCleanupUnsubscribeItem({
      stat: stat(),
      candidate: candidate({
        methods: [{ kind: 'httpGet', url: 'https://example.com/optout', isOneClick: false }],
        recommendedMethod: null,
        canOneClick: false,
      }),
    });
    expect(item.citation.evidence).toBe('Open unsubscribe link → https://example.com/optout');
  });
});
