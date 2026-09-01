import { describe, expect, it } from 'vitest';
import { appKeymapBindings, barShortcutKeys, keymapShortcut } from '../shared/appKeymap';
import type { ShortcutSettings } from '../shared/types';

function settings(overrides: Partial<ShortcutSettings> = {}): ShortcutSettings {
  return {
    mode: 'superhuman',
    singleKeyShortcuts: true,
    commandPaletteEnabled: true,
    vimNavigation: false,
    composeShortcutEnabled: true,
    reminderShortcutEnabled: true,
    ...overrides,
  };
}

describe('appKeymapBindings', () => {
  it('lists only bindings that exist in the app', () => {
    const labels = appKeymapBindings(settings()).map(binding => binding.label);
    expect(labels).toContain('Search mailbox');
    expect(labels).toContain('Find in message');
    expect(labels).toContain('Move to Trash');
    expect(labels).toContain('Move to Spam');
    expect(labels).toContain('Ignore Thread');
    expect(labels).not.toContain('Focus Queue');
    expect(labels).not.toContain('Refresh Gmail');
    expect(labels).not.toContain('Continue Older Mail');
    expect(labels).not.toContain('Cache Visible Bodies');
  });

  it('does not advertise ⌘F as mailbox search', () => {
    expect(keymapShortcut('searchMailbox', settings())).toBe('/');
    expect(keymapShortcut('findInMessage', settings())).toBe('⌘F');
  });

  it('drops single-key bindings in Apple Mail mode', () => {
    expect(keymapShortcut('reply', settings({ mode: 'appleMail' }))).toBeUndefined();
    expect(keymapShortcut('compose', settings({ mode: 'appleMail' }))).toBe('⌘N');
    expect(keymapShortcut('searchMailbox', settings({ mode: 'appleMail' }))).toBe('/');
    expect(keymapShortcut('shortcutGuide', settings({ mode: 'appleMail' }))).toBeUndefined();
  });

  it('drops ⌘K when the command palette is disabled', () => {
    expect(keymapShortcut('commandPalette', settings({ commandPaletteEnabled: false }))).toBeUndefined();
    expect(keymapShortcut('commandPalette', settings())).toBe('⌘K');
  });

  it('drops C when the compose shortcut is disabled', () => {
    expect(keymapShortcut('compose', settings({ composeShortcutEnabled: false }))).toBe('⌘N');
  });

  it('drops H when the reminder shortcut is disabled', () => {
    expect(keymapShortcut('remind', settings({ reminderShortcutEnabled: false }))).toBe('⌘⇧H');
    expect(keymapShortcut('remind', settings())).toBe('⌘⇧H / H');
  });

  it('keeps vim navigation in Gmail mode', () => {
    expect(keymapShortcut('vimNavigation', settings({ mode: 'gmail', vimNavigation: false }))).toBe('J/K');
  });

  it('compacts bar hints without dropping paired open keys', () => {
    expect(barShortcutKeys('⌘N / C', true)).toBe('C');
    expect(barShortcutKeys('⌘⇧E / E', true)).toBe('E');
    expect(barShortcutKeys('↩ / O', true)).toBe('↩/O');
    expect(barShortcutKeys('⌘N / C', false)).toBe('⌘N/C');
  });
});
