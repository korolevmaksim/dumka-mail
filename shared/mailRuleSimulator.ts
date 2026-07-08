import { mailAutomationRuleMatchesThread, mailRuleActionLogId } from './mailRules';
import type {
  AutomationRuleCandidate,
  MailActionLog,
  MailAutomationRule,
  MailLabelDefinition,
  MailRuleAction,
  MailRulesSettings,
  MailThread,
  AgentPlan,
} from './types';

export type RuleSimulationActionStatus = 'wouldApply' | 'alreadyApplied' | 'skipped' | 'previewOnly';

export interface RuleSimulationEffect {
  ruleId: string;
  ruleTitle: string;
  threadId: string;
  accountId: string;
  actionId: string;
  action: MailRuleAction;
  status: RuleSimulationActionStatus;
  summary: string;
  warning?: string;
}

export interface RuleSimulationThreadSample {
  threadId: string;
  accountId: string;
  subject: string;
  sender: string;
  lastMessageAt: string;
  effects: RuleSimulationEffect[];
}

export interface MailRuleSimulation {
  ruleId: string;
  ruleTitle: string;
  matchedThreadIds: string[];
  matchedThreadCount: number;
  effectCount: number;
  alreadyAppliedCount: number;
  skippedCount: number;
  previewOnlyCount: number;
  warnings: string[];
  samples: RuleSimulationThreadSample[];
}

export interface MailRuleSimulationSummary {
  generatedAt: string;
  ruleCount: number;
  matchedThreadCount: number;
  effectCount: number;
  alreadyAppliedCount: number;
  skippedCount: number;
  previewOnlyCount: number;
  warnings: string[];
  simulations: MailRuleSimulation[];
}

export interface SimulateRuleInput {
  rule: MailAutomationRule;
  threads: MailThread[];
  actionLogs?: MailActionLog[];
  labelDefinitions?: MailLabelDefinition[];
  now?: Date;
}

export interface SimulateRulesInput extends Omit<SimulateRuleInput, 'rule'> {
  settings: MailRulesSettings;
}

export interface BuildAutomationCandidatesInput {
  plan: AgentPlan | null;
  threads: MailThread[];
  actionLogs?: MailActionLog[];
}

const SAFE_ACTION_TYPES = new Set<MailRuleAction['type']>(['archive', 'applyLabel', 'moveToLabel']);
const SEND_LIKE_ACTION_TYPES = new Set<MailRuleAction['type']>(['forward', 'autoReply']);

function labelName(labelDefinitions: readonly MailLabelDefinition[], accountId: string, labelId?: string): string {
  if (!labelId) return '';
  const label = labelDefinitions.find(item => item.accountId === accountId && item.id === labelId);
  return label?.name || labelId;
}

function actionIsComplete(action: MailRuleAction): boolean {
  if ((action.type === 'applyLabel' || action.type === 'moveToLabel') && !action.labelId) return false;
  if (action.type === 'forward' && !action.forwardTo) return false;
  if (action.type === 'autoReply' && !action.replyBody?.trim()) return false;
  return true;
}

function actionSummary(action: MailRuleAction, thread: MailThread, labels: readonly MailLabelDefinition[]): string {
  if (action.type === 'archive') return 'Would remove Inbox';
  if (action.type === 'applyLabel') return `Would apply label ${labelName(labels, thread.accountId, action.labelId)}`;
  if (action.type === 'moveToLabel') return `Would move to label ${labelName(labels, thread.accountId, action.labelId)}`;
  if (action.type === 'forward') return `Preview only: would forward to ${action.forwardTo || 'missing recipient'}`;
  if (action.type === 'autoReply') return 'Preview only: would send automatic reply';
  return `Would run ${action.type}`;
}

function parsePayloadJson(log: MailActionLog): any | null {
  if (!log.payloadJson) return null;
  try {
    return JSON.parse(log.payloadJson);
  } catch {
    return null;
  }
}

function effectWasApplied(effectActionId: string, actionLogs: readonly MailActionLog[]): boolean {
  return actionLogs.some(log => (
    log.id === effectActionId ||
    parsePayloadJson(log)?.actionId === effectActionId
  ) && log.status !== 'failed');
}

function missingLabel(action: MailRuleAction, thread: MailThread, labels: readonly MailLabelDefinition[]): boolean {
  if (action.type !== 'applyLabel' && action.type !== 'moveToLabel') return false;
  if (!action.labelId) return false;
  return !labels.some(label => label.accountId === thread.accountId && label.id === action.labelId);
}

export function describeMailRuleEffect(action: MailRuleAction, thread: MailThread, labelDefinitions: readonly MailLabelDefinition[] = []): string {
  return actionSummary(action, thread, labelDefinitions);
}

export function simulateMailRule({
  rule,
  threads,
  actionLogs = [],
  labelDefinitions = [],
}: SimulateRuleInput): MailRuleSimulation {
  const effectsByThread = new Map<string, RuleSimulationEffect[]>();
  const warnings = new Set<string>();
  const ruleForMatching = { ...rule, isEnabled: true };

  for (const thread of threads) {
    if (!mailAutomationRuleMatchesThread(ruleForMatching, thread)) continue;
    for (const action of rule.actions) {
      const actionId = mailRuleActionLogId(rule, action, thread);
      let status: RuleSimulationActionStatus = 'wouldApply';
      let warning: string | undefined;

      if (!actionIsComplete(action)) {
        status = 'skipped';
        warning = 'Action is incomplete.';
      } else if (SEND_LIKE_ACTION_TYPES.has(action.type)) {
        status = 'previewOnly';
        warning = 'Send-like actions are preview-only in this simulator.';
      } else if (!SAFE_ACTION_TYPES.has(action.type)) {
        status = 'skipped';
        warning = 'Action type is not supported by the simulator.';
      } else if (missingLabel(action, thread, labelDefinitions)) {
        status = 'skipped';
        warning = 'Referenced label is missing.';
      } else if (effectWasApplied(actionId, actionLogs)) {
        status = 'alreadyApplied';
      }

      if (warning) warnings.add(warning);
      const simulated: RuleSimulationEffect = {
        ruleId: rule.id,
        ruleTitle: rule.title,
        threadId: thread.id,
        accountId: thread.accountId,
        actionId,
        action,
        status,
        summary: actionSummary(action, thread, labelDefinitions),
        warning,
      };
      const existing = effectsByThread.get(thread.id) || [];
      existing.push(simulated);
      effectsByThread.set(thread.id, existing);
    }
  }

  const samples: RuleSimulationThreadSample[] = [...effectsByThread.entries()].slice(0, 8).map(([threadId, effects]) => {
    const thread = threads.find(item => item.id === threadId)!;
    return {
      threadId: thread.id,
      accountId: thread.accountId,
      subject: thread.subject,
      sender: thread.senderNames[0] || thread.senderEmail,
      lastMessageAt: thread.lastMessageAt,
      effects,
    };
  });
  const allEffects = [...effectsByThread.values()].flat();

  return {
    ruleId: rule.id,
    ruleTitle: rule.title,
    matchedThreadIds: [...effectsByThread.keys()],
    matchedThreadCount: effectsByThread.size,
    effectCount: allEffects.length,
    alreadyAppliedCount: allEffects.filter(effect => effect.status === 'alreadyApplied').length,
    skippedCount: allEffects.filter(effect => effect.status === 'skipped').length,
    previewOnlyCount: allEffects.filter(effect => effect.status === 'previewOnly').length,
    warnings: [...warnings],
    samples,
  };
}

export function simulateMailRules({
  settings,
  threads,
  actionLogs = [],
  labelDefinitions = [],
  now = new Date(),
}: SimulateRulesInput): MailRuleSimulationSummary {
  const simulations = settings.rules.map(rule => simulateMailRule({
    rule,
    threads,
    actionLogs,
    labelDefinitions,
    now,
  }));
  const warnings = new Set(simulations.flatMap(simulation => simulation.warnings));

  return {
    generatedAt: now.toISOString(),
    ruleCount: settings.rules.length,
    matchedThreadCount: new Set(simulations.flatMap(simulation => simulation.matchedThreadIds)).size,
    effectCount: simulations.reduce((sum, simulation) => sum + simulation.effectCount, 0),
    alreadyAppliedCount: simulations.reduce((sum, simulation) => sum + simulation.alreadyAppliedCount, 0),
    skippedCount: simulations.reduce((sum, simulation) => sum + simulation.skippedCount, 0),
    previewOnlyCount: simulations.reduce((sum, simulation) => sum + simulation.previewOnlyCount, 0),
    warnings: [...warnings],
    simulations,
  };
}

function conditionForThread(thread: MailThread) {
  const domain = thread.senderEmail.split('@').at(-1) || thread.senderEmail;
  return {
    id: `sender-domain-${domain.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}`,
    field: 'senderDomain' as const,
    operation: 'equals' as const,
    value: domain,
    isNegated: false,
    accountId: thread.accountId,
  };
}

function actionLogMatchesAgentItem(log: MailActionLog, item: AgentPlan['items'][number]): boolean {
  if (log.status !== 'completed' || log.threadId !== item.threadId) return false;
  if (!log.payloadJson) return false;
  try {
    const payload = JSON.parse(log.payloadJson);
    return payload?.source === 'agentReviewQueue'
      && payload?.itemId === item.id
      && payload?.action === item.action;
  } catch {
    return false;
  }
}

export function buildAutomationCandidatesFromAgentPlan({
  plan,
  threads,
  actionLogs = [],
}: BuildAutomationCandidatesInput): AutomationRuleCandidate[] {
  const candidatesByKey = new Map<string, MailThread[]>();
  const addThread = (thread: MailThread) => {
    const domain = thread.senderEmail.split('@').at(-1)?.toLowerCase() || thread.senderEmail.toLowerCase();
    const key = `${thread.accountId.toLowerCase()}::${domain}`;
    const bucket = candidatesByKey.get(key) || [];
    if (!bucket.some(item => item.id === thread.id && item.accountId === thread.accountId)) {
      bucket.push(thread);
    }
    candidatesByKey.set(key, bucket);
  };

  for (const log of actionLogs) {
    if (log.status !== 'completed' || !log.threadId || !log.payloadJson) continue;
    try {
      const payload = JSON.parse(log.payloadJson);
      if (payload?.source !== 'agentReviewQueue' || payload?.action !== 'archive') continue;
      const thread = threads.find(candidate => candidate.id === log.threadId && candidate.accountId === log.accountId);
      if (thread) addThread(thread);
    } catch {
      continue;
    }
  }

  for (const item of plan?.items || []) {
    if (item.action !== 'archive') continue;
    const thread = threads.find(candidate => candidate.id === item.threadId && candidate.accountId === item.accountId);
    if (!thread) continue;
    if (item.approvalState !== 'applied' && !actionLogs.some(log => actionLogMatchesAgentItem(log, item))) continue;
    addThread(thread);
  }

  return [...candidatesByKey.values()]
    .filter(bucket => bucket.length >= 2)
    .map(bucket => {
      const first = bucket[0];
      const domain = first.senderEmail.split('@').at(-1)?.toLowerCase() || first.senderEmail.toLowerCase();
      const rule: MailAutomationRule = {
        id: `candidate-${first.accountId.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${domain.replace(/[^a-z0-9]+/g, '-')}`,
        title: `Archive ${domain}`,
        isEnabled: false,
        accountId: first.accountId,
        matchMode: 'all',
        conditions: [conditionForThread(first)],
        actions: [{ id: 'archive', type: 'archive' }],
      };
      return {
        id: rule.id,
        title: rule.title,
        reason: `${bucket.length} approved archived threads from ${domain}.`,
        rule,
        sourceActionCount: bucket.length,
        sampleThreadIds: bucket.slice(0, 5).map(thread => thread.id),
      };
    });
}
