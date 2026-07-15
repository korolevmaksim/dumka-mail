import type {
  MailThread,
  MailCategoryRule,
  BuiltInMailCategorySettings,
  CustomMailCategorySettings,
} from './types';
import { MailSignalClassifier, SplitInboxRouter } from './classifier';

/**
 * Deterministic category engine ported from the Swift `MailCategoryEngine` /
 * `MailCategoryRule` (SplitInbox.swift). Pure, dependency-free: it runs in both
 * the Electron main process and the React renderer.
 *
 * Precedence mirrors `MailCategoryEngine.categoryID(for:settings:)`:
 *   1. enabled custom categories (matchMode `all`/`any` over their rules)
 *   2. enabled built-in `extraRules`, evaluated in routing priority
 *      [purchases, linkedIn, important, automation]
 *   3. `SplitInboxRouter.split` system bucket (falling back to `fallback`
 *      when the resolved built-in bucket is disabled)
 */

/** Built-in routing precedence used when matching `extraRules`. */
const ROUTING_PRIORITY = ['purchases', 'linkedIn', 'important', 'automation'] as const;

/** System-signal names recognized by `systemSignal` rules (ported 1:1 from Swift). */
type SystemSignal =
  | 'importantCandidate'
  | 'purchase'
  | 'linkedIn'
  | 'automation'
  | 'marketing'
  | 'unread'
  | 'attachment';

/** `senderNames.first ?? senderEmail`, matching Swift `MailThread.primarySenderName`. */
function primarySenderName(thread: MailThread): string {
  return thread.senderNames[0] ?? thread.senderEmail;
}

/**
 * Domain portion of an email address. Mirrors Swift
 * `senderEmail.split(separator: "@").last`, which drops empty subsequences.
 */
function senderDomain(senderEmail: string): string {
  const parts = senderEmail.split('@').filter(part => part.length > 0);
  return parts.length > 0 ? parts[parts.length - 1] : senderEmail;
}

function recipientsMatch(
  recipients: MailThread['to'],
  expected: string,
  operation: MailCategoryRule['operation'],
): boolean {
  return (recipients || []).some(recipient => {
    const name = recipient.name.trim();
    const email = recipient.email.trim();
    return [email, name, `${name} ${email}`.trim()]
      .filter(Boolean)
      .some(candidate => textMatches(candidate, expected, operation));
  });
}

/**
 * Text comparison used by every non-`systemSignal` field. Both sides are
 * trimmed and lowercased; an empty expected value never matches (Swift parity).
 */
function textMatches(
  candidate: string,
  expected: string,
  operation: MailCategoryRule['operation'],
): boolean {
  const lhs = candidate.trim().toLowerCase();
  const rhs = expected.trim().toLowerCase();
  if (rhs.length === 0) {
    return false;
  }
  switch (operation) {
    case 'contains':
      return lhs.includes(rhs);
    case 'equals':
      return lhs === rhs;
    case 'startsWith':
      return lhs.startsWith(rhs);
    case 'endsWith':
      return lhs.endsWith(rhs);
    default:
      return false;
  }
}

/** Evaluate a `systemSignal` rule by dispatching to the deterministic classifier. */
function systemSignalMatches(thread: MailThread, value: string): boolean {
  switch (value as SystemSignal) {
    case 'importantCandidate':
      return MailSignalClassifier.isImportantCandidate(thread);
    case 'purchase':
      return SplitInboxRouter.isPurchase(thread);
    case 'linkedIn':
      return SplitInboxRouter.isLinkedIn(thread);
    case 'automation':
      return MailSignalClassifier.isLowPriorityAutomation(thread);
    case 'marketing':
      return MailSignalClassifier.isMarketingAutomation(thread);
    case 'unread':
      return thread.isUnread;
    case 'attachment':
      return thread.hasAttachments;
    default:
      return false;
  }
}

/**
 * Whether a single rule matches a thread. Ported from `MailCategoryRule.matches`.
 * Honors `isNegated`. `systemSignal` ignores the operator (signal lookup only),
 * exactly like the Swift implementation.
 */
export function ruleMatches(thread: MailThread, rule: MailCategoryRule): boolean {
  if (rule.accountId && rule.accountId !== 'global' && thread.accountId !== rule.accountId) {
    return false;
  }
  let result: boolean;
  switch (rule.field) {
    case 'systemSignal':
      result = systemSignalMatches(thread, rule.value);
      break;
    case 'from':
      result = textMatches(
        `${primarySenderName(thread)} ${thread.senderEmail}`,
        rule.value,
        rule.operation,
      );
      break;
    case 'senderDomain':
      result = textMatches(senderDomain(thread.senderEmail), rule.value, rule.operation);
      break;
    case 'subject':
      result = textMatches(thread.subject, rule.value, rule.operation);
      break;
    case 'to':
      result = recipientsMatch(thread.to, rule.value, rule.operation);
      break;
    case 'cc':
      result = recipientsMatch(thread.cc, rule.value, rule.operation);
      break;
    default:
      result = false;
  }
  return rule.isNegated ? !result : result;
}

/** Whether a rule set matches under the given mode. Empty rule sets never match. */
function rulesMatch(
  thread: MailThread,
  rules: MailCategoryRule[],
  mode: 'all' | 'any',
): boolean {
  if (rules.length === 0) {
    return false;
  }
  return mode === 'all'
    ? rules.every(rule => ruleMatches(thread, rule))
    : rules.some(rule => ruleMatches(thread, rule));
}

/** Look up the built-in settings entry for a kind id, if present. */
function builtInFor(
  builtIn: BuiltInMailCategorySettings[],
  kind: string,
): BuiltInMailCategorySettings | undefined {
  return builtIn.find(entry => entry.id === kind);
}

/**
 * Resolve the category id for a thread. Ported from
 * `MailCategoryEngine.categoryID(for:settings:)`.
 *
 * Precedence: enabled custom categories -> enabled built-in `extraRules`
 * (in routing priority) -> `SplitInboxRouter.split` system bucket ->
 * `fallback` (default `'other'`) when the resolved built-in bucket is disabled.
 */
export function categorize(
  thread: MailThread,
  builtIn: BuiltInMailCategorySettings[],
  custom: CustomMailCategorySettings[],
  fallback: string = 'other',
): string {
  // 1. Enabled custom categories (first match wins, in declared order).
  for (const category of custom) {
    if (category.accountId && category.accountId !== 'global' && thread.accountId !== category.accountId) {
      continue;
    }
    if (category.isEnabled && rulesMatch(thread, category.rules, category.matchMode)) {
      return category.id;
    }
  }

  // 2. Enabled built-in extraRules, evaluated in fixed routing priority.
  for (const kind of ROUTING_PRIORITY) {
    const settings = builtInFor(builtIn, kind);
    // Missing entry behaves like the Swift default (enabled, empty extraRules).
    if (settings && settings.isEnabled && rulesMatch(thread, settings.extraRules, settings.matchMode)) {
      return kind;
    }
  }

  // 3. Deterministic system split, demoted to `fallback` when disabled.
  const defaultSplit = SplitInboxRouter.split(thread);
  const defaultSettings = builtInFor(builtIn, defaultSplit);
  const isEnabled = defaultSettings ? defaultSettings.isEnabled : true;
  if (isEnabled || defaultSplit === 'other') {
    return defaultSplit;
  }
  return fallback;
}
