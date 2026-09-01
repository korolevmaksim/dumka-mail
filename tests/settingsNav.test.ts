import { describe, expect, it } from 'vitest';
import { filterSettingsNavItems, groupSettingsNavItems } from '../shared/settingsNav';

describe('settingsNav', () => {
  it('groups the 19 tabs into named sections', () => {
    const groups = groupSettingsNavItems(filterSettingsNavItems(''));
    expect(groups.map(group => group.group)).toEqual(['Accounts', 'Mail', 'Workspace', 'Intelligence', 'App']);
    expect(groups.reduce((sum, group) => sum + group.items.length, 0)).toBe(19);
  });

  it('filters by name, group, or keywords', () => {
    expect(filterSettingsNavItems('backup').map(item => item.id)).toEqual(['data']);
    expect(filterSettingsNavItems('gmail').map(item => item.id)).toContain('accounts');
    expect(filterSettingsNavItems('zzzz')).toHaveLength(0);
  });
});
