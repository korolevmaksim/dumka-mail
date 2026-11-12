import { describe, expect, it } from 'vitest';
import type { MailThread, UnsubscribeCandidate } from '../shared/types';
import {
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

function thread(id: string, senderEmail: string, labelIds: string[], accountId = ACCOUNT): MailThread {
  return { id, accountId, senderEmail, labelIds } as unknown as MailThread;
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
