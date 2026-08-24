import { describe, expect, it } from 'vitest';
import {
  classifyEmailSearchHost,
  EMAIL_SEARCH_HOST_SELECTOR,
  EMAIL_SEARCH_SKIP_ATTR,
} from '../renderer/src/lib/emailSearchHighlights';

describe('classifyEmailSearchHost', () => {
  it('highlights only sandboxed email body iframes', () => {
    expect(classifyEmailSearchHost('IFRAME', false)).toBe('iframe-body');
    expect(classifyEmailSearchHost('iframe', false)).toBe('iframe-body');
  });

  it('does not highlight React-managed thread chrome such as recipient lists', () => {
    expect(classifyEmailSearchHost('DIV', false)).toBe('ignore');
    expect(classifyEmailSearchHost('SPAN', false)).toBe('ignore');
    expect(classifyEmailSearchHost('BUTTON', false)).toBe('ignore');
  });

  it('ignores iframes that sit inside skipped chrome', () => {
    expect(classifyEmailSearchHost('IFRAME', true)).toBe('ignore');
  });

  it('keeps the live walker on sandboxed iframes so recipient chrome is never wrapped', () => {
    expect(EMAIL_SEARCH_HOST_SELECTOR).toBe('iframe');
    expect(EMAIL_SEARCH_SKIP_ATTR).toBe('data-email-search-skip');
  });
});
