import { describe, expect, it } from 'vitest';
import { boundSectionKeys, hintLabel, actionKeyHints } from '../renderer/src/lib/actionKeyHints';
import type { ShortcutSettings } from '../shared/types';

const superhuman: ShortcutSettings = {
  mode: 'superhuman',
  singleKeyShortcuts: true,
  commandPaletteEnabled: true,
  vimNavigation: false,
  composeShortcutEnabled: true,
  reminderShortcutEnabled: true,
};

describe('actionKeyHints', () => {
  it('shows single keys when they are bound', () => {
    const hints = actionKeyHints(superhuman);
    expect(hints.reply.keys).toEqual(['R']);
    expect(hints.archive.keys).toEqual(['E']);
    expect(hints.later.keys).toEqual(['H']);
    expect(hints.move.keys).toEqual(['J', 'K']);
    expect(hints.archiveClearSection.aria).toBe('Shift+E');
  });

  it('falls back to the ⌘ alternative, or no key, when single keys are off (Apple Mail mode)', () => {
    const hints = actionKeyHints({ ...superhuman, mode: 'appleMail' });
    expect(hints.reply.keys).toEqual([]);
    expect(hints.reply.aria).toBeUndefined();
    expect(hints.archive.keys).toEqual(['⌘', '⇧', 'E']);
    expect(hints.archive.aria).toBe('Meta+Shift+E');
    expect(hints.later.keys).toEqual(['⌘', '⇧', 'H']);
    expect(hints.move.keys).toEqual(['↑', '↓']);
    expect(hints.undo.keys).toEqual([]);
    expect(hints.moveToSection.keys).toEqual([]);
    expect(hintLabel(hints.reply)).toBeUndefined();
    expect(hintLabel(hints.archive)).toBe('⌘⇧E');
  });

  it('respects the reminder key toggle separately', () => {
    const hints = actionKeyHints({ ...superhuman, reminderShortcutEnabled: false });
    expect(hints.later.keys).toEqual(['⌘', '⇧', 'H']);
    expect(hints.archive.keys).toEqual(['E']);
  });

  it('drops unbound section keys from prepared lines', () => {
    const off = actionKeyHints({ ...superhuman, singleKeyShortcuts: false });
    expect(boundSectionKeys(['⇧', 'E'], off)).toEqual([]);
    expect(boundSectionKeys(['⇧', 'H'], off)).toEqual([]);
    expect(boundSectionKeys(['↩'], off)).toEqual(['↩']);
    expect(boundSectionKeys(['⇧', 'E'], actionKeyHints(superhuman))).toEqual(['⇧', 'E']);
  });
});
