import { describe, expect, it } from 'vitest';
import {
  accountMatchesSettingsQuery,
  filterSettingsNavItems,
  groupSettingsNavItems,
  settingsSectionForTab,
} from '../shared/settingsNav';

describe('settingsNav', () => {
  it('keeps all 19 tabs: five App pages and the rest under Advanced', () => {
    const groups = groupSettingsNavItems(filterSettingsNavItems(''));
    expect(groups.map(group => group.section)).toEqual(['App', 'Advanced']);
    expect(groups[0].items.map(item => item.name)).toEqual(['Appearance', 'Shortcuts', 'AI model', 'Privacy and data', 'About']);
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(19);
  });

  it('filters by name, section, or keywords', () => {
    expect(filterSettingsNavItems('backup').map(item => item.id)).toEqual(['data']);
    expect(filterSettingsNavItems('gmail').map(item => item.id)).toContain('accounts');
    expect(filterSettingsNavItems('advanced').length).toBe(14);
    expect(filterSettingsNavItems('zzzz')).toHaveLength(0);
  });

  it('matches account pages by address and by what the page holds', () => {
    expect(accountMatchesSettingsQuery('', 'alex@northwind.example')).toBe(true);
    expect(accountMatchesSettingsQuery('northwind', 'alex@northwind.example')).toBe(true);
    expect(accountMatchesSettingsQuery('sender rules', 'alex@northwind.example')).toBe(true);
    expect(accountMatchesSettingsQuery('backup', 'alex@northwind.example')).toBe(false);
  });

  it('knows which section a tab belongs to', () => {
    expect(settingsSectionForTab('ai')).toBe('App');
    expect(settingsSectionForTab('compose')).toBe('Advanced');
  });
});
