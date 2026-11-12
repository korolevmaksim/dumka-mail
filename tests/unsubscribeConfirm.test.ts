import { describe, expect, it } from 'vitest';
import type { MailThread, ThreadDecisionRecord, ThreadSignals, UnsubscribeCandidate } from '../shared/types';
import { EMPTY_THREAD_SIGNALS } from '../shared/threadSignals';
import {
  isArchivableAfterUnsubscribe,
  planArchiveAfterUnsubscribe,
  UNSUBSCRIBE_IRREVERSIBLE_NOTICE,
  describeUnsubscribeMethod,
  selectThreadsToArchiveAfterUnsubscribe,
  unsubscribeOutcomeFeedback,
  unsubscribeSheetTitle,
  unsubscribeTargetFromCandidate,
  type UnsubscribeTarget,
} from '../shared/unsubscribeConfirm';

const ACCOUNT = 'alex.morgan@northwind.example';

function target(overrides: Partial<UnsubscribeTarget> = {}): UnsubscribeTarget {
  return {
    accountId: ACCOUNT,
    threadId: 'promo-1',
    sourceMessageId: 'msg-1',
    senderName: 'Brightcart Deals',
    senderEmail: 'deals@brightcart.example',
    method: { kind: 'httpPost', url: 'https://brightcart.example/u/1', isOneClick: true },
    ...overrides,
  };
}

const NEWSLETTER: Partial<ThreadSignals> = { hasListUnsubscribe: true, hasOneClickUnsubscribe: true, isBulk: true };

function thread(
  id: string,
  senderEmail: string,
  labelIds: string[],
  accountId = ACCOUNT,
  extra: { subject?: string; senderNames?: string[]; signals?: Partial<ThreadSignals> } = {},
): MailThread {
  return {
    id, accountId, senderEmail, labelIds,
    subject: extra.subject ?? 'This week at Brightcart',
    senderNames: extra.senderNames ?? ['Brightcart Deals'],
    lastMessageAt: '2026-10-10T12:00:00.000Z',
    signals: { ...EMPTY_THREAD_SIGNALS, ...NEWSLETTER, lastMessageId: `${id}-m1`, ...extra.signals },
  } as unknown as MailThread;
}

describe('unsubscribe confirmation', () => {
  it('carries the exact reviewed message and method from the candidate', () => {
    const candidate: UnsubscribeCandidate = {
      accountId: ACCOUNT,
      threadId: 'promo-1',
      messageId: 'msg-1',
      senderEmail: 'deals@brightcart.example',
      senderName: 'Brightcart Deals',
      methods: [],
      recommendedMethod: { kind: 'mailto', url: 'mailto:leave@brightcart.example', isOneClick: false, email: 'leave@brightcart.example' },
      canOneClick: false,
    };
    expect(unsubscribeTargetFromCandidate(candidate)).toMatchObject({ sourceMessageId: 'msg-1', threadId: 'promo-1' });
    expect(unsubscribeTargetFromCandidate({ ...candidate, recommendedMethod: null })).toBeNull();
  });

  it('names the method: one-click, mailto, or web link', () => {
    expect(describeUnsubscribeMethod({ kind: 'httpPost', url: 'https://x.example', isOneClick: true })).toBe('One-click');
    expect(describeUnsubscribeMethod({ kind: 'mailto', url: 'mailto:a@x.example', isOneClick: false, email: 'a@x.example' })).toBe('Email to a@x.example');
    expect(describeUnsubscribeMethod({ kind: 'httpGet', url: 'https://x.example', isOneClick: false })).toBe('Web link');
  });

  it('titles the sheet for one or several senders and states it cannot be undone', () => {
    expect(unsubscribeSheetTitle([target()])).toBe('Unsubscribe from Brightcart Deals?');
    expect(unsubscribeSheetTitle([target(), target({ senderEmail: 'news@other.example' })])).toBe('Unsubscribe from 2 senders?');
    expect(UNSUBSCRIBE_IRREVERSIBLE_NOTICE).toBe('This sends a request to each sender and cannot be undone from Dumka Mail.');
  });

  it('archives every cached inbox thread of the unsubscribed sender in that account only', () => {
    const threads = [
      thread('promo-1', 'deals@brightcart.example', ['INBOX']),
      thread('promo-2', 'Deals@Brightcart.example', ['INBOX', 'UNREAD']),
      thread('promo-old', 'deals@brightcart.example', ['CATEGORY_PROMOTIONS']),
      thread('person', 'jordan.lee@northwind.example', ['INBOX']),
      thread('other-account', 'deals@brightcart.example', ['INBOX'], 'alex@morgan-family.example'),
    ];
    expect(selectThreadsToArchiveAfterUnsubscribe(threads, [target()]).map(item => item.id)).toEqual(['promo-1', 'promo-2']);
  });

  it('never archives a protected thread from the same sender', () => {
    const threads = [
      thread('promo-1', 'deals@brightcart.example', ['INBOX']),
      // Same automated address, but a security notice: protected.
      thread('password', 'deals@brightcart.example', ['INBOX'], ACCOUNT, {
        subject: 'Your password was changed', signals: { hasOneClickUnsubscribe: false, isBulk: false, hasListUnsubscribe: false },
      }),
      // An invitation from the same address, state unknown: protected event.
      thread('invite', 'deals@brightcart.example', ['INBOX'], ACCOUNT, {
        subject: 'Invitation: Store opening', signals: { hasCalendarInvite: true, inviteStateKnown: false },
      }),
    ];
    const plan = planArchiveAfterUnsubscribe(threads, [target()]);
    expect(plan.threads.map(item => item.id)).toEqual(['promo-1']);
    expect(plan.keptInInbox).toBe(2);
  });

  it("never archives a person's thread, even as the source thread", () => {
    const person = thread('person', 'jordan.lee@brightcart.example', ['INBOX', 'CATEGORY_PERSONAL'], ACCOUNT, {
      subject: 'Lunch?', senderNames: ['Jordan Lee'], signals: { hasListUnsubscribe: false, hasOneClickUnsubscribe: false, isBulk: false },
    });
    expect(isArchivableAfterUnsubscribe(person)).toBe(false);
    const plan = planArchiveAfterUnsubscribe([person], [target({ threadId: 'person', senderEmail: 'jordan.lee@brightcart.example' })]);
    expect(plan).toEqual({ threads: [], keptInInbox: 1 });
  });

  it('includes the source thread only when it is itself archivable', () => {
    const source = thread('promo-1', 'deals@brightcart.example', ['INBOX']);
    const automatedSource = thread('receipt', 'orders@brightcart.example', ['INBOX'], ACCOUNT, {
      subject: 'Your receipt', signals: { hasListUnsubscribe: false, hasOneClickUnsubscribe: false, isBulk: false },
    });
    expect(selectThreadsToArchiveAfterUnsubscribe([source], [target()]).map(item => item.id)).toEqual(['promo-1']);
    // Rule decision `automated`, not clear / unsubscribe: stays.
    expect(selectThreadsToArchiveAfterUnsubscribe([automatedSource], [target({ threadId: 'receipt', senderEmail: 'orders@brightcart.example' })])).toEqual([]);
  });

  it('excludes a thread the user moved to another section', () => {
    const moved = thread('promo-2', 'deals@brightcart.example', ['INBOX']);
    const correction = (decision: ThreadDecisionRecord['decision'], lastMessageId = 'promo-2-m1'): ThreadDecisionRecord => ({
      accountId: ACCOUNT, threadId: 'promo-2', lastMessageId, decision, reason: '', source: 'user', laterAt: null, model: null,
      createdAt: '2026-10-10T12:00:00.000Z',
    });
    const decisions = (record: ThreadDecisionRecord) => ({ [ACCOUNT]: { 'promo-2': { user: record } } });
    expect(isArchivableAfterUnsubscribe(moved, decisions(correction('read')))).toBe(false);
    expect(isArchivableAfterUnsubscribe(moved, decisions(correction('clear')))).toBe(true);
    // A correction for an older last message no longer applies.
    expect(isArchivableAfterUnsubscribe(moved, decisions(correction('read', 'promo-2-m0')))).toBe(true);
  });

  it('says how many stayed in the inbox', () => {
    expect(unsubscribeOutcomeFeedback({ succeeded: [target()], failed: [], archivedCount: 2, keptInInbox: 1 }).message)
      .toBe('Unsubscribed from Brightcart Deals. 2 conversations archived. 1 conversation that may need your attention was left in the inbox.');
    expect(unsubscribeOutcomeFeedback({ succeeded: [target()], failed: [], archivedCount: 0, keptInInbox: 2 }).message)
      .toBe('Unsubscribed from Brightcart Deals. 2 conversations that may need your attention were left in the inbox.');
  });

  it('offers Undo only for the archive', () => {
    const archived = unsubscribeOutcomeFeedback({ succeeded: [target()], failed: [], archivedCount: 2 });
    expect(archived).toEqual({ tone: 'success', message: 'Unsubscribed from Brightcart Deals. 2 conversations archived.', offerUndo: true });
    const notArchived = unsubscribeOutcomeFeedback({ succeeded: [target()], failed: [], archivedCount: 0 });
    expect(notArchived.offerUndo).toBe(false);
    expect(notArchived.message).toBe('Unsubscribed from Brightcart Deals.');
  });

  it('reports partial and total failures', () => {
    const second = target({ senderName: 'Weekly Digest', senderEmail: 'digest@news.example' });
    expect(unsubscribeOutcomeFeedback({ succeeded: [target()], failed: [second], archivedCount: 1 }).tone).toBe('warning');
    expect(unsubscribeOutcomeFeedback({ succeeded: [], failed: [second], archivedCount: 0 })).toEqual({
      tone: 'error',
      message: 'Could not unsubscribe from Weekly Digest.',
      offerUndo: false,
    });
  });
});
