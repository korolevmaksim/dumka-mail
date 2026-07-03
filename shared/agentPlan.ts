import type {
  AgentPlan,
  AgentPlanActionKind,
  AgentPlanItem,
  AgentPlanRiskLevel,
  AgentPlanSelectionPolicy,
  DailyBriefing,
  DailyBriefingItem,
  MailThread,
  MailTriagePlan,
  MailTriagePlanItem,
  TriageRecommendation,
} from './types';

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) return 50;
  return Math.max(1, Math.min(100, Math.round(value)));
}

function snippet(value: string | null | undefined): string {
  const normalized = (value || '').replace(/\s+/g, ' ').trim();
  return normalized.length > 220 ? `${normalized.slice(0, 217)}...` : normalized;
}

function itemId(source: AgentPlan['source'], threadId: string, action: AgentPlanActionKind, sourceItemId?: string | null): string {
  const sourcePart = sourceItemId ? sourceItemId.replace(/[^a-z0-9_-]+/gi, '-') : threadId;
  return `agent:${source}:${action}:${sourcePart}`;
}

function actionForRecommendation(recommendation: TriageRecommendation): {
  action: AgentPlanActionKind;
  title: string;
  riskLevel: AgentPlanRiskLevel;
  selectionPolicy: AgentPlanSelectionPolicy;
} {
  if (recommendation === 'reply') {
    return {
      action: 'draftReply',
      title: 'Draft a reply',
      riskLevel: 'medium',
      selectionPolicy: 'manualOnly',
    };
  }
  if (recommendation === 'reviewAttachment') {
    return {
      action: 'openThread',
      title: 'Review attachment',
      riskLevel: 'low',
      selectionPolicy: 'manualOnly',
    };
  }
  if (recommendation === 'setReminder') {
    return {
      action: 'setReminder',
      title: 'Set reminder',
      riskLevel: 'low',
      selectionPolicy: 'autoSelected',
    };
  }
  if (recommendation === 'markDoneCandidate') {
    return {
      action: 'archive',
      title: 'Archive thread',
      riskLevel: 'medium',
      selectionPolicy: 'explicitOptIn',
    };
  }
  return {
    action: 'markRead',
    title: 'Mark as read',
    riskLevel: 'low',
    selectionPolicy: 'autoSelected',
  };
}

function actionForBriefingItem(item: DailyBriefingItem, labelId?: string | null): {
  action: AgentPlanActionKind;
  title: string;
  riskLevel: AgentPlanRiskLevel;
  selectionPolicy: AgentPlanSelectionPolicy;
} {
  if (item.category === 'needsReply' || item.category === 'waitingOnMe') {
    return {
      action: 'draftReply',
      title: item.category === 'needsReply' ? 'Draft a reply' : 'Draft a follow-up',
      riskLevel: 'medium',
      selectionPolicy: 'manualOnly',
    };
  }

  if (item.category === 'riskOrNoise') {
    return {
      action: labelId ? 'applyLabel' : 'archive',
      title: labelId ? 'Apply cleanup label' : 'Archive noisy thread',
      riskLevel: item.phishingLinkCount > 0 || item.riskLevel === 'high' ? 'high' : 'medium',
      selectionPolicy: 'explicitOptIn',
    };
  }

  return {
    action: 'archive',
    title: 'Archive FYI thread',
    riskLevel: 'medium',
    selectionPolicy: 'explicitOptIn',
  };
}

function threadById(threads: MailThread[]): Map<string, MailThread> {
  return new Map(threads.map(thread => [thread.id, thread]));
}

export function buildAgentPlanItemFromTriage(
  plan: MailTriagePlan,
  item: MailTriagePlanItem,
  threads: MailThread[],
): AgentPlanItem {
  const thread = threadById(threads).get(item.threadId);
  const action = actionForRecommendation(item.recommendation);

  return {
    id: itemId('triageQueue', item.threadId, action.action),
    accountId: thread?.accountId || plan.accountId,
    threadId: item.threadId,
    subject: item.subject,
    sender: item.sender,
    action: action.action,
    title: action.title,
    reason: item.reason,
    citation: {
      accountId: thread?.accountId || plan.accountId,
      threadId: item.threadId,
      messageId: null,
      subject: item.subject,
      sender: item.sender,
      senderEmail: thread?.senderEmail || null,
      snippet: snippet(thread?.snippet),
      evidence: item.reason,
      receivedAt: thread?.lastMessageAt || null,
    },
    riskLevel: action.riskLevel,
    confidence: clampConfidence(item.priority),
    selectionPolicy: action.selectionPolicy,
    approvalState: 'proposed',
  };
}

export function buildAgentPlanFromTriagePlan({
  plan,
  threads,
  aiAssisted,
}: {
  plan: MailTriagePlan;
  threads: MailThread[];
  aiAssisted: boolean;
}): AgentPlan {
  const items = plan.items.map(item => buildAgentPlanItemFromTriage(plan, item, threads));
  return {
    id: `agent:triageQueue:${plan.accountId}:${plan.generatedAt}`,
    title: 'Agent Review Queue',
    source: 'triageQueue',
    sourceTitle: plan.sourceTitle,
    generatedAt: plan.generatedAt,
    accountId: plan.accountId,
    items,
    coverage: {
      sourceThreadCount: plan.sourceThreadCount,
      proposedActionCount: items.length,
      aiAssisted,
      privacyMode: aiAssisted ? 'aiAssisted' : 'localCache',
      bodyContextIncluded: false,
      warnings: [],
    },
  };
}

export function buildAgentPlanItemFromDailyBriefing({
  item,
  labelId,
}: {
  item: DailyBriefingItem;
  labelId?: string | null;
}): AgentPlanItem {
  const action = actionForBriefingItem(item, labelId);

  return {
    id: itemId('dailyBriefing', item.threadId, action.action, item.id),
    accountId: item.accountId,
    threadId: item.threadId,
    subject: item.source.subject,
    sender: item.source.sender,
    action: action.action,
    title: action.title,
    reason: item.reason,
    citation: {
      accountId: item.accountId,
      threadId: item.threadId,
      messageId: item.source.messageId,
      subject: item.source.subject,
      sender: item.source.sender,
      senderEmail: item.source.senderEmail,
      snippet: snippet(item.source.snippet),
      evidence: item.source.evidence,
      receivedAt: item.source.receivedAt,
    },
    riskLevel: action.riskLevel,
    confidence: clampConfidence(item.priority),
    selectionPolicy: action.selectionPolicy,
    approvalState: 'proposed',
    sourceItemId: item.id,
    payload: {
      labelId: labelId || null,
      sourceMessageId: item.source.messageId,
      category: item.category,
    },
  };
}

export function buildAgentPlanFromDailyBriefingItem({
  briefing,
  item,
  labelId,
}: {
  briefing: DailyBriefing;
  item: DailyBriefingItem;
  labelId?: string | null;
}): AgentPlan {
  const planItem = buildAgentPlanItemFromDailyBriefing({ item, labelId });
  return {
    id: `agent:dailyBriefing:${briefing.id}`,
    title: 'Agent Review Queue',
    source: 'dailyBriefing',
    sourceTitle: briefing.title,
    generatedAt: new Date().toISOString(),
    accountId: briefing.accountId,
    items: [planItem],
    coverage: {
      sourceThreadCount: briefing.coverage.candidateThreadCount,
      proposedActionCount: 1,
      aiAssisted: false,
      privacyMode: 'localCache',
      bodyContextIncluded: briefing.coverage.bodyContextIncluded,
      warnings: briefing.coverage.warnings,
    },
  };
}

export function mergeAgentPlanItem(plan: AgentPlan | null, item: AgentPlanItem): AgentPlan {
  const generatedAt = new Date().toISOString();
  if (!plan) {
    return {
      id: `agent:manual:${generatedAt}`,
      title: 'Agent Review Queue',
      source: 'command',
      sourceTitle: 'Manual additions',
      generatedAt,
      accountId: item.accountId,
      items: [item],
      coverage: {
        sourceThreadCount: 1,
        proposedActionCount: 1,
        aiAssisted: false,
        privacyMode: 'localCache',
        bodyContextIncluded: false,
        warnings: [],
      },
    };
  }

  const nextItems = [item, ...plan.items.filter(existing => existing.id !== item.id)];
  return {
    ...plan,
    generatedAt,
    items: nextItems,
    coverage: {
      ...plan.coverage,
      proposedActionCount: nextItems.length,
    },
  };
}
