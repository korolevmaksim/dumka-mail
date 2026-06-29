import { describe, expect, it } from 'vitest';
import { compileDraftBodyHtml, stripTrailingPlainSignature } from '../shared/draftHtml';
import type { ComposeSettings } from '../shared/types';

const compose: ComposeSettings = {
  defaultSignature: 'Best regards,\nMax',
  defaultSignatureHtml: '<div style="color:#444">Best regards,<br><b>Max</b></div>',
  signatureFormat: 'html',
  signaturesByAccount: {},
  autoSaveDrafts: true,
  spellCheck: true,
  autocorrect: true,
  smartCompose: true,
  alwaysReplyAll: false,
  sendUndoDelay: 10,
  defaultFontSize: 'normal',
};

describe('stripTrailingPlainSignature', () => {
  it('removes only a line-delimited trailing signature', () => {
    expect(stripTrailingPlainSignature('Hello\n\nBest regards,\nMax', 'Best regards,\nMax')).toEqual({
      bodyPlain: 'Hello',
      stripped: true,
    });
  });

  it('does not remove matching text embedded in the sentence body', () => {
    expect(stripTrailingPlainSignature('Hello Best regards,\nMax', 'Best regards,\nMax')).toEqual({
      bodyPlain: 'Hello Best regards,\nMax',
      stripped: false,
    });
  });
});

describe('compileDraftBodyHtml', () => {
  it('replaces the plain-text trailing signature with the imported Gmail HTML signature', () => {
    const html = compileDraftBodyHtml('Hello\n\nBest regards,\nMax', compose);

    expect(html).toContain('Hello');
    expect(html).toContain('<div class="gmail_signature"><div style="color:#444">Best regards,<br><b>Max</b></div></div>');
    expect(html).not.toContain('Best regards,<br/>Max');
  });

  it('does not append the HTML signature when the plain signature was not inserted', () => {
    const html = compileDraftBodyHtml('Hello', compose);

    expect(html).toContain('Hello');
    expect(html).not.toContain('gmail_signature');
  });

  it('falls back to normal markdown HTML for plain signatures', () => {
    const html = compileDraftBodyHtml('Hello\n\nBest regards,\nMax', {
      ...compose,
      defaultSignatureHtml: '',
      signatureFormat: 'plain',
    });

    expect(html).toContain('Best regards,<br/>Max');
    expect(html).not.toContain('gmail_signature');
  });

  it('uses the signature stored for the draft account', () => {
    const html = compileDraftBodyHtml('Hello\n\nRegards,\nAlice', {
      ...compose,
      signaturesByAccount: {
        'alice@example.com': {
          signaturePlain: 'Regards,\nAlice',
          signatureHtml: '<div>Regards,<br><i>Alice</i></div>',
          signatureFormat: 'html',
          sourceEmail: 'alice@example.com',
          importedAt: '2026-06-29T10:00:00.000Z',
        },
        'bob@example.com': {
          signaturePlain: 'Cheers,\nBob',
          signatureHtml: '<div>Cheers,<br><b>Bob</b></div>',
          signatureFormat: 'html',
        },
      },
    }, 'alice@example.com');

    expect(html).toContain('<div class="gmail_signature"><div>Regards,<br><i>Alice</i></div></div>');
    expect(html).not.toContain('Bob');
  });
});
