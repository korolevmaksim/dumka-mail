import { describe, expect, it } from 'vitest';
import {
  buildAutomationCandidatesFromAgentPlan,
  simulateMailRule,
  simulateMailRules,
} from '../shared/mailRuleSimulator';
import type {
  AgentPlan,
  MailActionLog,
  MailAutomationRule,
  MailLabelDefinition,
  MailThread,
} from '../shared/types';

const ACCOUNT = 'me@example.com';

function thread(partial: Partial<MailThread> = {}): MailThread {
  return {
    id: 't1',
    accountId: ACCOUNT,
    subject: 'Newsletter digest',
    snippet: 'Weekly digest',
    lastMessageAt: '2026-07-08T10:00:00.000Z',
    senderNames: ['News'],
    senderEmail: 'news@example.com',
    labelIds: ['INBOX', 'UNREAD'],
    hasAttachments: false,
    isUnread: true,
    ...partial,
  };
}

function rule(partial: Partial<MailAutomationRule> = {}): MailAutomationRule {
  return {
    id: 'rule-news',
    title: 'Archive newsletters',
    isEnabled: true,
    accountId: ACCOUNT,
    matchMode: 'all',
    conditions: [{
      id: 'from-news',
      field: 'senderDomain',
      operation: 'equals',
      value: 'example.com',
      isNegated: false,
      accountId: ACCOUNT,
    }],
    actions: [{ id: 'archive', type: 'archive' }],
    ...partial,
  };
}

function label(id = 'Label_1'): MailLabelDefinition {
  return {
    id,
    accountId: ACCOUNT,
    name: 'Newsletters',
    type: 'user',
  };
}

function log(partial: Partial<MailActionLog> = {}): MailActionLog {
  return {
    id: 'mail-rule:rule-news:me@example.com:t1:archive:archive',
    accountId: ACCOUNT,
    threadId: 't1',
    draftId: null,
    kind: 'markDone',
    status: 'completed',
    createdAt: '2026-07-08T11:00:00.000Z',
    scheduledAt: null,
    completedAt: '2026-07-08T11:00:01.000Z',
    failureMessage: null,
    payloadJson: null,
    ...partial,
  };
}

describe('simulateMailRule', () => {
  it('reports matched threads and would-apply effects for safe actions', () => {
    const simulation = simulateMailRule({
      rule: rule(),
      threads: [thread(), thread({ id: 'other', senderEmail: 'bot@other.test' })],
    });

    expect(simulation.matchedThreadCount).toBe(1);
    expect(simulation.effectCount).toBe(1);
    expect(simulation.samples[0].effects[0].status).toBe('wouldApply');
    expect(simulation.samples[0].effects[0].summary).toContain('remove Inbox');
  });

  it('marks existing action-log effects as already applied', () => {
    const simulation = simulateMailRule({
      rule: rule(),
      threads: [thread()],
      actionLogs: [log()],
    });

    expect(simulation.alreadyAppliedCount).toBe(1);
    expect(simulation.samples[0].effects[0].status).toBe('alreadyApplied');
  });

  it('skips missing labels for label actions', () => {
    const simulation = simulateMailRule({
      rule: rule({
        actions: [{ id: 'label', type: 'applyLabel', labelId: 'Missing_Label' }],
      }),
      threads: [thread()],
      labelDefinitions: [label('Other_Label')],
    });

    expect(simulation.skippedCount).toBe(1);
    expect(simulation.warnings).toContain('Referenced label is missing.');
  });

  it('treats forward and autoReply actions as preview-only', () => {
    const simulation = simulateMailRule({
      rule: rule({
        actions: [
          { id: 'forward', type: 'forward', forwardTo: 'ops@example.com' },
          { id: 'reply', type: 'autoReply', replyBody: 'Got it.' },
        ],
      }),
      threads: [thread()],
    });

    expect(simulation.previewOnlyCount).toBe(2);
    expect(simulation.warnings).toContain('Send-like actions are preview-only in this simulator.');
  });

  it('skips incomplete actions', () => {
    const simulation = simulateMailRule({
      rule: rule({ actions: [{ id: 'label', type: 'moveToLabel' }] }),
      threads: [thread()],
    });

    expect(simulation.skippedCount).toBe(1);
    expect(simulation.warnings).toContain('Action is incomplete.');
  });
});

describe('simulateMailRules', () => {
  it('aggregates totals across rules', () => {
    const summary = simulateMailRules({
      settings: {
        enabled: true,
        rules: [
          rule(),
          rule({ id: 'rule-label', title: 'Label newsletters', actions: [{ id: 'label', type: 'applyLabel', labelId: 'Label_1' }] }),
        ],
      },
      threads: [thread()],
      labelDefinitions: [label()],
      now: new Date('2026-07-08T12:00:00.000Z'),
    });

    expect(summary.generatedAt).toBe('2026-07-08T12:00:00.000Z');
    expect(summary.ruleCount).toBe(2);
    expect(summary.effectCount).toBe(2);
    expect(summary.matchedThreadCount).toBe(1);
  });

  it('counts all matched threads even when samples are capped', () => {
    const threads = Array.from({ length: 10 }, (_, index) => thread({
      id: `t${index + 1}`,
      senderEmail: `sender${index + 1}@example.com`,
    }));
    const summary = simulateMailRules({
      settings: {
        enabled: true,
        rules: [rule()],
      },
      threads,
    });

    expect(summary.matchedThreadCount).toBe(10);
    expect(summary.simulations[0].matchedThreadCount).toBe(10);
    expect(summary.simulations[0].samples).toHaveLength(8);
  });
});

describe('buildAutomationCandidatesFromAgentPlan', () => {
  it('suggests a disabled archive rule from repeated approved archive actions by domain', () => {
    const plan: AgentPlan = {
      id: 'agent:test',
      title: 'Agent Review Queue',
      source: 'command',
      sourceTitle: 'Manual additions',
      generatedAt: '2026-07-08T12:00:00.000Z',
      accountId: ACCOUNT,
      items: [
        item('t1', 'news@example.com'),
        item('t2', 'digest@example.com'),
      ],
      coverage: {
        sourceThreadCount: 2,
        proposedActionCount: 2,
        aiAssisted: false,
        privacyMode: 'localCache',
        bodyContextIncluded: false,
        warnings: [],
      },
    };

    const candidates = buildAutomationCandidatesFromAgentPlan({
      plan,
      threads: [
        thread({ id: 't1', senderEmail: 'news@example.com' }),
        thread({ id: 't2', senderEmail: 'digest@example.com' }),
      ],
      actionLogs: [
        log({ id: 'a1', threadId: 't1' }),
        log({ id: 'a2', threadId: 't2' }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].rule.isEnabled).toBe(false);
    expect(candidates[0].rule.conditions[0].field).toBe('senderDomain');
    expect(candidates[0].sourceActionCount).toBe(2);
  });

  it('does not treat unrelated completed logs as agent-review approvals', () => {
    const plan: AgentPlan = {
      id: 'agent:test',
      title: 'Agent Review Queue',
      source: 'command',
      sourceTitle: 'Manual additions',
      generatedAt: '2026-07-08T12:00:00.000Z',
      accountId: ACCOUNT,
      items: [
        item('t1', 'news@example.com', { approvalState: 'proposed' }),
        item('t2', 'digest@example.com', { approvalState: 'proposed' }),
      ],
      coverage: {
        sourceThreadCount: 2,
        proposedActionCount: 2,
        aiAssisted: false,
        privacyMode: 'localCache',
        bodyContextIncluded: false,
        warnings: [],
      },
    };

    const candidates = buildAutomationCandidatesFromAgentPlan({
      plan,
      threads: [
        thread({ id: 't1', senderEmail: 'news@example.com' }),
        thread({ id: 't2', senderEmail: 'digest@example.com' }),
      ],
      actionLogs: [
        log({ id: 'unrelated-1', threadId: 't1', payloadJson: JSON.stringify({ source: 'dailyBriefing', action: 'archive' }) }),
        log({ id: 'unrelated-2', threadId: 't2', payloadJson: JSON.stringify({ source: 'cleanup', action: 'archive' }) }),
      ],
    });

    expect(candidates).toHaveLength(0);
  });

  it('can suggest from matching completed agent-review action logs', () => {
    const first = item('t1', 'news@example.com', { approvalState: 'proposed' });
    const second = item('t2', 'digest@example.com', { approvalState: 'proposed' });
    const plan: AgentPlan = {
      id: 'agent:test',
      title: 'Agent Review Queue',
      source: 'command',
      sourceTitle: 'Manual additions',
      generatedAt: '2026-07-08T12:00:00.000Z',
      accountId: ACCOUNT,
      items: [first, second],
      coverage: {
        sourceThreadCount: 2,
        proposedActionCount: 2,
        aiAssisted: false,
        privacyMode: 'localCache',
        bodyContextIncluded: false,
        warnings: [],
      },
    };

    const candidates = buildAutomationCandidatesFromAgentPlan({
      plan,
      threads: [
        thread({ id: 't1', senderEmail: 'news@example.com' }),
        thread({ id: 't2', senderEmail: 'digest@example.com' }),
      ],
      actionLogs: [
        log({ id: 'a1', threadId: 't1', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: first.id, action: first.action }) }),
        log({ id: 'a2', threadId: 't2', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: second.id, action: second.action }) }),
      ],
    });

    expect(candidates).toHaveLength(1);
  });

  it('can suggest from completed agent-review logs after plan items are gone', () => {
    const candidates = buildAutomationCandidatesFromAgentPlan({
      plan: null,
      threads: [
        thread({ id: 't1', senderEmail: 'news@example.com' }),
        thread({ id: 't2', senderEmail: 'digest@example.com' }),
      ],
      actionLogs: [
        log({ id: 'a1', threadId: 't1', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: 'old-1', action: 'archive' }) }),
        log({ id: 'a2', threadId: 't2', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: 'old-2', action: 'archive' }) }),
      ],
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].rule.accountId).toBe(ACCOUNT);
  });

  it('does not combine same-domain approvals across accounts', () => {
    const candidates = buildAutomationCandidatesFromAgentPlan({
      plan: null,
      threads: [
        thread({ id: 't1', accountId: 'me@example.com', senderEmail: 'news@example.com' }),
        thread({ id: 't2', accountId: 'work@example.com', senderEmail: 'digest@example.com' }),
      ],
      actionLogs: [
        log({ id: 'a1', accountId: 'me@example.com', threadId: 't1', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: 'old-1', action: 'archive' }) }),
        log({ id: 'a2', accountId: 'work@example.com', threadId: 't2', payloadJson: JSON.stringify({ source: 'agentReviewQueue', itemId: 'old-2', action: 'archive' }) }),
      ],
    });

    expect(candidates).toHaveLength(0);
  });
});

function item(
  threadId: string,
  senderEmail: string,
  overrides: Partial<AgentPlan['items'][number]> = {},
): AgentPlan['items'][number] {
  return {
    id: `agent:cleanup:archive:${threadId}`,
    accountId: ACCOUNT,
    threadId,
    subject: 'Newsletter digest',
    sender: senderEmail,
    action: 'archive',
    title: 'Archive old thread',
    reason: 'Repeated archive approval.',
    citation: {
      accountId: ACCOUNT,
      threadId,
      messageId: null,
      subject: 'Newsletter digest',
      sender: senderEmail,
      senderEmail,
      snippet: 'Weekly digest',
      evidence: 'Approved archive',
      receivedAt: '2026-07-08T10:00:00.000Z',
    },
    riskLevel: 'low',
    confidence: 90,
    selectionPolicy: 'autoSelected',
    approvalState: 'applied',
    ...overrides,
  };
}
