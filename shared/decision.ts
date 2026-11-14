// Thread decision engine (design-review/SPEC.md §1).
//
// Three layers, strongest last:
//   1. `decideByRules` — deterministic, always available, works without a model.
//   2. `applyModelRefinement` — a model may only refine the rule decision along
//      the allowed transitions; anything else falls back to the rule decision.
//   3. `applyUserCorrection` — a manual move (`V`) wins over both.
//
// Pure and dependency-free: shared by the main process and the renderer.
// `shared/classifier.ts` (split inbox) is independent of this module.
import { EMPTY_THREAD_SIGNALS } from './threadSignals';
import type { Decision, MailThread, ThreadDecision, ThreadDecisionRecord, ThreadSignals } from './types';

export type { Decision, ThreadDecision, ThreadDecisionRecord, ThreadDecisionSource, ThreadSignals } from './types';

export const DECISIONS: readonly Decision[] = ['reply', 'read', 'event', 'later', 'clear', 'unsubscribe', 'people', 'automated'];

export function isDecision(value: unknown): value is Decision {
  return typeof value === 'string' && (DECISIONS as readonly string[]).includes(value);
}

export const MAX_DECISION_REASON_LENGTH = 120;

/** The thread fields the rule layer reads. */
export type DecisionThread = Pick<MailThread, 'subject' | 'senderEmail' | 'senderNames' | 'labelIds'> & {
  signals?: ThreadSignals | null;
};

export interface DecisionContext {
  accountEmail: string;
}

// --- Sender classification ---------------------------------------------------

const LOCAL_PART_SEPARATORS = /[.\-_+]/;

/**
 * SPEC §1 rule 3. Multi-word entries match as consecutive tokens of the local
 * part. `announce` / `announcements` are added to the SPEC list: since list
 * headers alone no longer make a sender automated (review item 7), these
 * role mailboxes (`eng-announce@`, `announcements@`) are what marks an
 * announcement list as not a person.
 */
const AUTOMATED_LOCAL_PARTS: readonly string[][] = [
  'noreply', 'no-reply', 'donotreply', 'do-not-reply', 'notifications', 'notification', 'mailer-daemon',
  'bounce', 'alerts', 'updates', 'news', 'newsletter', 'billing', 'bookings', 'tracking', 'receipts',
  'info', 'hello', 'offers', 'deals', 'members', 'orders', 'statements', 'announce', 'announcements',
].map(entry => entry.split(LOCAL_PART_SEPARATORS));

/**
 * Gmail's bulk categories. `CATEGORY_FORUMS` is deliberately absent: Gmail
 * files discussion-list posts there, and a person writing to a list is still
 * a person (SPEC §1 rule 3, review item 7).
 */
const AUTOMATED_CATEGORIES = ['CATEGORY_PROMOTIONS', 'CATEGORY_SOCIAL', 'CATEGORY_UPDATES'];

/** Subjects that are a security notice whoever sends them. */
const SECURITY_SUBJECT = /\bsign[- ]?in\b|\bpassword\b|\bverification code\b|\bone[- ]time (?:pass)?code\b|\b2fa\b|\btwo[- ]factor\b|\bmulti[- ]factor\b|\bmfa\b|\b(?:2|two)[- ]step verification\b|\bpasskeys?\b|\bsuspicious\b|\bsecurity alert\b|\bunusual activity\b|\bnew device\b/i;

/**
 * Words people also use in ordinary mail ("login page", "verify your numbers"):
 * a notice only when the sender is automated or a security mailbox.
 */
const GENERIC_SECURITY_SUBJECT = /\blog[- ]?in\b|\bverify your\b|\bconfirm your email address\b/i;

/**
 * Free-mail providers: sharing one with the account never makes a sender
 * "own domain" (a gmail.com account is not a colleague of every gmail.com user).
 * Exact registrable domains, plus provider names that exist under many TLDs.
 */
const FREE_MAIL_DOMAINS: ReadonlySet<string> = new Set([
  'gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'msn.com',
  'icloud.com', 'me.com', 'mac.com', 'proton.me', 'protonmail.com', 'pm.me',
  'mail.ru', 'ya.ru', 'aol.com', 'ymail.com',
]);
const FREE_MAIL_PROVIDER_LABELS: ReadonlySet<string> = new Set(['yahoo', 'gmx', 'yandex', 'hotmail', 'outlook', 'live']);

function splitAddress(email: string): { local: string; domain: string } {
  const trimmed = email.trim().toLowerCase();
  const at = trimmed.lastIndexOf('@');
  if (at < 0) return { local: trimmed, domain: '' };
  return { local: trimmed.slice(0, at), domain: trimmed.slice(at + 1) };
}

function localPartTokens(email: string): string[] {
  return splitAddress(email).local.split(LOCAL_PART_SEPARATORS).filter(Boolean);
}

/** True when the local part contains a known automated mailbox name on word boundaries (`comments-noreply` matches `noreply`). */
export function hasAutomatedLocalPart(email: string): boolean {
  const tokens = localPartTokens(email);
  return AUTOMATED_LOCAL_PARTS.some(entry => {
    for (let start = 0; start + entry.length <= tokens.length; start += 1) {
      if (entry.every((word, offset) => tokens[start + offset] === word)) return true;
    }
    return false;
  });
}

// Second-level labels that act as part of a country suffix (`example.co.uk`).
// Not a public-suffix list; enough to keep `*.co.uk`-style domains from
// collapsing into one "registrable domain".
const SECOND_LEVEL_SUFFIX_LABELS = new Set(['co', 'com', 'net', 'org', 'gov', 'ac', 'edu']);

/** Approximate registrable domain: the last two labels, or three for `co.uk`-style suffixes. */
export function registrableDomain(emailOrDomain: string): string {
  const domain = emailOrDomain.includes('@') ? splitAddress(emailOrDomain).domain : emailOrDomain.trim().toLowerCase();
  const labels = domain.replace(/\.$/, '').split('.').filter(Boolean);
  if (labels.length <= 2) return labels.join('.');
  const tld = labels[labels.length - 1];
  const second = labels[labels.length - 2];
  const take = tld.length === 2 && SECOND_LEVEL_SUFFIX_LABELS.has(second) ? 3 : 2;
  return labels.slice(-take).join('.');
}

/** True for public mail providers (gmail.com, yahoo.co.uk, gmx.de, …). */
export function isFreeMailDomain(emailOrDomain: string): boolean {
  const domain = registrableDomain(emailOrDomain);
  if (!domain) return false;
  if (FREE_MAIL_DOMAINS.has(domain)) return true;
  return FREE_MAIL_PROVIDER_LABELS.has(domain.split('.')[0]);
}

export function isOwnDomainSender(senderEmail: string, accountEmail: string): boolean {
  const sender = registrableDomain(senderEmail);
  if (sender === '' || sender !== registrableDomain(accountEmail)) return false;
  return !isFreeMailDomain(sender);
}

/** The identifier inside `List-Id` (`Name <id>` → `id`), lower case. */
function listIdentifier(listId: string | null | undefined): string {
  if (!listId) return '';
  const bracketed = /<([^>]+)>/.exec(listId);
  return (bracketed ? bracketed[1] : listId).trim().toLowerCase();
}

/**
 * The sender is the list itself (`eng-announce@example.com` posting with
 * `List-Id: <eng-announce.example.com>`): an announcement address, not a
 * person writing to a discussion list.
 */
export function isListAddressSender(senderEmail: string, listId: string | null | undefined): boolean {
  const id = listIdentifier(listId);
  const { local, domain } = splitAddress(senderEmail);
  if (!id || !local || !domain) return false;
  return id === `${local}.${domain}`;
}

function hasLabel(thread: DecisionThread, label: string): boolean {
  return thread.labelIds.some(value => String(value).toUpperCase() === label);
}

function isSecuritySender(thread: DecisionThread): boolean {
  if (splitAddress(thread.senderEmail).local.includes('security')) return true;
  // senderNames lists every participant; a thread with any "…Security…" sender is treated as a notice.
  return thread.senderNames.some(name => name.toLowerCase().includes('security'));
}

/** SPEC §1 rule 2: security notices are never swept. */
export function isSecurityNotice(thread: DecisionThread): boolean {
  if (isSecuritySender(thread)) return true;
  if (SECURITY_SUBJECT.test(thread.subject)) return true;
  return GENERIC_SECURITY_SUBJECT.test(thread.subject) && isAutomatedThread(thread);
}

/**
 * SPEC §1 rule 3. Gmail's primary category (`CATEGORY_PERSONAL` /
 * `CATEGORY_PRIMARY`) never makes a sender automated, and neither do list
 * headers alone: `Precedence: list`, a bare `List-Id` or a plain
 * `List-Unsubscribe` are on every discussion-list post a person writes.
 * Automated needs `Auto-Submitted`, `Precedence: bulk | junk`, one-click
 * unsubscribe, an automated local part, a Gmail bulk category, or a sender
 * that is the list address itself.
 */
export function isAutomatedThread(thread: DecisionThread): boolean {
  const signals = thread.signals || EMPTY_THREAD_SIGNALS;
  return signals.isAutoSubmitted
    || signals.isBulk
    || signals.hasOneClickUnsubscribe
    || hasAutomatedLocalPart(thread.senderEmail)
    || AUTOMATED_CATEGORIES.some(category => hasLabel(thread, category))
    || isListAddressSender(thread.senderEmail, signals.listId);
}

// --- Layer 1: rules ----------------------------------------------------------

function ruleDecision(decision: Decision, reason: string, isProtected: boolean): ThreadDecision {
  return { decision, reason, source: 'rule', protected: isProtected, laterAt: null };
}

/** Deterministic decision; first matching rule wins (SPEC §1, rules 1–7). */
export function decideByRules(thread: DecisionThread, context: DecisionContext): ThreadDecision {
  const signals = thread.signals || EMPTY_THREAD_SIGNALS;

  if (signals.inviteNeedsAnswer) return ruleDecision('event', 'Invitation awaiting your answer', true);
  // An invite whose calendar data is not readable yet (a Gmail attachment not
  // fetched) may still need an answer: never sortable into clear / later.
  if (signals.hasCalendarInvite && signals.inviteStateKnown !== true) return ruleDecision('event', 'Calendar invitation', true);
  if (isSecurityNotice(thread)) return ruleDecision('read', 'Security notice', true);
  if (!isAutomatedThread(thread)) return ruleDecision('people', '', true);
  if (isOwnDomainSender(thread.senderEmail, context.accountEmail)) return ruleDecision('read', 'Internal announcement', false);
  if (hasLabel(thread, 'CATEGORY_PROMOTIONS') && signals.hasOneClickUnsubscribe) {
    return ruleDecision('unsubscribe', 'Promotional mailing list', false);
  }
  if (signals.isBulk || signals.hasOneClickUnsubscribe) return ruleDecision('clear', 'Newsletter', false);
  return ruleDecision('automated', '', false);
}

// --- Layer 2: model ----------------------------------------------------------

/** Targets a model may move each rule decision to (SPEC §1). Identity confirms the decision with the model's reason. */
const MODEL_TRANSITIONS: Readonly<Partial<Record<Decision, readonly Decision[]>>> = {
  people: ['people', 'reply', 'read'],
  automated: ['automated', 'later', 'clear', 'read'],
  clear: ['clear', 'later', 'read'],
};

const PROTECTED_FORBIDDEN: readonly Decision[] = ['clear', 'unsubscribe', 'later'];

export function normalizeDecisionReason(reason: string): string {
  const collapsed = reason.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_DECISION_REASON_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_DECISION_REASON_LENGTH - 1).trimEnd()}…`;
}

function normalizeLaterAt(value: unknown): string | null | undefined {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string') return undefined;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : undefined;
}

/**
 * Applies a model suggestion (`{ decision, reason?, laterAt? }`, unvalidated)
 * to the rule decision. Returns the rule decision unchanged on any invalid
 * input or disallowed transition. `protected` always comes from the rules.
 */
export function applyModelRefinement(rule: ThreadDecision, suggestion: unknown): ThreadDecision {
  if (rule.source === 'user') return rule;
  if (!suggestion || typeof suggestion !== 'object' || Array.isArray(suggestion)) return rule;
  const raw = suggestion as Record<string, unknown>;
  if (!isDecision(raw.decision)) return rule;

  const target = raw.decision;
  const allowed = MODEL_TRANSITIONS[rule.decision];
  if (!allowed || !allowed.includes(target)) return rule;
  if (rule.protected && PROTECTED_FORBIDDEN.includes(target)) return rule;

  if (raw.reason !== undefined && raw.reason !== null && typeof raw.reason !== 'string') return rule;
  const reason = typeof raw.reason === 'string' ? normalizeDecisionReason(raw.reason) : '';

  const laterAt = normalizeLaterAt(raw.laterAt);
  if (laterAt === undefined) return rule;

  return {
    decision: target,
    reason,
    source: 'model',
    protected: rule.protected,
    laterAt: target === 'later' ? laterAt : null,
  };
}

// --- Layer 3: user -----------------------------------------------------------

/**
 * A manual move to another section. Applies to this thread only and wins over
 * rule and model. `protected` is kept: a person's thread the user moved to
 * Clear still never joins a group action.
 */
export function applyUserCorrection(
  current: ThreadDecision,
  target: unknown,
  options: { laterAt?: string | null; reason?: string } = {},
): ThreadDecision {
  if (!isDecision(target)) return current;
  const laterAt = target === 'later' ? normalizeLaterAt(options.laterAt) ?? null : null;
  return {
    decision: target,
    reason: typeof options.reason === 'string' ? normalizeDecisionReason(options.reason) : '',
    source: 'user',
    protected: current.protected,
    laterAt,
  };
}

/** A cached record applies only while the thread's last message is unchanged. */
export function isDecisionRecordCurrent(
  record: Pick<ThreadDecisionRecord, 'lastMessageId'>,
  lastMessageId: string | null | undefined,
): boolean {
  return Boolean(record.lastMessageId) && record.lastMessageId === (lastMessageId || null);
}

/**
 * Combines the three layers. `record` is the cached `thread_decisions` row,
 * ignored when stale. A user record wins; a model record is re-validated
 * against the current rule decision.
 */
export function resolveThreadDecision(
  thread: DecisionThread,
  context: DecisionContext,
  record?: Pick<ThreadDecisionRecord, 'lastMessageId' | 'decision' | 'reason' | 'source' | 'laterAt'> | null,
): ThreadDecision {
  const rule = decideByRules(thread, context);
  if (!record || !isDecisionRecordCurrent(record, thread.signals?.lastMessageId)) return rule;
  if (record.source === 'user') {
    return applyUserCorrection(rule, record.decision, { laterAt: record.laterAt, reason: record.reason });
  }
  if (record.source === 'model') {
    return applyModelRefinement(rule, { decision: record.decision, reason: record.reason, laterAt: record.laterAt });
  }
  return rule;
}

// --- Sections ----------------------------------------------------------------

const MODEL_SECTION_ORDER: readonly Decision[] = ['reply', 'read', 'event', 'later', 'clear', 'unsubscribe'];
const BASIC_SECTION_ORDER: readonly Decision[] = ['people', 'read', 'event', 'automated', 'clear', 'unsubscribe'];

/** SPEC §2 section order. */
export function sectionOrder(hasModel: boolean): Decision[] {
  return [...(hasModel ? MODEL_SECTION_ORDER : BASIC_SECTION_ORDER)];
}

/**
 * Display order for every decision. A thread whose decision is outside the mode's
 * canonical set (a `people` thread the model has not refined yet, a user's `later`
 * without a model) keeps its natural place: undecided people right after `reply`,
 * unsorted automated mail right before `clear`. Nothing jumps to the bottom while
 * the model is still answering, and no thread disappears from the inbox.
 */
const FULL_SECTION_ORDER: Decision[] = ['reply', 'people', 'read', 'event', 'later', 'automated', 'clear', 'unsubscribe'];

function fullSectionOrder(_hasModel: boolean): Decision[] {
  const order = [...FULL_SECTION_ORDER];
  for (const decision of DECISIONS) if (!order.includes(decision)) order.push(decision);
  return order;
}

export interface DecisionEntry<T extends { lastMessageAt: string } = MailThread> {
  thread: T;
  decision: ThreadDecision;
}

export interface DecisionSection<T extends { lastMessageAt: string } = MailThread> {
  decision: Decision;
  entries: DecisionEntry<T>[];
}

function timeOf(value: string): number {
  const time = Date.parse(value);
  return Number.isFinite(time) ? time : 0;
}

/** Non-empty sections in display order; newest thread first inside each. */
export function groupThreadsByDecision<T extends { lastMessageAt: string }>(
  entries: readonly DecisionEntry<T>[],
  hasModel: boolean,
): DecisionSection<T>[] {
  const buckets = new Map<Decision, DecisionEntry<T>[]>();
  for (const entry of entries) {
    const bucket = buckets.get(entry.decision.decision);
    if (bucket) bucket.push(entry);
    else buckets.set(entry.decision.decision, [entry]);
  }
  const sections: DecisionSection<T>[] = [];
  for (const decision of fullSectionOrder(hasModel)) {
    const bucket = buckets.get(decision);
    if (!bucket || bucket.length === 0) continue;
    bucket.sort((a, b) => timeOf(b.thread.lastMessageAt) - timeOf(a.thread.lastMessageAt));
    sections.push({ decision, entries: bucket });
  }
  return sections;
}

/** Only Clear and Later rows join a group action (`⇧E` / `⇧H`), and never a protected thread. */
export function isBatchEligible(decision: ThreadDecision): boolean {
  return !decision.protected && (decision.decision === 'clear' || decision.decision === 'later');
}
