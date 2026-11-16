// Sender sections: the person's standing "always sort mail from this sender
// into …". Covers the decision layer, the interplay with the model, manual
// moves, archive rules, notifications and the unsubscribe archive, plus the
// settings load path.
import { describe, expect, it } from 'vitest';
import { shouldNotifyForAccount, type NotificationMessage } from '../shared/accountNotifications';
import {
  getSenderRules,
  getSenderSections,
  normalizeAccountOverride,
  setAccountOverride,
  setSenderRuleEnabled,
  setSenderRules,
  setSenderSections,
  type AccountSettingsSource,
} from '../shared/accountSettings';
import { decisionAttemptKey, selectDecisionWorkList, selectDraftWorkList } from '../shared/agentPrompts';
import {
  SENDER_SECTION_REASON,
  applyModelRefinement,
  decideByRules,
  decideWithSenderSections,
  isBatchEligible,
  resolveThreadDecision,
  type DecisionContext,
} from '../shared/decision';
import { explainClearBatch, indexDecisionRecords, resolveInboxDecision } from '../shared/inboxSections';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { createSenderRule, isSenderRuleOfferable, matchSenderRule, pickSenderRuleOffer } from '../shared/senderRules';
import {
  createSenderSection,
  deleteSenderSection,
  findSenderSection,
  senderSectionAvailability,
  senderSectionChoice,
  senderSectionCreatedMessage,
  senderSectionOffer,
  senderSectionPopoverHint,
  senderSectionTargetFor,
  senderSectionsSummary,
  undoSenderSection,
} from '../shared/senderSections';
import { isArchivableAfterUnsubscribe, planArchiveAfterUnsubscribe } from '../shared/unsubscribeConfirm';
import type { MailThread, SenderRule, SenderRuleStats, SenderSection, SenderSectionTarget, ThreadDecisionRecord } from '../shared/types';
import { fixtureMessages, MAILING_LIST_POSTS, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;

function thread(key: string): MailThread {
  const spec = [...WORK_INBOX, ...MAILING_LIST_POSTS].find(candidate => candidate.key === key);
  if (!spec) throw new Error(key);
  const built = buildMailThreadFromMessages(accountEmail, key, fixtureMessages(spec));
  if (!built) throw new Error(key);
  return built;
}

function section(senderEmail: string, target: SenderSectionTarget, partial: Partial<SenderSection> = {}): SenderSection {
  return { id: `section-${senderEmail}`, senderEmail, section: target, createdAt: '2026-10-01T00:00:00.000Z', ...partial };
}

function context(...sections: SenderSection[]): DecisionContext {
  return { accountEmail, senderSections: sections };
}

function rule(senderEmail: string, partial: Partial<SenderRule> = {}): SenderRule {
  return {
    id: `rule-${senderEmail}`, senderEmail, action: 'archive', enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', confirmations: 3, bringBacks: 0, ...partial,
  };
}

function modelRecord(target: MailThread, decision: ThreadDecisionRecord['decision'], partial: Partial<ThreadDecisionRecord> = {}): ThreadDecisionRecord {
  return {
    accountId: accountEmail, threadId: target.id, lastMessageId: target.signals!.lastMessageId,
    decision, reason: 'Model said so', source: 'model', laterAt: null, model: 'test-model', createdAt: '2026-10-10T12:00:00.000Z',
    ...partial,
  };
}

const pr = thread('pr-482');                  // automated, notifications@codeforge.example
const receipt = thread('receipt');            // automated, billing@paperclip.example
const pilot = thread('pilot-date');           // people, priya.raman@lumenlabs.example
const dispatch = thread('dispatch-212');      // clear (bulk), hello@pragmaticdispatch.example
const promo = thread('fieldnote-promo');      // unsubscribe
const invite = thread('invite-weekly');       // event, same sender as pilot-date
const security = thread('sso-signin');        // protected read
const announcement = thread('deploy-freeze'); // read (internal announcement)

describe('sender sections in the decision layer', () => {
  it('leaves every thread to the rules when the account has no sections', () => {
    for (const target of [pr, receipt, pilot, dispatch, promo, invite, security]) {
      expect(decideWithSenderSections(target, { accountEmail })).toEqual(decideByRules(target, { accountEmail }));
      expect(decideWithSenderSections(target, context())).toEqual(decideByRules(target, { accountEmail }));
    }
  });

  it('sorts an automated sender into the chosen section as the person\'s own choice', () => {
    const decision = decideWithSenderSections(pr, context(section(pr.senderEmail, 'read')));
    expect(decision).toEqual({ decision: 'read', reason: SENDER_SECTION_REASON, source: 'user', protected: false, laterAt: null });
  });

  it('matches the sender whatever the case or padding of the stored address', () => {
    const decision = decideWithSenderSections(pr, context(section(`  ${pr.senderEmail.toUpperCase()} `, 'clear')));
    expect(decision.decision).toBe('clear');
  });

  it('applies to that sender only', () => {
    expect(decideWithSenderSections(receipt, context(section(pr.senderEmail, 'read'))).decision).toBe('automated');
  });

  it('makes automated mail sorted into Clear part of the group action', () => {
    const decision = decideWithSenderSections(receipt, context(section(receipt.senderEmail, 'clear')));
    expect(decision.decision).toBe('clear');
    expect(isBatchEligible(decision)).toBe(true);
  });

  it('keeps a person\'s mail out of group actions even when the person sorts that sender into Clear', () => {
    const decision = decideWithSenderSections(pilot, context(section(pilot.senderEmail, 'clear')));
    expect(decision).toMatchObject({ decision: 'clear', source: 'user', protected: true });
    expect(isBatchEligible(decision)).toBe(false);
  });

  it('treats a sender marked as a person like any person: protected, and refinable by a model', () => {
    const ctx = context(section(pr.senderEmail, 'people'));
    const decision = decideWithSenderSections(pr, ctx);
    expect(decision).toEqual({ decision: 'people', reason: '', source: 'rule', protected: true, laterAt: null });
    expect(applyModelRefinement(decision, { decision: 'reply', reason: 'Asks for a review' })).toMatchObject({ decision: 'reply', source: 'model', protected: true });
    // Protected: a model can never sweep it.
    expect(applyModelRefinement(decision, { decision: 'clear' })).toBe(decision);
    expect(applyModelRefinement(decision, { decision: 'later' })).toBe(decision);
  });

  it('never lets a model move mail the person always sorts into a section', () => {
    const ctx = context(section(receipt.senderEmail, 'clear'));
    const resolved = resolveThreadDecision(receipt, ctx, modelRecord(receipt, 'read'));
    expect(resolved).toMatchObject({ decision: 'clear', source: 'user' });
  });

  it('ignores a model answer given before the sender was marked as a person', () => {
    // The model answered for an automated thread (automated → clear is allowed).
    const stale = modelRecord(pr, 'clear');
    expect(resolveThreadDecision(pr, { accountEmail }, stale).decision).toBe('clear');
    expect(resolveThreadDecision(pr, context(section(pr.senderEmail, 'people')), stale)).toMatchObject({ decision: 'people', protected: true });
  });

  it('never moves an invitation or a security notice', () => {
    const sections = [section(invite.senderEmail, 'clear'), section(security.senderEmail, 'clear')];
    expect(decideWithSenderSections(invite, context(...sections))).toEqual(decideByRules(invite, { accountEmail }));
    expect(decideWithSenderSections(security, context(...sections))).toEqual(decideByRules(security, { accountEmail }));
    expect(decideWithSenderSections(invite, context(...sections))).toMatchObject({ decision: 'event', protected: true });
  });

  it('never applies to the account\'s own address', () => {
    const own = { ...pilot, senderEmail: accountEmail.toUpperCase() };
    expect(decideWithSenderSections(own, context(section(accountEmail, 'clear')))).toEqual(decideByRules(own, { accountEmail }));
  });

  it('a manual move of one conversation wins over the sender section', () => {
    const ctx = context(section(pr.senderEmail, 'read'));
    const user: ThreadDecisionRecord = modelRecord(pr, 'later', { source: 'user', model: null, reason: '', laterAt: '2026-10-11T07:00:00.000Z' });
    const stored = indexDecisionRecords([user])[pr.id];
    expect(resolveInboxDecision(pr, ctx, stored)).toMatchObject({ decision: 'later', source: 'user', reason: '' });
    // Once the conversation gets a new message the move lapses and the section applies again.
    const stale = indexDecisionRecords([{ ...user, lastMessageId: 'older-message' }])[pr.id];
    expect(resolveInboxDecision(pr, ctx, stale)).toMatchObject({ decision: 'read', reason: SENDER_SECTION_REASON });
  });

  it('a manual move never lifts the protection of a sender marked as a person', () => {
    const ctx = context(section(pr.senderEmail, 'people'));
    const user: ThreadDecisionRecord = modelRecord(pr, 'clear', { source: 'user', model: null, reason: '' });
    const resolved = resolveInboxDecision(pr, ctx, indexDecisionRecords([user])[pr.id]);
    expect(resolved).toMatchObject({ decision: 'clear', protected: true });
    expect(isBatchEligible(resolved)).toBe(false);
  });

  it('is explained in the Clear group as the person\'s own choice', () => {
    const decision = decideWithSenderSections(receipt, context(section(receipt.senderEmail, 'clear')));
    const explanation = explainClearBatch([{ thread: receipt, decision }]);
    expect(explanation.summary).toBe('You moved these here yourself.');
    expect(explanation.reasons[0].reason).toBe(SENDER_SECTION_REASON);
  });
});

describe('what a move stands for', () => {
  it('maps a section to its standing choice', () => {
    expect(senderSectionTargetFor('reply')).toBe('people');
    expect(senderSectionTargetFor('people')).toBe('people');
    for (const target of ['read', 'later', 'automated', 'clear'] as const) expect(senderSectionTargetFor(target)).toBe(target);
    expect(senderSectionTargetFor('event')).toBeNull();
    expect(senderSectionTargetFor('unsubscribe')).toBeNull();
  });

  it('is unavailable for invitations, security notices and the account\'s own messages', () => {
    expect(senderSectionAvailability(pr, accountEmail)).toBe('available');
    expect(senderSectionAvailability(invite, accountEmail)).toBe('fixed');
    expect(senderSectionAvailability(security, accountEmail)).toBe('fixed');
    expect(senderSectionAvailability({ ...pilot, senderEmail: accountEmail }, accountEmail)).toBe('noSender');
    expect(senderSectionAvailability({ ...pilot, senderEmail: ' ' }, accountEmail)).toBe('noSender');
    expect(senderSectionChoice(invite, accountEmail, 'read')).toBeNull();
    expect(senderSectionChoice(pr, accountEmail, 'unsubscribe')).toBeNull();
    expect(senderSectionChoice(pr, accountEmail, 'reply')).toBe('people');
  });
});

describe('the offer after a plain move', () => {
  it('offers when the move disagrees with how the rules see the sender', () => {
    expect(senderSectionOffer(pr, accountEmail, 'read', [])).toBe('read');
    expect(senderSectionOffer(pr, accountEmail, 'clear', [])).toBe('clear');
    expect(senderSectionOffer(pr, accountEmail, 'reply', [])).toBe('people');
    expect(senderSectionOffer(pr, accountEmail, 'people', [])).toBe('people');
    expect(senderSectionOffer(dispatch, accountEmail, 'read', [])).toBe('read');
    expect(senderSectionOffer(promo, accountEmail, 'clear', [])).toBe('clear');
    expect(senderSectionOffer(announcement, accountEmail, 'clear', [])).toBe('clear');
  });

  it('does not offer for a judgement about one conversation with a person', () => {
    expect(senderSectionOffer(pilot, accountEmail, 'read', [])).toBeNull();
    expect(senderSectionOffer(pilot, accountEmail, 'reply', [])).toBeNull();
    expect(senderSectionOffer(pilot, accountEmail, 'later', [])).toBeNull();
    // Saying a person-like address is routine or a robot is about the sender.
    expect(senderSectionOffer(pilot, accountEmail, 'clear', [])).toBe('clear');
    expect(senderSectionOffer(pilot, accountEmail, 'automated', [])).toBe('automated');
  });

  it('does not offer for the rules\' own section, for Later, Event or Unsubscribe', () => {
    expect(senderSectionOffer(pr, accountEmail, 'automated', [])).toBeNull();
    expect(senderSectionOffer(dispatch, accountEmail, 'clear', [])).toBeNull();
    expect(senderSectionOffer(announcement, accountEmail, 'read', [])).toBeNull();
    expect(senderSectionOffer(pr, accountEmail, 'later', [])).toBeNull();
    expect(senderSectionOffer(pr, accountEmail, 'event', [])).toBeNull();
    expect(senderSectionOffer(pr, accountEmail, 'unsubscribe', [])).toBeNull();
  });

  it('does not offer what the sender already has, nor for fixed threads', () => {
    expect(senderSectionOffer(pr, accountEmail, 'read', [section(pr.senderEmail, 'read')])).toBeNull();
    expect(senderSectionOffer(pr, accountEmail, 'clear', [section(pr.senderEmail, 'read')])).toBe('clear');
    expect(senderSectionOffer(invite, accountEmail, 'clear', [])).toBeNull();
    expect(senderSectionOffer(security, accountEmail, 'clear', [])).toBeNull();
  });
});

describe('sender sections in settings', () => {
  const base: AccountSettingsSource = { accountOverrides: {} };

  it('creates one section per sender, replacing the earlier one', () => {
    const first = createSenderSection(base, accountEmail, { id: 's1', senderEmail: ' Notifications@CodeForge.example ', senderName: 'CodeForge', section: 'read' });
    expect(first.section).toMatchObject({ id: 's1', senderEmail: 'notifications@codeforge.example', senderName: 'CodeForge', section: 'read' });
    expect(first.replaced).toBeNull();
    const second = createSenderSection(first.settings, accountEmail.toUpperCase(), { id: 's2', senderEmail: 'notifications@codeforge.example', section: 'clear' });
    expect(second.replaced?.id).toBe('s1');
    expect(getSenderSections(second.settings, accountEmail).map(entry => [entry.id, entry.section])).toEqual([['s2', 'clear']]);
    // The input is never mutated.
    expect(base.accountOverrides).toEqual({});
  });

  it('refuses a section without a sender or for the account itself', () => {
    expect(() => createSenderSection(base, accountEmail, { id: 's', senderEmail: ' ', section: 'read' })).toThrow();
    expect(() => createSenderSection(base, accountEmail, { id: 's', senderEmail: accountEmail.toUpperCase(), section: 'read' })).toThrow();
  });

  it('switches the sender\'s archive rule off, and Undo puts everything back', () => {
    const withRule = setSenderRules(base, accountEmail, [rule(dispatch.senderEmail), rule('other@x.example')]);
    const created = createSenderSection(withRule, accountEmail, { id: 's1', senderEmail: dispatch.senderEmail, section: 'read' });
    expect(created.disabledRule?.senderEmail).toBe(dispatch.senderEmail);
    expect(getSenderRules(created.settings, accountEmail).map(entry => entry.enabled)).toEqual([false, true]);

    const undone = undoSenderSection(created.settings, accountEmail, created);
    expect(getSenderSections(undone, accountEmail)).toEqual([]);
    expect(getSenderRules(undone, accountEmail).map(entry => entry.enabled)).toEqual([true, true]);
  });

  it('Undo restores the section it replaced and leaves a rule alone that was already off', () => {
    const start = setSenderRules(
      createSenderSection(base, accountEmail, { id: 's1', senderEmail: dispatch.senderEmail, section: 'read' }).settings,
      accountEmail,
      [rule(dispatch.senderEmail, { enabled: false })],
    );
    const created = createSenderSection(start, accountEmail, { id: 's2', senderEmail: dispatch.senderEmail, section: 'clear' });
    expect(created.disabledRule).toBeNull();
    const undone = undoSenderSection(created.settings, accountEmail, created);
    expect(getSenderSections(undone, accountEmail).map(entry => entry.id)).toEqual(['s1']);
    expect(getSenderRules(undone, accountEmail)[0].enabled).toBe(false);
  });

  it('Undo does nothing once the section was replaced or removed meanwhile', () => {
    const created = createSenderSection(base, accountEmail, { id: 's1', senderEmail: dispatch.senderEmail, section: 'read' });
    const replaced = createSenderSection(created.settings, accountEmail, { id: 's2', senderEmail: dispatch.senderEmail, section: 'clear' });
    expect(getSenderSections(undoSenderSection(replaced.settings, accountEmail, created), accountEmail).map(entry => entry.id)).toEqual(['s2']);
    const removed = deleteSenderSection(created.settings, accountEmail, 's1');
    expect(getSenderSections(undoSenderSection(removed, accountEmail, created), accountEmail)).toEqual([]);
  });

  it('Undo does not switch on a rule that was auto-disabled meanwhile', () => {
    const withRule = setSenderRules(base, accountEmail, [rule(dispatch.senderEmail)]);
    const created = createSenderSection(withRule, accountEmail, { id: 's1', senderEmail: dispatch.senderEmail, section: 'read' });
    const autoDisabled = setSenderRules(created.settings, accountEmail, [rule(dispatch.senderEmail, { enabled: false, autoDisabledAt: '2026-10-10T00:00:00.000Z' })]);
    expect(getSenderRules(undoSenderSection(autoDisabled, accountEmail, created), accountEmail)[0].enabled).toBe(false);
  });

  it('agreeing to an archive rule, or switching one on, removes the sender\'s section', () => {
    const sorted = createSenderSection(base, accountEmail, { id: 's1', senderEmail: dispatch.senderEmail, section: 'read' }).settings;
    const other = createSenderSection(sorted, accountEmail, { id: 's2', senderEmail: 'other@x.example', section: 'clear' }).settings;
    const withRule = createSenderRule(other, accountEmail, { id: 'r1', senderEmail: dispatch.senderEmail.toUpperCase() });
    expect(getSenderSections(withRule.settings, accountEmail).map(entry => entry.id)).toEqual(['s2']);

    const off = setSenderRules(sorted, accountEmail, [rule(dispatch.senderEmail, { enabled: false })]);
    expect(getSenderSections(setSenderRuleEnabled(off, accountEmail, `rule-${dispatch.senderEmail}`, false), accountEmail)).toHaveLength(1);
    const on = setSenderRuleEnabled(off, accountEmail, `rule-${dispatch.senderEmail}`, true);
    expect(getSenderSections(on, accountEmail)).toEqual([]);
    expect(getSenderRules(on, accountEmail)[0].enabled).toBe(true);
  });

  it('drops malformed stored entries and keeps the last entry of a sender', () => {
    const override = normalizeAccountOverride({
      notifications: 'all',
      senderSections: [
        null,
        'text',
        { id: 'a', senderEmail: 'A@x.example', section: 'read', createdAt: '2026-10-01T00:00:00.000Z' },
        { id: 'b', senderEmail: 'b@x.example', section: 'unsubscribe' },
        { id: 'c', senderEmail: 'c@x.example', section: 'event' },
        { id: '', senderEmail: 'd@x.example', section: 'read' },
        { id: 'e', senderEmail: 42, section: 'read' },
        { id: 'f', senderEmail: 'a@x.example', section: 'clear', senderName: ' A ' },
      ],
    });
    expect(override.notifications).toBe('all');
    expect(override.senderSections).toEqual([
      { id: 'f', senderEmail: 'a@x.example', section: 'clear', senderName: 'A', createdAt: new Date(0).toISOString() },
    ]);
    expect(normalizeAccountOverride({ senderSections: 'nope' }).senderSections).toBeUndefined();
    expect(normalizeAccountOverride({ senderSections: [{ id: 'x' }] }).senderSections).toBeUndefined();
  });

  it('reads stored JSON that was never normalised without throwing', () => {
    const raw = { accountOverrides: { [accountEmail]: { senderSections: [{ id: 'a', senderEmail: 7, section: 'read' }, { id: 'b', senderEmail: pr.senderEmail, section: 'read' }] } } } as unknown as AccountSettingsSource;
    expect(getSenderSections(raw, accountEmail).map(entry => entry.id)).toEqual(['b']);
    expect(getSenderSections({ accountOverrides: { [accountEmail]: { senderSections: {} } } } as unknown as AccountSettingsSource, accountEmail)).toEqual([]);
    expect(decideWithSenderSections(pr, { accountEmail, senderSections: getSenderSections(raw, accountEmail) }).decision).toBe('read');
    // A lookup that is handed junk directly is tolerant too.
    const junk = [null, { id: 'n', senderEmail: 7, section: 'read' }, { id: 'a', senderEmail: pr.senderEmail, section: 'unsubscribe' }] as unknown as SenderSection[];
    expect(decideWithSenderSections(pr, { accountEmail, senderSections: junk }).decision).toBe('automated');
  });

  it('removing the last section drops the key from the override', () => {
    const created = createSenderSection(base, accountEmail, { id: 's1', senderEmail: pr.senderEmail, section: 'read' });
    expect(deleteSenderSection(created.settings, accountEmail, 's1').accountOverrides).toEqual({});
    expect(setSenderSections(created.settings, accountEmail, []).accountOverrides).toEqual({});
  });

  it('words the choice plainly', () => {
    expect(senderSectionCreatedMessage('CodeForge', 'read')).toBe('Mail from CodeForge will always go to Read.');
    expect(senderSectionCreatedMessage('CodeForge', 'automated')).toBe('Mail from CodeForge will always go to Automated.');
    expect(senderSectionCreatedMessage('Sam', 'people')).toBe('Mail from Sam is now treated as mail from a person.');
    expect(senderSectionPopoverHint(null)).toBe('Remembered for this conversation only.');
    expect(senderSectionPopoverHint('CodeForge')).toContain('Hold ⇧ to always sort mail from CodeForge this way');
    expect(senderSectionsSummary(0)).toContain('press V');
    expect(senderSectionsSummary(1)).toContain('1 sender is');
    expect(senderSectionsSummary(3)).toContain('3 senders are');
    expect(findSenderSection([section('a@x.example', 'read')], ' A@X.example ')?.section).toBe('read');
    expect(findSenderSection([section('a@x.example', 'read')], '')).toBeNull();
  });
});

describe('sender sections and archive rules', () => {
  const stats: SenderRuleStats = {
    accountId: accountEmail, senderEmail: dispatch.senderEmail, senderName: 'Dispatch',
    confirmations: 5, bringBacks: 0, lastConfirmedAt: '2026-10-10T12:00:00.000Z', dismissedAt: null,
  };

  it('a rule never archives mail from a sender the person sorts into a section', () => {
    const input = {
      thread: dispatch, accountEmail, rules: [rule(dispatch.senderEmail)], autonomy: 'prepareAndRules' as const,
      hasUserCorrection: false, newestArrivalAt: '2026-10-10T12:00:00.000Z',
    };
    expect(matchSenderRule(input)).not.toBeNull();
    expect(matchSenderRule({ ...input, hasSenderSection: true })).toBeNull();
  });

  it('does not offer to archive a sender the person chose to keep seeing', () => {
    expect(isSenderRuleOfferable(stats, [])).toBe(true);
    expect(isSenderRuleOfferable(stats, [], [section(dispatch.senderEmail.toUpperCase(), 'read')])).toBe(false);
    expect(isSenderRuleOfferable(stats, [], [section('other@x.example', 'read')])).toBe(true);
    expect(pickSenderRuleOffer([stats], [], [section(dispatch.senderEmail, 'clear')])).toBeNull();
  });
});

describe('sender sections outside the list', () => {
  function message(senderEmail: string, partial: Partial<NotificationMessage> = {}): NotificationMessage {
    return { id: 'm1', accountId: accountEmail, subject: 'Build finished', senderEmail, senderName: 'Sender', labelIds: ['INBOX', 'UNREAD'], headers: [], attachments: [], ...partial };
  }
  function settings(...sections: SenderSection[]): AccountSettingsSource {
    return setSenderSections(setAccountOverride({ accountOverrides: {} }, accountEmail, 'notifications', 'people'), accountEmail, sections);
  }

  it('notifies for a sender marked as a person, and not for a person-like sender sorted elsewhere', () => {
    const robot = message('notifications@codeforge.example');
    const person = message('priya.raman@lumenlabs.example', { subject: 'Lunch?' });
    expect(shouldNotifyForAccount(robot, settings())).toBe(false);
    expect(shouldNotifyForAccount(robot, settings(section(robot.senderEmail, 'people')))).toBe(true);
    expect(shouldNotifyForAccount(person, settings())).toBe(true);
    expect(shouldNotifyForAccount(person, settings(section(person.senderEmail, 'clear')))).toBe(false);
  });

  it('still notifies for a security notice from a sender sorted into Clear', () => {
    const notice = message('no-reply@accounts.example', { subject: 'New sign-in to your account' });
    expect(shouldNotifyForAccount(notice, settings(section(notice.senderEmail, 'clear')))).toBe(true);
  });

  it('asks a model nothing about a sender with a fixed section, and asks about a marked person as a person', () => {
    const threads = [pr, receipt];
    expect(selectDecisionWorkList(threads, {}, { accountEmail }).map(item => item.thread.id).sort()).toEqual(['pr-482', 'receipt']);
    const fixed = selectDecisionWorkList(threads, {}, context(section(pr.senderEmail, 'read')));
    expect(fixed.map(item => item.thread.id)).toEqual(['receipt']);
    const person = selectDecisionWorkList(threads, {}, context(section(pr.senderEmail, 'people')));
    expect(person.find(item => item.thread.id === 'pr-482')?.rule).toMatchObject({ decision: 'people', protected: true });
  });

  it('asks again about a conversation whose model answer was for another classification of the sender', () => {
    // The model answered while the rules called the sender automated.
    const stored = indexDecisionRecords([modelRecord(pr, 'clear')]);
    expect(selectDecisionWorkList([pr], stored, { accountEmail })).toEqual([]);
    // Marked as a person: that answer no longer applies, so the thread is refinable again.
    const asPerson = context(section(pr.senderEmail, 'people'));
    expect(selectDecisionWorkList([pr], stored, asPerson).map(item => item.rule.decision)).toEqual(['people']);
    // An attempt made under the old classification does not block it either,
    // while an attempt under the new one does.
    const lastMessageId = pr.signals!.lastMessageId!;
    const triedAsAutomated = new Set([decisionAttemptKey(accountEmail, pr.id, lastMessageId, 'automated')]);
    const triedAsPerson = new Set([decisionAttemptKey(accountEmail, pr.id, lastMessageId, 'people')]);
    expect(selectDecisionWorkList([pr], stored, asPerson, { skip: triedAsAutomated })).toHaveLength(1);
    expect(selectDecisionWorkList([pr], stored, asPerson, { skip: triedAsPerson })).toEqual([]);
    // Once the model answers for a person, the thread is settled again.
    const answered = indexDecisionRecords([modelRecord(pr, 'reply')]);
    expect(selectDecisionWorkList([pr], answered, asPerson)).toEqual([]);
    // And the reverse: with the section removed, the answer given for a person lapses.
    expect(selectDecisionWorkList([pr], answered, { accountEmail }).map(item => item.rule.decision)).toEqual(['automated']);
  });

  it('prepares a draft for a marked person the model reads as needing a reply, never for a fixed section', () => {
    const stored = indexDecisionRecords([modelRecord(pr, 'reply')]);
    const options = { hasUserDraft: () => false, hasPreparedDraft: () => false };
    expect(selectDraftWorkList([pr], stored, { accountEmail }, options)).toEqual([]);
    expect(selectDraftWorkList([pr], stored, context(section(pr.senderEmail, 'people')), options).map(item => item.thread.id)).toEqual(['pr-482']);
    expect(selectDraftWorkList([pr], stored, context(section(pr.senderEmail, 'read')), options)).toEqual([]);
  });

  it('keeps mail the person sorts into another section out of the archive after unsubscribing', () => {
    const lookup = (sections: SenderSection[]) => () => sections;
    expect(isArchivableAfterUnsubscribe(promo)).toBe(true);
    expect(isArchivableAfterUnsubscribe(promo, null, lookup([section(promo.senderEmail, 'read')]))).toBe(false);
    expect(isArchivableAfterUnsubscribe(promo, null, lookup([section(promo.senderEmail, 'people')]))).toBe(false);
    expect(isArchivableAfterUnsubscribe(promo, null, lookup([section(promo.senderEmail, 'clear')]))).toBe(true);
    const target = { accountId: accountEmail, threadId: promo.id, sourceMessageId: null, senderName: 'Fieldnote', senderEmail: promo.senderEmail, method: 'oneClick' as never };
    const plan = planArchiveAfterUnsubscribe([promo], [target], null, lookup([section(promo.senderEmail, 'read')]));
    expect(plan).toEqual({ threads: [], keptInInbox: 1 });
  });
});
