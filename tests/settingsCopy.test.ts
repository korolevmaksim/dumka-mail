import { describe, expect, it } from 'vitest';
import {
  DENSITY_OPTIONS,
  INTERFACE_STYLE_OPTIONS,
  MESSAGE_WIDTH_OPTIONS,
  PRIVACY_KEYS,
  TEXT_SIZE_OPTIONS,
  THEME_OPTIONS,
  appUpdateStatusText,
  appearanceToggleCopy,
  canCheckForAppUpdates,
  formatMeasuredMs,
  offlineCoverageText,
  optionFor,
  privacyCopy,
  shortcutPresetSummary,
  shortcutSwitches,
  textSizeOption,
} from '../renderer/src/components/settings/tabs/settingsCopy';
import { deriveShortcuts } from '../shared/keyboard';
import { shortcutGuideSections } from '../shared/shortcutGuide';
import { SETTINGS_NAV_ITEMS } from '../shared/settingsNav';
import type { AutoUpdateStatus } from '../shared/autoUpdate';
import type { ShortcutSettings } from '../shared/types';

const IMPLEMENTATION_WORDS = /sqlite|\bfts\b|\bsql\b|cache|evict|purge|backdrop|vibrancy|oauth|\bapi\b|packaged|\bpx\b|\d+px|index(ing)?\b|vim\b|superhuman|enable /i;

function shortcutSettings(overrides: Partial<ShortcutSettings> = {}): ShortcutSettings {
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

function allVisibleCopy(): string[] {
  const texts: string[] = [];
  for (const options of [INTERFACE_STYLE_OPTIONS, THEME_OPTIONS, DENSITY_OPTIONS, TEXT_SIZE_OPTIONS, MESSAGE_WIDTH_OPTIONS] as const) {
    for (const option of options) texts.push(option.label, option.summary);
  }
  for (const on of [true, false]) {
    for (const key of ['showAvatars', 'useTranslucentPanels', 'enablePreviewPane'] as const) {
      const copy = appearanceToggleCopy(key, on);
      texts.push(copy.title, copy.description);
    }
    for (const key of PRIVACY_KEYS) {
      const copy = privacyCopy(key, on);
      texts.push(copy.title, copy.description);
    }
  }
  for (const mode of ['superhuman', 'gmail', 'appleMail'] as const) {
    for (const singleKeyShortcuts of [true, false]) {
      const settings = shortcutSettings({ mode, singleKeyShortcuts });
      texts.push(shortcutPresetSummary(settings));
      for (const item of shortcutSwitches(settings)) texts.push(item.title, item.description);
    }
  }
  return texts;
}

describe('settings copy', () => {
  it('uses plain words, no implementation terms', () => {
    for (const text of allVisibleCopy()) {
      expect(text, text).not.toMatch(IMPLEMENTATION_WORDS);
    }
  });

  it('never describes the opposite state under a switch', () => {
    for (const text of allVisibleCopy()) {
      expect(text, text).not.toMatch(/^(on|off):/i);
    }
    expect(privacyCopy('loadRemoteImages', true).description).not.toEqual(privacyCopy('loadRemoteImages', false).description);
    expect(appearanceToggleCopy('enablePreviewPane', false).description).toBe('Conversations open in place of the list');
  });

  it('uses sentence case for titles', () => {
    const titles = [
      ...PRIVACY_KEYS.map(key => privacyCopy(key, true).title),
      ...(['showAvatars', 'useTranslucentPanels', 'enablePreviewPane'] as const).map(key => appearanceToggleCopy(key, true).title),
      ...shortcutSwitches(shortcutSettings()).map(item => item.title),
    ];
    for (const title of titles) {
      const rest = title.split(/\s+/).slice(1);
      for (const word of rest) {
        if (/^[A-Z][a-z]/.test(word)) expect(['Mac', 'Later'], title).toContain(word);
      }
    }
  });

  it('falls back to a listed option and picks the nearest text size', () => {
    expect(optionFor(MESSAGE_WIDTH_OPTIONS, undefined, 'standard').value).toBe('standard');
    expect(textSizeOption(undefined).value).toBe(1);
    expect(textSizeOption(1.12).value).toBe(1.1);
  });

  it('page titles equal their names in the navigation', () => {
    const names = Object.fromEntries(SETTINGS_NAV_ITEMS.map(item => [item.id, item.name]));
    expect(names.privacy).toBe('Privacy and data');
    expect(names.appearance).toBe('Appearance');
    expect(names.shortcuts).toBe('Shortcuts');
    expect(names.about).toBe('About');
  });
});

describe('shortcut switches', () => {
  it('shows what the keyboard does, not a flag that has no effect', () => {
    for (const mode of ['superhuman', 'gmail', 'appleMail'] as const) {
      for (const singleKeyShortcuts of [true, false]) {
        for (const vimNavigation of [true, false]) {
          const settings = shortcutSettings({ mode, singleKeyShortcuts, vimNavigation });
          const sc = deriveShortcuts(settings);
          const byKey = Object.fromEntries(shortcutSwitches(settings).map(item => [item.key, item]));
          expect(byKey.singleKeyShortcuts.checked).toBe(sc.singleKey);
          expect(byKey.vimNavigation.checked).toBe(sc.vim);
          expect(byKey.composeShortcutEnabled.checked).toBe(sc.composeKey);
          expect(byKey.reminderShortcutEnabled.checked).toBe(sc.reminderKey);
          expect(byKey.commandPaletteEnabled.checked).toBe(sc.commandPalette);
        }
      }
    }
  });

  it('disables the switches another setting decides', () => {
    const apple = Object.fromEntries(shortcutSwitches(shortcutSettings({ mode: 'appleMail' })).map(item => [item.key, item]));
    expect(apple.singleKeyShortcuts.disabled).toBe(true);
    expect(apple.composeShortcutEnabled.disabled).toBe(true);
    expect(apple.singleKeyShortcuts.description).toBe('Not available with Only ⌘ shortcuts');
    const off = Object.fromEntries(shortcutSwitches(shortcutSettings({ singleKeyShortcuts: false })).map(item => [item.key, item]));
    expect(off.reminderShortcutEnabled.checked).toBe(false);
    expect(off.reminderShortcutEnabled.description).toBe('Turn on single-key shortcuts to use it');
  });

  it('a description never names a key the settings turn off', () => {
    const settings = shortcutSettings({ composeShortcutEnabled: false, reminderShortcutEnabled: false });
    const byKey = Object.fromEntries(shortcutSwitches(settings).map(item => [item.key, item]));
    expect(byKey.composeShortcutEnabled.description).toBe('Only ⌘N starts a new message');
    expect(byKey.reminderShortcutEnabled.description).not.toMatch(/\bH or\b/);
  });

  it('the listed bindings drop keys the settings disable', () => {
    const items = (settings: ShortcutSettings) => shortcutGuideSections(settings).flatMap(section => section.items);
    const noSingle = items(shortcutSettings({ singleKeyShortcuts: false }));
    expect(noSingle.some(item => item.keys.includes('J/K'))).toBe(false);
    expect(noSingle.find(item => item.label === 'Archive')?.keys).toBe('⌘⇧E');
    const noH = items(shortcutSettings({ reminderShortcutEnabled: false }));
    expect(noH.find(item => item.label === 'Later…')?.keys).toBe('⌘⇧H');
    const noPalette = items(shortcutSettings({ commandPaletteEnabled: false }));
    expect(noPalette.find(item => item.label === 'Command palette')).toBeUndefined();
  });
});

describe('app updates on About', () => {
  const base: AutoUpdateStatus = {
    platform: 'darwin',
    version: '1.2.3',
    state: 'idle',
    isSupported: true,
    isPackaged: true,
    isConfigured: true,
    feedURL: 'https://updates.example/update/darwin/1.2.3',
    message: 'Update checks run only from packaged builds.',
  };

  it('describes the status in plain words', () => {
    expect(appUpdateStatusText(null)).toBe('Checking update status…');
    expect(appUpdateStatusText({ ...base, isPackaged: false, state: 'unavailable' })).toBe('This is a development copy, so it does not update itself');
    expect(appUpdateStatusText({ ...base, state: 'downloaded' })).toBe('A new version is ready. Restart to install it');
    expect(appUpdateStatusText({ ...base, state: 'notAvailable', lastCheckedAt: '2026-11-12T14:30:00' }, new Date('2026-11-13T10:00:00')))
      .toBe('Dumka Mail is up to date. Checked Nov 12, 14:30');
    for (const state of ['unavailable', 'idle', 'checking', 'available', 'notAvailable', 'downloaded', 'error'] as const) {
      expect(appUpdateStatusText({ ...base, state })).not.toMatch(IMPLEMENTATION_WORDS);
    }
  });

  it('allows a check only when one can run', () => {
    expect(canCheckForAppUpdates(base)).toBe(true);
    expect(canCheckForAppUpdates({ ...base, isPackaged: false })).toBe(false);
    expect(canCheckForAppUpdates({ ...base, state: 'checking' })).toBe(false);
    expect(canCheckForAppUpdates(null)).toBe(false);
  });

  it('formats speed and offline coverage without internals', () => {
    expect(formatMeasuredMs(undefined)).toBe('Not measured yet');
    expect(formatMeasuredMs(120)).toBe('120 ms');
    expect(formatMeasuredMs(2450)).toBe('2.5 s');
    expect(offlineCoverageText('Bodies load on open')).toBe('Each message is downloaded when you open it');
    expect(offlineCoverageText('40% detail · 25% bodies')).toBe('25% of the messages on screen can be read offline');
  });
});
