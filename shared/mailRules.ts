import { ruleMatches } from './categoryEngine';
import type { MailAutomationRule, MailRuleAction, MailRulesSettings, MailThread } from './types';

export const DEFAULT_MAIL_RULES_SETTINGS: MailRulesSettings = {
  enabled: false,
  rules: [],
};

export interface MailRuleEffect {
  rule: MailAutomationRule;
  action: MailRuleAction;
  actionId: string;
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
          return {
            id: String(candidate.id || `rule-${index + 1}`),
            title: String(candidate.title || `Rule ${index + 1}`),
            isEnabled: candidate.isEnabled !== false,
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
  if (!rule.isEnabled) return false;
  if (rule.accountId && rule.accountId !== 'global' && rule.accountId !== thread.accountId) return false;
  if (rule.conditions.length === 0) return false;

  return rule.matchMode === 'all'
    ? rule.conditions.every(condition => ruleMatches(thread, condition))
    : rule.conditions.some(condition => ruleMatches(thread, condition));
}

export function evaluateMailRules(thread: MailThread, settings: MailRulesSettings): MailRuleEffect[] {
  if (!settings.enabled) return [];

  const effects: MailRuleEffect[] = [];
  for (const rule of settings.rules) {
    if (!mailAutomationRuleMatchesThread(rule, thread)) continue;
    for (const action of rule.actions) {
      if ((action.type === 'applyLabel' || action.type === 'moveToLabel') && !action.labelId) continue;
      if (action.type === 'forward' && !action.forwardTo) continue;
      if (action.type === 'autoReply' && !action.replyBody?.trim()) continue;
      effects.push({
        rule,
        action,
        actionId: mailRuleActionLogId(rule, action, thread),
      });
    }
  }
  return effects;
}
