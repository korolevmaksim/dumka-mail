// Sender sections: "always sort mail from this sender into …".
//
// A manual move (`V`) fixes one conversation and lapses with its next
// message. A sender section is the standing version of the same choice: the
// person makes it explicitly (`⇧` in the `V` popover, or the offer after a
// move), it is listed on the account page, and it is applied by
// `decideWithSenderSections` (`shared/decision.ts`) before any model.
//
// A sender section only changes where mail is shown. It never archives,
// sends or answers; invitations and security notices keep their place; mail
// the rules call a person's stays out of group actions wherever it is shown.
// A sender has either a section or an archive rule (`shared/senderRules.ts`),
// never both: the later choice replaces the earlier one.
//
// Pure and dependency-free; settings stay renderer-owned.
import {
  getSenderRules,
  getSenderSections,
  normalizeAccountId,
  setSenderRules,
  setSenderSections,
  type AccountSettingsSource,
} from './accountSettings';
import { decideByRules, isFixedRuleThread, type DecisionThread } from './decision';
import { SECTION_JUMP_LABELS } from './inboxSections';
import type { Decision, SenderRule, SenderSection, SenderSectionTarget } from './types';

export { SENDER_SECTION_REASON, SENDER_SECTION_TARGETS, isSenderSectionTarget } from './decision';

function normalizeSender(value: string | null | undefined): string {
  return (value || '').trim().toLowerCase();
}

/**
 * The standing section a move to `decision` stands for. `reply` is a
 * judgement about one message, so for a sender it means "a person" (a model
 * then still decides reply / read per conversation). `event` and
 * `unsubscribe` are never standing choices.
 */
export function senderSectionTargetFor(decision: Decision): SenderSectionTarget | null {
  switch (decision) {
    case 'reply':
    case 'people':
      return 'people';
    case 'read':
    case 'later':
    case 'automated':
    case 'clear':
      return decision;
    default:
      return null;
  }
}

export type SenderSectionAvailability = 'available' | 'noSender' | 'fixed';

/**
 * Whether this thread's sender can have a section at all. `noSender`: the
 * last message is the account's own (or carries no address). `fixed`: an
 * invitation or a security notice, which no sender section moves.
 */
export function senderSectionAvailability(thread: DecisionThread, accountEmail: string): SenderSectionAvailability {
  const sender = normalizeSender(thread.senderEmail);
  if (!sender || sender === normalizeAccountId(accountEmail)) return 'noSender';
  return isFixedRuleThread(thread) ? 'fixed' : 'available';
}

export function findSenderSection(sections: readonly SenderSection[], senderEmail: string | null | undefined): SenderSection | null {
  const sender = normalizeSender(senderEmail);
  if (!sender) return null;
  return sections.find(section => normalizeSender(section.senderEmail) === sender) || null;
}

/** The standing section `⇧` + a section would create for this thread's sender, else null. */
export function senderSectionChoice(
  thread: DecisionThread,
  accountEmail: string,
  moved: Decision,
): SenderSectionTarget | null {
  if (senderSectionAvailability(thread, accountEmail) !== 'available') return null;
  return senderSectionTargetFor(moved);
}

/** Targets worth offering after a plain move. `later` is left out: postponing is about one conversation. */
const OFFERED_TARGETS: readonly SenderSectionTarget[] = ['people', 'read', 'automated', 'clear'];

/**
 * After a plain move to `moved`: the standing section worth offering for the
 * sender, else null. Offered only when the move disagrees with how the rules
 * see the sender, not with a judgement about one conversation:
 * - the rules call the sender a person: only a move to Clear or Automated
 *   (reading, answering or postponing a person's mail is per conversation);
 * - otherwise: a move to a section other than the rules' own.
 * Never when the sender already has exactly that section.
 */
export function senderSectionOffer(
  thread: DecisionThread,
  accountEmail: string,
  moved: Decision,
  sections: readonly SenderSection[],
): SenderSectionTarget | null {
  const target = senderSectionChoice(thread, accountEmail, moved);
  if (!target || !OFFERED_TARGETS.includes(target)) return null;
  if (findSenderSection(sections, thread.senderEmail)?.section === target) return null;
  const rule = decideByRules(thread, { accountEmail });
  if (rule.decision === 'people') return target === 'clear' || target === 'automated' ? target : null;
  return senderSectionTargetFor(rule.decision) === target ? null : target;
}

// --- Copy ----------------------------------------------------------------------

export function senderSectionLabel(target: SenderSectionTarget): string {
  return SECTION_JUMP_LABELS[target];
}

/** The toast after a sender section was created. */
export function senderSectionCreatedMessage(senderName: string, target: SenderSectionTarget): string {
  if (target === 'people') return `Mail from ${senderName} is now treated as mail from a person.`;
  return `Mail from ${senderName} will always go to ${senderSectionLabel(target)}.`;
}

/** One line for the account page. */
export function senderSectionDescription(target: SenderSectionTarget): string {
  if (target === 'people') return 'Treated as a person';
  return `Always in ${senderSectionLabel(target)}`;
}

/** The account page row: how many senders have a section, and how one is made. */
export function senderSectionsSummary(count: number): string {
  if (count === 0) return 'No senders yet. In the inbox, press V, then hold ⇧ while choosing a section';
  return `${count} ${count === 1 ? 'sender is' : 'senders are'} always sorted into a section you chose`;
}

export const SENDER_SECTION_ARCHIVE_RULE_OFF = 'Its archive rule was switched off.';

/** Footer of the `V` popover. */
export function senderSectionPopoverHint(senderName: string | null): string {
  if (!senderName) return 'Remembered for this conversation only.';
  return `Moves this conversation only. Hold ⇧ to always sort mail from ${senderName} this way.`;
}

// --- Creating and removing --------------------------------------------------------

export interface CreateSenderSectionInput {
  id: string;
  senderEmail: string;
  senderName?: string | null;
  section: SenderSectionTarget;
  now?: Date;
}

export interface CreateSenderSectionResult<S> {
  settings: S & { accountOverrides: NonNullable<AccountSettingsSource['accountOverrides']> };
  section: SenderSection;
  /** The sender's section this one replaced. */
  replaced: SenderSection | null;
  /** The sender's enabled archive rule, switched off by this choice. */
  disabledRule: SenderRule | null;
}

/**
 * Sets the sender's section (replacing an earlier one) and switches off an
 * enabled archive rule for the same sender: mail the person wants sorted into
 * a section must stay in the inbox to be sorted.
 */
export function createSenderSection<S extends AccountSettingsSource>(
  settings: S,
  accountId: string,
  input: CreateSenderSectionInput,
): CreateSenderSectionResult<S> {
  const senderEmail = normalizeSender(input.senderEmail);
  if (!senderEmail) throw new Error('A sender section needs a sender address.');
  if (senderEmail === normalizeAccountId(accountId)) throw new Error('A sender section cannot be set for the account itself.');
  const section: SenderSection = {
    id: input.id,
    senderEmail,
    section: input.section,
    createdAt: (input.now || new Date()).toISOString(),
  };
  const name = input.senderName?.trim();
  if (name && name.toLowerCase() !== senderEmail) section.senderName = name;

  const existing = getSenderSections(settings, accountId);
  const replaced = findSenderSection(existing, senderEmail);
  let next = setSenderSections(settings, accountId, [
    ...existing.filter(other => normalizeSender(other.senderEmail) !== senderEmail),
    section,
  ]);

  let disabledRule: SenderRule | null = null;
  const rules = getSenderRules(next, accountId).map(rule => {
    if (!rule.enabled || normalizeSender(rule.senderEmail) !== senderEmail) return rule;
    disabledRule = rule;
    return { ...rule, enabled: false };
  });
  if (disabledRule) next = setSenderRules(next, accountId, rules);
  return { settings: next as CreateSenderSectionResult<S>['settings'], section, replaced, disabledRule };
}

export function deleteSenderSection<S extends AccountSettingsSource>(settings: S, accountId: string, sectionId: string) {
  return setSenderSections(settings, accountId, getSenderSections(settings, accountId).filter(section => section.id !== sectionId));
}

/**
 * Takes back `createSenderSection`: removes the section if it is still the
 * one created, puts back the section it replaced, and switches the archive
 * rule back on if this choice switched it off and nothing changed it since.
 */
export function undoSenderSection<S extends AccountSettingsSource>(
  settings: S,
  accountId: string,
  created: Pick<CreateSenderSectionResult<S>, 'section' | 'replaced' | 'disabledRule'>,
) {
  const sections = getSenderSections(settings, accountId);
  if (!sections.some(section => section.id === created.section.id)) {
    return setSenderSections(settings, accountId, sections);
  }
  const without = sections.filter(section => section.id !== created.section.id);
  let next = setSenderSections(settings, accountId, created.replaced ? [...without, created.replaced] : without);
  const disabledRule = created.disabledRule;
  if (disabledRule) {
    const rules = getSenderRules(next, accountId).map(rule => (
      rule.id === disabledRule.id && !rule.enabled && !rule.autoDisabledAt ? { ...rule, enabled: true } : rule
    ));
    next = setSenderRules(next, accountId, rules);
  }
  return next;
}
