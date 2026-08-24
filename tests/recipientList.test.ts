import { describe, expect, it } from 'vitest';
import {
  countHiddenRecipients,
  joinRecipientNames,
  recipientDisplayName,
  recipientFullIdentity,
} from '../renderer/src/lib/recipientList';
import { Recipient } from '../shared/types';

function recipient(overrides: Partial<Recipient> = {}): Recipient {
  return { name: '', email: 'user@example.com', ...overrides };
}

describe('recipientDisplayName', () => {
  it('prefers the display name when present', () => {
    expect(recipientDisplayName(recipient({ name: 'Marilyn Joseph', email: 'marilyn.joseph@cfacorp.com' }))).toBe('Marilyn Joseph');
  });

  it('falls back to the address when the name is missing or blank', () => {
    expect(recipientDisplayName(recipient())).toBe('user@example.com');
    expect(recipientDisplayName(recipient({ name: '   ' }))).toBe('user@example.com');
  });
});

describe('recipientFullIdentity', () => {
  it('shows name and address together so expanded lists identify every participant', () => {
    expect(recipientFullIdentity(recipient({ name: 'Marilyn Joseph', email: 'marilyn.joseph@cfacorp.com' }))).toBe('Marilyn Joseph <marilyn.joseph@cfacorp.com>');
  });

  it('shows only the address when there is no usable name', () => {
    expect(recipientFullIdentity(recipient())).toBe('user@example.com');
    expect(recipientFullIdentity(recipient({ name: '  ' }))).toBe('user@example.com');
  });

  it('does not duplicate the address when the name equals the address', () => {
    expect(recipientFullIdentity(recipient({ name: 'user@example.com' }))).toBe('user@example.com');
  });
});

describe('joinRecipientNames', () => {
  it('joins display names with commas for tooltip summaries', () => {
    const recipients = [
      recipient({ name: 'Alice', email: 'alice@example.com' }),
      recipient({ email: 'bob@example.com' }),
      recipient({ name: 'Carol', email: 'carol@example.com' }),
    ];
    expect(joinRecipientNames(recipients)).toBe('Alice, bob@example.com, Carol');
  });

  it('returns an empty string for an empty list', () => {
    expect(joinRecipientNames([])).toBe('');
  });
});

describe('countHiddenRecipients', () => {
  it('counts recipients that did not fully fit on the collapsed line', () => {
    expect(countHiddenRecipients(12, 5)).toBe(7);
  });

  it('is zero when everything fits', () => {
    expect(countHiddenRecipients(3, 3)).toBe(0);
  });

  it('never goes negative for out-of-range measurements', () => {
    expect(countHiddenRecipients(3, 10)).toBe(0);
    expect(countHiddenRecipients(3, -1)).toBe(3);
  });
});
