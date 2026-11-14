import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NO_REPLY_REMINDER_DAYS,
  evaluateNoReplyWatch,
  noReplyDaysLabel,
  noReplyReminderAt,
  parseNoReplyWatches,
  upsertNoReplyWatch,
  type NoReplyWatch,
} from '../shared/noReplyReminder';
import { EMPTY_THREAD_SIGNALS } from '../shared/threadSignals';

const ACCOUNT = 'alex.morgan@northwind.example';
const sent = new Date('2026-11-12T10:00:00.000Z');
const watch: NoReplyWatch = {
  accountId: ACCOUNT,
  threadId: 't1',
  sentAt: sent.toISOString(),
  remindAt: noReplyReminderAt(sent, 3).toISOString(),
};
const base = {
  accountId: ACCOUNT,
  senderEmail: ACCOUNT,
  lastMessageAt: '2026-11-12T10:00:10.000Z',
  reminderAt: watch.remindAt,
  signals: { ...EMPTY_THREAD_SIGNALS, fromUser: true },
};
const later = new Date('2026-11-13T08:00:00.000Z');

describe('noReplyReminderAt', () => {
  it('adds whole days and defaults to 3', () => {
    expect(noReplyReminderAt(sent, 3).toISOString()).toBe('2026-11-15T10:00:00.000Z');
    expect(noReplyReminderAt(sent, 0).getTime() - sent.getTime()).toBe(DEFAULT_NO_REPLY_REMINDER_DAYS * 86_400_000);
    expect(noReplyDaysLabel(1)).toBe('1 day');
    expect(noReplyDaysLabel(5)).toBe('5 days');
  });
});

describe('evaluateNoReplyWatch', () => {
  it('keeps watching while only our own message is in the thread', () => {
    expect(evaluateNoReplyWatch(watch, base, later)).toBe('keep');
    expect(evaluateNoReplyWatch(watch, null, later)).toBe('keep');
  });

  it('clears when someone else replies after the send', () => {
    expect(evaluateNoReplyWatch(watch, {
      ...base,
      senderEmail: 'priya.raman@lumenlabs.example',
      lastMessageAt: '2026-11-12T15:00:00.000Z',
      signals: { ...EMPTY_THREAD_SIGNALS, fromUser: false },
    }, later)).toBe('clear');
  });

  it('uses the sender address when signals are missing', () => {
    expect(evaluateNoReplyWatch(watch, {
      ...base,
      signals: undefined,
      senderEmail: 'priya.raman@lumenlabs.example',
      lastMessageAt: '2026-11-12T15:00:00.000Z',
    }, later)).toBe('clear');
  });

  it('drops the watch once the reminder is due or was changed', () => {
    expect(evaluateNoReplyWatch(watch, base, new Date('2026-11-16T00:00:00.000Z'))).toBe('drop');
    expect(evaluateNoReplyWatch(watch, { ...base, reminderAt: '2026-11-20T09:00:00.000Z' }, later)).toBe('drop');
  });
});

describe('watch storage', () => {
  it('parses only well-formed entries and replaces per thread', () => {
    expect(parseNoReplyWatches([watch, { threadId: 1 }, null])).toEqual([watch]);
    expect(parseNoReplyWatches('nope')).toEqual([]);
    const next = { ...watch, remindAt: '2026-11-19T10:00:00.000Z' };
    expect(upsertNoReplyWatch([watch], next)).toEqual([next]);
  });
});
