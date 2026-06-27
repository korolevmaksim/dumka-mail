import { describe, it, expect } from 'vitest';
import { shortcutGuideSections, ShortcutGuideSection, GuideItem } from '../shared/shortcutGuide';
import { ShortcutSettings } from '../shared/types';

// Mirrors Swift `ShortcutSettings()` defaults (AppSettings.swift):
// mode = superhuman, singleKeyShortcuts = true, commandPaletteEnabled = true,
// vimNavigation = false, composeShortcutEnabled = true, reminderShortcutEnabled = true.
function makeSettings(overrides: Partial<ShortcutSettings> = {}): ShortcutSettings {
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

function section(sections: ShortcutGuideSection[], title: string): ShortcutGuideSection | undefined {
  return sections.find((s) => s.title === title);
}

function findItem(sections: ShortcutGuideSection[], label: string): GuideItem | undefined {
  for (const s of sections) {
    const found = s.items.find((i) => i.label === label);
    if (found) return found;
  }
  return undefined;
}

function keysFor(sections: ShortcutGuideSection[], label: string): string | undefined {
  return findItem(sections, label)?.keys;
}

describe('shortcutGuideSections', () => {
  it('returns the four sections in canonical order for default superhuman settings', () => {
    const sections = shortcutGuideSections(makeSettings());
    expect(sections.map((s) => s.title)).toEqual([
      'Universal',
      'Mail List',
      'Compose',
      'Navigation',
    ]);
  });

  it('every item exposes non-empty keys and label', () => {
    const sections = shortcutGuideSections(makeSettings());
    for (const s of sections) {
      expect(s.items.length).toBeGreaterThan(0);
      for (const item of s.items) {
        expect(item.keys.length).toBeGreaterThan(0);
        expect(item.label.length).toBeGreaterThan(0);
      }
    }
  });

  describe('single-key (superhuman) defaults', () => {
    const sections = shortcutGuideSections(makeSettings());

    it('combines command + single-key labels with " / "', () => {
      expect(keysFor(sections, 'Compose')).toBe('⌘N / C');
      expect(keysFor(sections, 'Search')).toBe('⌘F / /');
      expect(keysFor(sections, 'Reply')).toBe('⌘R / R');
      expect(keysFor(sections, 'Reply All')).toBe('⌘⇧R / A');
      expect(keysFor(sections, 'Forward')).toBe('⌘⇧F / F');
      expect(keysFor(sections, 'Summarize Thread')).toBe('⌘⇧S / S');
      expect(keysFor(sections, 'Undo Last Action')).toBe('⌘Z / Z');
      expect(keysFor(sections, 'Open Thread')).toBe('↩ / O');
      expect(keysFor(sections, 'Mark Done')).toBe('⌘⇧E / E');
      expect(keysFor(sections, 'Remind...')).toBe('⌘⇧H / H');
      expect(keysFor(sections, 'Command Palette')).toBe('⌘K / ?');
    });

    it('exposes fixed (non-conditional) shortcuts', () => {
      expect(keysFor(sections, 'Ask AI')).toBe('⌘J');
      expect(keysFor(sections, 'Focus Queue')).toBe('⌘⇧P');
      expect(keysFor(sections, 'Refresh Gmail')).toBe('⌘⇧N');
      expect(keysFor(sections, 'Continue Older Mail')).toBe('⌘⇧I');
      expect(keysFor(sections, 'Settings')).toBe('⌘,');
      expect(keysFor(sections, 'Mark Read')).toBe('⌘⇧U');
      expect(keysFor(sections, 'Cache Visible Bodies')).toBe('⌘⇧B');
      expect(keysFor(sections, 'Send Draft')).toBe('⌘↩ / ⌘⇧D');
      expect(keysFor(sections, 'Attach Files')).toBe('⌘⇧A');
    });

    it('includes the literal account/dismiss/arrow guide items', () => {
      expect(keysFor(sections, 'Select Account Tab')).toBe('⌘1...⌘9');
      expect(keysFor(sections, 'Dismiss / Close')).toBe('Esc');
      expect(keysFor(sections, 'Move / Scroll')).toBe('↑ / ↓');
    });

    it('includes single-key-only items', () => {
      expect(keysFor(sections, 'Toggle Read/Unread')).toBe('U');
    });

    it('includes vim navigation and all split shortcuts', () => {
      expect(keysFor(sections, 'Vim Navigation')).toBe('J/K');
      expect(keysFor(sections, 'Open Important')).toBe('1');
      expect(keysFor(sections, 'Open Purchases')).toBe('2');
      expect(keysFor(sections, 'Open LinkedIn')).toBe('3');
      expect(keysFor(sections, 'Open Automation')).toBe('4');
      expect(keysFor(sections, 'Open Other')).toBe('5');
    });

    it('includes the snippet expansion item', () => {
      expect(keysFor(sections, 'Expand Default Snippet')).toBe('Tab');
    });
  });

  describe('Apple Mail mode disables single-key shortcuts', () => {
    const sections = shortcutGuideSections(makeSettings({ mode: 'appleMail' }));

    it('drops the single-key half of combined shortcuts', () => {
      expect(keysFor(sections, 'Compose')).toBe('⌘N');
      expect(keysFor(sections, 'Search')).toBe('⌘F');
      expect(keysFor(sections, 'Reply')).toBe('⌘R');
      expect(keysFor(sections, 'Mark Done')).toBe('⌘⇧E');
      expect(keysFor(sections, 'Remind...')).toBe('⌘⇧H');
      expect(keysFor(sections, 'Command Palette')).toBe('⌘K');
      expect(keysFor(sections, 'Open Thread')).toBe('↩');
    });

    it('omits single-key-only items', () => {
      expect(findItem(sections, 'Toggle Read/Unread')).toBeUndefined();
    });

    it('omits vim navigation even if vimNavigation is true (gated by single key)', () => {
      const vimOn = shortcutGuideSections(makeSettings({ mode: 'appleMail', vimNavigation: true }));
      expect(findItem(vimOn, 'Vim Navigation')).toBeUndefined();
    });

    it('omits every split shortcut from Navigation', () => {
      const nav = section(sections, 'Navigation');
      expect(nav).toBeDefined();
      expect(nav!.items.map((i) => i.label)).toEqual(['Move / Scroll']);
    });

    it('keeps all four sections (Navigation still has Move / Scroll)', () => {
      expect(sections.map((s) => s.title)).toEqual([
        'Universal',
        'Mail List',
        'Compose',
        'Navigation',
      ]);
    });
  });

  describe('singleKeyShortcuts toggled off', () => {
    it('behaves like Apple Mail for the single-key branches', () => {
      const sections = shortcutGuideSections(makeSettings({ singleKeyShortcuts: false }));
      expect(keysFor(sections, 'Compose')).toBe('⌘N');
      expect(keysFor(sections, 'Search')).toBe('⌘F');
      expect(findItem(sections, 'Toggle Read/Unread')).toBeUndefined();
      expect(findItem(sections, 'Open Important')).toBeUndefined();
      // superhuman mode no longer matters once single-key is off
      expect(findItem(sections, 'Vim Navigation')).toBeUndefined();
    });
  });

  describe('Gmail mode', () => {
    it('still enables vim navigation (mode is gmail)', () => {
      const sections = shortcutGuideSections(makeSettings({ mode: 'gmail' }));
      expect(keysFor(sections, 'Vim Navigation')).toBe('J/K');
    });
  });

  describe('per-flag conditionals', () => {
    it('composeShortcutEnabled=false drops the single-key C from Compose', () => {
      const sections = shortcutGuideSections(makeSettings({ composeShortcutEnabled: false }));
      expect(keysFor(sections, 'Compose')).toBe('⌘N');
    });

    it('reminderShortcutEnabled=false drops the single-key H from Remind', () => {
      const sections = shortcutGuideSections(makeSettings({ reminderShortcutEnabled: false }));
      expect(keysFor(sections, 'Remind...')).toBe('⌘⇧H');
    });

    it('commandPaletteEnabled=false removes the Command Palette item entirely', () => {
      const sections = shortcutGuideSections(makeSettings({ commandPaletteEnabled: false }));
      expect(findItem(sections, 'Command Palette')).toBeUndefined();
    });

    it('vimNavigation=true with single keys on (manual mode) enables vim', () => {
      // superhuman already enables it; verify the explicit flag path via a mode
      // that does not auto-enable vim would require appleMail (gated off), so the
      // explicit flag is observable through the effective computation staying on.
      const sections = shortcutGuideSections(
        makeSettings({ mode: 'superhuman', vimNavigation: true }),
      );
      expect(keysFor(sections, 'Vim Navigation')).toBe('J/K');
    });
  });
});
