import { describe, it, expect } from 'vitest';
import {
  startReply,
  startForward,
  filterEmailSuggestions,
  isValidEmail,
  validateDraft,
  formatMessageHeaderDate,
  MAX_TOTAL_ATTACHMENT_BYTES,
} from '../shared/compose';
import { EmailAddressSuggestion, MailMessage, Recipient } from '../shared/types';

const r = (email: string, name = ''): Recipient => ({ name, email });
const suggestion = (
  email: string,
  name = '',
  sourceCount = 1,
  lastMessageAt = '2026-06-26T15:04:00.000Z',
): EmailAddressSuggestion => ({ name, email, sourceCount, lastMessageAt });

function makeMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'm1',
    threadId: 't1',
    accountId: 'me@example.com',
    senderName: 'Alice Sender',
    senderEmail: 'alice@example.com',
    subject: 'Project status',
    snippet: 'snippet text',
    receivedAt: '2026-06-26T15:04:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: true,
    to: [r('me@example.com', 'Me'), r('bob@example.com', 'Bob')],
    cc: [r('carol@example.com', 'Carol')],
    bcc: [],
    bodyHtml: null,
    bodyPlain: 'Line one\nLine two',
    attachments: [],
    rfcMessageId: '<msg-1@example.com>',
    rfcReferences: '<root@example.com> <prev@example.com>',
    rfcInReplyTo: null,
    ...overrides,
  };
}

describe('isValidEmail', () => {
  it('accepts a well-formed address', () => {
    expect(isValidEmail('john.doe@example.com')).toBe(true);
    expect(isValidEmail('a@b.co')).toBe(true);
  });

  it('rejects missing or empty local part', () => {
    expect(isValidEmail('@example.com')).toBe(false);
    expect(isValidEmail('')).toBe(false);
  });

  it('requires exactly one @', () => {
    expect(isValidEmail('a@@b.com')).toBe(false);
    expect(isValidEmail('a.b.com')).toBe(false);
    expect(isValidEmail('a@b@c.com')).toBe(false);
  });

  it('requires a dotted domain that is not leading/trailing-dotted', () => {
    expect(isValidEmail('a@localhost')).toBe(false);
    expect(isValidEmail('a@.com')).toBe(false);
    expect(isValidEmail('a@com.')).toBe(false);
  });

  it('rejects any whitespace, including CR/LF', () => {
    expect(isValidEmail('a@b.com ')).toBe(false);
    expect(isValidEmail(' a@b.com')).toBe(false);
    expect(isValidEmail('a@b.c\nom')).toBe(false);
    expect(isValidEmail('a@b.c\r\nom')).toBe(false);
  });
});

describe('formatMessageHeaderDate', () => {
  it('formats an ISO timestamp deterministically in UTC', () => {
    const out = formatMessageHeaderDate('2026-06-26T15:04:00.000Z');
    expect(out).toContain('2026');
    expect(out).toContain('Jun');
    // 15:04 UTC -> 3:04 PM
    expect(out).toContain('3:04');
  });

  it('falls back to the raw value on unparseable input', () => {
    expect(formatMessageHeaderDate('not-a-date')).toBe('not-a-date');
  });
});

describe('filterEmailSuggestions', () => {
  it('matches email and display name case-insensitively', () => {
    const suggestions = [
      suggestion('ops@example.com', 'Ops Team', 2),
      suggestion('alice@example.com', 'Alice Sender', 1),
    ];

    expect(filterEmailSuggestions(suggestions, 'ali').map(item => item.email)).toEqual(['alice@example.com']);
    expect(filterEmailSuggestions(suggestions, 'TEAM').map(item => item.email)).toEqual(['ops@example.com']);
  });

  it('excludes already selected recipients and the active sending account', () => {
    const suggestions = [
      suggestion('me@example.com', 'Me', 10),
      suggestion('bob@example.com', 'Bob', 5),
      suggestion('carol@example.com', 'Carol', 3),
    ];

    const result = filterEmailSuggestions(suggestions, 'example', {
      existingRecipients: [r('bob@example.com')],
      excludedEmails: ['me@example.com'],
    });

    expect(result.map(item => item.email)).toEqual(['carol@example.com']);
  });

  it('ranks prefix matches before substring matches, then by frequency', () => {
    const suggestions = [
      suggestion('team-alpha@example.com', 'Alpha', 1),
      suggestion('beta-team@example.com', 'Beta', 20),
      suggestion('team-ops@example.com', 'Ops', 7),
    ];

    expect(filterEmailSuggestions(suggestions, 'team').map(item => item.email)).toEqual([
      'team-ops@example.com',
      'team-alpha@example.com',
      'beta-team@example.com',
    ]);
  });

  it('keeps mailing-list groups and sanitizes expanded members', () => {
    const suggestions: EmailAddressSuggestion[] = [
      {
        name: 'Backend Team',
        email: 'group:backend',
        sourceCount: 3,
        kind: 'group',
        groupId: 'backend',
        members: [
          r('alice@example.com', 'Alice'),
          r('bob@example.com', 'Bob'),
          r('invalid-localhost', 'Broken'),
        ],
      },
    ];

    const result = filterEmailSuggestions(suggestions, 'backend', {
      existingRecipients: [r('alice@example.com')],
    });

    expect(result).toHaveLength(1);
    expect(result[0].kind).toBe('group');
    expect(result[0].members).toEqual([r('bob@example.com', 'Bob')]);
  });

  it('ranks contact and group suggestions ahead of message-history suggestions on equal matches', () => {
    const result = filterEmailSuggestions([
      suggestion('archive@example.com', 'Team Archive', 100),
      { ...suggestion('lead@example.com', 'Team Lead', 1), kind: 'contact' },
      {
        name: 'Team Group',
        email: 'group:team',
        sourceCount: 2,
        kind: 'group',
        groupId: 'team',
        members: [r('one@example.com'), r('two@example.com')],
      },
    ], 'team');

    expect(result.map(item => item.kind ?? 'address')).toEqual(['group', 'contact', 'address']);
  });
});

describe('startReply', () => {
  it('replies to the sender with a Re: subject and quoted body', () => {
    const seed = startReply(makeMessage(), 'me@example.com');
    expect(seed.to).toEqual([{ name: 'Alice Sender', email: 'alice@example.com' }]);
    expect(seed.cc).toEqual([]);
    expect(seed.subject).toBe('Re: Project status');
    expect(seed.body).toContain('Alice Sender wrote:');
    expect(seed.body).toContain('> Line one');
    expect(seed.body).toContain('> Line two');
    expect(seed.bodyHtml).toContain('data-dumka-quoted-reply="true"');
    expect(seed.bodyHtml).toContain('<blockquote class="gmail_quote"');
    expect(seed.bodyHtml).toContain('Line one<br>Line two');
    expect(seed.bodyHtml).not.toContain('&gt; Line one');
  });

  it('does not double-prefix an existing Re: subject (case-insensitive)', () => {
    expect(startReply(makeMessage({ subject: 're: hello' }), 'me@example.com').subject).toBe('re: hello');
    expect(startReply(makeMessage({ subject: 'RE: hello' }), 'me@example.com').subject).toBe('RE: hello');
  });

  it('carries RFC threading headers from rfcMessageId/rfcReferences', () => {
    const seed = startReply(makeMessage(), 'me@example.com');
    expect(seed.replyMessageId).toBe('<msg-1@example.com>');
    expect(seed.replyReferences).toBe('<root@example.com> <prev@example.com> <msg-1@example.com>');
  });

  it('uses only the message id when there are no existing references', () => {
    const seed = startReply(makeMessage({ rfcReferences: null }), 'me@example.com');
    expect(seed.replyReferences).toBe('<msg-1@example.com>');
  });

  it('omits threading headers when rfcMessageId is empty', () => {
    const seed = startReply(makeMessage({ rfcMessageId: '   ' }), 'me@example.com');
    expect(seed.replyMessageId).toBeNull();
    expect(seed.replyReferences).toBeNull();
  });

  it('when the message was sent by me, replies to its original recipients (minus me)', () => {
    const seed = startReply(makeMessage({ senderEmail: 'me@example.com', senderName: 'Me' }), 'me@example.com');
    expect(seed.to).toEqual([{ name: 'Bob', email: 'bob@example.com' }]);
  });

  it('quotes the snippet when there is no plain body', () => {
    const seed = startReply(makeMessage({ bodyPlain: null, snippet: 'snip line' }), 'me@example.com');
    expect(seed.body).toContain('> snip line');
    expect(seed.bodyHtml).toContain('<p>snip line</p>');
  });

  it('uses sanitized original HTML inside the Gmail-style quote', () => {
    const seed = startReply(makeMessage({
      bodyHtml: '<p>Hello <strong>team</strong></p><script>alert(1)</script>',
      bodyPlain: 'Hello team',
    }), 'me@example.com');

    expect(seed.bodyHtml).toContain('<strong>team</strong>');
    expect(seed.bodyHtml).toContain('<blockquote class="gmail_quote"');
    expect(seed.bodyHtml).not.toContain('<script>');
  });
});

describe('startReply (reply-all)', () => {
  it('keeps the sender in To and the other recipients in Cc, excluding me', () => {
    const seed = startReply(makeMessage(), 'me@example.com', true);
    expect(seed.to).toEqual([{ name: 'Alice Sender', email: 'alice@example.com' }]);
    expect(seed.cc.map((x) => x.email)).toEqual(['bob@example.com', 'carol@example.com']);
    expect(seed.cc.map((x) => x.email)).not.toContain('me@example.com');
  });

  it('dedupes Cc against the resolved To set', () => {
    const seed = startReply(
      makeMessage({
        to: [r('alice@example.com', 'Alice'), r('me@example.com', 'Me')],
        cc: [r('alice@example.com', 'Alice dup'), r('dave@example.com', 'Dave')],
      }),
      'me@example.com',
      true,
    );
    expect(seed.to.map((x) => x.email)).toEqual(['alice@example.com']);
    expect(seed.cc.map((x) => x.email)).toEqual(['dave@example.com']);
  });

  it('promotes the first Cc into To when To resolves empty', () => {
    const seed = startReply(
      makeMessage({
        senderEmail: 'me@example.com',
        senderName: 'Me',
        to: [r('me@example.com', 'Me')],
        cc: [r('frank@example.com', 'Frank'), r('grace@example.com', 'Grace')],
      }),
      'me@example.com',
      true,
    );
    expect(seed.to.map((x) => x.email)).toEqual(['frank@example.com']);
    expect(seed.cc.map((x) => x.email)).toEqual(['grace@example.com']);
  });

  it('falls back to the sender when there is no recipient metadata', () => {
    const seed = startReply(makeMessage({ to: [], cc: [] }), 'me@example.com', true);
    expect(seed.to.map((x) => x.email)).toEqual(['alice@example.com']);
    expect(seed.cc).toEqual([]);
  });
});

describe('startForward', () => {
  it('produces an empty-recipient Fwd: draft with a quoted forwarded body', () => {
    const seed = startForward(makeMessage());
    expect(seed.to).toEqual([]);
    expect(seed.cc).toEqual([]);
    expect(seed.subject).toBe('Fwd: Project status');
    expect(seed.replyMessageId).toBeNull();
    expect(seed.replyReferences).toBeNull();
    expect(seed.body).toContain('Forwarded message');
    expect(seed.body).toContain('From: alice@example.com');
    expect(seed.body).toContain('Subject: Project status');
    expect(seed.body).toContain('Line one\nLine two');
  });

  it('does not double-prefix an existing Fwd: subject (case-insensitive)', () => {
    expect(startForward(makeMessage({ subject: 'fwd: hi' })).subject).toBe('fwd: hi');
    expect(startForward(makeMessage({ subject: 'FWD: hi' })).subject).toBe('FWD: hi');
  });
});

describe('validateDraft', () => {
  const ok = { to: [r('bob@example.com')], subject: 'Hi', body: 'Hello there' };

  it('accepts a complete, valid draft', () => {
    expect(validateDraft(ok)).toEqual({ valid: true, errors: [] });
  });

  it('requires at least one recipient across to, cc, and bcc', () => {
    const res = validateDraft({ ...ok, to: [] });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Add at least one recipient');

    expect(validateDraft({ ...ok, to: [], cc: [r('cc@example.com')] }).valid).toBe(true);
    expect(validateDraft({ ...ok, to: [], bcc: [r('bcc@example.com')] }).valid).toBe(true);
  });

  it('rejects an invalid recipient email', () => {
    const res = validateDraft({ ...ok, to: [r('not-an-email')] });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Invalid recipient: not-an-email');

    const ccRes = validateDraft({ ...ok, cc: [r('bad-cc')] });
    expect(ccRes.valid).toBe(false);
    expect(ccRes.errors).toContain('Invalid recipient: bad-cc');
  });

  it('requires a non-empty subject', () => {
    const res = validateDraft({ ...ok, subject: '   ' });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Add a subject');
  });

  it('flags CR/LF in the subject as an unsafe header', () => {
    const res = validateDraft({ ...ok, subject: 'Hi\nthere' });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Remove line breaks from recipients or subject');
  });

  it('requires a body or an attachment', () => {
    const res = validateDraft({ ...ok, body: '   ' });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Write a message or attach a file');
  });

  it('accepts an empty body when there is an attachment', () => {
    const res = validateDraft({ ...ok, body: '', attachmentBytes: 1024 });
    expect(res.valid).toBe(true);
  });

  it('rejects attachments over the 25 MB cap', () => {
    const res = validateDraft({ ...ok, attachmentBytes: MAX_TOTAL_ATTACHMENT_BYTES + 1 });
    expect(res.valid).toBe(false);
    expect(res.errors).toContain('Attachments are over 25 MB');
  });

  it('accepts attachments exactly at the 25 MB cap', () => {
    const res = validateDraft({ ...ok, attachmentBytes: MAX_TOTAL_ATTACHMENT_BYTES });
    expect(res.valid).toBe(true);
  });

  it('accumulates multiple distinct errors without duplicates', () => {
    const res = validateDraft({ to: [], subject: '', body: '' });
    expect(res.valid).toBe(false);
    expect(res.errors).toEqual(
      expect.arrayContaining([
        'Add at least one recipient',
        'Add a subject',
        'Write a message or attach a file',
      ]),
    );
    expect(new Set(res.errors).size).toBe(res.errors.length);
  });
});
