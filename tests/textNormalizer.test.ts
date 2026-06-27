import { describe, it, expect } from 'vitest';
import {
  decodeHtmlEntities,
  normalizeWhitespace,
  normalizePreview,
} from '../shared/textNormalizer';

describe('decodeHtmlEntities — named entities', () => {
  it('decodes each supported named entity', () => {
    expect(decodeHtmlEntities('&amp;')).toBe('&');
    expect(decodeHtmlEntities('&apos;')).toBe("'");
    expect(decodeHtmlEntities('&gt;')).toBe('>');
    expect(decodeHtmlEntities('&hellip;')).toBe('...');
    expect(decodeHtmlEntities('&lt;')).toBe('<');
    expect(decodeHtmlEntities('&mdash;')).toBe('-');
    expect(decodeHtmlEntities('&nbsp;')).toBe(' ');
    expect(decodeHtmlEntities('&ndash;')).toBe('-');
    expect(decodeHtmlEntities('&quot;')).toBe('"');
  });

  it('decodes named entities embedded in surrounding text', () => {
    expect(decodeHtmlEntities('Tom &amp; Jerry &lt;3')).toBe('Tom & Jerry <3');
  });

  it('decodes multiple adjacent named entities', () => {
    expect(decodeHtmlEntities('&lt;&gt;&amp;')).toBe('<>&');
  });

  it('is case-sensitive for named entities (AMP is not amp)', () => {
    // Unknown name → leading '&' kept literally, rest passed through.
    expect(decodeHtmlEntities('&AMP;')).toBe('&AMP;');
  });
});

describe('decodeHtmlEntities — numeric entities', () => {
  it('decodes decimal numeric entities', () => {
    expect(decodeHtmlEntities('&#39;')).toBe("'");
    expect(decodeHtmlEntities('&#169;')).toBe('©'); // ©
    expect(decodeHtmlEntities('&#65;')).toBe('A');
  });

  it('decodes lowercase hex numeric entities', () => {
    expect(decodeHtmlEntities('&#x27;')).toBe("'");
    expect(decodeHtmlEntities('&#x41;')).toBe('A');
    expect(decodeHtmlEntities('&#x1F600;')).toBe('\u{1F600}'); // 😀
  });

  it('decodes uppercase-X hex numeric entities', () => {
    expect(decodeHtmlEntities('&#X41;')).toBe('A');
  });

  it('mixes named, decimal and hex entities in one string', () => {
    expect(decodeHtmlEntities('a&amp;b&#39;c&#x3C;d')).toBe("a&b'c<d");
  });
});

describe('decodeHtmlEntities — passthrough / malformed', () => {
  it('returns the string unchanged when there is no ampersand', () => {
    expect(decodeHtmlEntities('plain text, no entities')).toBe(
      'plain text, no entities',
    );
  });

  it('passes through an unknown but short entity name verbatim', () => {
    expect(decodeHtmlEntities('&unknown;')).toBe('&unknown;');
  });

  it('passes through an ampersand with no closing semicolon', () => {
    expect(decodeHtmlEntities('a & b')).toBe('a & b');
    expect(decodeHtmlEntities('Q&A is fun')).toBe('Q&A is fun');
  });

  it('does not decode a run longer than the 16-char guard', () => {
    // 17 chars between '&' and ';' → treated as literal text.
    const long = '&' + 'a'.repeat(17) + ';';
    expect(decodeHtmlEntities(long)).toBe(long);
  });

  it('decodes a name exactly at the 16-char boundary check (still unknown → literal)', () => {
    const boundary = '&' + 'a'.repeat(16) + ';';
    expect(decodeHtmlEntities(boundary)).toBe(boundary);
  });

  it('passes through empty numeric entities', () => {
    expect(decodeHtmlEntities('&#;')).toBe('&#;');
    expect(decodeHtmlEntities('&#x;')).toBe('&#x;');
  });

  it('passes through numeric entities with non-digit characters', () => {
    expect(decodeHtmlEntities('&#12x3;')).toBe('&#12x3;');
    expect(decodeHtmlEntities('&#xZZ;')).toBe('&#xZZ;');
  });

  it('rejects surrogate code points', () => {
    expect(decodeHtmlEntities('&#xD800;')).toBe('&#xD800;');
    expect(decodeHtmlEntities('&#55296;')).toBe('&#55296;'); // 0xD800 decimal
  });

  it('rejects code points above the Unicode maximum', () => {
    expect(decodeHtmlEntities('&#x110000;')).toBe('&#x110000;');
  });

  it('keeps trailing literal text after a decoded entity (&amp;amp;)', () => {
    // First "&amp;" decodes; remaining "amp;" has no '&' and is emitted as-is.
    expect(decodeHtmlEntities('&amp;amp;')).toBe('&amp;');
  });

  it('re-scans after a literal ampersand so a later entity still decodes', () => {
    expect(decodeHtmlEntities('&foo &amp; bar')).toBe('&foo & bar');
  });
});

describe('normalizeWhitespace', () => {
  it('collapses runs of spaces into a single space', () => {
    expect(normalizeWhitespace('hello    world')).toBe('hello world');
  });

  it('collapses tabs and newlines and trims', () => {
    expect(normalizeWhitespace('  line1\n\nline2\tend  ')).toBe(
      'line1 line2 end',
    );
  });

  it('returns an empty string for whitespace-only input', () => {
    expect(normalizeWhitespace('   \n\t  ')).toBe('');
    expect(normalizeWhitespace('')).toBe('');
  });

  it('leaves already-normalized text unchanged', () => {
    expect(normalizeWhitespace('clean single line')).toBe('clean single line');
  });
});

describe('normalizePreview', () => {
  it('decodes entities and collapses whitespace together', () => {
    expect(normalizePreview('Tom   &amp;   Jerry')).toBe('Tom & Jerry');
  });

  it('treats decoded nbsp as collapsible whitespace and trims', () => {
    expect(normalizePreview('&nbsp;&nbsp;hello&hellip;')).toBe('hello...');
  });

  it('produces a clean single line from messy HTML-ish input', () => {
    const input = '  Hi &amp;\n  welcome&#33;\tEnjoy&nbsp;your stay  ';
    expect(normalizePreview(input)).toBe('Hi & welcome! Enjoy your stay');
  });

  it('returns an empty string for empty input', () => {
    expect(normalizePreview('')).toBe('');
  });
});
