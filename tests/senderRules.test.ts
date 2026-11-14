import { describe, expect, it } from 'vitest';
import { getSenderRules, resolveAccountSetting, setAccountOverride, setSenderRuleEnabled } from '../shared/accountSettings';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { isUndoableMailActionLog } from '../shared/mailActionFeedback';
import {
  SENDER_RULE_BRING_BACK_WINDOW_MS,
  SENDER_RULE_UNDO_WINDOW_MS,
  applySenderRuleBringBack,
  createSenderRule,
  isSenderRuleActionPayload,
  isSenderRuleEligible,
  isSenderRuleOfferable,
  isSenderRuleWornOut,
  isUndoOfArchive,
  isWithinBringBackWindow,
  matchSenderRule,
  pickSenderRuleOffer,
  senderRuleActionPayload,
  senderRuleAutoDisabledToast,
  senderRuleAutonomyConsent,
  senderRuleNeedsAutonomy,
  senderRuleStatus,
  type SenderRuleMatchInput,
} from '../shared/senderRules';
import type { MailThread, SenderRule, SenderRuleStats } from '../shared/types';
import { fixtureMessages, MAILING_LIST_POSTS, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;

function thread(key: string): MailThread {
  const spec = [...WORK_INBOX, ...MAILING_LIST_POSTS].find(candidate => candidate.key === key);
  if (!spec) throw new Error(key);
  const built = buildMailThreadFromMessages(accountEmail, key, fixtureMessages(spec));
  if (!built) throw new Error(key);
  return built;
}

function rule(senderEmail: string, partial: Partial<SenderRule> = {}): SenderRule {
  return {
    id: `rule-${senderEmail}`,
    senderEmail,
    action: 'archive',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    confirmations: 3,
    bringBacks: 0,
    ...partial,
  };
}

function stats(senderEmail: string, partial: Partial<SenderRuleStats> = {}): SenderRuleStats {
  return {
    accountId: accountEmail,
    senderEmail,
    senderName: senderEmail.split('@')[0],
    confirmations: 3,
    bringBacks: 0,
    lastConfirmedAt: '2026-10-10T12:00:00.000Z',
    dismissedAt: null,
    ...partial,
  };
}

const dispatch = thread('dispatch-212');
const ARRIVAL = '2026-10-10T12:00:00.000Z';

function matchInput(partial: Partial<SenderRuleMatchInput> = {}): SenderRuleMatchInput {
  return {
    thread: dispatch,
    accountEmail,
    rules: [rule(dispatch.senderEmail)],
    autonomy: 'prepareAndRules',
    hasUserCorrection: false,
    newestArrivalAt: ARRIVAL,
    ...partial,
  };
}

describe('sender rule eligibility', () => {
  it('accepts only clear / unsubscribe rule decisions', () => {
    for (const key of ['dispatch-212', 'product-weekly', 'linkedin-requests', 'fieldnote-promo', 'loft-promo']) {
      expect(isSenderRuleEligible(thread(key), accountEmail)).toBe(true);
    }
  });

  it('never matches people, security notices, invitations or other decisions', () => {
    for (const key of ['pilot-date', 'invoice-approved', 'sso-signin', 'invite-weekly', 'invite-1on1', 'people-newsletter']) {
      expect(isSenderRuleEligible(thread(key), accountEmail)).toBe(false);
    }
  });

  it('a rule for a person never archives their mail', () => {
    const person = thread('pilot-date');
    expect(matchSenderRule(matchInput({ thread: person, rules: [rule(person.senderEmail)] }))).toBeNull();
  });

  it('leaves a matching sender in the inbox when the new mail is not bulk', () => {
    const notBulk: MailThread = { ...dispatch, signals: dispatch.signals ? { ...dispatch.signals, isBulk: false, hasOneClickUnsubscribe: false, hasListUnsubscribe: false, listId: null } : undefined, labelIds: ['INBOX'] };
    expect(matchSenderRule(matchInput({ thread: notBulk }))).toBeNull();
  });
});

describe('applying a rule on arrival', () => {
  it('matches an enabled rule for new inbound mail', () => {
    expect(matchSenderRule(matchInput())?.id).toBe(`rule-${dispatch.senderEmail}`);
  });

  it('is gated by the account autonomy', () => {
    expect(matchSenderRule(matchInput({ autonomy: 'prepare' }))).toBeNull();
  });

  it('is never retroactive', () => {
    const later = rule(dispatch.senderEmail, { createdAt: '2026-10-11T00:00:00.000Z' });
    expect(matchSenderRule(matchInput({ rules: [later] }))).toBeNull();
    expect(matchSenderRule(matchInput({ newestArrivalAt: null }))).toBeNull();
  });

  it('skips disabled rules, user corrections, threads out of the inbox and brought-back threads', () => {
    expect(matchSenderRule(matchInput({ rules: [rule(dispatch.senderEmail, { enabled: false })] }))).toBeNull();
    expect(matchSenderRule(matchInput({ hasUserCorrection: true }))).toBeNull();
    expect(matchSenderRule(matchInput({ thread: { ...dispatch, labelIds: ['CATEGORY_UPDATES'] } }))).toBeNull();
    expect(matchSenderRule(matchInput({ broughtBackBefore: true }))).toBeNull();
  });

  it('never archives a thread with a calendar invite, even an answered one', () => {
    const withInvite: MailThread = { ...dispatch, signals: { ...dispatch.signals!, hasCalendarInvite: true, inviteNeedsAnswer: false, inviteStateKnown: true } };
    expect(isSenderRuleEligible(withInvite, accountEmail)).toBe(true);
    expect(matchSenderRule(matchInput({ thread: withInvite }))).toBeNull();
    // State unknown (attachment not fetched): a protected event, not eligible at all.
    const unknown: MailThread = { ...withInvite, signals: { ...withInvite.signals!, inviteStateKnown: false } };
    expect(isSenderRuleEligible(unknown, accountEmail)).toBe(false);
  });

  it("never archives a person's mailing-list post", () => {
    const post = thread('list-discussion');
    expect(isSenderRuleEligible(post, accountEmail)).toBe(false);
    expect(matchSenderRule(matchInput({ thread: post, rules: [rule(post.senderEmail)] }))).toBeNull();
  });

  it('stops at two bring-backs from settings or from the stored stats', () => {
    expect(isSenderRuleWornOut(rule(dispatch.senderEmail, { bringBacks: 1 }))).toBe(false);
    expect(isSenderRuleWornOut(rule(dispatch.senderEmail, { bringBacks: 2 }))).toBe(true);
    expect(isSenderRuleWornOut(rule(dispatch.senderEmail), 2)).toBe(true);
    expect(matchSenderRule(matchInput({ rules: [rule(dispatch.senderEmail, { bringBacks: 2 })] }))).toBeNull();
    expect(matchSenderRule(matchInput({ storedBringBacks: 2 }))).toBeNull();
    expect(matchSenderRule(matchInput({ storedBringBacks: 1 }))).not.toBeNull();
  });

  it('matches the sender address case-insensitively', () => {
    expect(matchSenderRule(matchInput({ rules: [rule(dispatch.senderEmail.toUpperCase())] }))).not.toBeNull();
  });

  it('marks its archives so Z (the user’s own undo) skips them', () => {
    const payload = senderRuleActionPayload(accountEmail, 'r1');
    expect(isSenderRuleActionPayload(payload)).toBe(true);
    expect(JSON.parse(payload).provenance).toEqual({ origin: 'senderRule', ruleId: 'r1' });
    expect(isUndoableMailActionLog({ kind: 'markDone', status: 'completed', payloadJson: payload })).toBe(false);
    expect(isSenderRuleActionPayload(JSON.stringify({ batchId: 'x' }))).toBe(false);
  });
});

describe('undo versus bring-back', () => {
  it('treats a restore inside the toast window as Undo', () => {
    const archivedAt = '2026-10-10T12:00:00.000Z';
    expect(SENDER_RULE_UNDO_WINDOW_MS).toBe(15_000);
    expect(isUndoOfArchive(archivedAt, new Date('2026-10-10T12:00:14.000Z'))).toBe(true);
    expect(isUndoOfArchive(archivedAt, new Date('2026-10-10T12:00:16.000Z'))).toBe(false);
    expect(isUndoOfArchive(archivedAt, new Date('2026-10-10T11:59:59.000Z'))).toBe(false);
    expect(isUndoOfArchive('not a date', new Date(archivedAt))).toBe(false);
  });
});

describe('the offer', () => {
  it('appears at three confirmations without a bring-back', () => {
    expect(isSenderRuleOfferable(stats('a@x.example', { confirmations: 2 }), [])).toBe(false);
    expect(isSenderRuleOfferable(stats('a@x.example'), [])).toBe(true);
    expect(isSenderRuleOfferable(stats('a@x.example', { bringBacks: 1 }), [])).toBe(false);
  });

  it('is not repeated after Not now, nor for a sender that has a rule', () => {
    expect(isSenderRuleOfferable(stats('a@x.example', { dismissedAt: '2026-10-10T00:00:00.000Z' }), [])).toBe(false);
    expect(isSenderRuleOfferable(stats('a@x.example'), [rule('A@x.example', { enabled: false })])).toBe(false);
  });

  it('offers one sender at a time, most confirmations first', () => {
    const pick = pickSenderRuleOffer([
      stats('few@x.example', { confirmations: 3 }),
      stats('many@x.example', { confirmations: 7 }),
      stats('dismissed@x.example', { confirmations: 9, dismissedAt: '2026-10-01T00:00:00.000Z' }),
    ], []);
    expect(pick?.senderEmail).toBe('many@x.example');
    expect(pickSenderRuleOffer([], [])).toBeNull();
  });
});

describe('creating a rule', () => {
  it('adds an enabled rule and raises Prepare only to Prepare and apply my sender rules', () => {
    const settings = { accountOverrides: {} };
    expect(senderRuleNeedsAutonomy(settings, accountEmail)).toBe(true);
    const result = createSenderRule(settings, accountEmail, { id: 'r1', senderEmail: 'News@Dispatch.example', senderName: 'Dispatch', confirmations: 3 });
    expect(result.autonomyRaised).toBe(true);
    expect(resolveAccountSetting(result.settings, accountEmail, 'agentAutonomy')).toEqual({ value: 'prepareAndRules', source: 'account' });
    expect(getSenderRules(result.settings, accountEmail)).toEqual([expect.objectContaining({
      id: 'r1', senderEmail: 'news@dispatch.example', senderName: 'Dispatch', enabled: true, confirmations: 3, bringBacks: 0,
    })]);
    expect(senderRuleAutonomyConsent(accountEmail)).toBe(`This lets the agent archive mail from your approved senders on its own for ${accountEmail}.`);
  });

  it('leaves autonomy alone when rules are already allowed', () => {
    const settings = setAccountOverride({ accountOverrides: {} }, accountEmail, 'agentAutonomy', 'prepareAndRules');
    const result = createSenderRule(settings, accountEmail, { id: 'r1', senderEmail: 'a@x.example' });
    expect(result.autonomyRaised).toBe(false);
  });

  it('pauses every rule when the account is set back to Prepare only', () => {
    expect(senderRuleStatus(rule('a@x.example'), 'prepareAndRules')).toBe('active');
    expect(senderRuleStatus(rule('a@x.example'), 'prepare')).toBe('paused');
    expect(senderRuleStatus(rule('a@x.example', { enabled: false }), 'prepareAndRules')).toBe('off');
    expect(senderRuleStatus(rule('a@x.example', { enabled: false, autoDisabledAt: '2026-10-10T00:00:00.000Z' }), 'prepare')).toBe('autoDisabled');
  });
});

describe('bring-backs', () => {
  it('count only within seven days of the archive', () => {
    const now = new Date('2026-10-17T12:00:00.000Z');
    expect(isWithinBringBackWindow(new Date(now.getTime() - SENDER_RULE_BRING_BACK_WINDOW_MS).toISOString(), now)).toBe(true);
    expect(isWithinBringBackWindow(new Date(now.getTime() - SENDER_RULE_BRING_BACK_WINDOW_MS - 1).toISOString(), now)).toBe(false);
    expect(isWithinBringBackWindow('not a date', now)).toBe(false);
  });

  it('switch a rule off at the second bring-back', () => {
    const now = new Date('2026-10-17T12:00:00.000Z');
    const first = applySenderRuleBringBack([rule('a@x.example'), rule('b@x.example')], 'A@x.example', now);
    expect(first.changed?.bringBacks).toBe(1);
    expect(first.disabled).toBeNull();
    const second = applySenderRuleBringBack(first.rules, 'a@x.example', now);
    expect(second.disabled).toMatchObject({ senderEmail: 'a@x.example', enabled: false, bringBacks: 2, autoDisabledAt: now.toISOString() });
    expect(second.rules[1]).toEqual(rule('b@x.example'));
    // A disabled rule is not counted further.
    expect(applySenderRuleBringBack(second.rules, 'a@x.example', now).changed).toBeNull();
    expect(senderRuleAutoDisabledToast('Dispatch')).toBe('Stopped auto-archiving Dispatch. You brought its mail back twice.');
  });

  it('turning an auto-disabled rule back on starts its count afresh', () => {
    const disabled = rule('a@x.example', { enabled: false, bringBacks: 2, autoDisabledAt: '2026-10-17T12:00:00.000Z' });
    const settings = { accountOverrides: { [accountEmail]: { senderRules: [disabled] } } };
    const [restored] = getSenderRules(setSenderRuleEnabled(settings, accountEmail, disabled.id, true), accountEmail);
    expect(restored).toMatchObject({ enabled: true, bringBacks: 0 });
    expect(restored.autoDisabledAt).toBeUndefined();
  });
});
