import { describe, expect, it } from 'vitest';
import { buildDoneSummary, doneSummaryLines, hasDoneSummaryActivity } from '../shared/doneSummary';
import type { MailActionLog } from '../shared/types';

const ACCOUNT = 'alex.morgan@northwind.example';
const OTHER = 'alex@personal.example';
const now = new Date(2026, 10, 12, 18, 0);
const today = (hour: number, minute = 0) => new Date(2026, 10, 12, hour, minute).toISOString();
const yesterday = new Date(2026, 10, 11, 18, 0).toISOString();

let counter = 0;
function log(kind: MailActionLog['kind'], overrides: Partial<MailActionLog> = {}): MailActionLog {
  counter += 1;
  return { id: `a${counter}`, accountId: ACCOUNT, threadId: `t${counter}`, kind, status: 'completed', createdAt: today(9), ...overrides };
}

describe('buildDoneSummary', () => {
  it('counts today’s sends, archives, Later and unsubscribes for the account', () => {
    const summary = buildDoneSummary([
      log('send'),
      log('send', { status: 'pending_sync' }),
      log('markDone', { threadId: 'x1' }),
      log('markDone', { threadId: 'x2' }),
      log('setReminder', { threadId: 'l1' }),
      log('autoMarkRead', { threadId: 'l2', payloadJson: JSON.stringify({ reminderAt: today(20) }) }),
      log('unsubscribeSender', { threadId: 'u1' }),
      log('markDone', { threadId: 'old', createdAt: yesterday }),
      log('markDone', { threadId: 'other', accountId: OTHER }),
      log('send', { status: 'failed' }),
    ], { now, accountIds: [ACCOUNT] });
    expect(summary).toEqual({ repliesSent: 2, archived: 2, movedToLater: 2, unsubscribed: 1 });
  });

  it('does not count an archive or Later that was undone', () => {
    const summary = buildDoneSummary([
      log('markDone', { threadId: 'x1', createdAt: today(9) }),
      log('restoreInbox', { threadId: 'x1', createdAt: today(9, 1) }),
      log('setReminder', { threadId: 'l1', createdAt: today(10) }),
      log('clearReminder', { threadId: 'l1', createdAt: today(10, 1) }),
      log('markDone', { threadId: 'x2', createdAt: today(11) }),
    ], { now });
    expect(summary).toMatchObject({ archived: 1, movedToLater: 0 });
  });

  it('ignores scheduled sends that have not gone out and autoMarkRead without a reminder', () => {
    const summary = buildDoneSummary([
      log('send', { status: 'pending_sync', scheduledAt: new Date(2026, 10, 13, 9).toISOString() }),
      log('autoMarkRead', { payloadJson: JSON.stringify({ auto: true }) }),
    ], { now });
    expect(summary).toEqual({ repliesSent: 0, archived: 0, movedToLater: 0, unsubscribed: 0 });
    expect(hasDoneSummaryActivity(summary)).toBe(false);
  });

  it('counts unsubscribes per sender when the payload names one', () => {
    const payloadJson = JSON.stringify({ senderEmail: 'news@fieldnote.example' });
    const summary = buildDoneSummary([
      log('unsubscribeSender', { threadId: 'a', payloadJson }),
      log('unsubscribeSender', { threadId: 'b', payloadJson }),
      log('unsubscribeSender', { threadId: 'c', status: 'running' }),
    ], { now });
    expect(summary.unsubscribed).toBe(1);
  });
});

describe('doneSummaryLines', () => {
  it('lists only non-zero lines with singular and plural copy', () => {
    expect(doneSummaryLines({ repliesSent: 1, archived: 3, movedToLater: 0, unsubscribed: 2 })).toEqual([
      { id: 'repliesSent', count: 1, text: 'reply sent' },
      { id: 'archived', count: 3, text: 'conversations archived' },
      { id: 'unsubscribed', count: 2, text: 'senders unsubscribed' },
    ]);
  });
});
