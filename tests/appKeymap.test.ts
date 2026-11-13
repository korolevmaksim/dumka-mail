import { describe, expect, it } from 'vitest';
import { APP_KEY_BINDING_IDS, KEYMAP_GROUP_LABELS, SHORTCUT_PRESET_LABELS, appKeymapBindings, barShortcutKeys, keymapShortcut, shortcutPresetLabel } from '../shared/appKeymap';
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
    expect(labels).toContain('Search mail');
    expect(labels).toContain('Find in message');
    expect(labels).toContain('Move to trash');
    expect(labels).toContain('Move to spam');
    expect(labels).toContain('Ignore');
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

describe('one vocabulary for actions', () => {
  const labels = appKeymapBindings(settings({ vimNavigation: true })).map(binding => binding.label);

  it('calls archiving Archive and snoozing Later, never Mark Done, Remind or Snooze', () => {
    expect(labels).toContain('Archive');
    expect(labels).toContain('Later…');
    expect(labels).toContain('Archive the Clear section');
    expect(labels).toContain('Ask Dumka');
    expect(labels).toContain('Ignore');
    for (const label of labels) {
      expect(label).not.toMatch(/mark done|remind|snooze/i);
      expect(label).not.toMatch(/thread/i);
    }
  });

  it('uses sentence case: no capital after the first word except names', () => {
    const allowed = new Set(['Dumka', 'Clear', 'Later', 'After']);
    for (const label of labels) {
      const words = label.replace(/[“”…,]/g, '').split(/\s+/).slice(1);
      for (const word of words) {
        if (/^[A-Z][a-z]/.test(word)) expect(allowed.has(word), `${label}: ${word}`).toBe(true);
      }
    }
  });

  it('keeps every binding id', () => {
    const ids = appKeymapBindings(settings({ vimNavigation: true })).map(binding => binding.id);
    expect(new Set(ids)).toEqual(new Set(APP_KEY_BINDING_IDS));
  });

  it('names the presets without another product’s name and keeps the stored values', () => {
    expect(Object.keys(SHORTCUT_PRESET_LABELS).sort()).toEqual(['appleMail', 'gmail', 'superhuman']);
    for (const label of Object.values(SHORTCUT_PRESET_LABELS)) {
      expect(label).not.toMatch(/superhuman|gmail|apple/i);
    }
    expect(shortcutPresetLabel('superhuman')).toBe('Single-key shortcuts');
    expect(shortcutPresetLabel('appleMail')).toBe('Only ⌘ shortcuts');
    expect(Object.values(KEYMAP_GROUP_LABELS)).toEqual(['Everywhere', 'Mail', 'Writing', 'Moving around']);
  });
});
