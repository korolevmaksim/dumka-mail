import type {
  AgentPlan,
  AgentPlanActionKind,
  AgentPlanApprovalState,
  AgentPlanItem,
  DailyBriefing,
  DailyBriefingCategory,
  OperatorHomeStateSnapshot,
} from './types';

const AGENT_ACTIONS = new Set<AgentPlanActionKind>([
  'openThread',
  'markRead',
  'archive',
  'draftReply',
  'setReminder',
  'applyLabel',
  'unsubscribe',
]);
const APPROVAL_STATES = new Set<AgentPlanApprovalState>([
  'proposed',
  'approved',
  'applied',
  'rejected',
  'blocked',
]);
const BRIEFING_CATEGORIES = new Set<DailyBriefingCategory>([
  'needsReply',
  'waitingOnMe',
  'fyi',
  'riskOrNoise',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function hasString(value: Record<string, unknown>, key: string): boolean {
  return typeof value[key] === 'string' && Boolean(String(value[key]).trim());
}

function isAgentPlanItem(value: unknown): value is AgentPlanItem {
  if (!isRecord(value)) return false;
  if (!hasString(value, 'id') || !hasString(value, 'accountId') || !hasString(value, 'threadId')) return false;
  if (!hasString(value, 'subject') || !hasString(value, 'sender') || !hasString(value, 'title')) return false;
  if (!hasString(value, 'reason') || !AGENT_ACTIONS.has(value.action as AgentPlanActionKind)) return false;
  if (!APPROVAL_STATES.has(value.approvalState as AgentPlanApprovalState)) return false;
  if (!isRecord(value.citation) || !hasString(value.citation, 'accountId') || !hasString(value.citation, 'threadId')) return false;
  return true;
}

function isAgentPlan(value: unknown): value is AgentPlan {
  if (!isRecord(value) || !Array.isArray(value.items) || !value.items.every(isAgentPlanItem)) return false;
  if (!hasString(value, 'id') || !hasString(value, 'title') || !hasString(value, 'accountId')) return false;
  if (!hasString(value, 'sourceTitle') || !hasString(value, 'generatedAt') || !isRecord(value.coverage)) return false;
  return Array.isArray(value.coverage.warnings);
}

function isDailyBriefing(value: unknown): value is DailyBriefing {
  if (!isRecord(value) || !Array.isArray(value.items)) return false;
  if (!hasString(value, 'id') || !hasString(value, 'accountId') || !hasString(value, 'generatedAt')) return false;
  if (!hasString(value, 'title') || !isRecord(value.coverage) || !isRecord(value.settings)) return false;
  if (!Array.isArray(value.coverage.warnings)) return false;
  return value.items.every(item => (
    isRecord(item)
    && hasString(item, 'id')
    && hasString(item, 'accountId')
    && hasString(item, 'threadId')
    && BRIEFING_CATEGORIES.has(item.category as DailyBriefingCategory)
    && isRecord(item.source)
    && hasString(item.source, 'messageId')
  ));
}

export function normalizeOperatorHomeScopeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized || normalized.length > 320) return null;
  return normalized;
}

export function normalizeOperatorHomeStateSnapshot(
  input: unknown,
  expectedScopeId?: string,
): OperatorHomeStateSnapshot | null {
  if (!isRecord(input)) return null;
  const scopeId = normalizeOperatorHomeScopeId(input.scopeId);
  const expected = expectedScopeId ? normalizeOperatorHomeScopeId(expectedScopeId) : null;
  if (!scopeId || (expected && scopeId !== expected)) return null;

  const rawAgentPlan = input.agentPlan === null || input.agentPlan === undefined
    ? null
    : isAgentPlan(input.agentPlan) ? input.agentPlan : null;
  const rawDailyBriefing = input.dailyBriefing === null || input.dailyBriefing === undefined
    ? null
    : isDailyBriefing(input.dailyBriefing) ? input.dailyBriefing : null;
  const belongsToScope = (accountId: string) => (
    scopeId === 'unified' || normalizeOperatorHomeScopeId(accountId) === scopeId
  );
  const agentPlan = rawAgentPlan ? {
    ...rawAgentPlan,
    items: rawAgentPlan.items.filter(item => belongsToScope(item.accountId)),
  } : null;
  const dailyBriefing = rawDailyBriefing ? {
    ...rawDailyBriefing,
    items: rawDailyBriefing.items.filter(item => belongsToScope(item.accountId)),
  } : null;
  const validPlanItemIds = new Set(agentPlan?.items.map(item => item.id) || []);
  const selectedAgentPlanItemIds = Array.isArray(input.selectedAgentPlanItemIds)
    ? Array.from(new Set(input.selectedAgentPlanItemIds
        .filter((item): item is string => typeof item === 'string')
        .filter(item => validPlanItemIds.has(item))))
    : [];

  return {
    scopeId,
    agentPlan,
    selectedAgentPlanItemIds,
    dailyBriefing,
    lastAutoRefreshWindow: typeof input.lastAutoRefreshWindow === 'string'
      ? input.lastAutoRefreshWindow
      : null,
    updatedAt: typeof input.updatedAt === 'string' && Number.isFinite(Date.parse(input.updatedAt))
      ? input.updatedAt
      : new Date(0).toISOString(),
  };
}

function localDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function dailyBriefingRefreshWindowKey(now: Date, windowStartHour: number): string {
  const safeNow = Number.isFinite(now.getTime()) ? new Date(now) : new Date();
  const safeHour = Number.isFinite(windowStartHour)
    ? Math.max(0, Math.min(23, Math.round(windowStartHour)))
    : 9;
  if (safeNow.getHours() < safeHour) {
    safeNow.setDate(safeNow.getDate() - 1);
  }
  return `${localDateKey(safeNow)}@${String(safeHour).padStart(2, '0')}`;
}

export function briefingBelongsToRefreshWindow(
  briefing: DailyBriefing | null,
  now: Date,
  windowStartHour: number,
): boolean {
  if (!briefing) return false;
  const generatedAt = new Date(briefing.generatedAt);
  if (!Number.isFinite(generatedAt.getTime())) return false;
  return dailyBriefingRefreshWindowKey(generatedAt, windowStartHour)
    === dailyBriefingRefreshWindowKey(now, windowStartHour);
}

export interface OperatorRequestToken {
  scopeId: string;
  scopeGeneration: number;
  requestGeneration: number;
}

export function isOperatorRequestCurrent(
  token: OperatorRequestToken,
  currentScopeId: string | null,
  currentScopeGeneration: number,
  currentRequestGeneration: number,
): boolean {
  return token.scopeId === currentScopeId
    && token.scopeGeneration === currentScopeGeneration
    && token.requestGeneration === currentRequestGeneration;
}

export function filterAgentPlanItemsForOperatorScope(
  items: AgentPlanItem[],
  scopeId: string,
  connectedAccountIds: string[],
): { accepted: AgentPlanItem[]; rejected: AgentPlanItem[] } {
  const normalizedScope = normalizeOperatorHomeScopeId(scopeId);
  const allowedAccountIds = normalizedScope === 'unified'
    ? new Set(connectedAccountIds
        .map(normalizeOperatorHomeScopeId)
        .filter((accountId): accountId is string => Boolean(accountId)))
    : new Set(normalizedScope ? [normalizedScope] : []);
  const accepted: AgentPlanItem[] = [];
  const rejected: AgentPlanItem[] = [];

  for (const item of items) {
    const itemAccountId = normalizeOperatorHomeScopeId(item.accountId);
    (itemAccountId && allowedAccountIds.has(itemAccountId) ? accepted : rejected).push(item);
  }
  return { accepted, rejected };
}
