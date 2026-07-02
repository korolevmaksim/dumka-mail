import { describe, expect, it } from 'vitest';
import {
  evaluateMailRules,
  mailAutomationRuleMatchesThread,
  mailRuleActionLogId,
  normalizeMailRulesSettings,
} from '../shared/mailRules';
import type { MailAutomationRule, MailThread } from '../shared/types';

const thread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Invoice for July',
  snippet: 'Your invoice is ready',
  lastMessageAt: '2026-07-02T10:00:00.000Z',
  senderNames: ['Billing'],
  senderEmail: 'billing@vendor.com',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: true,
  isUnread: true,
};

function rule(partial: Partial<MailAutomationRule> = {}): MailAutomationRule {
  return {
    id: 'receipts',
    title: 'Receipts',
    isEnabled: true,
    accountId: 'me@example.com',
    matchMode: 'all',
    conditions: [{
      id: 'condition-1',
      field: 'senderDomain',
      operation: 'equals',
      value: 'vendor.com',
      isNegated: false,
      accountId: 'me@example.com',
    }],
    actions: [{ id: 'archive', type: 'archive' }],
    ...partial,
  };
}

describe('mail automation rules', () => {
  it('matches enabled scoped rules against category-engine conditions', () => {
    expect(mailAutomationRuleMatchesThread(rule(), thread)).toBe(true);
    expect(mailAutomationRuleMatchesThread(rule({ accountId: 'other@example.com' }), thread)).toBe(false);
    expect(mailAutomationRuleMatchesThread(rule({ isEnabled: false }), thread)).toBe(false);
  });

  it('evaluates archive, label, forward, and auto-reply actions for matching rules', () => {
    const effects = evaluateMailRules(thread, {
      enabled: true,
      rules: [
        rule({
          actions: [
            { id: 'archive', type: 'archive' },
            { id: 'label', type: 'applyLabel', labelId: 'Label_123' },
            { id: 'forward', type: 'forward', forwardTo: 'ops@example.com' },
            { id: 'auto-reply', type: 'autoReply', replyBody: 'I am away today.' },
          ],
        }),
      ],
    });

    expect(effects.map(effect => effect.action.type)).toEqual(['archive', 'applyLabel', 'forward', 'autoReply']);
  });

  it('skips incomplete label, forward, and auto-reply actions', () => {
    const effects = evaluateMailRules(thread, {
      enabled: true,
      rules: [
        rule({
          actions: [
            { id: 'missing-label', type: 'applyLabel' },
            { id: 'missing-forward', type: 'forward' },
            { id: 'missing-reply', type: 'autoReply', replyBody: '   ' },
          ],
        }),
      ],
    });

    expect(effects).toEqual([]);
  });

  it('creates stable action-log ids that include action target', () => {
    expect(mailRuleActionLogId(rule(), { id: 'archive', type: 'archive' }, thread)).toBe(
      'mail-rule:receipts:me@example.com:thread-1:archive:archive',
    );
    expect(mailRuleActionLogId(rule(), { id: 'label', type: 'applyLabel', labelId: 'Label 123' }, thread)).toBe(
      'mail-rule:receipts:me@example.com:thread-1:applylabel:label-123',
    );
    expect(mailRuleActionLogId(rule(), { id: 'reply-vacation', type: 'autoReply', replyBody: 'Thanks' }, thread)).toBe(
      'mail-rule:receipts:me@example.com:thread-1:autoreply:reply-vacation',
    );
  });

  it('normalizes persisted settings and drops empty rules', () => {
    const normalized = normalizeMailRulesSettings({
      enabled: true,
      rules: [
        rule({ id: '', title: '', conditions: [], actions: [{ id: 'archive', type: 'archive' }] }),
        rule({ id: 'valid' }),
      ],
    });

    expect(normalized).toEqual({
      enabled: true,
      rules: [expect.objectContaining({ id: 'valid', title: 'Receipts' })],
    });
  });

  it('normalizes auto-reply action body from persisted settings', () => {
    const normalized = normalizeMailRulesSettings({
      enabled: true,
      rules: [
        rule({
          actions: [{ id: 'reply', type: 'autoReply', replyBody: 'I am out today.' }],
        }),
      ],
    });

    expect(normalized.rules[0].actions[0]).toEqual({
      id: 'reply',
      type: 'autoReply',
      replyBody: 'I am out today.',
    });
  });
});
