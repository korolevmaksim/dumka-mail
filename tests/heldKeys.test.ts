// A key that chose something in a popover stays with it until released: the
// auto-repeat of the same held key must not act on the mailbox behind.
import { beforeEach, describe, expect, it } from 'vitest';
import { isOwnedKeyRepeat, ownKeyUntilRelease, releaseAllOwnedKeys, releaseOwnedKey } from '../renderer/src/lib/heldKeys';

describe('held keys', () => {
  beforeEach(() => releaseAllOwnedKeys());

  it('swallows every repeat of an owned key until it is released', () => {
    ownKeyUntilRelease('Digit1');
    expect(isOwnedKeyRepeat({ code: 'Digit1', repeat: true })).toBe(true);
    expect(isOwnedKeyRepeat({ code: 'Digit1', repeat: true })).toBe(true);
    releaseOwnedKey('Digit1');
    expect(isOwnedKeyRepeat({ code: 'Digit1', repeat: true })).toBe(false);
  });

  it('leaves other keys alone', () => {
    ownKeyUntilRelease('Digit1');
    expect(isOwnedKeyRepeat({ code: 'Digit2', repeat: true })).toBe(false);
    expect(isOwnedKeyRepeat({ code: 'KeyE', repeat: false })).toBe(false);
    expect(isOwnedKeyRepeat({ code: '', repeat: true })).toBe(false);
  });

  it('a fresh press ends the ownership even when the keyup was never seen', () => {
    ownKeyUntilRelease('Enter');
    expect(isOwnedKeyRepeat({ code: 'Enter', repeat: false })).toBe(false);
    // The new press is an ordinary one, and so are its repeats.
    expect(isOwnedKeyRepeat({ code: 'Enter', repeat: true })).toBe(false);
  });

  it('ignores a missing code and forgets everything on blur', () => {
    ownKeyUntilRelease('');
    ownKeyUntilRelease(null);
    ownKeyUntilRelease('Digit3');
    releaseAllOwnedKeys();
    expect(isOwnedKeyRepeat({ code: 'Digit3', repeat: true })).toBe(false);
  });
});
