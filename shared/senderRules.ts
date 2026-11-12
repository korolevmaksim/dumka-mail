// Sender rules (design-review/SPEC.md §7): learning, the offer, applying a
// rule on arrival, and bring-backs. Pure and dependency-free; the main process
// counts and applies, the renderer shows the offer and edits the rules.
//
// A rule is never created without the user's explicit `Always archive`, it
// only ever archives (Gmail keeps the mail in All mail), and it never touches
// a thread the deterministic layer does not call `clear` / `unsubscribe`, a
// protected thread (people, security notices, invitations), or mail that was
// already in the inbox before the rule existed.
import {
  getSenderRules,
  normalizeAccountId,
  resolveAccountSetting,
  setAccountOverride,
  setSenderRules,
  type AccountSettingsSource,
} from './accountSettings';
import { decideByRules, type DecisionThread } from './decision';
import type { AgentAutonomy, SenderRule, SenderRuleStats, ThreadDecision } from './types';

/** Confirmations without a bring-back before the offer appears. */
export const SENDER_RULE_OFFER_THRESHOLD = 3;
/** Bring-backs that switch a rule off. */
export const SENDER_RULE_AUTO_DISABLE_BRING_BACKS = 2;
/** An archive undone or moved back within this window counts as a bring-back. */
export const SENDER_RULE_BRING_BACK_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
/**
 * The undo toast's window. Reversing one's own archive this quickly is `Undo`
 * (a slip), not a bring-back: it withdraws the confirmation instead.
 */
export const SENDER_RULE_UNDO_WINDOW_MS = 15_000;

export const SENDER_RULE_PROVENANCE_ORIGIN = 'senderRule';

export function normalizeSenderEmail(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

function timeOf(value: string | null | undefined): number {
  if (!value) return NaN;
  return Date.parse(value);
}

// --- Eligibility ---------------------------------------------------------------

/**
 * The rule decision when it allows a sender rule (`clear` / `unsubscribe`,
 * not protected), else null. Model and user layers are deliberately ignored:
 * only the deterministic layer qualifies mail for automatic handling.
 */
export function senderRuleEligibleDecision(thread: DecisionThread, accountEmail: string): ThreadDecision | null {
  const decision = decideByRules(thread, { accountEmail });
  if (decision.protected) return null;
  return decision.decision === 'clear' || decision.decision === 'unsubscribe' ? decision : null;
}

export function isSenderRuleEligible(thread: DecisionThread, accountEmail: string): boolean {
  return senderRuleEligibleDecision(thread, accountEmail) !== null;
}

// --- Offer ---------------------------------------------------------------------

/** Stats that qualify for the offer: ≥ 3 confirmations, no bring-back, not dismissed, no rule yet. */
export function isSenderRuleOfferable(stats: SenderRuleStats, rules: readonly SenderRule[]): boolean {
  if (stats.confirmations < SENDER_RULE_OFFER_THRESHOLD) return false;
  if (stats.bringBacks > 0) return false;
  if (stats.dismissedAt) return false;
  const sender = normalizeSenderEmail(stats.senderEmail);
  return !rules.some(rule => normalizeSenderEmail(rule.senderEmail) === sender);
}

/** The one sender to offer now: most confirmations first, then the most recent confirmation. */
export function pickSenderRuleOffer(stats: readonly SenderRuleStats[], rules: readonly SenderRule[]): SenderRuleStats | null {
  const candidates = stats.filter(entry => isSenderRuleOfferable(entry, rules));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => (
    b.confirmations - a.confirmations
    || (timeOf(b.lastConfirmedAt) || 0) - (timeOf(a.lastConfirmedAt) || 0)
    || a.senderEmail.localeCompare(b.senderEmail)
  ));
  return candidates[0];
}

export function senderDisplayName(entry: { senderName?: string | null; senderEmail: string }): string {
  return entry.senderName?.trim() || entry.senderEmail;
}

export const SENDER_RULE_OFFER_DESCRIPTION = 'New mail from this sender skips the inbox and is listed under “Handled for you”. Mail from people, security notices and invitations is never handled this way.';

export function senderRuleOfferTitle(senderName: string): string {
  return `Always archive mail from ${senderName}?`;
}

/** Shown when creating the rule also raises the account's autonomy to `prepareAndRules`. */
export function senderRuleAutonomyConsent(accountEmail: string): string {
  return `This lets the agent archive mail from your approved senders on its own for ${accountEmail}.`;
}

/** True when creating a rule must also raise "What the agent may do on its own". */
export function senderRuleNeedsAutonomy(settings: AccountSettingsSource, accountId: string): boolean {
  return resolveAccountSetting(settings, accountId, 'agentAutonomy').value === 'prepare';
}

export interface CreateSenderRuleInput {
  id: string;
  senderEmail: string;
  senderName?: string | null;
  confirmations?: number;
  now?: Date;
}

/**
 * Adds an enabled rule for the sender (replacing an older rule for the same
 * address) and, when the account only prepares, raises it to
 * `prepareAndRules` in the same step.
 */
export function createSenderRule<S extends AccountSettingsSource>(
  settings: S,
  accountId: string,
  input: CreateSenderRuleInput,
): { settings: S & { accountOverrides: NonNullable<S['accountOverrides']> }; rule: SenderRule; autonomyRaised: boolean } {
  const senderEmail = normalizeSenderEmail(input.senderEmail);
  if (!senderEmail) throw new Error('A sender rule needs a sender address.');
  const rule: SenderRule = {
    id: input.id,
    senderEmail,
    action: 'archive',
    enabled: true,
    createdAt: (input.now || new Date()).toISOString(),
    confirmations: Math.max(0, Math.floor(input.confirmations || 0)),
    bringBacks: 0,
  };
  const name = input.senderName?.trim();
  if (name && name.toLowerCase() !== senderEmail) rule.senderName = name;
  const others = getSenderRules(settings, accountId).filter(existing => normalizeSenderEmail(existing.senderEmail) !== senderEmail);
  let next = setSenderRules(settings, accountId, [...others, rule]);
  const autonomyRaised = senderRuleNeedsAutonomy(next, accountId);
  if (autonomyRaised) next = setAccountOverride(next, accountId, 'agentAutonomy', 'prepareAndRules');
  return { settings: next as S & { accountOverrides: NonNullable<S['accountOverrides']> }, rule, autonomyRaised };
}

// --- Applying on arrival ---------------------------------------------------------

export interface SenderRuleMatchInput {
  thread: DecisionThread & { labelIds: string[]; senderEmail: string };
  accountEmail: string;
  rules: readonly SenderRule[];
  autonomy: AgentAutonomy;
  /** The thread has a manual section move (`V`). */
  hasUserCorrection: boolean;
  /** Newest inbound message of this thread that the current sync stored for the first time; null when none is new. */
  newestArrivalAt: string | null;
  /** A rule archived this thread before and the user brought it back. */
  broughtBackBefore?: boolean;
  /**
   * Bring-backs of this sender's mail counted in the database since the rule
   * was created. The main process enforces the auto-disable with it even
   * before the renderer has switched the rule off in settings.
   */
  storedBringBacks?: number;
}

/** True once a rule has been brought back often enough to stop applying. */
export function isSenderRuleWornOut(rule: Pick<SenderRule, 'bringBacks'>, storedBringBacks = 0): boolean {
  return Math.max(rule.bringBacks || 0, storedBringBacks || 0) >= SENDER_RULE_AUTO_DISABLE_BRING_BACKS;
}

/**
 * The enabled rule that archives this newly arrived thread, else null.
 * Gates: autonomy `prepareAndRules`, thread in the inbox, inbound, no
 * calendar invite, new mail received after the rule was created, rule
 * decision `clear` / `unsubscribe` and not protected, no user correction, not
 * brought back from a rule before, fewer than two bring-backs on the rule.
 */
export function matchSenderRule(input: SenderRuleMatchInput): SenderRule | null {
  if (input.autonomy !== 'prepareAndRules') return null;
  if (input.hasUserCorrection || input.broughtBackBefore) return null;
  const { thread } = input;
  if (!thread.labelIds.some(label => String(label).toUpperCase() === 'INBOX')) return null;
  if (thread.signals?.fromUser) return null;
  // Invitations are never handled by a rule, answered or not.
  if (thread.signals?.hasCalendarInvite) return null;
  const arrival = timeOf(input.newestArrivalAt);
  if (!Number.isFinite(arrival)) return null;
  const sender = normalizeSenderEmail(thread.senderEmail);
  if (!sender || sender === normalizeAccountId(input.accountEmail)) return null;
  const rule = input.rules.find(candidate => candidate.enabled && normalizeSenderEmail(candidate.senderEmail) === sender);
  if (!rule) return null;
  if (isSenderRuleWornOut(rule, input.storedBringBacks)) return null;
  const created = timeOf(rule.createdAt);
  // Never retroactive: only mail received after the rule was agreed to.
  if (!Number.isFinite(created) || arrival <= created) return null;
  if (!isSenderRuleEligible(thread, input.accountEmail)) return null;
  return rule;
}

/** Rules only run when the account allows the agent to apply them. */
export function senderRulesActive(settings: AccountSettingsSource, accountId: string): boolean {
  return resolveAccountSetting(settings, accountId, 'agentAutonomy').value === 'prepareAndRules';
}

export type SenderRuleStatus = 'active' | 'paused' | 'off' | 'autoDisabled';

/** How the account page labels a rule. `paused`: enabled, but the account is set to "Prepare only". */
export function senderRuleStatus(rule: SenderRule, autonomy: AgentAutonomy): SenderRuleStatus {
  if (!rule.enabled) return rule.autoDisabledAt ? 'autoDisabled' : 'off';
  return autonomy === 'prepareAndRules' ? 'active' : 'paused';
}

// --- Bring-backs -----------------------------------------------------------------

/** A restore this soon after the user's own archive is the toast's `Undo`, not a bring-back. */
export function isUndoOfArchive(archivedAt: string, now: Date = new Date()): boolean {
  const archived = timeOf(archivedAt);
  if (!Number.isFinite(archived)) return false;
  const elapsed = now.getTime() - archived;
  return elapsed >= 0 && elapsed <= SENDER_RULE_UNDO_WINDOW_MS;
}

export function isWithinBringBackWindow(archivedAt: string, now: Date = new Date()): boolean {
  const archived = timeOf(archivedAt);
  if (!Number.isFinite(archived)) return false;
  const elapsed = now.getTime() - archived;
  return elapsed >= 0 && elapsed <= SENDER_RULE_BRING_BACK_WINDOW_MS;
}

/**
 * Counts one bring-back on the sender's rule; the rule is switched off at
 * two. `disabled` is the rule when this bring-back switched it off.
 */
export function applySenderRuleBringBack(
  rules: readonly SenderRule[],
  senderEmail: string,
  now: Date = new Date(),
): { rules: SenderRule[]; changed: SenderRule | null; disabled: SenderRule | null } {
  const sender = normalizeSenderEmail(senderEmail);
  let changed: SenderRule | null = null;
  let disabled: SenderRule | null = null;
  const next = rules.map(rule => {
    if (changed || !rule.enabled || normalizeSenderEmail(rule.senderEmail) !== sender) return rule;
    const bringBacks = rule.bringBacks + 1;
    const updated: SenderRule = { ...rule, bringBacks };
    if (bringBacks >= SENDER_RULE_AUTO_DISABLE_BRING_BACKS) {
      updated.enabled = false;
      updated.autoDisabledAt = now.toISOString();
      disabled = updated;
    }
    changed = updated;
    return updated;
  });
  return { rules: next, changed, disabled };
}

export function senderRuleAutoDisabledToast(senderName: string): string {
  return `Stopped auto-archiving ${senderName}. You brought its mail back twice.`;
}

/** The action-log payload of a rule archive. `auto` keeps it out of `Z`, which undoes the user's own actions. */
export function senderRuleActionPayload(accountId: string, ruleId: string): string {
  return JSON.stringify({
    accountId,
    auto: true,
    silent: true,
    provenance: { origin: SENDER_RULE_PROVENANCE_ORIGIN, ruleId },
  });
}

/** True when an action payload says a sender rule produced the action. */
export function isSenderRuleActionPayload(payloadJson: string | null | undefined): boolean {
  if (!payloadJson) return false;
  try {
    const parsed = JSON.parse(payloadJson) as { provenance?: { origin?: unknown } } | null;
    return parsed?.provenance?.origin === SENDER_RULE_PROVENANCE_ORIGIN;
  } catch {
    return false;
  }
}
