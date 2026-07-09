import { ruleMatches } from './categoryEngine';
import type { MailActionLog, MailAutomationRule, MailRuleAction, MailRuleMode, MailRulesSettings, MailThread } from './types';

export const DEFAULT_MAIL_RULES_SETTINGS: MailRulesSettings = {
  enabled: false,
  rules: [],
};

export interface MailRuleEffect {
  rule: MailAutomationRule;
  action: MailRuleAction;
  actionId: string;
}

export function mailRuleMode(rule: Pick<MailAutomationRule, 'isEnabled' | 'mode'>): MailRuleMode {
  if (rule.mode === 'disabled' || rule.mode === 'shadow' || rule.mode === 'active') return rule.mode;
  return rule.isEnabled ? 'active' : 'disabled';
}

function normalizeIdPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.@-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'blank';
}

export function mailRuleActionLogId(rule: MailAutomationRule, action: MailRuleAction, thread: MailThread): string {
  const target = action.labelId || action.forwardTo || action.id || action.type;
  return [
    'mail-rule',
    normalizeIdPart(rule.id),
    normalizeIdPart(thread.accountId),
    normalizeIdPart(thread.id),
    normalizeIdPart(action.type),
    normalizeIdPart(target),
  ].join(':');
}

export function mailRuleShadowLogId(rule: MailAutomationRule, action: MailRuleAction, thread: MailThread): string {
  return mailRuleActionLogId(rule, action, thread).replace(/^mail-rule:/, 'mail-rule-shadow:');
}

export function buildMailRuleShadowLog(
  effect: MailRuleEffect,
  thread: MailThread,
  observedAt = new Date().toISOString(),
): MailActionLog {
  return {
    id: mailRuleShadowLogId(effect.rule, effect.action, thread),
    accountId: thread.accountId,
    threadId: thread.id,
    kind: 'ruleShadowMatch',
    status: 'completed',
    createdAt: observedAt,
    completedAt: observedAt,
    payloadJson: JSON.stringify({
      source: 'mailRuleShadow',
      ruleId: effect.rule.id,
      ruleTitle: effect.rule.title,
      mode: 'shadow',
      action: effect.action,
    }),
  };
}

export function normalizeMailRulesSettings(value: unknown): MailRulesSettings {
  if (!value || typeof value !== 'object') return DEFAULT_MAIL_RULES_SETTINGS;

  const raw = value as Partial<MailRulesSettings>;
  const rules = Array.isArray(raw.rules)
    ? raw.rules
        .map((rule, index): MailAutomationRule | null => {
          if (!rule || typeof rule !== 'object') return null;
          const candidate = rule as Partial<MailAutomationRule>;
          const conditions = Array.isArray(candidate.conditions)
            ? candidate.conditions.filter(condition => (
                condition &&
                typeof condition.id === 'string' &&
                typeof condition.field === 'string' &&
                typeof condition.operation === 'string' &&
                typeof condition.value === 'string'
              ))
            : [];
          const actions = Array.isArray(candidate.actions)
            ? candidate.actions
                .map((action, actionIndex): MailRuleAction | null => {
                  if (!action || typeof action !== 'object') return null;
                  const candidateAction = action as Partial<MailRuleAction>;
                  if (!candidateAction.type) return null;
                  return {
                    id: String(candidateAction.id || `action-${actionIndex + 1}`),
                    type: candidateAction.type,
                    labelId: typeof candidateAction.labelId === 'string' ? candidateAction.labelId : undefined,
                    forwardTo: typeof candidateAction.forwardTo === 'string' ? candidateAction.forwardTo : undefined,
                    replyBody: typeof candidateAction.replyBody === 'string' ? candidateAction.replyBody : undefined,
                  };
                })
                .filter((action): action is MailRuleAction => Boolean(action))
            : [];

          if (conditions.length === 0 || actions.length === 0) return null;
          const mode = candidate.mode === 'disabled' || candidate.mode === 'shadow' || candidate.mode === 'active'
            ? candidate.mode
            : candidate.isEnabled === false ? 'disabled' : 'active';
          return {
            id: String(candidate.id || `rule-${index + 1}`),
            title: String(candidate.title || `Rule ${index + 1}`),
            isEnabled: mode === 'active',
            mode,
            accountId: typeof candidate.accountId === 'string' ? candidate.accountId : 'global',
            matchMode: candidate.matchMode === 'all' ? 'all' : 'any',
            conditions,
            actions,
          };
        })
        .filter((rule): rule is MailAutomationRule => Boolean(rule))
    : [];

  return {
    enabled: raw.enabled === true,
    rules,
  };
}

export function mailAutomationRuleMatchesThread(rule: MailAutomationRule, thread: MailThread): boolean {
  if (mailRuleMode(rule) !== 'active') return false;
  return mailAutomationRuleConditionsMatchThread(rule, thread);
}

function mailAutomationRuleConditionsMatchThread(rule: MailAutomationRule, thread: MailThread): boolean {
  if (rule.accountId && rule.accountId !== 'global' && rule.accountId !== thread.accountId) return false;
  if (rule.conditions.length === 0) return false;

  return rule.matchMode === 'all'
    ? rule.conditions.every(condition => ruleMatches(thread, condition))
    : rule.conditions.some(condition => ruleMatches(thread, condition));
}

function evaluateMailRulesForMode(
  thread: MailThread,
  settings: MailRulesSettings,
  mode: Extract<MailRuleMode, 'active' | 'shadow'>,
): MailRuleEffect[] {
  if (!settings.enabled) return [];

  const effects: MailRuleEffect[] = [];
  for (const rule of settings.rules) {
    if (mailRuleMode(rule) !== mode || !mailAutomationRuleConditionsMatchThread(rule, thread)) continue;
    for (const action of rule.actions) {
      if ((action.type === 'applyLabel' || action.type === 'moveToLabel') && !action.labelId) continue;
      if (action.type === 'forward' && !action.forwardTo) continue;
      if (action.type === 'autoReply' && !action.replyBody?.trim()) continue;
      effects.push({
        rule,
        action,
        actionId: mode === 'shadow'
          ? mailRuleShadowLogId(rule, action, thread)
          : mailRuleActionLogId(rule, action, thread),
      });
    }
  }
  return effects;
}

export function evaluateMailRules(thread: MailThread, settings: MailRulesSettings): MailRuleEffect[] {
  return evaluateMailRulesForMode(thread, settings, 'active');
}

export function evaluateShadowMailRules(thread: MailThread, settings: MailRulesSettings): MailRuleEffect[] {
  return evaluateMailRulesForMode(thread, settings, 'shadow');
}
