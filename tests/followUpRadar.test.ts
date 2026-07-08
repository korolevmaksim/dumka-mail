import { describe, expect, it } from 'vitest';
import {
  buildFollowUpRadarItem,
  buildFollowUpRadarResult,
  followUpStateKey,
} from '../shared/followUpRadar';
import type { FollowUpRadarState, MailMessage, MailThread, Recipient } from '../shared/types';

const ACCOUNT = 'me@example.com';
const NOW = new Date('2026-07-08T12:00:00.000Z');

function recipient(email: string, name = ''): Recipient {
  return { email, name };
}

function thread(partial: Partial<MailThread> = {}): MailThread {
  return {
    id: 't1',
    accountId: ACCOUNT,
    subject: 'Project update',
    snippet: 'Following up',
    lastMessageAt: '2026-07-06T08:00:00.000Z',
    senderNames: ['Me'],
    senderEmail: ACCOUNT,
    labelIds: ['SENT'],
    hasAttachments: false,
    isUnread: false,
    ...partial,
  };
}

function message(partial: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'm1',
    threadId: 't1',
    accountId: ACCOUNT,
    senderName: 'Me',
    senderEmail: ACCOUNT,
    subject: 'Project update',
    snippet: 'Can you send the latest numbers?',
    receivedAt: '2026-07-06T08:00:00.000Z',
    labelIds: ['SENT'],
    hasAttachments: false,
    isUnread: false,
    to: [recipient('alex@example.com', 'Alex')],
    cc: [],
    bcc: [],
    bodyPlain: 'Can you send the latest numbers?',
    attachments: [],
    ...partial,
  };
}

function state(partial: Partial<FollowUpRadarState> = {}): FollowUpRadarState {
  return {
    accountId: ACCOUNT,
    threadId: 't1',
    sentMessageId: 'm1',
    status: 'dismissed',
    snoozedUntil: null,
    createdAt: '2026-07-08T00:00:00.000Z',
    updatedAt: '2026-07-08T00:00:00.000Z',
    ...partial,
  };
}

describe('buildFollowUpRadarItem', () => {
  it('creates a candidate when the latest active message is an old outbound sent message', () => {
    const item = buildFollowUpRadarItem({
      thread: thread(),
      messages: [message()],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
    });

    expect(item?.id).toBe(followUpStateKey(ACCOUNT, 't1', 'm1'));
    expect(item?.recipientLine).toContain('Alex');
    expect(item?.priority).toBeGreaterThanOrEqual(70);
    expect(item?.reason).toContain('asks for a response');
  });

  it('uses the SENT label as outbound evidence even when an alias sent the message', () => {
    const item = buildFollowUpRadarItem({
      thread: thread({ senderEmail: 'alias@example.com' }),
      messages: [message({ senderEmail: 'alias@example.com', labelIds: ['SENT'] })],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
    });

    expect(item?.sentMessageId).toBe('m1');
  });

  it('does not create a candidate when an inbound reply arrives after the sent message', () => {
    const item = buildFollowUpRadarItem({
      thread: thread({ lastMessageAt: '2026-07-07T08:00:00.000Z', senderEmail: 'alex@example.com' }),
      messages: [
        message(),
        message({
          id: 'm2',
          senderName: 'Alex',
          senderEmail: 'alex@example.com',
          receivedAt: '2026-07-07T08:00:00.000Z',
          labelIds: ['INBOX'],
          to: [recipient(ACCOUNT)],
          bodyPlain: 'Here are the numbers.',
        }),
      ],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 24,
    });

    expect(item).toBeNull();
  });

  it('hides dismissed and future-snoozed exact sent-message candidates', () => {
    const dismissed = buildFollowUpRadarItem({
      thread: thread(),
      messages: [message()],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
      state: state({ status: 'dismissed' }),
    });
    const snoozed = buildFollowUpRadarItem({
      thread: thread(),
      messages: [message()],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
      state: state({ status: 'snoozed', snoozedUntil: '2026-07-09T12:00:00.000Z' }),
    });

    expect(dismissed).toBeNull();
    expect(snoozed).toBeNull();
  });

  it('shows expired snoozed items again', () => {
    const item = buildFollowUpRadarItem({
      thread: thread(),
      messages: [message()],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
      state: state({ status: 'snoozed', snoozedUntil: '2026-07-07T12:00:00.000Z' }),
    });

    expect(item?.sentMessageId).toBe('m1');
  });

  it('requires at least one external recipient', () => {
    const item = buildFollowUpRadarItem({
      thread: thread(),
      messages: [message({ to: [recipient(ACCOUNT)] })],
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 48,
    });

    expect(item).toBeNull();
  });
});

describe('buildFollowUpRadarResult', () => {
  it('orders by priority and applies max item limits', () => {
    const result = buildFollowUpRadarResult({
      accountId: ACCOUNT,
      now: NOW,
      thresholdHours: 24,
      maxItems: 1,
      threadsWithMessages: [
        {
          thread: thread({ id: 'low', subject: 'FYI', snippet: 'Receipt', lastMessageAt: '2026-07-06T08:00:00.000Z' }),
          messages: [message({ id: 'low-message', threadId: 'low', subject: 'Receipt', snippet: 'Receipt', bodyPlain: 'Receipt attached' })],
        },
        {
          thread: thread({ id: 'high', subject: 'Need approval', snippet: 'Please approve', lastMessageAt: '2026-07-01T08:00:00.000Z' }),
          messages: [message({ id: 'high-message', threadId: 'high', receivedAt: '2026-07-01T08:00:00.000Z', bodyPlain: 'Please approve this when you can?' })],
        },
      ],
    });

    expect(result.scannedThreadCount).toBe(2);
    expect(result.candidateCount).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].threadId).toBe('high');
    expect(result.warnings[0]).toContain('locally cached sent mail');
  });
});
