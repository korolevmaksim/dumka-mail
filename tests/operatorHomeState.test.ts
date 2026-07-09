import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  briefingBelongsToRefreshWindow,
  dailyBriefingRefreshWindowKey,
  filterAgentPlanItemsForOperatorScope,
  isOperatorRequestCurrent,
  normalizeOperatorHomeStateSnapshot,
} from '../shared/operatorHomeState';
import type {
  AgentPlan,
  DailyBriefing,
  MailThread,
  OperatorHomeStateSnapshot,
} from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as {
      new (filename: string): { close: () => void };
    };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

const accountId = 'me@example.com';
const thread: MailThread = {
  id: 'thread-1',
  accountId,
  subject: 'Review this',
  snippet: 'Please review the attached plan.',
  lastMessageAt: '2026-07-09T08:00:00.000Z',
  senderNames: ['Ada'],
  senderEmail: 'ada@example.com',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: false,
  isUnread: true,
  reminderAt: null,
};

const plan: AgentPlan = {
  id: 'plan-1',
  title: 'Agent Review Queue',
  source: 'command',
  sourceTitle: 'Mailbox assistant',
  generatedAt: '2026-07-09T09:00:00.000Z',
  accountId,
  items: [{
    id: 'item-1',
    accountId,
    threadId: thread.id,
    subject: thread.subject,
    sender: 'Ada',
    action: 'archive',
    title: 'Archive thread',
    reason: 'The user approved this cleanup candidate.',
    citation: {
      accountId,
      threadId: thread.id,
      messageId: 'message-1',
      subject: thread.subject,
      sender: 'Ada',
      senderEmail: thread.senderEmail,
      snippet: thread.snippet,
      evidence: 'Approved cleanup candidate',
      receivedAt: thread.lastMessageAt,
    },
    riskLevel: 'medium',
    confidence: 88,
    selectionPolicy: 'explicitOptIn',
    approvalState: 'approved',
  }],
  coverage: {
    sourceThreadCount: 1,
    proposedActionCount: 1,
    aiAssisted: false,
    privacyMode: 'localCache',
    bodyContextIncluded: false,
    warnings: [],
  },
};

const briefing: DailyBriefing = {
  id: 'briefing-1',
  accountId,
  title: 'Daily Briefing',
  generatedAt: '2026-07-09T09:05:00.000Z',
  items: [{
    id: 'briefing-item-1',
    accountId,
    threadId: thread.id,
    category: 'needsReply',
    title: 'Reply requested',
    summary: 'Ada asked for a review.',
    reason: 'Direct question in recent inbox mail.',
    priority: 90,
    source: {
      accountId,
      threadId: thread.id,
      messageId: 'message-1',
      subject: thread.subject,
      sender: 'Ada',
      senderEmail: thread.senderEmail,
      snippet: thread.snippet,
      receivedAt: thread.lastMessageAt,
      evidence: 'Please review',
    },
    suggestedActions: ['openThread', 'draftReply'],
    trackerCount: 0,
    phishingLinkCount: 0,
    isUnread: true,
    receivedAt: thread.lastMessageAt,
  }],
  coverage: {
    accountId,
    generatedAt: '2026-07-09T09:05:00.000Z',
    lookbackHours: 24,
    candidateThreadCount: 1,
    includedItemCount: 1,
    semanticSearchEnabled: false,
    semanticMatches: 0,
    bodyContextIncluded: false,
    warnings: [],
  },
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
};

function snapshot(): OperatorHomeStateSnapshot {
  return {
    scopeId: accountId,
    agentPlan: plan,
    selectedAgentPlanItemIds: ['item-1'],
    dailyBriefing: briefing,
    lastAutoRefreshWindow: null,
    updatedAt: '2026-07-09T09:06:00.000Z',
  };
}

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-operator-state-'));
  let databaseModule: typeof import('../main/database') | null = null;
  vi.resetModules();
  process.env.HOME = home;

  try {
    databaseModule = await import('../main/database');
    return await run(databaseModule);
  } finally {
    databaseModule?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

describe('Operator Home state', () => {
  it('normalizes durable selections without losing item approval state', () => {
    const normalized = normalizeOperatorHomeStateSnapshot({
      ...snapshot(),
      selectedAgentPlanItemIds: ['item-1', 'missing', 'item-1'],
    }, accountId);

    expect(normalized?.selectedAgentPlanItemIds).toEqual(['item-1']);
    expect(normalized?.agentPlan?.items[0].approvalState).toBe('approved');
  });

  it('preserves AI proposal provenance, source snapshot, and draft body in the durable queue', () => {
    const aiPlan: AgentPlan = {
      ...plan,
      items: [{
        ...plan.items[0],
        action: 'draftReply',
        selectionPolicy: 'manualOnly',
        approvalState: 'proposed',
        provenance: {
          origin: 'aiAssistant',
          requestId: 'request-1',
          proposedAt: '2026-07-09T09:00:00.000Z',
        },
        sourceSnapshot: {
          accountId,
          threadId: thread.id,
          citedMessageId: 'message-1',
          latestMessageId: 'message-1',
          lastMessageAt: thread.lastMessageAt,
        },
        payload: {
          sourceMessageId: 'message-1',
          bodyPlain: 'Thanks, I reviewed the plan.',
        },
      }],
    };

    const normalized = normalizeOperatorHomeStateSnapshot({
      ...snapshot(),
      agentPlan: aiPlan,
      selectedAgentPlanItemIds: [],
    }, accountId);

    expect(normalized?.agentPlan?.items[0]).toMatchObject({
      provenance: { origin: 'aiAssistant', requestId: 'request-1' },
      sourceSnapshot: { latestMessageId: 'message-1' },
      payload: { bodyPlain: 'Thanks, I reviewed the plan.' },
    });
  });

  it('uses one local-day window anchored to the configured briefing hour', () => {
    const beforeWindow = new Date(2026, 6, 9, 8, 30);
    const inWindow = new Date(2026, 6, 9, 10, 0);
    expect(dailyBriefingRefreshWindowKey(beforeWindow, 9)).toBe('2026-07-08@09');
    expect(dailyBriefingRefreshWindowKey(inWindow, 9)).toBe('2026-07-09@09');

    const currentBriefing = {
      ...briefing,
      generatedAt: new Date(2026, 6, 9, 9, 5).toISOString(),
    };
    expect(briefingBelongsToRefreshWindow(currentBriefing, inWindow, 9)).toBe(true);
    expect(briefingBelongsToRefreshWindow(currentBriefing, new Date(2026, 6, 10, 10), 9)).toBe(false);
  });

  it('rejects async Operator Home completions from another scope or request generation', () => {
    const token = {
      scopeId: accountId,
      scopeGeneration: 3,
      requestGeneration: 7,
    };
    expect(isOperatorRequestCurrent(token, accountId, 3, 7)).toBe(true);
    expect(isOperatorRequestCurrent(token, 'other@example.com', 4, 7)).toBe(false);
    expect(isOperatorRequestCurrent(token, accountId, 4, 7)).toBe(false);
    expect(isOperatorRequestCurrent(token, accountId, 3, 8)).toBe(false);
  });

  it('accepts proposals only from the current single-account operator scope', () => {
    const ownItem = plan.items[0];
    const foreignItem = { ...ownItem, id: 'foreign-item', accountId: 'other@example.com' };

    const filtered = filterAgentPlanItemsForOperatorScope(
      [ownItem, foreignItem],
      accountId,
      [accountId, 'other@example.com'],
    );

    expect(filtered.accepted.map(item => item.id)).toEqual(['item-1']);
    expect(filtered.rejected.map(item => item.id)).toEqual(['foreign-item']);
  });

  it('limits unified proposals to connected account ids', () => {
    const first = plan.items[0];
    const second = { ...first, id: 'second-item', accountId: 'second@example.com' };
    const unknown = { ...first, id: 'unknown-item', accountId: 'unknown@example.com' };

    const filtered = filterAgentPlanItemsForOperatorScope(
      [first, second, unknown],
      'unified',
      [accountId, 'second@example.com'],
    );

    expect(filtered.accepted.map(item => item.id)).toEqual(['item-1', 'second-item']);
    expect(filtered.rejected.map(item => item.id)).toEqual(['unknown-item']);
  });

  repositoryIt('round-trips snapshots, claims a window once, and expires deleted threads', async () => {
    await withIsolatedDatabase(async ({ OperatorHomeStateRepo, ThreadsRepo }) => {
      ThreadsRepo.save([thread]);
      expect(OperatorHomeStateRepo.finalizeAutoRefreshWindow(accountId, '2026-07-09@09', briefing)).toBe(true);
      expect(OperatorHomeStateRepo.get(accountId)).toMatchObject({
        lastAutoRefreshWindow: '2026-07-09@09',
        dailyBriefing: { id: 'briefing-1', items: [{ id: 'briefing-item-1' }] },
      });

      OperatorHomeStateRepo.saveSnapshot(snapshot());

      expect(OperatorHomeStateRepo.get(accountId)).toMatchObject({
        scopeId: accountId,
        selectedAgentPlanItemIds: ['item-1'],
        lastAutoRefreshWindow: '2026-07-09@09',
        agentPlan: { items: [{ approvalState: 'approved' }] },
        dailyBriefing: { items: [{ id: 'briefing-item-1' }] },
      });

      ThreadsRepo.delete(accountId, thread.id);
      const restored = OperatorHomeStateRepo.get(accountId);
      expect(restored?.agentPlan?.items).toEqual([]);
      expect(restored?.selectedAgentPlanItemIds).toEqual([]);
      expect(restored?.dailyBriefing?.items).toEqual([]);
      expect(restored?.agentPlan?.coverage.warnings.at(-1)).toContain('stale review item');
    });
  });
});
