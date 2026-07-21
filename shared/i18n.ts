export const APP_LANGUAGES = ['system', 'en', 'pseudo'] as const;
export type AppLanguage = typeof APP_LANGUAGES[number];

export type TranslationKey =
  | 'settings.panel.title'
  | 'settings.panel.close'
  | 'settings.tabs.accounts'
  | 'settings.tabs.profile'
  | 'settings.tabs.general'
  | 'settings.tabs.inbox'
  | 'settings.tabs.classification'
  | 'settings.tabs.labels'
  | 'settings.tabs.contacts'
  | 'settings.tabs.calendar'
  | 'settings.tabs.compose'
  | 'settings.tabs.shortcuts'
  | 'settings.tabs.snippets'
  | 'settings.tabs.notifications'
  | 'settings.tabs.ai'
  | 'settings.tabs.mcp'
  | 'settings.tabs.privacy'
  | 'settings.tabs.appearance'
  | 'settings.tabs.logging'
  | 'settings.tabs.about'
  | 'settings.general.title'
  | 'settings.general.description'
  | 'settings.general.language.title'
  | 'settings.general.language.description'
  | 'settings.general.language.system'
  | 'settings.general.language.english'
  | 'settings.general.language.pseudo'
  | 'settings.general.startup.title'
  | 'settings.general.startup.description'
  | 'settings.general.startup.today'
  | 'settings.general.startup.inbox'
  | 'settings.general.startup.lastSelectedAccount'
  | 'settings.general.startup.commandPalette'
  | 'settings.general.defaultSplit.title'
  | 'settings.general.defaultSplit.description'
  | 'settings.general.showBottomShortcutBar.title'
  | 'settings.general.showBottomShortcutBar.description'
  | 'settings.general.showRightContextPanel.title'
  | 'settings.general.showRightContextPanel.description'
  | 'settings.general.openLinksInBackground.title'
  | 'settings.general.openLinksInBackground.description'
  | 'settings.general.confirmBeforeQuitting.title'
  | 'settings.general.confirmBeforeQuitting.description'
  | 'settings.general.keepDraftsAcrossLaunches.title'
  | 'settings.general.keepDraftsAcrossLaunches.description'
  | 'settings.general.attachmentDownloadFolder.title'
  | 'settings.general.attachmentDownloadFolder.description'
  | 'settings.general.attachmentDownloadFolder.choose'
  | 'settings.general.attachmentDownloadFolder.reset'
  | 'settings.general.attachmentDownloadFolder.systemDownloads'
  | 'settings.privacy.title'
  | 'settings.privacy.description'
  | 'settings.privacy.loadRemoteImages.title'
  | 'settings.privacy.loadRemoteImages.description'
  | 'settings.privacy.includeBodiesInSearchIndex.title'
  | 'settings.privacy.includeBodiesInSearchIndex.description'
  | 'settings.privacy.redactLogs.title'
  | 'settings.privacy.redactLogs.description'
  | 'settings.privacy.useKeychainForSecrets.title'
  | 'settings.privacy.useKeychainForSecrets.description'
  | 'settings.privacy.clearCacheOnDisconnect.title'
  | 'settings.privacy.clearCacheOnDisconnect.description'
  | 'settings.privacy.diagnosticsEnabled.title'
  | 'settings.privacy.diagnosticsEnabled.description'
  | 'settings.updates.title'
  | 'settings.updates.loadingStatus'
  | 'settings.updates.restart'
  | 'settings.updates.check'
  | 'settings.updates.checking';

const ENGLISH: Record<TranslationKey, string> = {
  'settings.panel.title': 'Preferences',
  'settings.panel.close': 'Close Settings',
  'settings.tabs.accounts': 'Accounts',
  'settings.tabs.profile': 'Profile',
  'settings.tabs.general': 'General',
  'settings.tabs.inbox': 'Inbox',
  'settings.tabs.classification': 'Classification',
  'settings.tabs.labels': 'Labels',
  'settings.tabs.contacts': 'Contacts',
  'settings.tabs.calendar': 'Calendar',
  'settings.tabs.compose': 'Compose',
  'settings.tabs.shortcuts': 'Shortcuts',
  'settings.tabs.snippets': 'Snippets',
  'settings.tabs.notifications': 'Notifications',
  'settings.tabs.ai': 'AI Config',
  'settings.tabs.mcp': 'MCP & Search',
  'settings.tabs.privacy': 'Privacy',
  'settings.tabs.appearance': 'Appearance',
  'settings.tabs.logging': 'Logging',
  'settings.tabs.about': 'About',
  'settings.general.title': 'General Preferences',
  'settings.general.description': 'Configure startup behavior, links, and workspace defaults.',
  'settings.general.language.title': 'Language',
  'settings.general.language.description': 'Choose the interface language for localized surfaces.',
  'settings.general.language.system': 'System Default',
  'settings.general.language.english': 'English',
  'settings.general.language.pseudo': 'Pseudo Locale',
  'settings.general.startup.title': 'Startup Behavior',
  'settings.general.startup.description': 'Choose screen displayed on application launch',
  'settings.general.startup.today': 'Today / Operator Home',
  'settings.general.startup.inbox': 'Focus Inbox Split',
  'settings.general.startup.lastSelectedAccount': 'Last Selected Account',
  'settings.general.startup.commandPalette': 'Launch Command Palette',
  'settings.general.defaultSplit.title': 'Default Inbox Split',
  'settings.general.defaultSplit.description': 'Active category on startup',
  'settings.general.showBottomShortcutBar.title': 'Show Bottom Shortcut Bar',
  'settings.general.showBottomShortcutBar.description': 'Display quick reference labels at bottom',
  'settings.general.showRightContextPanel.title': 'Show Right Context Panel',
  'settings.general.showRightContextPanel.description': 'Display diagnostics, health and action ledger sidebar',
  'settings.general.openLinksInBackground.title': 'Open Links in Background',
  'settings.general.openLinksInBackground.description': 'Prevent browser focus stealing',
  'settings.general.confirmBeforeQuitting.title': 'Confirm Before Quitting',
  'settings.general.confirmBeforeQuitting.description': 'Prompt before closing process',
  'settings.general.keepDraftsAcrossLaunches.title': 'Restore Drafts on Launch',
  'settings.general.keepDraftsAcrossLaunches.description': 'Save unsent composer details locally',
  'settings.general.attachmentDownloadFolder.title': 'Attachment Download Folder',
  'settings.general.attachmentDownloadFolder.description': 'Where Save Attachment writes files by default. Empty uses the system Downloads folder.',
  'settings.general.attachmentDownloadFolder.choose': 'Choose…',
  'settings.general.attachmentDownloadFolder.reset': 'Use Downloads',
  'settings.general.attachmentDownloadFolder.systemDownloads': 'System Downloads',
  'settings.privacy.title': 'Privacy & Security',
  'settings.privacy.description': 'Manage log redactions, keychain credentials, local indices, and image loader.',
  'settings.privacy.loadRemoteImages.title': 'Load Remote Images',
  'settings.privacy.loadRemoteImages.description': 'Enable fetching external assets in HTML viewer',
  'settings.privacy.includeBodiesInSearchIndex.title': 'Index Email Message Bodies',
  'settings.privacy.includeBodiesInSearchIndex.description': 'Perform offline SQL FTS indexing on content text',
  'settings.privacy.redactLogs.title': 'Redact Logs',
  'settings.privacy.redactLogs.description': 'Omit usernames and tokens in diagnostic outputs',
  'settings.privacy.useKeychainForSecrets.title': 'Use System Keychain for Secrets',
  'settings.privacy.useKeychainForSecrets.description': 'Encrypt OAuth tokens and API credentials',
  'settings.privacy.clearCacheOnDisconnect.title': 'Purge SQLite Cache on Disconnect',
  'settings.privacy.clearCacheOnDisconnect.description': 'Evict local SQLite records when an account is removed',
  'settings.privacy.diagnosticsEnabled.title': 'Enable Anonymous Diagnostics',
  'settings.privacy.diagnosticsEnabled.description': 'Share telemetry logs to improve triage classifications',
  'settings.updates.title': 'App Updates',
  'settings.updates.loadingStatus': 'Loading update status...',
  'settings.updates.restart': 'Restart',
  'settings.updates.check': 'Check',
  'settings.updates.checking': 'Checking',
};

function pseudoLocalize(value: string): string {
  return `[!! ${value.replace(/[A-Za-z]/g, match => {
    const upper = match.toUpperCase() === match;
    const mapped = {
      a: 'aa',
      e: 'ee',
      i: 'ii',
      o: 'oo',
      u: 'uu',
    }[match.toLowerCase()] || match;
    return upper ? mapped.toUpperCase() : mapped;
  })} !!]`;
}

export function normalizeAppLanguage(value: unknown): AppLanguage {
  return APP_LANGUAGES.includes(value as AppLanguage) ? value as AppLanguage : 'system';
}

export function resolvedAppLanguage(language: AppLanguage): Exclude<AppLanguage, 'system'> {
  return language === 'system' ? 'en' : language;
}

export function translate(language: AppLanguage, key: TranslationKey): string {
  const text = ENGLISH[key];
  return resolvedAppLanguage(language) === 'pseudo' ? pseudoLocalize(text) : text;
}

export function createTranslator(language: AppLanguage): (key: TranslationKey) => string {
  return (key) => translate(language, key);
}
