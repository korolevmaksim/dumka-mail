import { describe, it, expect } from 'vitest';
import { ruleMatches, categorize } from '../shared/categoryEngine';
import type {
  MailThread,
  MailCategoryRule,
  BuiltInMailCategorySettings,
  CustomMailCategorySettings,
} from '../shared/types';

const baseThread: MailThread = {
  id: 't1',
  accountId: 'me@gmail.com',
  subject: 'Normal Email',
  snippet: 'This is a normal email snippet',
  lastMessageAt: new Date('2026-06-26T14:30:00Z').toISOString(),
  senderNames: ['John Doe'],
  senderEmail: 'john@example.com',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
};

function rule(partial: Partial<MailCategoryRule>): MailCategoryRule {
  return {
    id: 'r',
    field: 'subject',
    operation: 'contains',
    value: '',
    isNegated: false,
    ...partial,
  };
}

/** Built-in settings with every kind enabled and no extra rules (Swift default). */
function defaultBuiltIn(): BuiltInMailCategorySettings[] {
  return ['important', 'purchases', 'linkedIn', 'automation', 'other'].map(id => ({
    id,
    title: id,
    isEnabled: true,
    matchMode: 'any',
    extraRules: [],
  }));
}

describe('ruleMatches', () => {
  it('matches subject contains (case-insensitive, trimmed)', () => {
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'contains', value: '  NORMAL ' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'contains', value: 'invoice' }))).toBe(false);
  });

  it('supports equals / startsWith / endsWith', () => {
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'equals', value: 'normal email' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'equals', value: 'normal' }))).toBe(false);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'startsWith', value: 'normal' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'endsWith', value: 'email' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'startsWith', value: 'email' }))).toBe(false);
  });

  it('never matches an empty expected value', () => {
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'contains', value: '   ' }))).toBe(false);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'equals', value: '' }))).toBe(false);
  });

  it('matches senderDomain against the domain portion only', () => {
    expect(ruleMatches(baseThread, rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'senderDomain', operation: 'equals', value: 'john' }))).toBe(false);
    expect(ruleMatches(baseThread, rule({ field: 'senderDomain', operation: 'contains', value: 'example' }))).toBe(true);
  });

  it('matches `from` against primary sender name + email', () => {
    expect(ruleMatches(baseThread, rule({ field: 'from', operation: 'contains', value: 'john doe' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'from', operation: 'contains', value: 'john@example.com' }))).toBe(true);
    expect(ruleMatches(baseThread, rule({ field: 'from', operation: 'contains', value: 'someone else' }))).toBe(false);
  });

  it('falls back to senderEmail for `from` when there is no display name', () => {
    const noName: MailThread = { ...baseThread, senderNames: [] };
    expect(ruleMatches(noName, rule({ field: 'from', operation: 'contains', value: 'john@example.com' }))).toBe(true);
  });

  it('never matches `to` / `cc` (no recipient data on a thread)', () => {
    expect(ruleMatches(baseThread, rule({ field: 'to', operation: 'contains', value: 'anyone' }))).toBe(false);
    expect(ruleMatches(baseThread, rule({ field: 'cc', operation: 'contains', value: 'anyone' }))).toBe(false);
  });

  it('honors isNegated', () => {
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'contains', value: 'normal', isNegated: true }))).toBe(false);
    expect(ruleMatches(baseThread, rule({ field: 'subject', operation: 'contains', value: 'invoice', isNegated: true }))).toBe(true);
  });

  describe('systemSignal dispatch', () => {
    it('importantCandidate / automation', () => {
      const important: MailThread = { ...baseThread, labelIds: ['INBOX', 'IMPORTANT'] };
      expect(ruleMatches(important, rule({ field: 'systemSignal', value: 'importantCandidate' }))).toBe(true);

      const auto: MailThread = { ...baseThread, senderEmail: 'no-reply@company.com', subject: 'Weekly digest' };
      expect(ruleMatches(auto, rule({ field: 'systemSignal', value: 'automation' }))).toBe(true);
      expect(ruleMatches(baseThread, rule({ field: 'systemSignal', value: 'automation' }))).toBe(false);
    });

    it('purchase / linkedIn / marketing', () => {
      const purchase: MailThread = { ...baseThread, subject: 'Your order receipt' };
      expect(ruleMatches(purchase, rule({ field: 'systemSignal', value: 'purchase' }))).toBe(true);

      const linkedin: MailThread = { ...baseThread, senderEmail: 'jobs@linkedin.com' };
      expect(ruleMatches(linkedin, rule({ field: 'systemSignal', value: 'linkedIn' }))).toBe(true);

      const marketing: MailThread = { ...baseThread, subject: 'Huge sale today' };
      expect(ruleMatches(marketing, rule({ field: 'systemSignal', value: 'marketing' }))).toBe(true);
    });

    it('unread / attachment', () => {
      const unread: MailThread = { ...baseThread, isUnread: true };
      expect(ruleMatches(unread, rule({ field: 'systemSignal', value: 'unread' }))).toBe(true);
      expect(ruleMatches(baseThread, rule({ field: 'systemSignal', value: 'unread' }))).toBe(false);

      const attach: MailThread = { ...baseThread, hasAttachments: true };
      expect(ruleMatches(attach, rule({ field: 'systemSignal', value: 'attachment' }))).toBe(true);
    });

    it('ignores the operator and rejects unknown signals', () => {
      const unread: MailThread = { ...baseThread, isUnread: true };
      // operation is irrelevant for systemSignal
      expect(ruleMatches(unread, rule({ field: 'systemSignal', operation: 'equals', value: 'unread' }))).toBe(true);
      expect(ruleMatches(unread, rule({ field: 'systemSignal', value: 'bogusSignal' }))).toBe(false);
    });

    it('honors isNegated for systemSignal', () => {
      expect(ruleMatches(baseThread, rule({ field: 'systemSignal', value: 'unread', isNegated: true }))).toBe(true);
    });
  });
});

describe('categorize', () => {
  it('falls through to the deterministic system split', () => {
    const purchase: MailThread = { ...baseThread, subject: 'Your order invoice receipt #12345' };
    expect(categorize(purchase, defaultBuiltIn(), [])).toBe('purchases');

    const linkedin: MailThread = { ...baseThread, senderEmail: 'jobs@linkedin.com' };
    expect(categorize(linkedin, defaultBuiltIn(), [])).toBe('linkedIn');

    const important: MailThread = { ...baseThread, labelIds: ['INBOX', 'IMPORTANT'] };
    expect(categorize(important, defaultBuiltIn(), [])).toBe('important');

    expect(categorize(baseThread, defaultBuiltIn(), [])).toBe('other');
  });

  it('prefers an enabled custom category over the system split', () => {
    const custom: CustomMailCategorySettings[] = [
      {
        id: 'custom-newsletters',
        title: 'Newsletters',
        isEnabled: true,
        matchMode: 'any',
        rules: [rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' })],
      },
    ];
    const purchase: MailThread = { ...baseThread, subject: 'Your order receipt' };
    // Custom wins even though the system split would route to 'purchases'.
    expect(categorize(purchase, defaultBuiltIn(), custom)).toBe('custom-newsletters');
  });

  it('skips disabled custom categories', () => {
    const custom: CustomMailCategorySettings[] = [
      {
        id: 'custom-off',
        title: 'Off',
        isEnabled: false,
        matchMode: 'any',
        rules: [rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' })],
      },
    ];
    expect(categorize(baseThread, defaultBuiltIn(), custom)).toBe('other');
  });

  it('honors matchMode "all" for custom rules', () => {
    const custom: CustomMailCategorySettings[] = [
      {
        id: 'custom-both',
        title: 'Both',
        isEnabled: true,
        matchMode: 'all',
        rules: [
          rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' }),
          rule({ field: 'subject', operation: 'contains', value: 'invoice' }),
        ],
      },
    ];
    expect(categorize(baseThread, defaultBuiltIn(), custom)).toBe('other'); // subject does not contain "invoice"
    const matching: MailThread = { ...baseThread, subject: 'Your invoice' };
    expect(categorize(matching, defaultBuiltIn(), custom)).toBe('custom-both');
  });

  it('applies built-in extraRules in routing priority before the default split', () => {
    const builtIn = defaultBuiltIn();
    // Route example.com senders into "important" via an extra rule.
    const important = builtIn.find(b => b.id === 'important')!;
    important.extraRules = [rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' })];
    // A plain thread (no system signals) now lands in important.
    expect(categorize(baseThread, builtIn, [])).toBe('important');
  });

  it('respects routing priority [purchases, linkedIn, important, automation] for extraRules', () => {
    const builtIn = defaultBuiltIn();
    builtIn.find(b => b.id === 'important')!.extraRules = [
      rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' }),
    ];
    builtIn.find(b => b.id === 'purchases')!.extraRules = [
      rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' }),
    ];
    // Both match, but purchases is earlier in routing priority.
    expect(categorize(baseThread, builtIn, [])).toBe('purchases');
  });

  it('demotes to fallback when the resolved built-in bucket is disabled', () => {
    const builtIn = defaultBuiltIn();
    builtIn.find(b => b.id === 'purchases')!.isEnabled = false;
    const purchase: MailThread = { ...baseThread, subject: 'Your order receipt' };
    // System split says "purchases" but it is disabled -> fallback.
    expect(categorize(purchase, builtIn, [])).toBe('other');
    expect(categorize(purchase, builtIn, [], 'custom-fallback')).toBe('custom-fallback');
  });

  it('a disabled built-in does not block its extraRules from being skipped', () => {
    const builtIn = defaultBuiltIn();
    const purchases = builtIn.find(b => b.id === 'purchases')!;
    purchases.isEnabled = false;
    purchases.extraRules = [rule({ field: 'senderDomain', operation: 'equals', value: 'example.com' })];
    // purchases extraRules are ignored because it's disabled; falls to default split 'other'.
    expect(categorize(baseThread, builtIn, [])).toBe('other');
  });

  it('always allows "other" even though no built-in entry guards it', () => {
    const builtIn = defaultBuiltIn().filter(b => b.id !== 'other');
    expect(categorize(baseThread, builtIn, [])).toBe('other');
  });

  it('filters rules by accountId', () => {
    const threadMe: MailThread = { ...baseThread, accountId: 'me@gmail.com', subject: 'Invoice' };
    const threadWork: MailThread = { ...baseThread, accountId: 'work@gmail.com', subject: 'Invoice' };

    // Rule matches both but only targets 'me@gmail.com'
    const meRule = rule({ field: 'subject', operation: 'contains', value: 'Invoice', accountId: 'me@gmail.com' });
    expect(ruleMatches(threadMe, meRule)).toBe(true);
    expect(ruleMatches(threadWork, meRule)).toBe(false);

    // Rule is global (no accountId or 'global')
    const globalRule1 = rule({ field: 'subject', operation: 'contains', value: 'Invoice' });
    const globalRule2 = rule({ field: 'subject', operation: 'contains', value: 'Invoice', accountId: 'global' });
    expect(ruleMatches(threadMe, globalRule1)).toBe(true);
    expect(ruleMatches(threadWork, globalRule1)).toBe(true);
    expect(ruleMatches(threadMe, globalRule2)).toBe(true);
    expect(ruleMatches(threadWork, globalRule2)).toBe(true);
  });
});
