import { describe, expect, it } from 'vitest';
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../shared/agentPlan';
import {
  CLEANUP_ARCHIVE_AGE_MS,
  CLEANUP_ARCHIVE_BATCH_LIMIT,
  isCleanupSenderActionable,
  selectArchiveOldCandidates,
  shouldResurfaceUnsubscribedSender,
  suggestCleanupAction,
  UNSUBSCRIBE_GRACE_PERIOD_MS,
  UNSUBSCRIBE_RESURFACE_MIN_MESSAGES,
} from '../shared/cleanup';
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
    archiveableOldCount: 0,
    trackerCount: 0,
    maxRiskLevel: null,
    attachmentBytes: 0,
    ...partial,
  };
}

function thread(partial: Partial<MailThread> = {}): MailThread {
  return {
    id: partial.id || 'thread-1',
    accountId: partial.accountId || 'me@example.com',
    subject: partial.subject || 'Weekly digest',
    snippet: partial.snippet || 'Here are the weekly product updates and links.',
    lastMessageAt: partial.lastMessageAt || '2026-05-20T08:00:00.000Z',
    senderNames: partial.senderNames || ['Example News'],
    senderEmail: partial.senderEmail || 'news@example.com',
    labelIds: partial.labelIds || ['INBOX'],
    hasAttachments: partial.hasAttachments ?? false,
    isUnread: partial.isUnread ?? false,
    reminderAt: partial.reminderAt ?? null,
  };
}

describe('isCleanupSenderActionable', () => {
  it('is false when neither archive nor unsubscribe is possible', () => {
    expect(isCleanupSenderActionable(stat())).toBe(false);
  });

  it('is true when an unsubscribe header exists', () => {
    expect(isCleanupSenderActionable(stat({ hasUnsubscribeHeader: true }))).toBe(true);
  });

  it('is true when archiveable old threads exist', () => {
    expect(isCleanupSenderActionable(stat({ archiveableOldCount: 3 }))).toBe(true);
  });
});

describe('selectArchiveOldCandidates', () => {
  const now = Date.parse('2026-07-08T12:00:00.000Z');

  it('keeps INBOX threads older than 30 days, including unread', () => {
    const oldRead = thread({ id: 'old-read', lastMessageAt: '2026-05-01T00:00:00.000Z', isUnread: false });
    const oldUnread = thread({ id: 'old-unread', lastMessageAt: '2026-05-02T00:00:00.000Z', isUnread: true });
    const recent = thread({ id: 'recent', lastMessageAt: '2026-07-01T00:00:00.000Z' });
    const archived = thread({ id: 'archived', lastMessageAt: '2026-04-01T00:00:00.000Z', labelIds: ['CATEGORY_UPDATES'] });

    const selected = selectArchiveOldCandidates([oldRead, oldUnread, recent, archived], { now });
    expect(selected.map(item => item.id)).toEqual(['old-read', 'old-unread']);
  });

  it('sorts oldest first and respects the batch limit', () => {
    const threads = Array.from({ length: 30 }, (_, index) => thread({
      id: `t-${index}`,
      lastMessageAt: new Date(now - CLEANUP_ARCHIVE_AGE_MS - (index + 1) * 86_400_000).toISOString(),
    }));

    const selected = selectArchiveOldCandidates(threads, { now, limit: CLEANUP_ARCHIVE_BATCH_LIMIT });
    expect(selected).toHaveLength(CLEANUP_ARCHIVE_BATCH_LIMIT);
    expect(selected[0].id).toBe('t-29');
    expect(selected[selected.length - 1].id).toBe('t-5');
  });

  it('returns an empty list when nothing is archiveable', () => {
    expect(selectArchiveOldCandidates([
      thread({ lastMessageAt: '2026-07-05T00:00:00.000Z' }),
      thread({ lastMessageAt: '2026-04-01T00:00:00.000Z', labelIds: ['SENT'] }),
    ], { now })).toEqual([]);
  });
});

describe('suggestCleanupAction', () => {
  it('exports the archive batch limit used by the panel', () => {
    expect(CLEANUP_ARCHIVE_BATCH_LIMIT).toBe(25);
  });

  it('recommends review for high-risk senders above every other rule', () => {
    expect(suggestCleanupAction(stat({
      maxRiskLevel: 'high',
      hasUnsubscribeHeader: true,
      recent30dCount: 50,
      archiveableOldCount: 12,
    }))).toBe('review');
  });

  it('does not treat medium or low risk as review', () => {
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'medium', archiveableOldCount: 4 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'low', hasUnsubscribeHeader: true, recent30dCount: 3 }))).toBe('unsubscribe');
  });

  it('recommends unsubscribe at the recent30d >= 3 boundary when the header exists', () => {
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 3 }))).toBe('unsubscribe');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 2 }))).toBe('none');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: false, recent30dCount: 3, archiveableOldCount: 0 }))).toBe('none');
  });

  it('recommends unsubscribe for re-surfaced previously-unsubscribed senders without the volume gate', () => {
    expect(suggestCleanupAction(stat({
      previouslyUnsubscribed: true,
      hasUnsubscribeHeader: true,
      recent30dCount: 1,
    }))).toBe('unsubscribe');
  });

  it('prefers unsubscribe over archiveOld when both match', () => {
    expect(suggestCleanupAction(stat({
      hasUnsubscribeHeader: true,
      recent30dCount: 15,
      archiveableOldCount: 20,
    }))).toBe('unsubscribe');
  });

  it('recommends archiveOld only when archiveableOldCount > 0', () => {
    expect(suggestCleanupAction(stat({ archiveableOldCount: 1 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ archiveableOldCount: 0, recent30dCount: 50, threadCount: 40 }))).toBe('none');
  });

  it('does not invent archiveOld from volume alone when nothing is archiveable', () => {
    // Former volume heuristic would fire here; capability-gated rules must not.
    expect(suggestCleanupAction(stat({
      recent30dCount: 10,
      threadCount: 10,
      messageCount: 10,
      unreadCount: 10,
      archiveableOldCount: 0,
    }))).toBe('none');
  });
});

describe('shouldResurfaceUnsubscribedSender', () => {
  const unsubscribedAt = '2026-06-01T00:00:00.000Z';
  const unsubscribedMs = Date.parse(unsubscribedAt);

  it('stays hidden inside the grace window even with post-grace-shaped counts', () => {
    expect(shouldResurfaceUnsubscribedSender({
      unsubscribedAt,
      postGraceMessageCount: 5,
      now: unsubscribedMs + UNSUBSCRIBE_GRACE_PERIOD_MS - 1,
    })).toBe(false);
  });

  it('stays hidden after grace until the min message threshold is met', () => {
    const now = unsubscribedMs + UNSUBSCRIBE_GRACE_PERIOD_MS + 1;
    expect(shouldResurfaceUnsubscribedSender({
      unsubscribedAt,
      postGraceMessageCount: UNSUBSCRIBE_RESURFACE_MIN_MESSAGES - 1,
      now,
    })).toBe(false);
    expect(shouldResurfaceUnsubscribedSender({
      unsubscribedAt,
      postGraceMessageCount: UNSUBSCRIBE_RESURFACE_MIN_MESSAGES,
      now,
    })).toBe(true);
  });

  it('rejects invalid unsubscribedAt timestamps', () => {
    expect(shouldResurfaceUnsubscribedSender({
      unsubscribedAt: 'not-a-date',
      postGraceMessageCount: 10,
    })).toBe(false);
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
      'Inbox thread from Example News, last activity 2026-05-20; part of Cleanup archive-old batch.'
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
