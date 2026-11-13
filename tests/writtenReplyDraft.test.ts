import { describe, expect, it } from 'vitest';
import { buildWrittenReplyDraftBody, stripSignOffName, writtenReplyPreviewPlain } from '../shared/draftHtml';
import type { ComposeSettings, ProfileSettings } from '../shared/types';

const compose: ComposeSettings = {
  defaultSignature: 'Alex Morgan\nHead of Rollouts · Northwind',
  defaultSignatureHtml: '',
  signatureFormat: 'plain',
  signaturesByAccount: {},
  autoSaveDrafts: true,
  spellCheck: true,
  smartCompose: true,
  alwaysReplyAll: false,
  sendUndoDelay: 10,
  defaultFontSize: 'normal',
  afterSend: 'archive',
};
const noSignature: ComposeSettings = { ...compose, defaultSignature: '' };
const profile: ProfileSettings = { fullName: 'Alex Morgan', role: '', company: '', timezone: 'Europe/Berlin' };

const reply = 'Daniel,\n\nUnderstood — you will have all three by Wednesday 5pm.\n\nAlex';
const quote = '\n\nOn Nov 12, Daniel Okafor wrote:\n> I still need three things from you.';

describe('a reply that starts from written text', () => {
  it('puts the reply first, then the signature, then the quote', () => {
    const { bodyPlain, bodyHtml } = buildWrittenReplyDraftBody(reply, quote, null, compose, profile);
    const order = ['Daniel,', 'Understood', 'Alex Morgan', 'Head of Rollouts', 'On Nov 12, Daniel Okafor wrote:'].map(part => bodyPlain.indexOf(part));
    expect(order.every(index => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(bodyPlain.startsWith('Daniel,')).toBe(true);
    const html = bodyHtml || '';
    expect(html.indexOf('Understood')).toBeLessThan(html.indexOf('Alex Morgan'));
    expect(html.indexOf('Alex Morgan')).toBeLessThan(html.indexOf('Daniel Okafor wrote'));
  });

  it('does not sign the letter twice', () => {
    const { bodyPlain } = buildWrittenReplyDraftBody(reply, quote, null, compose, profile);
    expect(bodyPlain.match(/Alex/g)).toHaveLength(1);
    expect(bodyPlain).toContain('by Wednesday 5pm.\n\nAlex Morgan');
  });

  it('keeps the name the reply ends with when there is no signature', () => {
    const { bodyPlain } = buildWrittenReplyDraftBody(reply, quote, null, noSignature, profile);
    expect(bodyPlain.startsWith(reply)).toBe(true);
    expect(bodyPlain).toContain('On Nov 12, Daniel Okafor wrote:');
  });

  it('falls back to the ordinary reply layout when there is no written text', () => {
    const { bodyPlain } = buildWrittenReplyDraftBody('  ', quote, null, compose, profile);
    expect(bodyPlain.startsWith('Alex Morgan')).toBe(true);
  });
});

describe('stripSignOffName', () => {
  const signature = 'Alex Morgan\nHead of Rollouts';

  it('removes a last line that is just the sender’s name', () => {
    expect(stripSignOffName('Thanks.\n\nBest,\nAlex', signature)).toBe('Thanks.\n\nBest,');
    expect(stripSignOffName('Thanks.\n\nAlex Morgan', signature)).toBe('Thanks.');
    expect(stripSignOffName('Thanks.\n\nalex,', signature)).toBe('Thanks.');
  });

  it('leaves everything else alone', () => {
    expect(stripSignOffName('Thanks, Alex will join.', signature)).toBe('Thanks, Alex will join.');
    expect(stripSignOffName('Thanks.\n\nSofia', signature)).toBe('Thanks.\n\nSofia');
    expect(stripSignOffName('Alex', signature)).toBe('Alex');
    expect(stripSignOffName('Thanks.\n\nAlex', '')).toBe('Thanks.\n\nAlex');
  });
});

describe('the preview of a written reply before Send', () => {
  it('shows the reply with the signature that will be sent, and no quote', () => {
    const preview = writtenReplyPreviewPlain(reply, compose, profile);
    expect(preview).toBe('Daniel,\n\nUnderstood — you will have all three by Wednesday 5pm.\n\nAlex Morgan\nHead of Rollouts · Northwind');
    // The same reply-and-signature text opens the body that is actually sent.
    expect(buildWrittenReplyDraftBody(reply, quote, null, compose, profile).bodyPlain.startsWith(preview)).toBe(true);
  });

  it('is just the reply when the account has no signature', () => {
    expect(writtenReplyPreviewPlain(reply, noSignature, profile)).toBe(reply);
  });
});
