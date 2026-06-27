import { describe, it, expect } from 'vitest';
import { htmlToText, redactSecrets, buildThreadContext } from '../shared/aiContext';
import { AISettings, MailMessage, MailThread } from '../shared/types';

// --- Fixtures -------------------------------------------------------------

const baseThread: MailThread = {
  id: 't1',
  accountId: 'me@gmail.com',
  subject: 'Quarterly report',
  snippet: 'Here is the report you asked for',
  lastMessageAt: new Date('2026-01-01T00:00:00Z').toISOString(),
  senderNames: ['Alice Smith', 'Bob Jones'],
  senderEmail: 'alice@example.com',
  labelIds: ['INBOX'],
  hasAttachments: true,
  isUnread: true,
};

function makeMessage(over: Partial<MailMessage> = {}): MailMessage {
  return {
    id: 'm1',
    threadId: 't1',
    accountId: 'me@gmail.com',
    senderName: 'Alice Smith',
    senderEmail: 'alice@example.com',
    subject: 'Quarterly report',
    snippet: 'snippet text',
    receivedAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: true,
    to: [],
    cc: [],
    bcc: [],
    bodyHtml: null,
    bodyPlain: null,
    attachments: [],
    ...over,
  };
}

function makeAISettings(allowMailBodyContext: boolean): AISettings {
  return {
    provider: 'automatic',
    globalDefaultModel: '',
    fallback: { isEnabled: false, orderText: '' },
    providerConfigurations: [],
    replyTone: 'direct',
    allowMailBodyContext,
    savePromptHistory: false,
    suggestDrafts: false,
    suggestAutoArchive: false,
    suggestLabels: false,
    translationEnabled: false,
    personalizationNotes: '',
  };
}

// --- htmlToText -----------------------------------------------------------

describe('htmlToText', () => {
  it('strips tags and collapses whitespace', () => {
    expect(htmlToText('<p>Hello   <b>world</b></p>')).toBe('Hello world');
  });

  it('decodes the core entities ported from Swift', () => {
    expect(htmlToText('a&nbsp;b &amp; &lt;tag&gt;')).toBe('a b & <tag>');
  });

  it('decodes extra named, decimal and hex entities', () => {
    expect(htmlToText('&quot;quote&quot; it&#39;s &#x41;&#66;')).toBe('"quote" it\'s AB');
  });

  it('drops script and style blocks entirely', () => {
    const html = '<style>.a{color:red}</style><div>Visible</div><script>alert(1)</script>';
    expect(htmlToText(html)).toBe('Visible');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });

  it('trims leading and trailing whitespace', () => {
    expect(htmlToText('  <span> padded </span>  ')).toBe('padded');
  });
});

// --- redactSecrets --------------------------------------------------------

describe('redactSecrets', () => {
  it('redacts email addresses', () => {
    const out = redactSecrets('contact max@example.com please');
    expect(out).not.toContain('max@example.com');
    expect(out).toContain('[REDACTED]');
  });

  it('redacts OpenAI-style sk- keys', () => {
    expect(redactSecrets('key sk-test-ABC123_value')).not.toContain('sk-test');
  });

  it('redacts Google access tokens and API keys', () => {
    const out = redactSecrets('ya29.a0AfHvalue and AIzaSyExampleSecretKeyValue12345');
    expect(out).not.toContain('ya29');
    expect(out).not.toContain('AIza');
  });

  it('redacts Anthropic message ids', () => {
    expect(redactSecrets('id msg_01ABCdef')).not.toContain('msg_01ABCdef');
  });

  it('redacts api key, x-api-key, bearer and oauth token fields', () => {
    const input =
      'api_key=pk-provider-secret x-api-key: sk-ant-secret ' +
      'authorization: Bearer token-secret refresh_token=rt_abc access_token=at_xyz client_secret=cs_123';
    const out = redactSecrets(input);
    expect(out).not.toContain('pk-provider-secret');
    expect(out).not.toContain('sk-ant-secret');
    expect(out).not.toContain('token-secret');
    expect(out).not.toContain('rt_abc');
    expect(out).not.toContain('at_xyz');
    expect(out).not.toContain('cs_123');
  });

  it('redacts standalone bearer tokens', () => {
    expect(redactSecrets('Bearer abc.def.ghi')).not.toContain('abc.def.ghi');
  });

  it('redacts long hex and base64 secrets', () => {
    const hex = 'a'.repeat(40);
    const b64 = 'A1b2C3d4'.repeat(6); // 48 chars
    const out = redactSecrets(`hex ${hex} b64 ${b64}`);
    expect(out).not.toContain(hex);
    expect(out).not.toContain(b64);
  });

  it('leaves ordinary prose untouched', () => {
    const text = 'Please review the report and reply by Friday.';
    expect(redactSecrets(text)).toBe(text);
  });

  it('returns empty input unchanged', () => {
    expect(redactSecrets('')).toBe('');
  });
});

// --- buildThreadContext ---------------------------------------------------

describe('buildThreadContext', () => {
  it('builds the structured header from thread metadata', () => {
    const out = buildThreadContext(baseThread, [], makeAISettings(false));
    expect(out).toBe(
      [
        'Subject: Quarterly report',
        'Snippet: Here is the report you asked for',
        'Senders: Alice Smith, Bob Jones',
        'Has attachments: yes',
      ].join('\n'),
    );
  });

  it('omits message bodies when allowMailBodyContext is false', () => {
    const msg = makeMessage({ bodyPlain: 'Secret plan inside body' });
    const out = buildThreadContext(baseThread, [msg], makeAISettings(false));
    expect(out).toContain('Messages:');
    expect(out).toContain('Message 1 from Alice Smith:');
    expect(out).toContain('Subject: Quarterly report');
    expect(out).not.toContain('Body:');
    expect(out).not.toContain('Secret plan inside body');
    expect(out).toContain('Has attachments: no');
  });

  it('includes message bodies when allowMailBodyContext is true', () => {
    const msg = makeMessage({ bodyPlain: 'The numbers look good this quarter.' });
    const out = buildThreadContext(baseThread, [msg], makeAISettings(true));
    expect(out).toContain('Body:');
    expect(out).toContain('The numbers look good this quarter.');
  });

  it('falls back to HTML->text when plain body is missing', () => {
    const msg = makeMessage({ bodyPlain: null, bodyHtml: '<p>Hello&nbsp;<b>HTML</b></p>' });
    const out = buildThreadContext(baseThread, [msg], makeAISettings(true));
    expect(out).toContain('Hello HTML');
  });

  it('falls back to the snippet when both bodies are empty', () => {
    const msg = makeMessage({ bodyPlain: '   ', bodyHtml: '', snippet: 'just the snippet' });
    const out = buildThreadContext(baseThread, [msg], makeAISettings(true));
    expect(out).toContain('just the snippet');
  });

  it('redacts secrets inside included bodies', () => {
    const msg = makeMessage({ bodyPlain: 'token sk-live-DEADBEEF12345 here' });
    const out = buildThreadContext(baseThread, [msg], makeAISettings(true));
    expect(out).not.toContain('sk-live-DEADBEEF12345');
    expect(out).toContain('[REDACTED]');
  });

  it('numbers multiple messages sequentially', () => {
    const messages = [
      makeMessage({ id: 'a', senderName: 'Alice Smith', bodyPlain: 'first' }),
      makeMessage({ id: 'b', senderName: 'Bob Jones', hasAttachments: true, bodyPlain: 'second' }),
    ];
    const out = buildThreadContext(baseThread, messages, makeAISettings(true));
    expect(out).toContain('Message 1 from Alice Smith:');
    expect(out).toContain('Message 2 from Bob Jones:');
  });

  it('handles a null thread by emitting only message blocks', () => {
    const msg = makeMessage({ bodyPlain: 'body' });
    const out = buildThreadContext(null, [msg], makeAISettings(true));
    expect(out.startsWith('Messages:')).toBe(true);
    expect(out).not.toContain('Snippet:');
  });

  it('returns an empty string for a null thread with no messages', () => {
    expect(buildThreadContext(null, [], makeAISettings(true))).toBe('');
  });
});
