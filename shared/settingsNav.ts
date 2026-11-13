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

/**
 * Settings navigation (SPEC §8): `Accounts` (one page per account, built from
 * the account list), `App` with five pages, and a collapsed `Advanced` group
 * that keeps every older tab unchanged.
 */
export type SettingsNavSection = 'App' | 'Advanced';

export interface SettingsNavItem {
  id: SettingsTabId;
  section: SettingsNavSection;
  name: string;
  keywords: string;
}

export const SETTINGS_NAV_ITEMS: SettingsNavItem[] = [
  { id: 'appearance', section: 'App', name: 'Appearance', keywords: 'theme density spacing dark light font text size scale accent color style reading pane message width pictures avatars translucent' },
  { id: 'shortcuts', section: 'App', name: 'Shortcuts', keywords: 'keyboard keymap keys single-key command palette archive later superhuman gmail apple mail vim j k' },
  { id: 'ai', section: 'App', name: 'AI model', keywords: 'ai openai anthropic gemini model provider api key add a model embeddings' },
  { id: 'privacy', section: 'App', name: 'Privacy and data', keywords: 'privacy pictures images keychain remote search logs cache disconnect' },
  { id: 'about', section: 'App', name: 'About', keywords: 'version app updates update speed offline' },
  { id: 'accounts', section: 'Advanced', name: 'Connected accounts', keywords: 'gmail connect onboard contacts credentials' },
  { id: 'profile', section: 'Advanced', name: 'Profile', keywords: 'name role company timezone' },
  { id: 'inbox', section: 'Advanced', name: 'Inbox', keywords: 'split purchases linkedin automation follow-up reminders' },
  { id: 'classification', section: 'Advanced', name: 'Classification', keywords: 'rules categories' },
  { id: 'labels', section: 'Advanced', name: 'Labels', keywords: 'gmail labels' },
  { id: 'compose', section: 'Advanced', name: 'Compose', keywords: 'drafts send signature undo font' },
  { id: 'contacts', section: 'Advanced', name: 'Contacts', keywords: 'people groups' },
  { id: 'calendar', section: 'Advanced', name: 'Calendar', keywords: 'agenda events availability' },
  { id: 'mcp', section: 'Advanced', name: 'MCP and search', keywords: 'mcp tools search tavily brave perplexity' },
  { id: 'general', section: 'Advanced', name: 'General', keywords: 'startup language' },
  { id: 'snippets', section: 'Advanced', name: 'Snippets', keywords: 'templates' },
  { id: 'notifications', section: 'Advanced', name: 'Notifications', keywords: 'alerts quiet hours sound' },
  { id: 'logging', section: 'Advanced', name: 'Logging', keywords: 'diagnostics logs' },
  { id: 'data', section: 'Advanced', name: 'Data and backup', keywords: 'backup restore export' },
];

export const SETTINGS_SECTION_ORDER: readonly SettingsNavSection[] = ['App', 'Advanced'];

/** What an account page holds, so settings search can land on it. */
export const ACCOUNT_PAGE_KEYWORDS = 'account signature after sending reply archive notifications agent sender rules model mail text calendar reconnect disconnect';

function matches(needle: string, ...haystacks: string[]): boolean {
  return haystacks.some(value => value.toLowerCase().includes(needle));
}

export function filterSettingsNavItems(query: string, items: SettingsNavItem[] = SETTINGS_NAV_ITEMS): SettingsNavItem[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return items;
  return items.filter(item => matches(needle, item.name, item.section, item.keywords));
}

export function groupSettingsNavItems(items: SettingsNavItem[]): Array<{ section: SettingsNavSection; items: SettingsNavItem[] }> {
  return SETTINGS_SECTION_ORDER
    .map(section => ({ section, items: items.filter(item => item.section === section) }))
    .filter(group => group.items.length > 0);
}

/** An account row stays visible in search when the query names the account or anything on its page. */
export function accountMatchesSettingsQuery(query: string, accountEmail: string, displayName = ''): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return matches(needle, accountEmail, displayName, 'accounts', ACCOUNT_PAGE_KEYWORDS);
}

export function settingsSectionForTab(tab: SettingsTabId): SettingsNavSection {
  return SETTINGS_NAV_ITEMS.find(item => item.id === tab)?.section ?? 'Advanced';
}
