import { describe, expect, it } from 'vitest';
import {
  advanceReplyPipelineState,
  canPrepareReplyPipelineCandidateDraft,
  detectReplyDraftPlaceholders,
  hasReplyDraftPlaceholder,
  markReplyPipelineDraftReady,
  markReplyPipelineSent,
  reconcileReplyPipelineCandidate,
  replyDraftPlaceholderValidationMessage,
  resolveReplyPipelineForInbound,
  resumeReplyPipelineState,
  snoozeReplyPipelineState,
} from '../shared/replyPipeline';
import type {
  ReplyPipelineCandidate,
  ReplyPipelineState,
  ReplyPipelineStatus,
} from '../shared/types';

const ACCOUNT = 'me@example.com';
const THREAD = 'thread-1';
const NOW = '2026-07-09T10:00:00.000Z';

function candidate(overrides: Partial<ReplyPipelineCandidate> = {}): ReplyPipelineCandidate {
  return {
    accountId: ACCOUNT,
    threadId: THREAD,
    sourceMessageId: 'inbound-1',
    sourceReceivedAt: '2026-07-09T09:00:00.000Z',
    sourceKind: 'inbound',
    status: 'needsReply',
    reason: 'A direct question needs a reply.',
    priority: 90,
    ...overrides,
  };
}

function state(overrides: Partial<ReplyPipelineState> = {}): ReplyPipelineState {
  return {
    ...reconcileReplyPipelineCandidate(null, candidate(), NOW),
    ...overrides,
  };
}

describe('reply pipeline candidate reconciliation', () => {
  it('creates a complete current-row lifecycle from a candidate', () => {
    expect(reconcileReplyPipelineCandidate(null, candidate(), NOW)).toEqual({
      accountId: ACCOUNT,
      threadId: THREAD,
      sourceMessageId: 'inbound-1',
      sourceReceivedAt: '2026-07-09T09:00:00.000Z',
      sourceKind: 'inbound',
      status: 'needsReply',
      resumeStatus: null,
      draftId: null,
      draftOrigin: null,
      hasPlaceholders: false,
      waitingSince: null,
      dueAt: null,
      snoozedUntil: null,
      reason: 'A direct question needs a reply.',
      priority: 90,
      resolvedAt: null,
      createdAt: NOW,
      updatedAt: NOW,
    });
  });

  it.each<ReplyPipelineStatus>([
    'needsReply',
    'draftReady',
    'waitingOnThem',
    'due',
    'resolved',
    'snoozed',
    'suppressed',
  ])('preserves same-source %s state during candidate refresh', status => {
    const current = state({
      status,
      resumeStatus: status === 'snoozed' ? 'draftReady' : null,
      draftId: status === 'draftReady' || status === 'snoozed' ? 'draft-1' : null,
      draftOrigin: status === 'draftReady' || status === 'snoozed' ? 'automation' : null,
      snoozedUntil: status === 'snoozed' ? '2026-07-10T10:00:00.000Z' : null,
      resolvedAt: status === 'resolved' ? '2026-07-09T09:30:00.000Z' : null,
    });

    const refreshed = reconcileReplyPipelineCandidate(current, candidate({
      reason: 'Updated local evidence.',
      priority: 95,
    }), '2026-07-09T11:00:00.000Z');

    expect(refreshed.status).toBe(status);
    expect(refreshed.draftId).toBe(current.draftId);
    expect(refreshed.reason).toBe('Updated local evidence.');
    expect(refreshed.priority).toBe(95);
  });

  it('ignores older different-source candidates and reopens for a newer source', () => {
    const suppressed = state({
      status: 'suppressed',
      sourceReceivedAt: '2026-07-09T09:00:00.000Z',
      resolvedAt: '2026-07-09T09:15:00.000Z',
    });
    const older = reconcileReplyPipelineCandidate(suppressed, candidate({
      sourceMessageId: 'inbound-old',
      sourceReceivedAt: '2026-07-09T08:59:59.000Z',
    }), '2026-07-09T11:00:00.000Z');
    expect(older).toBe(suppressed);

    const reopened = reconcileReplyPipelineCandidate(suppressed, candidate({
      sourceMessageId: 'inbound-2',
      sourceReceivedAt: '2026-07-09T09:30:00.000Z',
      reason: 'A newer request needs attention.',
    }), '2026-07-09T11:00:00.000Z');

    expect(reopened).toMatchObject({
      sourceMessageId: 'inbound-2',
      sourceReceivedAt: '2026-07-09T09:30:00.000Z',
      status: 'needsReply',
      reason: 'A newer request needs attention.',
      resolvedAt: null,
      draftId: null,
      createdAt: '2026-07-09T11:00:00.000Z',
    });
  });
});

describe('reply pipeline transitions', () => {
  it('advances needsReply to draftReady, waitingOnThem, and due', () => {
    const ready = markReplyPipelineDraftReady(state(), 'draft-1', 'automation', true, NOW);
    expect(ready).toMatchObject({
      status: 'draftReady',
      draftId: 'draft-1',
      draftOrigin: 'automation',
      hasPlaceholders: true,
    });

    const waiting = markReplyPipelineSent(
      ready,
      '2026-07-09T10:05:00.000Z',
      '2026-07-11T10:05:00.000Z',
    );
    expect(waiting).toMatchObject({
      status: 'waitingOnThem',
      sourceKind: 'outbound',
      sourceMessageId: 'pending-send:draft-1',
      sourceReceivedAt: '2026-07-09T10:05:00.000Z',
      draftId: null,
      draftOrigin: null,
      waitingSince: '2026-07-09T10:05:00.000Z',
      dueAt: '2026-07-11T10:05:00.000Z',
    });
    expect(advanceReplyPipelineState(waiting, '2026-07-11T10:04:59.000Z')).toBe(waiting);
    expect(advanceReplyPipelineState(waiting, '2026-07-11T10:05:00.000Z')).toMatchObject({
      status: 'due',
      updatedAt: '2026-07-11T10:05:00.000Z',
    });
  });

  it('allows a durable briefing action only for its matching draftable source', () => {
    const source = candidate();
    expect(canPrepareReplyPipelineCandidateDraft(state(), source)).toBe(true);
    expect(canPrepareReplyPipelineCandidateDraft(state({ status: 'draftReady' }), source)).toBe(true);
    for (const status of ['waitingOnThem', 'resolved', 'snoozed', 'suppressed'] as const) {
      expect(canPrepareReplyPipelineCandidateDraft(state({
        status,
        resumeStatus: status === 'snoozed' ? 'needsReply' : null,
      }), source)).toBe(false);
    }
    expect(canPrepareReplyPipelineCandidateDraft(state({ sourceMessageId: 'newer-source' }), source)).toBe(false);
  });

  it('snoozes and restores the exact previous lifecycle status', () => {
    const ready = markReplyPipelineDraftReady(state(), 'draft-1', 'template', false, NOW);
    const snoozed = snoozeReplyPipelineState(
      ready,
      '2026-07-10T10:00:00.000Z',
      '2026-07-09T10:05:00.000Z',
    );
    expect(snoozed).toMatchObject({
      status: 'snoozed',
      resumeStatus: 'draftReady',
      draftId: 'draft-1',
    });
    expect(advanceReplyPipelineState(snoozed, '2026-07-10T09:59:59.000Z')).toBe(snoozed);
    expect(advanceReplyPipelineState(snoozed, '2026-07-10T10:00:00.000Z')).toMatchObject({
      status: 'draftReady',
      resumeStatus: null,
      snoozedUntil: null,
      draftId: 'draft-1',
    });
    expect(resumeReplyPipelineState(snoozed, '2026-07-09T12:00:00.000Z').status).toBe('draftReady');
  });

  it('restores an expired waiting snooze and immediately marks it due', () => {
    const waiting = markReplyPipelineSent(
      state(),
      '2026-07-09T10:00:00.000Z',
      '2026-07-10T10:00:00.000Z',
    );
    const snoozed = snoozeReplyPipelineState(
      waiting,
      '2026-07-11T10:00:00.000Z',
      '2026-07-09T11:00:00.000Z',
    );

    expect(advanceReplyPipelineState(snoozed, '2026-07-11T10:00:00.000Z').status).toBe('due');
  });
});

describe('reply pipeline inbound resolution', () => {
  it('resolves only for a later inbound event in the same account and thread', () => {
    const waiting = markReplyPipelineSent(
      state({ sourceKind: 'outbound', sourceMessageId: 'sent-1' }),
      '2026-07-09T10:00:00.000Z',
      '2026-07-11T10:00:00.000Z',
    );
    const event = {
      accountId: ACCOUNT,
      threadId: THREAD,
      messageId: 'inbound-2',
      receivedAt: '2026-07-09T11:00:00.000Z',
    };

    expect(resolveReplyPipelineForInbound(waiting, { ...event, threadId: 'other' }, NOW)).toBe(waiting);
    expect(resolveReplyPipelineForInbound(waiting, {
      ...event,
      receivedAt: '2026-07-09T09:59:59.000Z',
    }, NOW)).toBe(waiting);

    const resolved = resolveReplyPipelineForInbound(waiting, event, '2026-07-09T11:01:00.000Z');
    expect(resolved).toMatchObject({
      status: 'resolved',
      sourceMessageId: 'sent-1',
      resolvedAt: '2026-07-09T11:00:00.000Z',
      dueAt: null,
    });

    const reopened = reconcileReplyPipelineCandidate(resolved, candidate({
      sourceMessageId: event.messageId,
      sourceReceivedAt: event.receivedAt,
    }), '2026-07-09T11:02:00.000Z');
    expect(reopened.status).toBe('needsReply');
    expect(reopened.sourceMessageId).toBe('inbound-2');
  });

  it('resolves an outbound due candidate using its source time as the waiting baseline', () => {
    const due = reconcileReplyPipelineCandidate(null, candidate({
      sourceMessageId: 'sent-1',
      sourceReceivedAt: '2026-07-07T10:00:00.000Z',
      sourceKind: 'outbound',
      status: 'due',
    }), NOW);
    expect(due.waitingSince).toBe('2026-07-07T10:00:00.000Z');

    expect(resolveReplyPipelineForInbound(due, {
      accountId: ACCOUNT,
      threadId: THREAD,
      receivedAt: '2026-07-09T11:00:00.000Z',
    }, '2026-07-09T11:01:00.000Z')?.status).toBe('resolved');
  });
});

describe('reply draft placeholders', () => {
  it('detects fallback and common template tokens without flagging normal brackets', () => {
    expect(detectReplyDraftPlaceholders(
      'Hi {{first_name}},\n\n[Add your reply here]\n[availability]\n[meeting link]\n\nRegards, <<sender name>>',
    )).toEqual(['[Add your reply here]', '[availability]', '[meeting link]', '{{first_name}}', '<<sender name>>']);
    expect(hasReplyDraftPlaceholder('Please [insert project details] before sending.')).toBe(true);

    expect(hasReplyDraftPlaceholder('Re: [External] Project update')).toBe(false);
    expect(hasReplyDraftPlaceholder('Read the [project notes](https://example.com).')).toBe(false);
    expect(hasReplyDraftPlaceholder('- [x] Reviewed')).toBe(false);
    expect(replyDraftPlaceholderValidationMessage('Meet during [availability].')).toBe(
      'Replace draft placeholder before sending: [availability]',
    );
    expect(replyDraftPlaceholderValidationMessage('No template tokens remain.')).toBeNull();
    expect(replyDraftPlaceholderValidationMessage(
      'Thanks, Tuesday works.\n\nOn Jul 9, 2026, Ada wrote:\n> I am free on [availability].',
    )).toBeNull();
    expect(replyDraftPlaceholderValidationMessage(
      'Thanks, Tuesday works.\n\nOn Jul 9, 2026, Ada wrote:\nI am free on [availability].',
      '<p>Thanks, Tuesday works.</p><div class="gmail_quote" data-dumka-quoted-reply="true"><div>On Jul 9, 2026, Ada wrote:</div><blockquote>I am free on [availability].</blockquote></div>',
    )).toBeNull();
    expect(replyDraftPlaceholderValidationMessage(
      'I can meet on [date].\n\nOn Jul 9, 2026, Ada wrote:\nI am free.',
      '<p>I can meet on [date].</p><div data-dumka-quoted-reply="true"><blockquote>I am free.</blockquote></div>',
    )).toBe('Replace draft placeholder before sending: [date]');
  });
});
