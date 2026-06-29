import { describe, expect, it } from 'vitest';
import {
  buildInitialDraftBodyWithSignature,
  compileDraftBodyHtml,
  htmlFragmentToPlainText,
  plainTextToHtmlFragment,
  renderComposeSignatureHtmlFragment,
  replaceComposeSignatureForAccount,
  sanitizeDraftHtmlFragment,
  stripTrailingPlainSignature,
} from '../shared/draftHtml';
import type { ProfileSettings } from '../shared/types';
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

const profile: ProfileSettings = {
  fullName: 'Max Korolyov',
  role: 'Engineer',
  company: 'Example Co',
  timezone: 'UTC',
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
  it('uses sanitized rich HTML when a draft stores a rich body fragment', () => {
    const html = compileDraftBodyHtml('Hello', compose, 'me@example.com', '<p onclick="x()">Hello <strong>Max</strong></p><script>alert(1)</script>');

    expect(html).toContain('<strong>Max</strong>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>');
  });

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

describe('rich draft HTML helpers', () => {
  it('converts plain text into paragraph HTML', () => {
    expect(plainTextToHtmlFragment('Hello\nthere\n\nNext')).toBe('<p>Hello<br>there</p><p>Next</p>');
  });

  it('sanitizes active HTML and converts fragments to plain text', () => {
    const html = sanitizeDraftHtmlFragment('<p>Hello<br>there</p><img src="cid:x" alt="Chart"><script>bad()</script>');

    expect(html).toContain('cid:x');
    expect(html).not.toContain('<script>');
    expect(htmlFragmentToPlainText(html)).toBe('Hello\nthere\nChart');
  });

  it('renders the selected account HTML signature with formatting and images', () => {
    const html = renderComposeSignatureHtmlFragment({
      ...compose,
      signaturesByAccount: {
        'max@example.com': {
          signaturePlain: 'Best,\nMax',
          signatureHtml: '<div style="color:#444">Best,<br><b>Max</b><br><img src="https://example.com/logo.png" alt="Example Co"></div>',
          signatureFormat: 'html',
        },
      },
    }, profile, 'max@example.com');

    expect(html).toContain('class="gmail_signature"');
    expect(html).toContain('<b>Max</b>');
    expect(html).toContain('src="https://example.com/logo.png"');
    expect(html).toContain('alt="Example Co"');
  });

  it('builds a new draft body with an editable leading line before the HTML signature', () => {
    const body = buildInitialDraftBodyWithSignature('', compose, profile);

    expect(body.bodyPlain).toBe('Best regards,\nMax');
    expect(body.bodyHtml).toContain('<p><br></p>');
    expect(body.bodyHtml).toContain('<div class="gmail_signature"');
    expect(body.bodyHtml).toContain('<b>Max</b>');
  });

  it('replaces the managed signature when the compose account changes', () => {
    const settings: ComposeSettings = {
      ...compose,
      signaturesByAccount: {
        'personal@example.com': {
          signaturePlain: 'Personal Max',
          signatureHtml: '<div><b>Personal Max</b><br><img src="https://personal.example/logo.png" alt="Personal"></div>',
          signatureFormat: 'html',
        },
        'work@example.com': {
          signaturePlain: 'Work Max',
          signatureHtml: '<div><b>Work Max</b><br><img src="https://example.com/logo.png" alt="Example Co"></div>',
          signatureFormat: 'html',
        },
      },
    };
    const initial = buildInitialDraftBodyWithSignature('', settings, profile, 'personal@example.com');
    const updated = replaceComposeSignatureForAccount(initial.bodyHtml, settings, profile, 'work@example.com');

    expect(updated).toContain('data-dumka-signature-account="work@example.com"');
    expect(updated).toContain('<b>Work Max</b>');
    expect(updated).toContain('src="https://example.com/logo.png"');
    expect(updated).not.toContain('Personal Max');
    expect(updated).not.toContain('personal.example');
  });

  it('preserves written body content while replacing the managed signature', () => {
    const settings: ComposeSettings = {
      ...compose,
      signaturesByAccount: {
        'personal@example.com': {
          signaturePlain: 'Personal Max',
          signatureHtml: '<div><b>Personal Max</b></div>',
          signatureFormat: 'html',
        },
        'work@example.com': {
          signaturePlain: 'Work Max',
          signatureHtml: '<div><b>Work Max</b></div>',
          signatureFormat: 'html',
        },
      },
    };
    const personalSignature = renderComposeSignatureHtmlFragment(settings, profile, 'personal@example.com');
    const updated = replaceComposeSignatureForAccount(`<p>Hello client</p>${personalSignature}`, settings, profile, 'work@example.com');

    expect(updated).toContain('<p>Hello client</p>');
    expect(updated).toContain('<b>Work Max</b>');
    expect(updated).not.toContain('Personal Max');
  });
});
