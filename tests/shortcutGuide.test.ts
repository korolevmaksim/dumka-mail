import { describe, it, expect } from 'vitest';
import { shortcutGuideSections, ShortcutGuideSection, GuideItem } from '../shared/shortcutGuide';
import { ShortcutSettings } from '../shared/types';

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

    it('lists the keys that are actually bound', () => {
      expect(keysFor(sections, 'Compose')).toBe('⌘N / C');
      expect(keysFor(sections, 'Search mailbox')).toBe('/');
      expect(keysFor(sections, 'Find in message')).toBe('⌘F');
      expect(keysFor(sections, 'Reply')).toBe('R');
      expect(keysFor(sections, 'Reply All')).toBe('A');
      expect(keysFor(sections, 'Forward')).toBe('F');
      expect(keysFor(sections, 'Summarize Thread')).toBe('S');
      expect(keysFor(sections, 'Undo Last Action')).toBe('Z');
      expect(keysFor(sections, 'Open Thread')).toBe('↩ / O');
      expect(keysFor(sections, 'Mark Done')).toBe('⌘⇧E / E');
      expect(keysFor(sections, 'Move to Trash')).toBe('Backspace');
      expect(keysFor(sections, 'Move to Spam')).toBe('!');
      expect(keysFor(sections, 'Ignore Thread')).toBe('M');
      expect(keysFor(sections, 'Remind...')).toBe('⌘⇧H / H');
      expect(keysFor(sections, 'Command Palette')).toBe('⌘K');
      expect(keysFor(sections, 'Keyboard Shortcuts')).toBe('?');
      expect(keysFor(sections, 'Send Draft')).toBe('⌘↩');
    });

    it('does not advertise unbound command-key combos', () => {
      expect(findItem(sections, 'Focus Queue')).toBeUndefined();
      expect(findItem(sections, 'Refresh Gmail')).toBeUndefined();
      expect(findItem(sections, 'Continue Older Mail')).toBeUndefined();
      expect(findItem(sections, 'Cache Visible Bodies')).toBeUndefined();
      expect(findItem(sections, 'Search')).toBeUndefined();
    });

    it('includes vim navigation and split shortcuts', () => {
      expect(keysFor(sections, 'Vim Navigation')).toBe('J/K');
      expect(keysFor(sections, 'Open Important')).toBe('1');
      expect(keysFor(sections, 'Open Other')).toBe('5');
    });
  });

  describe('Apple Mail mode disables single-key shortcuts', () => {
    const sections = shortcutGuideSections(makeSettings({ mode: 'appleMail' }));

    it('keeps menu accelerators and drops single-key mail actions', () => {
      expect(keysFor(sections, 'Compose')).toBe('⌘N');
      expect(keysFor(sections, 'Search mailbox')).toBe('/');
      expect(findItem(sections, 'Reply')).toBeUndefined();
      expect(keysFor(sections, 'Mark Done')).toBe('⌘⇧E');
      expect(keysFor(sections, 'Remind...')).toBe('⌘⇧H');
      expect(keysFor(sections, 'Command Palette')).toBe('⌘K');
      expect(findItem(sections, 'Keyboard Shortcuts')).toBeUndefined();
      expect(keysFor(sections, 'Open Thread')).toBe('↩');
    });

    it('keeps mailbox and split keys and omits vim navigation', () => {
      expect(findItem(sections, 'Vim Navigation')).toBeUndefined();
      expect(keysFor(sections, 'Open Important')).toBe('1');
      const nav = section(sections, 'Navigation');
      expect(nav!.items.map((i) => i.label)).toEqual([
        'Move / Scroll',
        'Open Important',
        'Open Purchases',
        'Open LinkedIn',
        'Open Automation',
        'Open Other',
      ]);
    });
  });
});
