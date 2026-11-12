import { describe, expect, it } from 'vitest';
import { messageCounterparty, threadRowSender } from '../shared/threadCounterparty';
import type { MailThread } from '../shared/types';

const ACCOUNT = 'alex.morgan@northwind.example';

function message(senderName: string, senderEmail: string, receivedAt: string, extra: { labelIds?: string[]; to?: { name: string; email: string }[] } = {}) {
  return { senderName, senderEmail, receivedAt, labelIds: extra.labelIds ?? ['INBOX'], to: extra.to ?? [] };
}

function thread(overrides: Partial<MailThread> = {}): MailThread {
  return {
    id: 't1',
    accountId: ACCOUNT,
    subject: 'Contract redlines v3',
    snippet: '',
    lastMessageAt: '2026-11-12T14:08:00.000Z',
    senderNames: ['Alex Morgan', 'Sofia Lindqvist'],
    senderEmail: 'sofia@harborpine.example',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: true,
    ...overrides,
  };
}

describe('messageCounterparty', () => {
  it('names the first sender when someone else started the thread', () => {
    expect(messageCounterparty([
      message('Alex Morgan', ACCOUNT, '2026-11-12T11:00:00.000Z'),
      message('Priya Raman', 'priya.raman@lumenlabs.example', '2026-11-12T10:00:00.000Z'),
    ], ACCOUNT)).toEqual({ name: 'Priya Raman', email: 'priya.raman@lumenlabs.example' });
  });

  it('names the latest other sender when the account started the thread', () => {
    expect(messageCounterparty([
      message('Alex Morgan', ACCOUNT, '2026-11-11T09:00:00.000Z', { to: [{ name: 'Sofia Lindqvist', email: 'sofia@harborpine.example' }] }),
      message('Sofia Lindqvist', 'sofia@harborpine.example', '2026-11-12T14:08:00.000Z'),
    ], ACCOUNT)).toEqual({ name: 'Sofia Lindqvist', email: 'sofia@harborpine.example' });
  });

  it('treats SENT-labelled aliases as the account and falls back to the recipient', () => {
    expect(messageCounterparty([
      message('Alex', 'alex@alias.example', '2026-11-11T09:00:00.000Z', {
        labelIds: ['SENT'],
        to: [{ name: '', email: 'tomas@brightwave.example' }],
      }),
    ], ACCOUNT)).toEqual({ name: 'tomas@brightwave.example', email: 'tomas@brightwave.example' });
  });

  it('returns null for an empty thread', () => {
    expect(messageCounterparty([], ACCOUNT)).toBeNull();
  });
});

describe('threadRowSender', () => {
  it('shows the replier, not the account, for a thread the account started', () => {
    expect(threadRowSender(thread(), { email: ACCOUNT, displayName: 'Alex Morgan' })).toBe('Sofia Lindqvist');
  });

  it('keeps the first sender when it is not the account', () => {
    expect(threadRowSender(thread({ senderNames: ['Priya Raman', 'Alex Morgan'] }), { email: ACCOUNT, displayName: 'Alex Morgan' })).toBe('Priya Raman');
  });

  it('recognises the account by address when no display name is known', () => {
    expect(threadRowSender(thread({ senderNames: [ACCOUNT, 'Sofia Lindqvist'] }))).toBe('Sofia Lindqvist');
  });

  it('falls back to the recipient when only the account has written', () => {
    expect(threadRowSender(
      thread({ senderNames: ['Alex Morgan'], senderEmail: ACCOUNT, to: [{ name: 'Tomás Ibarra', email: 'tomas@brightwave.example' }] }),
      { email: ACCOUNT, displayName: 'Alex Morgan' },
    )).toBe('Tomás Ibarra');
  });

  it('uses the address when there are no names', () => {
    expect(threadRowSender(thread({ senderNames: [], senderEmail: 'noreply@trackline.example' }))).toBe('noreply@trackline.example');
  });
});
