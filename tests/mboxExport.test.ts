import { describe, it, expect } from 'vitest';
import {
  buildMimeEntity,
  encodeHeaderText,
  encodeQuotedPrintable,
  escapeMboxFromLines,
  exportMboxFileName,
  formatMboxSeparatorDate,
  formatRfc2822Date,
  messageToMboxEntry,
} from '../shared/mboxExport';
import type { MailMessage } from '../shared/types';

// 2026-07-28 is a Tuesday; all date expectations below depend on it.
const RECEIVED_AT = '2026-07-28T12:37:54.000Z';

function message(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'msg-1',
    threadId: 'thread-1',
    accountId: 'me@gmail.com',
    senderName: 'Ada Lovelace',
    senderEmail: 'ada@example.com',
    subject: 'Hello',
    snippet: '',
    receivedAt: RECEIVED_AT,
    labelIds: ['INBOX', 'IMPORTANT'],
    hasAttachments: false,
    isUnread: false,
    to: [{ name: 'Maksim', email: 'me@gmail.com' }],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain: 'Plain body line one.\nLine two.',
    attachments: [],
    rfcMessageId: '<abc123@mail.gmail.com>',
    ...overrides,
  };
}

describe('formatRfc2822Date', () => {
  it('renders an RFC 2822 date in UTC', () => {
    expect(formatRfc2822Date(RECEIVED_AT)).toBe('Tue, 28 Jul 2026 12:37:54 +0000');
  });

  it('falls back to the sanitized input for unparseable dates', () => {
    expect(formatRfc2822Date('not a date')).toBe('not a date');
    expect(formatRfc2822Date('weird\r\ninjected: yes')).toBe('weird injected: yes');
  });
});

describe('formatMboxSeparatorDate', () => {
  it('renders the asctime-style date with a space-padded day', () => {
    expect(formatMboxSeparatorDate(RECEIVED_AT)).toBe('Tue Jul 28 12:37:54 2026');
    expect(formatMboxSeparatorDate('2026-07-05T00:00:01.000Z')).toBe('Sun Jul  5 00:00:01 2026');
  });
});

describe('encodeHeaderText', () => {
  it('keeps printable ASCII verbatim', () => {
    expect(encodeHeaderText('Plain subject (v2)')).toBe('Plain subject (v2)');
  });

  it('encodes non-ASCII text as RFC 2047 encoded words', () => {
    const expected = Buffer.from('Привіт', 'utf8').toString('base64');
    expect(encodeHeaderText('Привіт')).toBe(`=?UTF-8?B?${expected}?=`);
  });

  it('chunks long non-ASCII text into multiple encoded words', () => {
    const result = encodeHeaderText('ääääääääääääääääääääääää');
    const words = result.split(' ');
    expect(words.length).toBeGreaterThan(1);
    for (const word of words) {
      expect(word).toMatch(/^=\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=$/);
      expect(word.length).toBeLessThanOrEqual(75);
    }
  });

  it('strips CR/LF to prevent header injection', () => {
    expect(encodeHeaderText('one\r\nBcc: evil@example.com')).toBe('one Bcc: evil@example.com');
  });
});

describe('encodeQuotedPrintable', () => {
  it('passes printable ASCII through', () => {
    expect(encodeQuotedPrintable('hello world')).toBe('hello world');
  });

  it('encodes UTF-8 bytes as =XX', () => {
    expect(encodeQuotedPrintable('café')).toBe('caf=C3=A9');
  });

  it('encodes the equals sign', () => {
    expect(encodeQuotedPrintable('a=b')).toBe('a=3Db');
  });

  it('encodes trailing whitespace but keeps inner whitespace', () => {
    expect(encodeQuotedPrintable('trailing ')).toBe('trailing=20');
    expect(encodeQuotedPrintable('a b')).toBe('a b');
  });

  it('soft-wraps lines at 76 characters', () => {
    const long = 'x'.repeat(200);
    const result = encodeQuotedPrintable(long);
    for (const line of result.split('\n')) {
      expect(line.length).toBeLessThanOrEqual(76);
    }
    // Removing soft breaks must restore the original text.
    expect(result.replace(/=\n/g, '')).toBe(long);
  });
});

describe('escapeMboxFromLines', () => {
  it('prefixes lines starting with "From " and ">From "', () => {
    const input = 'From the top\n>From earlier\n>>From deep\nnormal\nFromage is fine';
    expect(escapeMboxFromLines(input)).toBe(
      '>From the top\n>>From earlier\n>>>From deep\nnormal\nFromage is fine',
    );
  });
});

describe('buildMimeEntity', () => {
  it('emits RFC 2822 headers and a text/plain part for a plain-only message', () => {
    const { headers, body } = buildMimeEntity(message());
    expect(headers).toContain('From: Ada Lovelace <ada@example.com>');
    expect(headers).toContain('To: Maksim <me@gmail.com>');
    expect(headers).toContain('Date: Tue, 28 Jul 2026 12:37:54 +0000');
    expect(headers).toContain('Subject: Hello');
    expect(headers).toContain('Message-ID: <abc123@mail.gmail.com>');
    expect(headers).toContain('X-Gmail-Labels: INBOX, IMPORTANT');
    expect(headers).toContain('X-Dumka-Account: me@gmail.com');
    expect(headers).toContain('MIME-Version: 1.0');
    expect(headers).toContain('Content-Type: text/plain; charset=utf-8');
    expect(headers).toContain('Content-Transfer-Encoding: quoted-printable');
    expect(headers.some(h => h.startsWith('Content-Type: multipart'))).toBe(false);
    expect(body).toBe('Plain body line one.\nLine two.');
  });

  it('builds multipart/alternative when both bodies exist', () => {
    const { headers, body } = buildMimeEntity(message({ bodyHtml: '<p>Hello <b>HTML</b></p>' }));
    const contentType = headers.find(h => h.startsWith('Content-Type: multipart/alternative'));
    expect(contentType).toBeTruthy();
    const boundary = contentType!.match(/boundary="([^"]+)"/)![1];
    expect(body).toContain(`--${boundary}`);
    expect(body).toContain('Content-Type: text/plain; charset=utf-8');
    expect(body).toContain('Plain body line one.');
    expect(body).toContain('Content-Type: text/html; charset=utf-8');
    expect(body).toContain('<p>Hello <b>HTML</b></p>');
    expect(body.trimEnd().endsWith(`--${boundary}--`)).toBe(true);
  });

  it('derives a plain part from HTML when bodyPlain is missing', () => {
    const { headers, body } = buildMimeEntity(message({ bodyPlain: null, bodyHtml: '<p>Hello <b>world</b></p>' }));
    expect(headers.some(h => h.startsWith('Content-Type: multipart/alternative'))).toBe(true);
    expect(body).toContain('Content-Type: text/plain; charset=utf-8');
    expect(body).toContain('Hello world');
    expect(body).toContain('<p>Hello <b>world</b></p>');
  });

  it('quotes display names containing specials', () => {
    const { headers } = buildMimeEntity(message({ senderName: 'Lovelace, Ada' }));
    expect(headers).toContain('From: "Lovelace, Ada" <ada@example.com>');
  });

  it('encodes non-ASCII display names as encoded words', () => {
    const { headers } = buildMimeEntity(message({ senderName: 'Ада' }));
    const expected = Buffer.from('Ада', 'utf8').toString('base64');
    expect(headers).toContain(`From: =?UTF-8?B?${expected}?= <ada@example.com>`);
  });

  it('omits empty optional headers', () => {
    const { headers } = buildMimeEntity(message({ subject: '', rfcMessageId: null, labelIds: [] }));
    expect(headers.some(h => h.startsWith('Subject:'))).toBe(false);
    expect(headers.some(h => h.startsWith('Message-ID:'))).toBe(false);
    expect(headers.some(h => h.startsWith('X-Gmail-Labels:'))).toBe(false);
  });
});

describe('messageToMboxEntry', () => {
  it('starts with the mbox separator line and ends with a blank line', () => {
    const entry = messageToMboxEntry(message());
    expect(entry.startsWith('From ada@example.com Tue Jul 28 12:37:54 2026\n')).toBe(true);
    expect(entry.endsWith('\n\n')).toBe(true);
    expect(entry).toContain('\n\nPlain body line one.\nLine two.\n');
  });

  it('escapes "From " lines in the body', () => {
    const entry = messageToMboxEntry(message({ bodyPlain: 'From the archive\nok' }));
    expect(entry).toContain('\n>From the archive\nok\n');
    // The only unescaped separator line is the entry's own first line.
    const lines = entry.split('\n');
    expect(lines.filter((line, index) => index > 0 && line.startsWith('From '))).toHaveLength(0);
  });

  it('falls back to the account id when the sender address is missing', () => {
    const entry = messageToMboxEntry(message({ senderEmail: '' }));
    expect(entry.startsWith('From me@gmail.com ')).toBe(true);
  });
});

describe('exportMboxFileName', () => {
  it('builds a sanitized, dated file name', () => {
    const date = new Date(Date.UTC(2026, 6, 28, 9, 7, 3));
    expect(exportMboxFileName('me@gmail.com', date)).toBe('dumka-export-me@gmail.com-20260728.mbox');
    expect(exportMboxFileName('weird / account', date)).toBe('dumka-export-weird_account-20260728.mbox');
  });
});
