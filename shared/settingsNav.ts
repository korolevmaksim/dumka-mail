export type SettingsTabId =
  | 'accounts'
  | 'profile'
  | 'general'
  | 'inbox'
  | 'classification'
  | 'labels'
  | 'contacts'
  | 'calendar'
  | 'compose'
  | 'shortcuts'
  | 'snippets'
  | 'notifications'
  | 'ai'
  | 'mcp'
  | 'privacy'
  | 'appearance'
  | 'logging'
  | 'data'
  | 'about';

export interface SettingsNavItem {
  id: SettingsTabId;
  group: string;
  name: string;
  keywords: string;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: 'accounts', group: 'Accounts', name: 'Accounts', keywords: 'gmail connect onboard' },
  { id: 'profile', group: 'Accounts', name: 'Profile', keywords: 'signature name' },
  { id: 'inbox', group: 'Mail', name: 'Inbox', keywords: 'split purchases linkedin automation' },
  { id: 'classification', group: 'Mail', name: 'Classification', keywords: 'rules categories' },
  { id: 'labels', group: 'Mail', name: 'Labels', keywords: 'gmail labels' },
  { id: 'compose', group: 'Mail', name: 'Compose', keywords: 'drafts send signature' },
  { id: 'contacts', group: 'Workspace', name: 'Contacts', keywords: 'people groups' },
  { id: 'calendar', group: 'Workspace', name: 'Calendar', keywords: 'agenda events' },
  { id: 'ai', group: 'Intelligence', name: 'AI', keywords: 'openai model provider' },
  { id: 'mcp', group: 'Intelligence', name: 'MCP & Search', keywords: 'tools search' },
  { id: 'general', group: 'App', name: 'General', keywords: 'startup language' },
  { id: 'shortcuts', group: 'App', name: 'Shortcuts', keywords: 'keyboard keymap' },
  { id: 'snippets', group: 'App', name: 'Snippets', keywords: 'templates' },
  { id: 'notifications', group: 'App', name: 'Notifications', keywords: 'alerts' },
  { id: 'appearance', group: 'App', name: 'Appearance', keywords: 'theme density' },
  { id: 'privacy', group: 'App', name: 'Privacy', keywords: 'images keychain' },
  { id: 'logging', group: 'App', name: 'Logging', keywords: 'diagnostics' },
  { id: 'data', group: 'App', name: 'Data', keywords: 'backup restore export' },
  { id: 'about', group: 'App', name: 'About', keywords: 'version' },
];

export const SETTINGS_GROUP_ORDER = ['Accounts', 'Mail', 'Workspace', 'Intelligence', 'App'] as const;

export function filterSettingsNavItems(query: string, items: SettingsNavItem[] = SETTINGS_NAV_ITEMS): SettingsNavItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(item =>
    item.name.toLowerCase().includes(needle)
    || item.group.toLowerCase().includes(needle)
    || item.keywords.toLowerCase().includes(needle)
  );
}

export function groupSettingsNavItems(items: SettingsNavItem[]): Array<{ group: string; items: SettingsNavItem[] }> {
  return SETTINGS_GROUP_ORDER
    .map(group => ({ group, items: items.filter(item => item.group === group) }))
    .filter(section => section.items.length > 0);
}
