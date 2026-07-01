import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hasRemoteImages, removeDarkColorSchemeMediaRules } from '../renderer/src/components/SafeHtmlRenderer';

function indexCsp(): string {
  const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  return match?.[1] || '';
}

function cspDirective(csp: string, directive: string): string[] {
  const entry = csp
    .split(';')
    .map(part => part.trim())
    .find(part => part.startsWith(`${directive} `));
  return entry ? entry.split(/\s+/).slice(1) : [];
}

describe('hasRemoteImages', () => {
  it('detects remote image src values', () => {
    expect(hasRemoteImages('<img src="http://example.com/a.png">')).toBe(true);
    expect(hasRemoteImages("<img src='https://example.com/a.png'>")).toBe(true);
  });

  it('detects remote srcset and source values', () => {
    expect(hasRemoteImages('<source srcset="https://example.com/a.png 1x, https://example.com/b.png 2x">')).toBe(true);
    expect(hasRemoteImages('<img srcset="//example.com/a.png 1x">')).toBe(true);
  });

  it('detects remote CSS image URLs', () => {
    expect(hasRemoteImages('<td style="background:url(http://example.com/bg.png)">')).toBe(true);
  });

  it('ignores local cid and data image references', () => {
    expect(hasRemoteImages('<img src="cid:hero"><img src="data:image/png;base64,AAAA">')).toBe(false);
  });
});

describe('removeDarkColorSchemeMediaRules', () => {
  it('removes dark color-scheme media rules while preserving normal styles', () => {
    const css = `
      .primary-text { color: #3c4043 !important; }
      @media (prefers-color-scheme: dark) {
        .primary-text { color: #e8eaed !important; }
        .primary-button { background-color: #8ab4f8 !important; }
      }
      @media only screen and (max-width: 580px) {
        .main-container-inner { padding: 12px !important; }
      }
    `;

    const sanitized = removeDarkColorSchemeMediaRules(css);

    expect(sanitized).toContain('#3c4043');
    expect(sanitized).not.toContain('#e8eaed');
    expect(sanitized).not.toContain('#8ab4f8');
    expect(sanitized).toContain('max-width: 580px');
  });

  it('ignores media-looking text inside strings and comments', () => {
    const css = `
      .hero { background-image: url("@media (prefers-color-scheme: dark)"); }
      /* @media (prefers-color-scheme: dark) { .hero { color: white; } } */
      @media (prefers-color-scheme: dark) {
        .hero { color: #ffffff; }
      }
      .hero { color: #111111; }
    `;

    const sanitized = removeDarkColorSchemeMediaRules(css);

    expect(sanitized).toContain('background-image');
    expect(sanitized).toContain('#111111');
    expect(sanitized).not.toContain('#ffffff');
  });
});

describe('application CSP', () => {
  it('allows http and https images so email iframes can load inherited remote image sources', () => {
    const imgSrc = cspDirective(indexCsp(), 'img-src');
    expect(imgSrc).toContain('https:');
    expect(imgSrc).toContain('http:');
  });
});
