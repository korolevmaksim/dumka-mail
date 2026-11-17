// "Reply in my voice": which of the person's own earlier messages are handed
// to the model as examples of how they write, and what is never included.
import { describe, expect, it } from 'vitest';
import { buildDraftPrompt, DRAFT_LANGUAGE_RULE, DRAFT_STYLE_RULE, DRAFT_STYLE_SAMPLE_MAX } from '../shared/agentPrompts';
import {
  REPLY_STYLE_MAX_SAMPLES,
  REPLY_STYLE_SAMPLE_MAX,
  accountSignaturePlain,
  replyRecipientEmail,
  replyStyleEnabled,
  replyStyleText,
  selectReplyStyleSamples,
  stripSignature,
  type OwnMessage,
  type ReplyStyleSample,
} from '../shared/replyStyle';
import type { MailMessage } from '../shared/types';

const ME = 'alex.morgan@northwind.example';
const PRIYA = 'priya.raman@lumenlabs.example';

let counter = 0;
function own(to: string | string[], text: string, partial: Partial<OwnMessage> & { daysAgo?: number } = {}): OwnMessage {
  counter += 1;
  const { daysAgo = counter, ...rest } = partial;
  return {
    id: `m${counter}`,
    threadId: `thread-${counter}`,
    receivedAt: new Date(Date.parse('2026-11-17T10:00:00.000Z') - daysAgo * 86_400_000).toISOString(),
    labelIds: ['SENT'],
    to: (Array.isArray(to) ? to : [to]).map(email => ({ name: '', email })),
    cc: [],
    bodyPlain: text,
    bodyHtml: null,
    snippet: text.slice(0, 80),
    ...rest,
  };
}

const LONG = 'Hi there,\n\nThanks for sending this over. I read it last night and have two small comments on the timeline.\n\nBest,\nAlex';

function select(messages: OwnMessage[], recipientEmail = PRIYA, extra: Record<string, unknown> = {}): ReplyStyleSample[] {
  return selectReplyStyleSamples(messages, { accountEmail: ME, recipientEmail, ...extra });
}

describe('choosing examples of how the person writes', () => {
  it('prefers messages to the same person, then the same organisation, then recent ones', () => {
    const messages = [
      own('someone@elsewhere.example', `${LONG} (recent)`, { daysAgo: 1 }),
      own('colleague@lumenlabs.example', `${LONG} (same organisation)`, { daysAgo: 2 }),
      own(PRIYA, `${LONG} (older, to Priya)`, { daysAgo: 30 }),
      own(PRIYA.toUpperCase(), `${LONG} (newer, to Priya)`, { daysAgo: 10 }),
      own('another@elsewhere.example', `${LONG} (another recent)`, { daysAgo: 3 }),
    ];
    const samples = select(messages);
    expect(samples.map(sample => sample.match)).toEqual(['recipient', 'recipient', 'organisation']);
    expect(samples[0].text).toContain('(newer, to Priya)');
    expect(samples[1].text).toContain('(older, to Priya)');
    expect(samples[0].to).toBe(PRIYA);
    expect(samples).toHaveLength(REPLY_STYLE_MAX_SAMPLES);
  });

  it('falls back to recent messages for someone the person never wrote to', () => {
    const samples = select([own('a@x.example', `${LONG} one`, { daysAgo: 5 }), own('b@y.example', `${LONG} two`, { daysAgo: 2 })], 'new.person@nowhere.example');
    expect(samples.map(sample => sample.match)).toEqual(['recent', 'recent']);
    expect(samples[0].text).toContain('two');
  });

  it('never treats two addresses at a public mail provider as one organisation', () => {
    const samples = select([own('stranger@gmail.com', LONG)], 'friend@gmail.com');
    expect(samples.map(sample => sample.match)).toEqual(['recent']);
    // A copy to the recipient's organisation counts; a copy to the person themselves is not "written to them".
    const viaCc = select([own('other@elsewhere.example', LONG, { cc: [{ name: '', email: 'boss@lumenlabs.example' }] })]);
    expect(viaCc[0].match).toBe('organisation');
  });

  it('never uses a draft, a message of the conversation being answered, or a note to oneself', () => {
    const messages = [
      own(PRIYA, `${LONG} draft`, { labelIds: ['DRAFT'] }),
      own(PRIYA, `${LONG} same thread`, { threadId: 'current' }),
      own(ME, `${LONG} note to self`),
      own([], `${LONG} no recipient`),
      own(PRIYA, `${LONG} usable`),
    ];
    const samples = select(messages, PRIYA, { excludeThreadId: 'current' });
    expect(samples).toHaveLength(1);
    expect(samples[0].text).toContain('usable');
  });

  it('skips text with nothing to learn from and counts the same text once', () => {
    const messages = [
      own(PRIYA, 'Thanks!'),
      own(PRIYA, 'Ok, will do.\n\n> On Monday Priya wrote:\n> a very long quoted message that must not count as the person\'s own writing at all'),
      own(PRIYA, LONG),
      own('copy@lumenlabs.example', LONG),
    ];
    const samples = select(messages);
    expect(samples).toHaveLength(1);
  });

  it('keeps only the person\'s own words: no quoted history, no signature, no keys or tokens, bounded', () => {
    const text = [
      'Hi Priya,',
      '',
      'The staging key is sk-live-abc123DEF456 for now. Let us talk on Thursday.',
      '',
      'Alex Morgan',
      'Head of Rollouts · Northwind',
      '',
      'On Mon, Nov 9, 2026 at 10:00 Priya Raman <priya.raman@lumenlabs.example> wrote:',
      '> Could you send the plan?',
    ].join('\n');
    const [sample] = select([own(PRIYA, text)], PRIYA, { signaturePlain: 'Alex Morgan\nHead of Rollouts · Northwind' });
    expect(sample.text).toContain('Let us talk on Thursday.');
    expect(sample.text).not.toContain('Head of Rollouts');
    expect(sample.text).not.toContain('Could you send the plan');
    // The same redaction as for thread excerpts: keys and tokens, not every private detail.
    expect(sample.text).not.toContain('sk-live-abc123DEF456');
    const long = select([own(PRIYA, `Hello Priya, ${'word '.repeat(600)}`)]);
    expect(long[0].text.length).toBeLessThanOrEqual(REPLY_STYLE_SAMPLE_MAX);
  });

  it('reads an HTML-only message and honours the limit', () => {
    const html = own(PRIYA, '', { bodyPlain: null, bodyHtml: `<p>Hi Priya,</p><p>${'This is the part I wrote myself. '.repeat(3)}</p>`, snippet: '' });
    expect(select([html])[0].text).toContain('This is the part I wrote myself.');
    const many = Array.from({ length: 8 }, (_, index) => own(PRIYA, `${LONG} number ${index}`));
    expect(select(many)).toHaveLength(REPLY_STYLE_MAX_SAMPLES);
    expect(select(many, PRIYA, { limit: 1 })).toHaveLength(1);
    expect(select(many, PRIYA, { limit: 0 })).toEqual([]);
    expect(select(many, PRIYA, { limit: 99 })).toHaveLength(REPLY_STYLE_MAX_SAMPLES);
    expect(select([], PRIYA)).toEqual([]);
  });
});

describe('stripSignature', () => {
  it('cuts from the delimiter line or from the first line of the account signature', () => {
    expect(stripSignature('Body line\n\n-- \nAlex\nNorthwind')).toBe('Body line');
    expect(stripSignature('Body line\n\nAlex Morgan\nNorthwind', 'Alex Morgan\nNorthwind')).toBe('Body line');
    expect(stripSignature('Body line\nstill body', 'Alex Morgan')).toBe('Body line\nstill body');
    // A signature line that opens the message is the message, not a signature.
    expect(stripSignature('Alex Morgan\nwrote this', 'Alex Morgan')).toBe('Alex Morgan\nwrote this');
    // Too short a line would cut ordinary text ("Al").
    expect(stripSignature('First\nAl\nLast', 'Al')).toBe('First\nAl\nLast');
    expect(replyStyleText({ bodyPlain: 'Hello\n--\nSig', bodyHtml: null, snippet: '' })).toBe('Hello');
  });
});

describe('who a reply is for', () => {
  const message = (senderEmail: string, minute: number, extra: Partial<MailMessage> = {}) => ({
    senderEmail, receivedAt: `2026-11-17T10:${String(minute).padStart(2, '0')}:00.000Z`, labelIds: ['INBOX'], to: [{ name: '', email: ME }], ...extra,
  });

  it('is the sender of the newest message that is not the account\'s own', () => {
    expect(replyRecipientEmail([message(PRIYA, 1), message('Daniel@Northwind.example', 5), message(ME, 9, { labelIds: ['SENT'] })], ME)).toBe('daniel@northwind.example');
    // A send-as alias is the account's own message too.
    expect(replyRecipientEmail([message(PRIYA, 1), message('alias@northwind.example', 5, { labelIds: ['SENT'] })], ME)).toBe(PRIYA);
  });

  it('is the first recipient when every message is the account\'s own', () => {
    expect(replyRecipientEmail([message(ME, 1, { labelIds: ['SENT'], to: [{ name: '', email: ME }, { name: 'Priya', email: PRIYA }] })], ME)).toBe(PRIYA);
    expect(replyRecipientEmail([], ME)).toBe('');
    expect(replyRecipientEmail([message(ME, 1, { labelIds: ['SENT'], to: [] })], ME)).toBe('');
  });
});

describe('settings', () => {
  it('is on unless switched off', () => {
    expect(replyStyleEnabled(null)).toBe(true);
    expect(replyStyleEnabled({ ai: {} })).toBe(true);
    expect(replyStyleEnabled({ ai: { replyStyleFromSent: false } })).toBe(false);
  });

  it('finds the signature the account signs with', () => {
    const settings = { compose: { defaultSignature: 'Default sig', signaturesByAccount: { [ME]: { signaturePlain: 'Alex Morgan' }, 'other@x.example': { signaturePlain: ' ' } } } };
    expect(accountSignaturePlain(settings, ME.toUpperCase())).toBe('Alex Morgan');
    expect(accountSignaturePlain(settings, 'other@x.example')).toBe('Default sig');
    expect(accountSignaturePlain(settings, 'unknown@x.example')).toBe('Default sig');
    expect(accountSignaturePlain({ compose: { signaturesByAccount: 'junk' } }, ME)).toBe('');
    expect(accountSignaturePlain(null, ME)).toBe('');
  });
});

describe('the draft prompt', () => {
  const base = {
    thread: { subject: 'Q3 rollout' },
    messages: [{ senderName: 'Priya Raman', senderEmail: PRIYA, receivedAt: '2026-11-17T09:00:00.000Z', bodyPlain: 'Can we move the pilot to the 24th?', bodyHtml: null, snippet: '' }],
    accountName: 'Alex Morgan',
    accountEmail: ME,
    tone: 'direct',
  };
  const sample: ReplyStyleSample = { to: PRIYA, date: '2026-11-10T09:00:00.000Z', text: 'Hi Priya,\n\nAttached is the draft pilot plan.\n\nAlex', match: 'recipient' };

  it('always asks for the language of the message being answered', () => {
    expect(buildDraftPrompt(base).system).toContain(DRAFT_LANGUAGE_RULE);
  });

  it('carries the examples and the rule for them only when there are examples', () => {
    const plain = buildDraftPrompt(base);
    expect(plain.system).not.toContain(DRAFT_STYLE_RULE);
    expect(plain.user).not.toContain('yourEarlierMessages');

    const styled = buildDraftPrompt({ ...base, styleSamples: [sample] });
    expect(styled.system).toContain(DRAFT_STYLE_RULE);
    const payload = JSON.parse(styled.user.slice(styled.user.indexOf('{'), styled.user.lastIndexOf('}') + 1));
    expect(payload.yourEarlierMessages).toEqual([{ to: PRIYA, date: sample.date, text: sample.text }]);
    // How the example was matched stays on this machine.
    expect(styled.user).not.toContain('"match"');
    // The thread itself is unchanged by the examples.
    expect(payload.messages).toHaveLength(1);
  });

  it('bounds what it is handed, whatever the caller passes', () => {
    const big = { ...sample, text: 'x'.repeat(5000) };
    const prompt = buildDraftPrompt({ ...base, styleSamples: [big, big, big, big, big, { ...sample, text: '   ' }] });
    const payload = JSON.parse(prompt.user.slice(prompt.user.indexOf('{'), prompt.user.lastIndexOf('}') + 1));
    expect(payload.yourEarlierMessages).toHaveLength(3);
    for (const entry of payload.yourEarlierMessages) expect(entry.text.length).toBeLessThanOrEqual(DRAFT_STYLE_SAMPLE_MAX);
    // Only empty examples: no field and no rule.
    const empty = buildDraftPrompt({ ...base, styleSamples: [{ ...sample, text: '' }] });
    expect(empty.user).not.toContain('yourEarlierMessages');
    expect(empty.system).not.toContain(DRAFT_STYLE_RULE);
  });
});
