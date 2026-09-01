import { describe, expect, it } from 'vitest';
import { createRfcMessageId, normalizeRfcMessageId, resolveActionRfcMessageId, rfc822MessageIdQuery } from '../shared/rfcMessageId';

describe('rfc message id', () => {
  it('builds a stable local Message-ID', () => {
    expect(createRfcMessageId(1_700_000_000_000, () => 'abc123')).toBe('<1700000000000.abc123@dumka-mail.local>');
  });

  it('normalizes brackets for rfc822msgid search', () => {
    expect(normalizeRfcMessageId('<id@example.com>')).toBe('id@example.com');
    expect(rfc822MessageIdQuery('<id@example.com>')).toBe('rfc822msgid:id@example.com');
    expect(rfc822MessageIdQuery('')).toBeNull();
  });

  it('reuses an existing payload Message-ID and mints only when missing', () => {
    expect(resolveActionRfcMessageId('{"sendAt":"later"}', null, () => '<minted@dumka-mail.local>')).toEqual({
      rfcMessageId: '<minted@dumka-mail.local>',
      payloadJson: '{"sendAt":"later","rfcMessageId":"<minted@dumka-mail.local>"}',
      wrote: true,
    });
    expect(resolveActionRfcMessageId('{"rfcMessageId":"<keep@dumka-mail.local>"}', '<other@dumka-mail.local>', () => '<minted@dumka-mail.local>')).toEqual({
      rfcMessageId: '<keep@dumka-mail.local>',
      payloadJson: '{"rfcMessageId":"<keep@dumka-mail.local>"}',
      wrote: false,
    });
  });
});
