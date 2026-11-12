import { describe, expect, it } from 'vitest';
import {
  applyModelRefinement,
  applyUserCorrection,
  decideByRules,
  groupThreadsByDecision,
  hasAutomatedLocalPart,
  isAutomatedThread,
  isBatchEligible,
  isFreeMailDomain,
  isListAddressSender,
  isOwnDomainSender,
  isSecurityNotice,
  registrableDomain,
  resolveThreadDecision,
  sectionOrder,
  type Decision,
  type ThreadDecision,
} from '../shared/decision';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { computeThreadSignals, readIcsInviteState } from '../shared/threadSignals';
import type { MailMessage, MailThread } from '../shared/types';
import { ATTACHMENT_ONLY_INVITES, fixtureMessages, icsAttachment, inviteIcs, MAILING_LIST_POSTS, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;

function buildThread(key: string): MailThread {
  const spec = [...WORK_INBOX, ...MAILING_LIST_POSTS, ...ATTACHMENT_ONLY_INVITES].find(thread => thread.key === key);
  if (!spec) throw new Error(`Unknown fixture thread ${key}`);
  const thread = buildMailThreadFromMessages(accountEmail, spec.key, fixtureMessages(spec));
  if (!thread) throw new Error(`Fixture thread ${key} has no messages`);
  return thread;
}

const threads = WORK_INBOX.map(spec => buildThread(spec.key));
const decide = (thread: MailThread, email = accountEmail) => decideByRules(thread, { accountEmail: email });
const ruleDecisions = new Map(threads.map(thread => [thread.id, decideByRules(thread, { accountEmail })]));

function rule(key: string): ThreadDecision {
  const decision = ruleDecisions.get(key);
  if (!decision) throw new Error(`No decision for ${key}`);
  return decision;
}

/** Rule-layer result for every thread of the work inbox, pinned by key. */
const EXPECTED: Record<string, { decision: Decision; protected: boolean }> = {
  'pilot-date': { decision: 'people', protected: true },
  'board-numbers': { decision: 'people', protected: true },
  redlines: { decision: 'people', protected: true },
  'interview-loop': { decision: 'people', protected: true },
  'intro-tomas': { decision: 'people', protected: true },
  'onboarding-feedback': { decision: 'people', protected: true },
  'offsite-moved': { decision: 'people', protected: true },
  'invoice-approved': { decision: 'people', protected: true },
  'deploy-freeze': { decision: 'read', protected: false },
  'invite-weekly': { decision: 'event', protected: true },
  'invite-1on1': { decision: 'event', protected: true },
  'pr-482': { decision: 'automated', protected: false },
  'ci-failed': { decision: 'automated', protected: false },
  'nw-1432': { decision: 'automated', protected: false },
  'nw-1398': { decision: 'automated', protected: false },
  // noreply@status.northwind.example: a subdomain of the account's domain, so rule 4 (own domain) applies.
  'status-resolved': { decision: 'read', protected: false },
  'doc-comment': { decision: 'automated', protected: false },
  eticket: { decision: 'automated', protected: false },
  receipt: { decision: 'automated', protected: false },
  parcel: { decision: 'automated', protected: false },
  'dispatch-212': { decision: 'clear', protected: false },
  'product-weekly': { decision: 'clear', protected: false },
  'people-newsletter': { decision: 'read', protected: false },
  // CATEGORY_PROMOTIONS + one-click unsubscribe: rule 5.
  'devconf-cfp': { decision: 'unsubscribe', protected: false },
  'fieldnote-promo': { decision: 'unsubscribe', protected: false },
  'loft-promo': { decision: 'unsubscribe', protected: false },
  'linkedin-requests': { decision: 'clear', protected: false },
  'sso-signin': { decision: 'read', protected: true },
};

const PEOPLE_KEYS = ['pilot-date', 'board-numbers', 'redlines', 'interview-loop', 'intro-tomas', 'onboarding-feedback', 'offsite-moved', 'invoice-approved'];
const INVITE_KEYS = ['invite-weekly', 'invite-1on1'];
const SECURITY_KEYS = ['sso-signin'];

describe('work inbox fixture', () => {
  it('holds the 28 inbox conversations', () => {
    expect(WORK_INBOX).toHaveLength(28);
    expect(new Set(WORK_INBOX.map(thread => thread.key)).size).toBe(28);
    expect(Object.keys(EXPECTED).sort()).toEqual(WORK_INBOX.map(thread => thread.key).sort());
  });
});

describe('decideByRules on the work inbox', () => {
  it.each(Object.entries(EXPECTED))('%s', (key, expected) => {
    const decision = rule(key);
    expect({ decision: decision.decision, protected: decision.protected }).toEqual(expected);
    expect(decision.source).toBe('rule');
    expect(decision.laterAt).toBeNull();
  });

  it('produces these section counts without a model', () => {
    const counts: Partial<Record<Decision, number>> = {};
    for (const decision of ruleDecisions.values()) counts[decision.decision] = (counts[decision.decision] || 0) + 1;
    expect(counts).toEqual({ people: 8, read: 4, event: 2, automated: 8, clear: 3, unsubscribe: 3 });
  });

  it('never sweeps people, security notices or invitations', () => {
    for (const key of [...PEOPLE_KEYS, ...INVITE_KEYS, ...SECURITY_KEYS]) {
      const decision = rule(key);
      expect(['clear', 'unsubscribe', 'automated', 'later']).not.toContain(decision.decision);
      expect(decision.protected).toBe(true);
    }
  });

  it('pins the named cases', () => {
    expect(INVITE_KEYS.map(key => rule(key).decision)).toEqual(['event', 'event']);
    const invoice = threads.find(thread => thread.subject === 'Re: Invoice #2291 approved');
    expect(invoice?.senderEmail).toBe('nora.petrov@northwind.example');
    expect(rule('invoice-approved').decision).toBe('people');
    expect(rule('sso-signin')).toMatchObject({ decision: 'read', protected: true });
    expect(rule('deploy-freeze').decision).toBe('read');
    expect(rule('people-newsletter').decision).toBe('read');
    for (const key of ['pr-482', 'ci-failed', 'nw-1432', 'nw-1398', 'doc-comment', 'eticket', 'receipt', 'parcel']) {
      expect(rule(key).decision).toBe('automated');
    }
    for (const key of ['dispatch-212', 'product-weekly', 'linkedin-requests']) expect(rule(key).decision).toBe('clear');
    for (const key of ['fieldnote-promo', 'loft-promo']) expect(rule(key).decision).toBe('unsubscribe');
  });

  it('works on threads cached without signals', () => {
    const { signals: _signals, ...legacy } = buildThread('pr-482');
    expect(decideByRules(legacy, { accountEmail }).decision).toBe('automated');
    const { signals: _personSignals, ...legacyPerson } = buildThread('pilot-date');
    expect(decideByRules(legacyPerson, { accountEmail })).toMatchObject({ decision: 'people', protected: true });
  });

  it('treats CATEGORY_PERSONAL and CATEGORY_PRIMARY as not automated', () => {
    const base = buildThread('pilot-date');
    for (const label of ['CATEGORY_PERSONAL', 'CATEGORY_PRIMARY']) {
      expect(decideByRules({ ...base, labelIds: ['INBOX', label] }, { accountEmail }).decision).toBe('people');
    }
  });

  it('checks security before the automated and own-domain rules', () => {
    const base = buildThread('people-newsletter');
    expect(decideByRules({ ...base, subject: 'Your password was changed' }, { accountEmail }))
      .toMatchObject({ decision: 'read', protected: true, reason: 'Security notice' });
    expect(decideByRules({ ...buildThread('dispatch-212'), subject: 'Suspicious activity on your account' }, { accountEmail }))
      .toMatchObject({ decision: 'read', protected: true });
  });
});

describe('mailing lists (review item 7)', () => {
  it("keeps a person's discussion-list post with People, protected", () => {
    const thread = buildThread('list-discussion');
    expect(thread.signals).toMatchObject({ isBulk: false, hasOneClickUnsubscribe: false, hasListUnsubscribe: true });
    expect(thread.signals?.listId).toContain('api-design.lists.openspec.example');
    expect(isAutomatedThread(thread)).toBe(false);
    expect(decide(thread)).toMatchObject({ decision: 'people', protected: true });
  });

  it('never makes Precedence: list or a bare List-Id alone automated or clear', () => {
    const base = buildThread('pilot-date');
    const signals = { ...base.signals!, listId: 'Team <team.lumenlabs.example>', hasListUnsubscribe: true };
    expect(decide({ ...base, signals })).toMatchObject({ decision: 'people', protected: true });
    expect(decide({ ...base, labelIds: ['INBOX', 'CATEGORY_FORUMS'], signals })).toMatchObject({ decision: 'people', protected: true });
  });

  it('still clears a list that is bulk by Precedence or one-click unsubscribe', () => {
    const base = buildThread('list-discussion');
    expect(decide({ ...base, signals: { ...base.signals!, isBulk: true } }).decision).toBe('clear');
    expect(decide({ ...base, signals: { ...base.signals!, hasOneClickUnsubscribe: true } }).decision).toBe('clear');
  });

  it('keeps an announcement list on the account domain as Read', () => {
    expect(rule('deploy-freeze')).toMatchObject({ decision: 'read', protected: false, reason: 'Internal announcement' });
    expect(isListAddressSender('eng-announce@northwind.example', 'Eng Announce <eng-announce.northwind.example>')).toBe(true);
    expect(isListAddressSender('daniel.okafor@northwind.example', 'Eng Announce <eng-announce.northwind.example>')).toBe(false);
    // A colleague posting to an internal discussion group is a person.
    const colleague = { ...buildThread('deploy-freeze'), senderEmail: 'daniel.okafor@northwind.example', senderNames: ['Daniel Okafor'] };
    expect(decide(colleague)).toMatchObject({ decision: 'people', protected: true });
  });
});

describe('invitations whose state cannot be read (second review, item 1)', () => {
  it('keeps an attachment-only ICS from an automated sender as a protected event', () => {
    const thread = buildThread('scheduler-invite');
    expect(thread.signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: false, inviteStateKnown: false });
    expect(isAutomatedThread(thread)).toBe(true);
    const decision = decide(thread);
    expect(decision).toMatchObject({ decision: 'event', protected: true });
    // The model cannot move it, and it never joins a group action.
    for (const target of ['clear', 'later', 'unsubscribe', 'read', 'automated']) {
      expect(applyModelRefinement(decision, { decision: target })).toBe(decision);
    }
    expect(isBatchEligible(decision)).toBe(false);
  });

  it('treats invites stored before inviteStateKnown existed as unknown', () => {
    const thread = buildThread('scheduler-invite');
    const { inviteStateKnown: _known, ...legacySignals } = thread.signals!;
    expect(decide({ ...thread, signals: legacySignals })).toMatchObject({ decision: 'event', protected: true });
  });

  it('lets an answered, readable invite fall through to the other rules', () => {
    const thread = buildThread('scheduler-invite');
    const answered = { ...thread, signals: { ...thread.signals!, inviteStateKnown: true, inviteNeedsAnswer: false } };
    expect(decide(answered).decision).toBe('automated');
  });

  it('marks the state known when the ICS is inline and decodable', () => {
    expect(buildThread('invite-weekly').signals).toMatchObject({ inviteStateKnown: true, inviteNeedsAnswer: true });
    expect(buildThread('pilot-date').signals?.inviteStateKnown).toBe(false);
  });
});

describe('security subjects (review item 10)', () => {
  const person = buildThread('pilot-date');
  const notifier = buildThread('nw-1432');

  it.each([
    'Security alert for your account',
    'Your one-time code is 448812',
    'One time passcode for sign up',
    'Unusual activity detected',
    'New device signed in to your account',
    '2-step verification is now on',
    'Two-step verification turned off',
    'Two-factor authentication enabled',
    'Multi-factor authentication required',
    'Your MFA settings changed',
    'A passkey was added to your account',
  ])('treats "%s" as a security notice from anyone', subject => {
    expect(decide({ ...person, subject })).toMatchObject({ decision: 'read', protected: true, reason: 'Security notice' });
    expect(decide({ ...notifier, subject })).toMatchObject({ decision: 'read', protected: true });
  });

  it.each(['New login to your account', 'Log-in attempt blocked', 'Verify your email address', 'Please confirm your email address'])(
    'treats "%s" as a notice only from an automated or security sender',
    subject => {
      expect(decide({ ...notifier, subject })).toMatchObject({ decision: 'read', protected: true, reason: 'Security notice' });
      expect(isSecurityNotice({ ...person, subject })).toBe(false);
      expect(decide({ ...person, subject })).toMatchObject({ decision: 'people', protected: true });
      expect(isSecurityNotice({ ...person, subject, senderEmail: 'security@lumenlabs.example' })).toBe(true);
    },
  );

  it('matches on word boundaries only', () => {
    for (const subject of ['Blogging tips', 'Logins page redesign review', 'Newdevice launch', 'Unusual activityboard', 'MFAQ roundup', 'Passkeyboard demo']) {
      expect(isSecurityNotice({ ...notifier, subject })).toBe(false);
    }
  });
});

describe('sender helpers', () => {
  it('matches automated local parts on word boundaries', () => {
    for (const email of ['comments-noreply@x.example', 'notifications-noreply@x.example', 'security-noreply@x.example',
      'NoReply@x.example', 'no-reply@x.example', 'no_reply@x.example', 'do-not-reply@x.example', 'mailer-daemon@x.example',
      'billing+eu@x.example', 'team.updates@x.example', 'eng-announce@x.example', 'announcements@x.example']) {
      expect(hasAutomatedLocalPart(email)).toBe(true);
    }
    for (const email of ['information@x.example', 'newsroom@x.example', 'nora.petrov@x.example', 'shelloworld@x.example', 'no@x.example']) {
      expect(hasAutomatedLocalPart(email)).toBe(false);
    }
  });

  it('compares registrable domains', () => {
    expect(registrableDomain('noreply@status.northwind.example')).toBe('northwind.example');
    expect(registrableDomain('a@mail.example.co.uk')).toBe('example.co.uk');
    expect(isOwnDomainSender('noreply@status.northwind.example', accountEmail)).toBe(true);
    expect(isOwnDomainSender('x@codeforge.example', accountEmail)).toBe(false);
    expect(isOwnDomainSender('x@other.co.uk', 'me@mine.co.uk')).toBe(false);
  });

  it('never treats a free-mail provider as the account domain (review item 9)', () => {
    for (const domain of ['gmail.com', 'googlemail.com', 'outlook.com', 'hotmail.com', 'live.com', 'yahoo.com', 'yahoo.co.uk',
      'icloud.com', 'me.com', 'proton.me', 'protonmail.com', 'gmx.de', 'gmx.net', 'mail.ru', 'yandex.ru', 'yandex.com']) {
      expect(isFreeMailDomain(domain)).toBe(true);
      expect(isOwnDomainSender(`newsletter@${domain}`, `someone@${domain}`)).toBe(false);
    }
    expect(isFreeMailDomain('northwind.example')).toBe(false);
    // An automated gmail.com sender is not an internal announcement for a gmail.com account.
    const thread = { ...buildThread('dispatch-212'), senderEmail: 'hello@gmail.com' };
    expect(decide(thread, 'alex@gmail.com').decision).toBe('clear');
  });
});

describe('applyModelRefinement', () => {
  const people = rule('pilot-date');
  const automated = rule('pr-482');
  const clear = rule('dispatch-212');
  const event = rule('invite-weekly');
  const security = rule('sso-signin');

  it('allows the SPEC transitions', () => {
    expect(applyModelRefinement(people, { decision: 'reply', reason: 'Asks to move the pilot' }))
      .toMatchObject({ decision: 'reply', source: 'model', protected: true, reason: 'Asks to move the pilot' });
    expect(applyModelRefinement(people, { decision: 'read' }).decision).toBe('read');
    for (const target of ['later', 'clear', 'read'] as const) {
      expect(applyModelRefinement(automated, { decision: target }).decision).toBe(target);
    }
    for (const target of ['later', 'read'] as const) {
      expect(applyModelRefinement(clear, { decision: target }).decision).toBe(target);
    }
  });

  it('rejects other transitions', () => {
    expect(applyModelRefinement(people, { decision: 'clear' })).toBe(people);
    expect(applyModelRefinement(automated, { decision: 'unsubscribe' })).toBe(automated);
    expect(applyModelRefinement(clear, { decision: 'unsubscribe' })).toBe(clear);
    expect(applyModelRefinement(rule('fieldnote-promo'), { decision: 'clear' })).toBe(rule('fieldnote-promo'));
    expect(applyModelRefinement(rule('deploy-freeze'), { decision: 'clear' })).toBe(rule('deploy-freeze'));
  });

  it('never moves a protected thread into clear, unsubscribe or later', () => {
    for (const key of [...PEOPLE_KEYS, ...INVITE_KEYS, ...SECURITY_KEYS]) {
      const base = rule(key);
      for (const target of ['clear', 'unsubscribe', 'later']) {
        expect(applyModelRefinement(base, { decision: target, laterAt: '2026-10-11T09:00:00.000Z' })).toBe(base);
      }
    }
    // Even if a protected decision were in a refinable section.
    const protectedAutomated: ThreadDecision = { ...automated, protected: true };
    expect(applyModelRefinement(protectedAutomated, { decision: 'clear' })).toBe(protectedAutomated);
    expect(applyModelRefinement(protectedAutomated, { decision: 'read' })).toMatchObject({ decision: 'read', protected: true });
  });

  it('never touches event', () => {
    for (const target of ['reply', 'read', 'event', 'later', 'clear', 'unsubscribe', 'people', 'automated']) {
      expect(applyModelRefinement(event, { decision: target, reason: 'x' })).toBe(event);
    }
    expect(applyModelRefinement(security, { decision: 'reply' })).toBe(security);
  });

  it('falls back to the rule decision on garbage', () => {
    for (const garbage of [null, undefined, 42, 'clear', [], ['clear'], {}, { decision: 'archive' }, { decision: 7 },
      { decision: 'read', reason: 12 }, { decision: 'later', laterAt: 'not a date' }, { decision: 'later', laterAt: 5 }]) {
      expect(applyModelRefinement(automated, garbage)).toBe(automated);
    }
  });

  it('truncates the reason to 120 characters and normalizes laterAt', () => {
    const refined = applyModelRefinement(automated, {
      decision: 'later', reason: `  ${'word '.repeat(60)}  `, laterAt: '2026-10-11T09:00:00+02:00',
    });
    expect(refined.reason.length).toBeLessThanOrEqual(120);
    expect(refined.reason.endsWith('…')).toBe(true);
    expect(refined.laterAt).toBe('2026-10-11T07:00:00.000Z');
    expect(applyModelRefinement(automated, { decision: 'read', laterAt: '2026-10-11T09:00:00Z' }).laterAt).toBeNull();
  });

  it('does not override a user correction', () => {
    const corrected = applyUserCorrection(automated, 'read');
    expect(applyModelRefinement(corrected, { decision: 'clear' })).toBe(corrected);
  });
});

describe('applyUserCorrection and resolveThreadDecision', () => {
  it('records a manual move and keeps protected', () => {
    const corrected = applyUserCorrection(rule('pilot-date'), 'clear');
    expect(corrected).toMatchObject({ decision: 'clear', source: 'user', protected: true });
    expect(isBatchEligible(corrected)).toBe(false);
    expect(applyUserCorrection(rule('pilot-date'), 'bogus')).toBe(rule('pilot-date'));
    expect(applyUserCorrection(rule('pr-482'), 'later', { laterAt: '2026-10-11T09:00:00Z' }).laterAt).toBe('2026-10-11T09:00:00.000Z');
  });

  it('uses a cached record only while the last message is unchanged', () => {
    const thread = buildThread('pr-482');
    const lastMessageId = thread.signals?.lastMessageId ?? null;
    expect(lastMessageId).toBe('pr-482-m0');
    const record = { lastMessageId, decision: 'clear' as const, reason: 'Review done by others', source: 'model' as const, laterAt: null };
    expect(resolveThreadDecision(thread, { accountEmail }, record)).toMatchObject({ decision: 'clear', source: 'model' });
    expect(resolveThreadDecision(thread, { accountEmail }, { ...record, lastMessageId: 'older' }).source).toBe('rule');
    expect(resolveThreadDecision(thread, { accountEmail }, { ...record, source: 'user', decision: 'people' }))
      .toMatchObject({ decision: 'people', source: 'user' });
    // A cached model record is re-validated: it cannot sweep a person's thread.
    const personThread = buildThread('pilot-date');
    expect(resolveThreadDecision(personThread, { accountEmail }, {
      ...record, lastMessageId: personThread.signals?.lastMessageId ?? null,
    }).decision).toBe('people');
  });
});

describe('sections', () => {
  it('orders sections per mode', () => {
    expect(sectionOrder(true)).toEqual(['reply', 'read', 'event', 'later', 'clear', 'unsubscribe']);
    expect(sectionOrder(false)).toEqual(['people', 'read', 'event', 'automated', 'clear', 'unsubscribe']);
  });

  it('groups threads, skips empty sections and sorts newest first', () => {
    const entries = threads.map(thread => ({ thread, decision: rule(thread.id) }));
    const sections = groupThreadsByDecision(entries, false);
    expect(sections.map(section => section.decision)).toEqual(['people', 'read', 'event', 'automated', 'clear', 'unsubscribe']);
    expect(sections.reduce((sum, section) => sum + section.entries.length, 0)).toBe(28);
    for (const section of sections) {
      const times = section.entries.map(entry => Date.parse(entry.thread.lastMessageAt));
      expect([...times].sort((a, b) => b - a)).toEqual(times);
    }
  });

  it('keeps not-yet-refined people right after Reply instead of dropping them to the bottom', () => {
    const at = (minute: number) => ({ lastMessageAt: `2026-10-10T10:${String(minute).padStart(2, '0')}:00.000Z` });
    const sections = groupThreadsByDecision([
      { thread: at(1), decision: rule('pilot-date') },
      { thread: at(2), decision: applyModelRefinement(rule('pilot-date'), { decision: 'reply' }) },
      { thread: at(3), decision: rule('dispatch-212') },
    ], true);
    expect(sections.map(section => section.decision)).toEqual(['reply', 'people', 'clear']);
  });

  it('allows group actions only for unprotected clear and later', () => {
    expect(isBatchEligible(rule('dispatch-212'))).toBe(true);
    expect(isBatchEligible(applyModelRefinement(rule('pr-482'), { decision: 'later' }))).toBe(true);
    for (const key of ['pr-482', 'fieldnote-promo', 'deploy-freeze', 'pilot-date', 'invite-weekly', 'sso-signin']) {
      expect(isBatchEligible(rule(key))).toBe(false);
    }
    expect(isBatchEligible({ ...rule('dispatch-212'), protected: true })).toBe(false);
  });
});

describe('thread signal extraction', () => {
  function message(partial: Partial<MailMessage>): MailMessage {
    return {
      id: 'm1', threadId: 't1', accountId: accountEmail, senderName: 'Sender', senderEmail: 'sender@x.example',
      subject: 'Subject', snippet: '', receivedAt: '2026-10-10T10:00:00.000Z', labelIds: ['INBOX'],
      hasAttachments: false, isUnread: false, to: [], cc: [], bcc: [], attachments: [], headers: [], ...partial,
    };
  }
  const invite = { uid: 'u1@x.example', summary: 'Sync', organizer: { name: 'Org', email: 'org@x.example' } };

  it('reads list headers', () => {
    const signals = computeThreadSignals([message({ headers: [
      { name: 'list-id', value: ' Team <team.x.example> ' },
      { name: 'List-Unsubscribe', value: '<mailto:u@x.example>, <https://x.example/u>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ] })], accountEmail);
    expect(signals).toMatchObject({ listId: 'Team <team.x.example>', hasListUnsubscribe: true, hasOneClickUnsubscribe: true });
  });

  it('requires an https URI for one-click unsubscribe', () => {
    expect(computeThreadSignals([message({ headers: [
      { name: 'List-Unsubscribe', value: '<mailto:u@x.example>' },
      { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
    ] })], accountEmail)).toMatchObject({ hasListUnsubscribe: true, hasOneClickUnsubscribe: false });
    expect(computeThreadSignals([message({ headers: [{ name: 'List-Unsubscribe', value: '<https://x.example/u>' }] })], accountEmail))
      .toMatchObject({ hasListUnsubscribe: true, hasOneClickUnsubscribe: false });
  });

  it('reads Precedence', () => {
    for (const value of ['bulk', 'Junk', 'junk']) {
      expect(computeThreadSignals([message({ headers: [{ name: 'Precedence', value }] })], accountEmail).isBulk).toBe(true);
    }
    // Discussion lists set `Precedence: list` on people's posts too.
    for (const value of ['first-class', 'list', 'List']) {
      expect(computeThreadSignals([message({ headers: [{ name: 'Precedence', value }] })], accountEmail).isBulk).toBe(false);
    }
  });

  it('reads Auto-Submitted', () => {
    expect(computeThreadSignals([message({ headers: [{ name: 'Auto-Submitted', value: 'auto-generated' }] })], accountEmail).isAutoSubmitted).toBe(true);
    expect(computeThreadSignals([message({ headers: [{ name: 'Auto-Submitted', value: 'auto-replied; owner-email=a@x.example' }] })], accountEmail).isAutoSubmitted).toBe(true);
    expect(computeThreadSignals([message({ headers: [{ name: 'Auto-Submitted', value: 'no' }] })], accountEmail).isAutoSubmitted).toBe(false);
  });

  it('reads list headers from the latest message not sent by the account', () => {
    const signals = computeThreadSignals([
      message({ id: 'a', headers: [{ name: 'Precedence', value: 'bulk' }] }),
      message({ id: 'b', senderEmail: accountEmail, labelIds: ['SENT'] }),
    ], accountEmail);
    expect(signals).toMatchObject({ isBulk: true, fromUser: true, lastMessageId: 'b' });
  });

  it('detects fromUser by address (any case) or SENT label', () => {
    expect(computeThreadSignals([message({ senderEmail: 'Alex.Morgan@Northwind.example' })], accountEmail).fromUser).toBe(true);
    expect(computeThreadSignals([message({ senderEmail: 'alias@northwind.example', labelIds: ['SENT'] })], accountEmail).fromUser).toBe(true);
    expect(computeThreadSignals([
      message({ id: 'a', senderEmail: accountEmail }),
      message({ id: 'b' }),
    ], accountEmail).fromUser).toBe(false);
    expect(buildThread('redlines').signals?.fromUser).toBe(false);
  });

  it('flags a REQUEST invite awaiting the account answer', () => {
    const signals = computeThreadSignals([message({ attachments: [icsAttachment(inviteIcs(invite))] })], accountEmail);
    expect(signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: true });
    expect(buildThread('invite-weekly').signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: true });
  });

  it('does not flag answered, cancelled or reply invites', () => {
    for (const ics of [
      inviteIcs(invite, WORK_ACCOUNT, { partstat: 'ACCEPTED' }),
      inviteIcs(invite, WORK_ACCOUNT, { method: 'CANCEL' }),
      inviteIcs(invite, WORK_ACCOUNT, { method: 'REPLY', partstat: 'DECLINED' }),
    ]) {
      const signals = computeThreadSignals([message({ attachments: [icsAttachment(ics)] })], accountEmail);
      expect(signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: false });
    }
  });

  it('treats a REQUEST without the account as attendee, or without PARTSTAT, as needing an answer', () => {
    const other = inviteIcs(invite, { name: 'Someone', email: 'someone@x.example' }, { partstat: 'ACCEPTED' });
    expect(computeThreadSignals([message({ attachments: [icsAttachment(other)] })], accountEmail).inviteNeedsAnswer).toBe(true);
    const noPartstat = inviteIcs(invite, WORK_ACCOUNT, { partstat: null });
    expect(readIcsInviteState(noPartstat, accountEmail)).toEqual({ method: 'REQUEST', accountPartstat: 'NEEDS-ACTION' });
  });

  it('uses only the latest invite in the thread', () => {
    const signals = computeThreadSignals([
      message({ id: 'a', attachments: [icsAttachment(inviteIcs(invite))] }),
      message({ id: 'b', attachments: [icsAttachment(inviteIcs(invite, WORK_ACCOUNT, { method: 'CANCEL' }))] }),
      message({ id: 'c' }),
    ], accountEmail);
    expect(signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: false });
  });

  it('reads PARTSTAT from folded attendee lines', () => {
    const folded = 'BEGIN:VCALENDAR\r\nMETHOD:REQUEST\r\nBEGIN:VEVENT\r\nATTENDEE;CN=Alex;PARTSTAT=TENTA\r\n TIVE:mailto:alex.morgan@northwind.example\r\nEND:VEVENT\r\nEND:VCALENDAR';
    expect(readIcsInviteState(folded, accountEmail)).toEqual({ method: 'REQUEST', accountPartstat: 'TENTATIVE' });
  });

  it('marks an undecodable invite as present but not awaiting an answer', () => {
    const signals = computeThreadSignals([message({ attachments: [{
      id: 'x', filename: 'invite.ics', mimeType: 'application/ics', sizeBytes: 9000, attachmentId: 'remote',
    }] })], accountEmail);
    expect(signals).toMatchObject({ hasCalendarInvite: true, inviteNeedsAnswer: false });
  });
});
