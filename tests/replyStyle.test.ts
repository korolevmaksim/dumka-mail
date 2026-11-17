// "Reply in my voice": which of the person's own earlier messages are handed
// to the model as examples of how they write, and what is never included.
import { describe, expect, it } from 'vitest';
import { buildDraftPrompt, DRAFT_LANGUAGE_RULE, DRAFT_STYLE_RULE, DRAFT_STYLE_SAMPLE_MAX } from '../shared/agentPrompts';
import {
  REPLY_STYLE_MAX_SAMPLES,
  REPLY_STYLE_SAMPLE_MAX,
  accountSignaturePlain,
  ownAuthoredText,
  replyRecipientEmail,
  replyStyleEnabled,
  replyStyleText,
  selectReplyStyleSamples,
  stripSignature,
  type OwnMessage,
  type ReplyStyleSample,
} from '../shared/replyStyle';
import { replyRecipients } from '../shared/compose';
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

/** An HTML-only own message to Priya. */
function own_(_label: string, bodyHtml: string): OwnMessage {
  return own(PRIYA, '', { bodyPlain: null, bodyHtml, snippet: '' });
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

  it('never takes an example from a message that has only an HTML body', () => {
    const own = 'Thanks, that works for me and I will confirm the room on Monday.';
    const theirs = 'CONFIDENTIAL figures from the other party that must never be sent with another draft';
    const htmlBodies = [
      `<div dir="ltr">${own}</div><br><div class="gmail_quote"><blockquote class="gmail_quote">${theirs}</blockquote></div>`,
      `<div>${own}</div><blockquote type="cite"><div>${theirs}</div></blockquote>`,
      `<div>${own}</div><div id="divRplyFwdMsg"><b>From:</b> Priya<br><b>Sent:</b> Monday</div><div>${theirs}</div>`,
      // Quotations no markup rule can find: sibling and nested blocks, preformatted text, inline runs.
      `<div>Thanks!</div><div>&gt; ${theirs}</div>`,
      `<div>Thanks<div>&gt; ${theirs}</div></div>`,
      `<pre>Thanks\n&gt; ${theirs}</pre>`,
      `<span>Thanks</span> <span>&gt; ${theirs}</span>`,
      `<div>${own} ${theirs}</div>`,
      // Even one that quotes nothing: HTML alone is never read.
      `<p>${own}</p>`,
    ];
    for (const bodyHtml of htmlBodies) {
      expect(replyStyleText({ bodyPlain: null, bodyHtml, snippet: '' })).toBe('');
      expect(replyStyleText({ bodyPlain: '', bodyHtml, snippet: own.slice(0, 40) })).toBe('');
      // A plain body that only repeats the snippet is a placeholder for the HTML one.
      expect(replyStyleText({ bodyPlain: 'Thanks, that works', bodyHtml, snippet: 'Thanks, that works' })).toBe('');
      expect(select([own_('html only', bodyHtml)])).toEqual([]);
    }
    // With a real plain body the plain body is read, whatever the HTML holds.
    expect(replyStyleText({ bodyPlain: `${own}\n\nOn Mon, Nov 9, 2026 Priya wrote:\n> ${theirs}`, bodyHtml: `<blockquote>${theirs}</blockquote>`, snippet: '' })).toBe(own);
    expect(ownAuthoredText({ bodyPlain: own, bodyHtml: `<div>${theirs}</div>`, snippet: 'Thanks, that works' })).toBe(own);
  });

  it('never lets a quotation in: a header or a quoted line at the very top, wrapped headers, unmarked quotations', () => {
    const theirs = 'CONFIDENTIAL figures from the other party that must never be sent with another draft';
    const mine = 'I agree with the plan and will send the signed copy back tomorrow morning.';
    // A bottom-posted reply: the quoted headers open the message, so nothing of it is an example.
    const bottomPosted = `From: Alice\nSent: Monday\nTo: Me\n\n${theirs}\n\n${mine}`;
    expect(replyStyleText({ bodyPlain: bottomPosted, bodyHtml: null, snippet: '' })).toBe('');
    expect(replyStyleText({ bodyPlain: `> ${theirs}\n\n${mine}`, bodyHtml: null, snippet: '' })).toBe('');
    expect(replyStyleText({ bodyPlain: `On Mon, Nov 9, 2026 at 10:00 Alice wrote:\n${theirs}\n\n${mine}`, bodyHtml: null, snippet: '' })).toBe('');
    expect(replyStyleText({ bodyPlain: `-----Original Message-----\nFrom: Alice\n\n${theirs}`, bodyHtml: null, snippet: '' })).toBe('');
    expect(replyStyleText({ bodyPlain: `Begin forwarded message:\n\n${theirs}`, bodyHtml: null, snippet: '' })).toBe('');
    // Outlook: a rule of underscores, then the quoted headers, no > marks.
    expect(replyStyleText({ bodyPlain: `${mine}\n\n________________________________\nFrom: Alice <a@x.example>\nSent: Monday\nSubject: Plan\n\n${theirs}`, bodyHtml: null, snippet: '' })).toBe(mine);
    // The attribution wrapped by the mail client over two or three lines.
    expect(replyStyleText({ bodyPlain: `${mine}\n\nOn Mon, Nov 9, 2026 at 10:00 AM Priya Raman <priya.raman@lumenlabs.example>\nwrote:\n\n${theirs}`, bodyHtml: null, snippet: '' })).toBe(mine);
    expect(replyStyleText({ bodyPlain: `${mine}\n\nOn Mon, Nov 9, 2026 at 10:00 AM\nPriya Raman <priya.raman@lumenlabs.example>\nwrote:\n${theirs}`, bodyHtml: null, snippet: '' })).toBe(mine);
    expect(replyStyleText({ bodyPlain: `${mine}\n\nпн, 9 нояб. 2026 г. в 10:00, Priya Raman\n<priya.raman@lumenlabs.example>:\n\n${theirs}`, bodyHtml: null, snippet: '' })).toBe(mine);
    // None of these can become an example through the selection either.
    for (const bodyPlain of [bottomPosted, `> ${theirs}\n\nOk.`]) {
      expect(select([own(PRIYA, bodyPlain)])).toEqual([]);
    }
    // A quotation mark that follows a sentence on the same line.
    expect(replyStyleText({ bodyPlain: `Thanks! > ${theirs}`, bodyHtml: null, snippet: '' })).toBe('Thanks!');
  });

  it('takes nothing from a message that has no body, and leaves ordinary text alone', () => {
    // A snippet cannot be told apart from what it quotes.
    expect(replyStyleText({ bodyPlain: null, bodyHtml: null, snippet: 'Thanks, that works for me and I will confirm the room on Monday.' })).toBe('');
    expect(select([own(PRIYA, '', { bodyPlain: null, bodyHtml: null, snippet: LONG })])).toEqual([]);
    const ordinary = [
      'Hi Priya,',
      '',
      'On Monday we should talk about the plan: I wrote down three points.',
      'From: my side nothing is blocking. Dates and costs are in the sheet.',
      '---',
      'A line of dashes is not a quotation.',
      'Costs: 3 > 2, so we take the second offer.',
    ].join('\n');
    expect(replyStyleText({ bodyPlain: ordinary, bodyHtml: null, snippet: '' })).toBe(ordinary);
  });

  it('cuts quoted mail under a header written in another language, with or without > marks', () => {
    const own = 'Спасибо, меня это устраивает. В понедельник подтвержу переговорную.';
    const theirs = 'КОНФИДЕНЦИАЛЬНО: цифры другой стороны';
    const plainBodies = [
      // Gmail, Russian interface.
      `${own}\n\nпн, 9 нояб. 2026 г. в 10:00, Priya Raman <priya.raman@lumenlabs.example>:\n> ${theirs}`,
      `${own}\n\n9 ноября 2026 г., 10:00 Прия Раман написал(а):\n> ${theirs}`,
      `${own}\n\nПрия Раман пишет:\n${theirs}`,
      // Outlook quotes without > marks.
      `${own}\n\nОт: Прия Раман\nОтправлено: понедельник, 9 ноября 2026 г. 10:00\nКому: Алекс\nТема: Пилот\n\n${theirs}`,
      `${own}\n\n-----Исходное сообщение-----\n${theirs}`,
      `${own}\n\nAm 09.11.2026 um 10:00 schrieb Priya Raman:\n${theirs}`,
      `${own}\n\nLe 9 nov. 2026 à 10:00, Priya Raman a écrit :\n${theirs}`,
    ];
    for (const bodyPlain of plainBodies) {
      const text = replyStyleText({ bodyPlain, bodyHtml: null, snippet: '' });
      expect(text).toContain('подтвержу переговорную.');
      expect(text).not.toContain('КОНФИДЕНЦИАЛЬНО');
    }
    // Ordinary sentences are not headers: a colon in the person's own text stays.
    const ordinary = 'Коллеги, план такой: сначала пилот, потом раскатка.\nОт: себя добавлю, что сроки реальные.';
    expect(replyStyleText({ bodyPlain: ordinary, bodyHtml: null, snippet: '' })).toBe(ordinary);
  });

  it('honours the limit', () => {
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
    senderEmail, senderName: '', receivedAt: `2026-11-17T10:${String(minute).padStart(2, '0')}:00.000Z`, labelIds: ['INBOX'], to: [{ name: '', email: ME }], cc: [], ...extra,
  });
  /** What the reply editor itself would address the reply to. */
  const editorTarget = (last: ReturnType<typeof message>) => replyRecipients(last, ME, true).to[0]?.email.toLowerCase() || '';

  it('is the sender of the newest message when that one is inbound', () => {
    expect(replyRecipientEmail([message(PRIYA, 1), message('Daniel@Northwind.example', 5)], ME)).toBe('daniel@northwind.example');
    expect(replyRecipientEmail([message(ME, 1, { labelIds: ['SENT'], to: [{ name: '', email: PRIYA }] }), message('daniel@northwind.example', 5)], ME)).toBe('daniel@northwind.example');
  });

  it('is who the newest own message was addressed to, as the reply editor resolves a follow-up', () => {
    // Alice wrote, then the person addressed Bob in the same thread: the follow-up goes to Bob.
    const toBob = { labelIds: ['SENT'], to: [{ name: 'Bob', email: 'Bob@Elsewhere.example' }] };
    expect(replyRecipientEmail([message(PRIYA, 1), message(ME, 9, toBob)], ME)).toBe('bob@elsewhere.example');
    // The same for a send-as alias, which is the account's own message too.
    expect(replyRecipientEmail([message(PRIYA, 1), message('alias@northwind.example', 9, toBob)], ME)).toBe('bob@elsewhere.example');
  });

  it('promotes a Cc recipient when the own message is addressed only to the account', () => {
    const onlyCc = message(ME, 9, { labelIds: ['SENT'], to: [{ name: '', email: ME }], cc: [{ name: 'Bob', email: 'bob@elsewhere.example' }] });
    expect(replyRecipientEmail([message(PRIYA, 1), onlyCc], ME)).toBe('bob@elsewhere.example');
  });

  it('never disagrees with the reply editor, whatever the shape of the newest message', () => {
    const shapes = [
      message(PRIYA, 9),
      message(PRIYA, 9, { to: [], cc: [] }),
      message(ME, 9, { labelIds: ['SENT'], to: [{ name: '', email: PRIYA }, { name: '', email: 'bob@elsewhere.example' }] }),
      message(ME, 9, { labelIds: ['SENT'], to: [{ name: '', email: ME }], cc: [{ name: '', email: 'bob@elsewhere.example' }] }),
      message(ME, 9, { labelIds: ['SENT'], to: [{ name: '', email: ME }] }),
      message(ME, 9, { labelIds: ['SENT'], to: [], cc: [] }),
      message('alias@northwind.example', 9, { labelIds: ['SENT'], to: [{ name: '', email: PRIYA }] }),
      message(PRIYA, 9, { to: [{ name: '', email: 'list@x.example' }], cc: [{ name: '', email: ME }] }),
    ];
    for (const last of shapes) {
      expect(replyRecipientEmail([message('older@x.example', 1), last], ME)).toBe(editorTarget(last));
    }
    expect(replyRecipientEmail([], ME)).toBe('');
    // An own message that names nobody else: the editor has no recipient, and neither do we.
    expect(replyRecipientEmail([message(PRIYA, 1), message(ME, 9, { labelIds: ['SENT'], to: [{ name: '', email: ME }] })], ME)).toBe('');
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
    // Metadata is bounded too: a date is a fixed-length timestamp or nothing.
    const hostile = buildDraftPrompt({ ...base, styleSamples: [
      { ...sample, date: 'x'.repeat(100_000), to: 'y'.repeat(100_000) },
      { ...sample, date: 'Nov 10, 2026 09:00 UTC' },
      { ...sample, date: 5 as unknown as string, to: null as unknown as string, text: 7 as unknown as string },
    ] });
    expect(hostile.user.length).toBeLessThan(3000);
    const hostilePayload = JSON.parse(hostile.user.slice(hostile.user.indexOf('{'), hostile.user.lastIndexOf('}') + 1));
    expect(hostilePayload.yourEarlierMessages.map((entry: { date: string }) => entry.date)).toEqual(['', '2026-11-10T09:00:00.000Z']);
    expect(hostilePayload.yourEarlierMessages[0].to.length).toBeLessThanOrEqual(240);
    // Only empty examples: no field and no rule.
    const empty = buildDraftPrompt({ ...base, styleSamples: [{ ...sample, text: '' }] });
    expect(empty.user).not.toContain('yourEarlierMessages');
    expect(empty.system).not.toContain(DRAFT_STYLE_RULE);
  });
});
