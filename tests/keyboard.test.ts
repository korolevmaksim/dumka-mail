import { describe, it, expect } from 'vitest';
import {
  deriveShortcuts,
  resolveSingleKey,
  ResolvedShortcuts,
} from '../shared/keyboard';
import { ShortcutSettings } from '../shared/types';

// Default settings mirror the reference `ShortcutSettings()` defaults:
// superhuman mode, single-key on, palette on, vim off, compose on, reminder on.
const defaults: ShortcutSettings = {
  mode: 'superhuman',
  singleKeyShortcuts: true,
  commandPaletteEnabled: true,
  vimNavigation: false,
  composeShortcutEnabled: true,
  reminderShortcutEnabled: true,
};

const make = (over: Partial<ShortcutSettings>): ShortcutSettings => ({
  ...defaults,
  ...over,
});

describe('deriveShortcuts', () => {
  it('enables everything in superhuman mode (vim forced on)', () => {
    const r = deriveShortcuts(defaults);
    expect(r).toEqual<ResolvedShortcuts>({
      singleKey: true,
      vim: true,
      composeKey: true,
      reminderKey: true,
      commandPalette: true,
    });
  });

  it('forces vim on in gmail mode even when vimNavigation is false', () => {
    const r = deriveShortcuts(make({ mode: 'gmail', vimNavigation: false }));
    expect(r.singleKey).toBe(true);
    expect(r.vim).toBe(true);
  });

  it('keeps vim on in superhuman when the toggle is explicitly false', () => {
    const r = deriveShortcuts(make({ mode: 'superhuman', vimNavigation: false }));
    expect(r.vim).toBe(true);
  });

  it('disables ALL single-key flags in appleMail mode regardless of toggles', () => {
    const r = deriveShortcuts(
      make({
        mode: 'appleMail',
        singleKeyShortcuts: true,
        vimNavigation: true,
        composeShortcutEnabled: true,
        reminderShortcutEnabled: true,
      }),
    );
    expect(r.singleKey).toBe(false);
    expect(r.vim).toBe(false);
    expect(r.composeKey).toBe(false);
    expect(r.reminderKey).toBe(false);
  });

  it('still reports commandPalette in appleMail (⌘K survives)', () => {
    const r = deriveShortcuts(make({ mode: 'appleMail', commandPaletteEnabled: true }));
    expect(r.commandPalette).toBe(true);
    expect(r.singleKey).toBe(false);
  });

  it('honors the singleKeyShortcuts master toggle outside appleMail', () => {
    const r = deriveShortcuts(make({ mode: 'gmail', singleKeyShortcuts: false }));
    expect(r.singleKey).toBe(false);
    // vim is gated behind singleKey, so it must be off too
    expect(r.vim).toBe(false);
    expect(r.composeKey).toBe(false);
    expect(r.reminderKey).toBe(false);
  });

  it('gates composeKey behind composeShortcutEnabled', () => {
    expect(deriveShortcuts(make({ composeShortcutEnabled: false })).composeKey).toBe(false);
    expect(deriveShortcuts(make({ composeShortcutEnabled: true })).composeKey).toBe(true);
  });

  it('gates reminderKey behind reminderShortcutEnabled', () => {
    expect(deriveShortcuts(make({ reminderShortcutEnabled: false })).reminderKey).toBe(false);
    expect(deriveShortcuts(make({ reminderShortcutEnabled: true })).reminderKey).toBe(true);
  });

  it('reflects commandPaletteEnabled directly', () => {
    expect(deriveShortcuts(make({ commandPaletteEnabled: false })).commandPalette).toBe(false);
  });

  it('enables vim via the toggle alone (defensive: only meaningful if a mode ever lacked forced vim)', () => {
    // singleKey is true here, and vimNavigation OR mode forces it on.
    const r = deriveShortcuts(make({ mode: 'gmail', vimNavigation: true }));
    expect(r.vim).toBe(true);
  });
});

describe('resolveSingleKey', () => {
  const full = deriveShortcuts(defaults); // everything enabled, vim on

  it('maps the core letter bindings', () => {
    expect(resolveSingleKey('e', full)).toBe('archive');
    expect(resolveSingleKey('u', full)).toBe('toggleRead');
    expect(resolveSingleKey('r', full)).toBe('reply');
    expect(resolveSingleKey('a', full)).toBe('replyAll');
    expect(resolveSingleKey('f', full)).toBe('forward');
    expect(resolveSingleKey('s', full)).toBe('summarize');
    expect(resolveSingleKey('o', full)).toBe('open');
    expect(resolveSingleKey('z', full)).toBe('undo');
  });

  it('maps compose (c) when composeKey is on and gates it off otherwise', () => {
    expect(resolveSingleKey('c', full)).toBe('compose');
    const noCompose = deriveShortcuts(make({ composeShortcutEnabled: false }));
    expect(resolveSingleKey('c', noCompose)).toBe('none');
  });

  it('maps remind (h) when reminderKey is on and gates it off otherwise', () => {
    expect(resolveSingleKey('h', full)).toBe('remind');
    const noRemind = deriveShortcuts(make({ reminderShortcutEnabled: false }));
    expect(resolveSingleKey('h', noRemind)).toBe('none');
  });

  it('maps vim navigation (j/k) only when vim is enabled', () => {
    expect(resolveSingleKey('j', full)).toBe('next');
    expect(resolveSingleKey('k', full)).toBe('prev');
  });

  it('disables j/k when vim is off (single-key still on)', () => {
    // Force a resolved state where singleKey is true but vim is false.
    const noVim: ResolvedShortcuts = { ...full, vim: false };
    expect(resolveSingleKey('j', noVim)).toBe('none');
    expect(resolveSingleKey('k', noVim)).toBe('none');
  });

  it('maps ? to the shortcut guide', () => {
    expect(resolveSingleKey('?', full)).toBe('shortcutGuide');
    const noPalette = deriveShortcuts(make({ commandPaletteEnabled: false }));
    expect(resolveSingleKey('?', noPalette)).toBe('shortcutGuide');
  });

  it('maps / to search', () => {
    expect(resolveSingleKey('/', full)).toBe('search');
  });

  it('is case-insensitive for letter keys', () => {
    expect(resolveSingleKey('E', full)).toBe('archive');
    expect(resolveSingleKey('R', full)).toBe('reply');
    expect(resolveSingleKey('J', full)).toBe('next');
  });

  it('returns none for unbound keys', () => {
    expect(resolveSingleKey('x', full)).toBe('none');
    expect(resolveSingleKey('1', full)).toBe('none');
    expect(resolveSingleKey('', full)).toBe('none');
  });

  it('returns none for every key in appleMail mode (single-key disabled)', () => {
    const apple = deriveShortcuts(make({ mode: 'appleMail' }));
    for (const k of ['e', 'u', 'r', 'a', 'f', 's', 'c', 'h', 'o', 'z', 'j', 'k', '?', '/']) {
      expect(resolveSingleKey(k, apple)).toBe('none');
    }
  });

  it('returns none for everything when the master single-key toggle is off', () => {
    const off = deriveShortcuts(make({ singleKeyShortcuts: false }));
    expect(resolveSingleKey('e', off)).toBe('none');
    expect(resolveSingleKey('/', off)).toBe('none');
    expect(resolveSingleKey('?', off)).toBe('none');
  });
});
