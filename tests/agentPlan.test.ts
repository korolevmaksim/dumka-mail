import { describe, expect, it } from 'vitest';
import {
  buildAgentPlanFromDailyBriefingItem,
  buildAgentPlanFromTriagePlan,
  buildCleanupArchiveItem,
  mergeAgentPlanItem,
} from '../shared/agentPlan';
import type { AgentPlan, DailyBriefing, DailyBriefingItem, MailThread, MailTriagePlan, SenderCleanupStat } from '../shared/types';

const thread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Weekly digest',
  snippet: 'Here are the weekly product updates and links.',
  lastMessageAt: '2026-07-03T08:00:00.000Z',
  senderNames: ['Digest Bot'],
  senderEmail: 'digest@example.com',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  isUnread: true,
  reminderAt: null,
};

const triagePlan: MailTriagePlan = {
  accountId: 'me@example.com',
  sourceTitle: 'automation',
  generatedAt: '2026-07-03T09:00:00.000Z',
  sourceThreadCount: 1,
  intent: 'automationCleanup',
  automationRulePreview: null,
  items: [
    {
      threadId: 'thread-1',
      subject: 'Weekly digest',
      sender: 'Digest Bot',
      recommendation: 'markDoneCandidate',
      reason: 'Read automated update',
      priority: 72,
      automationRuleIds: ['marketing-digests'],
    },
  ],
};

const briefingItem: DailyBriefingItem = {
  id: 'briefing-item-1',
  accountId: 'me@example.com',
  threadId: 'thread-1',
  category: 'riskOrNoise',
  title: 'Noisy digest',
  summary: 'Digest looks like low-signal automation.',
  reason: 'Automated or bulk mail with tracking signals.',
  priority: 83,
  source: {
    accountId: 'me@example.com',
    threadId: 'thread-1',
    messageId: 'msg-1',
    subject: 'Weekly digest',
    sender: 'Digest Bot',
    senderEmail: 'digest@example.com',
    snippet: 'Tracked newsletter content.',
    receivedAt: '2026-07-03T08:00:00.000Z',
    evidence: 'Tracker detected',
  },
  suggestedActions: ['openThread', 'archive', 'applyLabel'],
  riskLevel: 'medium',
  trackerCount: 1,
  phishingLinkCount: 0,
  isUnread: true,
  receivedAt: '2026-07-03T08:00:00.000Z',
};

const briefing: DailyBriefing = {
  id: 'daily:me@example.com:2026-07-03T09:00:00.000Z',
  accountId: 'me@example.com',
  title: 'Daily Briefing',
  generatedAt: '2026-07-03T09:00:00.000Z',
  items: [briefingItem],
  settings: {
    enabled: true,
    lookbackHours: 24,
    maxItems: 12,
    includeRead: false,
    includeFyi: true,
    includeRiskAndNoise: true,
    useSemanticSearch: false,
    defaultReminderHour: 9,
  },
  coverage: {
    accountId: 'me@example.com',
    generatedAt: '2026-07-03T09:00:00.000Z',
    lookbackHours: 24,
    candidateThreadCount: 8,
    includedItemCount: 1,
    semanticSearchEnabled: false,
    semanticMatches: 0,
    bodyContextIncluded: false,
    warnings: [],
  },
};

describe('Agent Plan builders', () => {
  it('converts triage cleanup candidates into explicit archive proposals', () => {
    const plan = buildAgentPlanFromTriagePlan({
      plan: triagePlan,
      threads: [thread],
      aiAssisted: false,
    });

    expect(plan).toMatchObject({
      title: 'Agent Review Queue',
      source: 'triageQueue',
      sourceTitle: 'automation',
      coverage: {
        sourceThreadCount: 1,
        proposedActionCount: 1,
        privacyMode: 'localCache',
      },
    });
    expect(plan.items[0]).toMatchObject({
      action: 'archive',
      riskLevel: 'medium',
      selectionPolicy: 'explicitOptIn',
      approvalState: 'proposed',
      citation: {
        snippet: 'Here are the weekly product updates and links.',
        evidence: 'Read automated update',
      },
    });
  });

  it('turns a risk briefing item with a label into a reviewable label action', () => {
    const plan = buildAgentPlanFromDailyBriefingItem({
      briefing,
      item: briefingItem,
      labelId: 'Label_123',
    });

    expect(plan.items[0]).toMatchObject({
      action: 'applyLabel',
      payload: {
        labelId: 'Label_123',
        sourceMessageId: 'msg-1',
        category: 'riskOrNoise',
      },
      citation: {
        messageId: 'msg-1',
        snippet: 'Tracked newsletter content.',
      },
    });
  });

  it('deduplicates manually merged review items by item id', () => {
    const plan = buildAgentPlanFromDailyBriefingItem({ briefing, item: briefingItem });
    const merged = mergeAgentPlanItem(plan, { ...plan.items[0], reason: 'Updated reason' });

    expect(merged.items).toHaveLength(1);
    expect(merged.items[0].reason).toBe('Updated reason');
    expect(merged.coverage.proposedActionCount).toBe(1);
  });

  it('merges cleanup items additively into an existing plan and dedups by id', () => {
    const cleanupStat: SenderCleanupStat = {
      accountId: 'me@example.com',
      senderEmail: 'digest@example.com',
      senderName: 'Digest Bot',
      threadCount: 12,
      messageCount: 20,
      unreadCount: 15,
      lastReceivedAt: '2026-07-03T08:00:00.000Z',
      recent30dCount: 11,
      hasUnsubscribeHeader: true,
      trackerCount: 4,
      maxRiskLevel: 'medium',
      attachmentBytes: 0,
    };
    const archiveItem = buildCleanupArchiveItem({ stat: cleanupStat, thread });
    const planWithBriefing = buildAgentPlanFromDailyBriefingItem({ briefing, item: briefingItem });

    const merged = mergeAgentPlanItem(planWithBriefing, archiveItem);
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0].id).toBe('agent:cleanup:archive:thread-1');
    expect(merged.source).toBe('dailyBriefing');

    const deduped = mergeAgentPlanItem(merged, archiveItem);
    expect(deduped.items).toHaveLength(2);
    expect(deduped.coverage.proposedActionCount).toBe(2);
  });

  it('preserves pre-existing items when a triage plan is folded in item-by-item (Bug A regression)', () => {
    const briefingPlan = buildAgentPlanFromDailyBriefingItem({ briefing, item: briefingItem });
    const triageReviewPlan = buildAgentPlanFromTriagePlan({
      plan: triagePlan,
      threads: [thread],
      aiAssisted: false,
    });

    // This is exactly the fold runAITriagePlan must use instead of replacing the plan.
    const merged = triageReviewPlan.items.reduce<AgentPlan | null>(
      (acc, item) => mergeAgentPlanItem(acc, item),
      briefingPlan,
    );

    expect(merged?.items.map(item => item.id)).toContain(briefingPlan.items[0].id);
    expect(merged?.items).toHaveLength(2);
    expect(merged?.coverage.proposedActionCount).toBe(2);
  });
});
