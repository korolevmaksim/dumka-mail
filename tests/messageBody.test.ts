import { describe, it, expect } from 'vitest';
import {
  INITIAL_PLAINTEXT_LIMIT,
  planPlainText,
  resolveInlineCids,
} from '../shared/messageBody';
import type { AttachmentMetadata } from '../shared/types';

function attachment(overrides: Partial<AttachmentMetadata>): AttachmentMetadata {
  return {
    id: 'att-1',
    filename: 'inline.png',
    mimeType: 'image/png',
    sizeBytes: 1024,
    base64Data: 'QUJD', // "ABC"
    contentId: 'logo',
    ...overrides,
  };
}

describe('planPlainText', () => {
  it('returns text verbatim when shorter than the cap', () => {
    const plan = planPlainText('Hello world', 100);
    expect(plan).toEqual({ text: 'Hello world', truncated: false, fullLength: 11 });
  });

  it('does not truncate when length equals the cap exactly', () => {
    const text = 'abcdefghij'; // 10 chars
    const plan = planPlainText(text, 10);
    expect(plan.truncated).toBe(false);
    expect(plan.text).toBe(text);
    expect(plan.fullLength).toBe(10);
  });

  it('truncates and appends an ellipsis when longer than the cap', () => {
    const plan = planPlainText('Hello world foobar baz', 10);
    expect(plan.truncated).toBe(true);
    expect(plan.fullLength).toBe(22);
    expect(plan.text.endsWith('\n\n...')).toBe(true);
    // Reports the FULL original length, not the truncated length.
    expect(plan.fullLength).toBeGreaterThan(plan.text.length - 5);
  });

  it('backs off to a word boundary instead of splitting a word', () => {
    // cap 10 lands inside "world" ("Hello worl|d"); should cut back to "Hello".
    const plan = planPlainText('Hello world foobar baz', 10);
    expect(plan.text).toBe('Hello\n\n...');
  });

  it('keeps a whole word when the cap lands exactly on a space boundary', () => {
    // cap 5 -> next char is a space, so "Hello" is a complete word, no back-off.
    const plan = planPlainText('Hello world', 5);
    expect(plan.text).toBe('Hello\n\n...');
    expect(plan.truncated).toBe(true);
  });

  it('cuts at the cap when there is no whitespace to back off to', () => {
    const plan = planPlainText('abcdefghijspill', 10);
    expect(plan.truncated).toBe(true);
    expect(plan.text).toBe('abcdefghij\n\n...');
  });

  it('trims surrounding whitespace from the truncated prefix', () => {
    const plan = planPlainText('  leading words here are plenty', 12);
    expect(plan.truncated).toBe(true);
    expect(plan.text.startsWith(' ')).toBe(false);
    expect(/\s$/.test(plan.text.replace(/\n\n\.\.\.$/, ''))).toBe(false);
  });

  it('defaults the cap to 12000 characters', () => {
    const long = 'a'.repeat(INITIAL_PLAINTEXT_LIMIT + 500);
    const plan = planPlainText(long);
    expect(plan.truncated).toBe(true);
    expect(plan.fullLength).toBe(INITIAL_PLAINTEXT_LIMIT + 500);
    // Truncated body never exceeds the cap plus the ellipsis suffix.
    expect(plan.text.length).toBeLessThanOrEqual(INITIAL_PLAINTEXT_LIMIT + 5);
  });

  it('does not truncate a body that is exactly at the default cap', () => {
    const exact = 'a'.repeat(INITIAL_PLAINTEXT_LIMIT);
    const plan = planPlainText(exact);
    expect(plan.truncated).toBe(false);
    expect(plan.text).toBe(exact);
  });
});

describe('resolveInlineCids', () => {
  it('replaces a src="cid:..." reference with a data URI', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe('<img src="data:image/png;base64,QUJD">');
  });

  it('normalizes Gmail base64url data before building data URIs', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo', base64Data: 'SGVsbG8td29ybGQ_' })]);
    expect(result).toBe('<img src="data:image/png;base64,SGVsbG8td29ybGQ/">');
  });

  it('matches single-quoted cid references', () => {
    const html = "<img src='cid:logo'>";
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe("<img src='data:image/png;base64,QUJD'>");
  });

  it('normalizes content-ids: strips angle brackets and lowercases', () => {
    const html = '<img src="cid:Logo">';
    const result = resolveInlineCids(html, [attachment({ contentId: '<LOGO>' })]);
    expect(result).toBe('<img src="data:image/png;base64,QUJD">');
  });

  it('percent-decodes the cid reference before matching', () => {
    const html = '<img src="cid:my%20logo">';
    const result = resolveInlineCids(html, [attachment({ contentId: 'my logo' })]);
    expect(result).toBe('<img src="data:image/png;base64,QUJD">');
  });

  it('replaces every occurrence of a matched cid', () => {
    const html = '<img src="cid:logo"><img src="cid:logo">';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe(
      '<img src="data:image/png;base64,QUJD"><img src="data:image/png;base64,QUJD">'
    );
  });

  it('uses the first attachment when multiple share a content-id', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [
      attachment({ contentId: 'logo', base64Data: 'Rmlyc3Q=' }),
      attachment({ id: 'att-2', contentId: 'logo', base64Data: 'U2Vjb25k' }),
    ]);
    expect(result).toBe('<img src="data:image/png;base64,Rmlyc3Q=">');
  });

  it('leaves references with no matching attachment untouched', () => {
    const html = '<img src="cid:missing">';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe('<img src="cid:missing">');
  });

  it('ignores non-image attachments', () => {
    const html = '<img src="cid:doc">';
    const result = resolveInlineCids(html, [
      attachment({ contentId: 'doc', mimeType: 'application/pdf' }),
    ]);
    expect(result).toBe('<img src="cid:doc">');
  });

  it('ignores attachments without inline base64 data', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [
      attachment({ contentId: 'logo', base64Data: undefined }),
    ]);
    expect(result).toBe('<img src="cid:logo">');
  });

  it('ignores attachments with empty / whitespace base64 data', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [
      attachment({ contentId: 'logo', base64Data: '   ' }),
    ]);
    expect(result).toBe('<img src="cid:logo">');
  });

  it('ignores attachments without a content-id', () => {
    const html = '<img src="cid:logo">';
    const result = resolveInlineCids(html, [
      attachment({ contentId: null }),
    ]);
    expect(result).toBe('<img src="cid:logo">');
  });

  it('returns the html unchanged when there are no attachments', () => {
    const html = '<img src="cid:logo">';
    expect(resolveInlineCids(html, [])).toBe(html);
  });

  it('returns empty input unchanged', () => {
    expect(resolveInlineCids('', [attachment({ contentId: 'logo' })])).toBe('');
  });

  it('resolves cid references inside url(...) css forms', () => {
    const html = '<div style="background:url(cid:logo)"></div>';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe('<div style="background:url(data:image/png;base64,QUJD)"></div>');
  });

  it('preserves surrounding text and untouched cids in mixed content', () => {
    const html = 'before <img src="cid:logo"> middle <img src="cid:other"> after';
    const result = resolveInlineCids(html, [attachment({ contentId: 'logo' })]);
    expect(result).toBe(
      'before <img src="data:image/png;base64,QUJD"> middle <img src="cid:other"> after'
    );
  });
});
