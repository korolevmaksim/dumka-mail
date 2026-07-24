import { describe, expect, it } from 'vitest';
import {
  buildInitialDraftBodyWithSignature,
  cleanPastedHtml,
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
  defaultSignature: 'Best regards,\nAlex',
  defaultSignatureHtml: '<div style="color:#444">Best regards,<br><b>Alex</b></div>',
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
  fullName: 'Alex Example',
  role: 'Engineer',
  company: 'Example Co',
  timezone: 'UTC',
};

describe('stripTrailingPlainSignature', () => {
  it('removes only a line-delimited trailing signature', () => {
    expect(stripTrailingPlainSignature('Hello\n\nBest regards,\nAlex', 'Best regards,\nAlex')).toEqual({
      bodyPlain: 'Hello',
      stripped: true,
    });
  });

  it('does not remove matching text embedded in the sentence body', () => {
    expect(stripTrailingPlainSignature('Hello Best regards,\nAlex', 'Best regards,\nAlex')).toEqual({
      bodyPlain: 'Hello Best regards,\nAlex',
      stripped: false,
    });
  });
});

describe('compileDraftBodyHtml', () => {
  it('uses sanitized rich HTML when a draft stores a rich body fragment', () => {
    const html = compileDraftBodyHtml('Hello', compose, 'me@example.com', '<p onclick="x()">Hello <strong>Alex</strong></p><script>alert(1)</script>');

    expect(html).toContain('<strong>Alex</strong>');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<script>');
  });

  it('replaces the plain-text trailing signature with the imported Gmail HTML signature', () => {
    const html = compileDraftBodyHtml('Hello\n\nBest regards,\nAlex', compose);

    expect(html).toContain('Hello');
    expect(html).toContain('<div class="gmail_signature"><div style="color:#444">Best regards,<br><b>Alex</b></div></div>');
    expect(html).not.toContain('Best regards,<br/>Alex');
  });

  it('does not append the HTML signature when the plain signature was not inserted', () => {
    const html = compileDraftBodyHtml('Hello', compose);

    expect(html).toContain('Hello');
    expect(html).not.toContain('gmail_signature');
  });

  it('falls back to normal markdown HTML for plain signatures', () => {
    const html = compileDraftBodyHtml('Hello\n\nBest regards,\nAlex', {
      ...compose,
      defaultSignatureHtml: '',
      signatureFormat: 'plain',
    });

    expect(html).toContain('Best regards,<br/>Alex');
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
        'alex@example.com': {
          signaturePlain: 'Best,\nAlex',
          signatureHtml: '<div style="color:#444">Best,<br><b>Alex</b><br><img src="https://assets.example.com/logo.png" alt="Example Co"></div>',
          signatureFormat: 'html',
        },
      },
    }, profile, 'alex@example.com');

    expect(html).toContain('class="gmail_signature"');
    expect(html).toContain('<b>Alex</b>');
    expect(html).toContain('src="https://assets.example.com/logo.png"');
    expect(html).toContain('alt="Example Co"');
  });

  it('builds a new draft body with an editable leading line before the HTML signature', () => {
    const body = buildInitialDraftBodyWithSignature('', compose, profile);

    expect(body.bodyPlain).toBe('Best regards,\nAlex');
    expect(body.bodyHtml).toContain('<p><br></p>');
    expect(body.bodyHtml).toContain('<div class="gmail_signature"');
    expect(body.bodyHtml).toContain('<b>Alex</b>');
  });

  it('preserves a rich Gmail-style quoted reply after the signature', () => {
    const quoteHtml = '<div class="gmail_quote" data-dumka-quoted-reply="true"><div class="gmail_attr">On Jun 26, Alice wrote:<br></div><blockquote class="gmail_quote" style="margin:0px 0px 0px 0.8ex; border-left:1px solid rgb(204,204,204); padding-left:1ex"><p>Line one<br>Line two</p></blockquote></div>';
    const body = buildInitialDraftBodyWithSignature(
      '\n\nOn Jun 26, Alice wrote:\n> Line one\n> Line two',
      compose,
      profile,
      'alex@example.com',
      quoteHtml,
    );

    expect(body.bodyHtml).toContain('<p><br></p>');
    expect(body.bodyHtml).toContain('<div class="gmail_signature"');
    expect(body.bodyHtml).toContain('data-dumka-quoted-reply="true"');
    expect(body.bodyHtml).toContain('<blockquote class="gmail_quote"');
    expect(body.bodyHtml).not.toContain('&gt; Line one');
  });

  it('replaces the managed signature when the compose account changes', () => {
    const settings: ComposeSettings = {
      ...compose,
      signaturesByAccount: {
        'personal@example.com': {
          signaturePlain: 'Personal Alex',
          signatureHtml: '<div><b>Personal Alex</b><br><img src="https://personal.example/logo.png" alt="Personal"></div>',
          signatureFormat: 'html',
        },
        'work@example.com': {
          signaturePlain: 'Work Alex',
          signatureHtml: '<div><b>Work Alex</b><br><img src="https://assets.example.com/logo.png" alt="Example Co"></div>',
          signatureFormat: 'html',
        },
      },
    };
    const initial = buildInitialDraftBodyWithSignature('', settings, profile, 'personal@example.com');
    const updated = replaceComposeSignatureForAccount(initial.bodyHtml, settings, profile, 'work@example.com');

    expect(updated).toContain('data-dumka-signature-account="work@example.com"');
    expect(updated).toContain('<b>Work Alex</b>');
    expect(updated).toContain('src="https://assets.example.com/logo.png"');
    expect(updated).not.toContain('Personal Alex');
    expect(updated).not.toContain('personal.example');
  });

  it('preserves written body content while replacing the managed signature', () => {
    const settings: ComposeSettings = {
      ...compose,
      signaturesByAccount: {
        'personal@example.com': {
          signaturePlain: 'Personal Alex',
          signatureHtml: '<div><b>Personal Alex</b></div>',
          signatureFormat: 'html',
        },
        'work@example.com': {
          signaturePlain: 'Work Alex',
          signatureHtml: '<div><b>Work Alex</b></div>',
          signatureFormat: 'html',
        },
      },
    };
    const personalSignature = renderComposeSignatureHtmlFragment(settings, profile, 'personal@example.com');
    const updated = replaceComposeSignatureForAccount(`<p>Hello client</p>${personalSignature}`, settings, profile, 'work@example.com');

    expect(updated).toContain('<p>Hello client</p>');
    expect(updated).toContain('<b>Work Alex</b>');
    expect(updated).not.toContain('Personal Alex');
  });
});

describe('cleanPastedHtml', () => {
  it('strips inline styles and fonts while preserving semantic structure', () => {
    const rawHtml = '<p style="font-family: Arial; color: red; background-color: yellow;">Hello <span style="font-size: 20px;"><b>world</b></span></p>';
    const cleaned = cleanPastedHtml(rawHtml);

    expect(cleaned).not.toContain('style');
    expect(cleaned).not.toContain('font-family');
    expect(cleaned).not.toContain('color');
    expect(cleaned).toContain('<b>world</b>');
    expect(cleaned).toContain('Hello');
  });

  it('removes dangerous or non-content tags', () => {
    const rawHtml = '<p>Safe content</p><script>alert(1)</script><style>body { color: red; }</style>';
    const cleaned = cleanPastedHtml(rawHtml);

    expect(cleaned).toContain('Safe content');
    expect(cleaned).not.toContain('<script');
    expect(cleaned).not.toContain('<style');
  });

  it('preserves list structures and links without attributes', () => {
    const rawHtml = '<ul class="MsoList" style="margin:0"><li id="item1"><a href="https://example.com" style="color:blue">Link</a></li></ul>';
    const cleaned = cleanPastedHtml(rawHtml);

    expect(cleaned).toContain('<ul>');
    expect(cleaned).toContain('<li>');
    expect(cleaned).toContain('<a href="https://example.com"');
    expect(cleaned).not.toContain('class=');
    expect(cleaned).not.toContain('id=');
    expect(cleaned).not.toContain('style=');
  });

  it('returns empty string when pasted HTML contains only styled empty tags', () => {
    const rawHtml = '<span style="color: red; font-size: 12px;"></span>';
    const cleaned = cleanPastedHtml(rawHtml);
    expect(cleaned).toBe('');
  });

  it('unwraps span and font tags even if they have extra attributes like align or dir', () => {
    const rawHtml = '<span align="left" dir="ltr" data-custom="1"><font color="red" size="3">Clean text</font></span>';
    const cleaned = cleanPastedHtml(rawHtml);
    expect(cleaned).toBe('Clean text');
  });

  it('uses regex fallback logic when DOMParser is unavailable', () => {
    const originalDOMParser = globalThis.DOMParser;
    // @ts-ignore
    delete globalThis.DOMParser;
    try {
      const rawHtml = '<p style="color: red;" class=MsoNormal id=p1>Fallback <font color=blue>text</font></p>';
      const cleaned = cleanPastedHtml(rawHtml);
      expect(cleaned).not.toContain('style=');
      expect(cleaned).not.toContain('class=');
      expect(cleaned).not.toContain('id=');
      expect(cleaned).not.toContain('<font');
      expect(cleaned).toContain('Fallback text');
    } finally {
      globalThis.DOMParser = originalDOMParser;
    }
  });
});
