import { describe, expect, it } from 'vitest';
import { createTranslator, normalizeAppLanguage, resolvedAppLanguage, translate } from '../shared/i18n';

describe('i18n helpers', () => {
  it('normalizes supported app language values', () => {
    expect(normalizeAppLanguage('system')).toBe('system');
    expect(normalizeAppLanguage('en')).toBe('en');
    expect(normalizeAppLanguage('pseudo')).toBe('pseudo');
    expect(normalizeAppLanguage('ru')).toBe('system');
    expect(normalizeAppLanguage(null)).toBe('system');
  });

  it('resolves system to English until external locale resources are available', () => {
    expect(resolvedAppLanguage('system')).toBe('en');
    expect(resolvedAppLanguage('pseudo')).toBe('pseudo');
  });

  it('translates English keys and supports pseudo localization', () => {
    expect(translate('en', 'settings.general.title')).toBe('General Preferences');
    expect(translate('system', 'settings.general.title')).toBe('General Preferences');
    expect(translate('pseudo', 'settings.general.title')).toContain('Geeneeraal');
    expect(translate('en', 'settings.tabs.privacy')).toBe('Privacy');
    expect(translate('pseudo', 'settings.updates.checking')).toContain('Cheeck');
  });

  it('creates a stable translator closure', () => {
    const t = createTranslator('en');
    expect(t('settings.general.startup.commandPalette')).toBe('Launch Command Palette');
    expect(t('settings.privacy.clearCacheOnDisconnect.title')).toBe('Purge SQLite Cache on Disconnect');
  });
});
