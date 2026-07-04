import { describe, expect, it } from 'vitest';
import {
  analyzeMessageSecurity,
  isSafePublicHttpUrl,
  parseUnsubscribeCandidate,
  shouldGenerateAgentDraft,
  shouldNotifyForMessage,
  stripTrackingPixelsFromHtml,
} from '../shared/mailSecurity';
import type { MailMessage } from '../shared/types';

function message(patch: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    accountId: 'me@example.com',
    senderName: 'Ada',
    senderEmail: 'ada@example.com',
    subject: 'Can you review this?',
    snippet: 'Can you review this today?',
    receivedAt: '2026-07-01T10:00:00.000Z',
    labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PRIMARY'],
    hasAttachments: false,
    isUnread: true,
    to: [{ name: 'Me', email: 'me@example.com' }],
    cc: [],
    bcc: [],
    bodyPlain: 'Can you review this today?',
    bodyHtml: null,
    attachments: [],
    headers: [],
    ...patch,
  };
}

describe('mail security and agent heuristics', () => {
  it('parses RFC list-unsubscribe one-click headers', () => {
    const candidate = parseUnsubscribeCandidate(message({
      headers: [
        { name: 'List-Unsubscribe', value: '<https://example.com/unsub?id=1>, <mailto:unsubscribe@example.com?subject=unsubscribe>' },
        { name: 'List-Unsubscribe-Post', value: 'List-Unsubscribe=One-Click' },
      ],
    }));

    expect(candidate?.canOneClick).toBe(true);
    expect(candidate?.recommendedMethod?.kind).toBe('httpPost');
    expect(candidate?.methods.map(method => method.kind)).toEqual(['httpPost', 'mailto']);
  });

  it('suppresses newsletter notifications while allowing direct unread mail', () => {
    expect(shouldNotifyForMessage(message())).toBe(true);
    expect(shouldNotifyForMessage(message({
      subject: 'Weekly digest',
      headers: [{ name: 'List-Id', value: 'Digest <digest.example.com>' }],
      labelIds: ['INBOX', 'UNREAD', 'CATEGORY_PROMOTIONS'],
    }))).toBe(false);
  });

  it('selects reply-worthy messages for proactive drafts', () => {
    expect(shouldGenerateAgentDraft(message(), 'me@example.com')).toBe(true);
    expect(shouldGenerateAgentDraft(message({
      senderEmail: 'news@example.com',
      subject: 'Newsletter',
      headers: [{ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' }],
    }), 'me@example.com')).toBe(false);
  });

  it('applies proactive draft trigger and bulk sender rules', () => {
    expect(shouldGenerateAgentDraft(message({
      to: [{ name: 'Team', email: 'team@example.com' }],
      bodyPlain: 'Could you send the signed contract today?',
    }), 'me@example.com', {
      proactiveDraftTrigger: 'directOnly',
      blockBulkAndAutomated: true,
      maxDraftSourceWords: 6000,
    })).toBe(false);

    expect(shouldGenerateAgentDraft(message({
      subject: 'Newsletter question?',
      headers: [{ name: 'List-Unsubscribe', value: '<mailto:unsubscribe@example.com>' }],
    }), 'me@example.com', {
      proactiveDraftTrigger: 'directOrActionRequest',
      blockBulkAndAutomated: false,
      maxDraftSourceWords: 6000,
    })).toBe(true);
  });

  it('detects and strips tracking pixels', () => {
    const html = '<p>Hello</p><img src="https://track.example.com/open.gif" width="1" height="1"><img src="https://cdn.example.com/logo.png" width="120">';
    const insight = analyzeMessageSecurity(message({ bodyHtml: html, bodyPlain: '' }));

    expect(insight.trackerCount).toBe(1);
    expect(insight.riskLevel).toBe('medium');
    expect(stripTrackingPixelsFromHtml(html)).not.toContain('track.example.com');
    expect(stripTrackingPixelsFromHtml(html)).toContain('cdn.example.com');
  });

  it('flags visible link destination mismatches', () => {
    const insight = analyzeMessageSecurity(message({
      bodyPlain: '',
      bodyHtml: '<a href="https://evil.example/login">https://bank.example/login</a>',
    }));

    expect(insight.riskLevel).toBe('high');
    expect(insight.warnings.some(warning => warning.kind === 'suspiciousLink')).toBe(true);
  });
});

describe('isSafePublicHttpUrl', () => {
  it('accepts a public https URL', () => {
    expect(isSafePublicHttpUrl('https://news.example.com/unsubscribe?id=1')).toBe(true);
  });

  it('rejects non-http(s) protocols and unparseable values', () => {
    expect(isSafePublicHttpUrl('ftp://example.com/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('file:///etc/passwd')).toBe(false);
    expect(isSafePublicHttpUrl('javascript:alert(1)')).toBe(false);
    expect(isSafePublicHttpUrl('not a url')).toBe(false);
    expect(isSafePublicHttpUrl('')).toBe(false);
  });

  it('rejects localhost and internal-suffix hostnames', () => {
    expect(isSafePublicHttpUrl('http://localhost/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://localhost:8080/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('https://printer.local/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('https://vault.internal/unsub')).toBe(false);
  });

  it('rejects private and special-purpose IPv4 literals', () => {
    expect(isSafePublicHttpUrl('http://0.0.0.0/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://10.1.2.3/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://127.0.0.1:8080/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://169.254.169.254/latest/meta-data')).toBe(false);
    expect(isSafePublicHttpUrl('http://172.16.0.1/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://172.31.255.255/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://192.168.0.213/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://100.64.7.7/unsub')).toBe(false);
  });

  it('accepts public IPv4 literals outside the screened ranges', () => {
    expect(isSafePublicHttpUrl('http://8.8.8.8/unsub')).toBe(true);
    expect(isSafePublicHttpUrl('http://172.32.0.1/unsub')).toBe(true);
    expect(isSafePublicHttpUrl('http://100.128.0.1/unsub')).toBe(true);
  });

  it('rejects loopback, unique-local, and link-local IPv6 literals', () => {
    expect(isSafePublicHttpUrl('http://[::1]/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://[0:0:0:0:0:0:0:1]/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://[fc00::1]/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://[fd12:3456::1]/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('http://[fe80::1]/unsub')).toBe(false);
    expect(isSafePublicHttpUrl('https://[2001:db8::1]/unsub')).toBe(true);
  });
});
