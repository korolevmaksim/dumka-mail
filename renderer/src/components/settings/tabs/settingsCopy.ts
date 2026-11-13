// Plain-language copy for the App settings pages (Appearance, Shortcuts,
// Privacy and data, About). Every description says what the person gets in the
// state the control is in now. Pure (no React) so it is unit-tested.
import { deriveShortcuts } from '../../../../../shared/keyboard';
import { formatDateTime } from '../../../../../shared/dateFormat';
import type { AutoUpdateStatus } from '../../../../../shared/autoUpdate';
import type { AppearanceSettings, PrivacySettings, ShortcutSettings } from '../../../../../shared/types';

export interface SettingOption<T extends string | number> {
  value: T;
  label: string;
  /** Description of the row while this option is chosen. */
  summary: string;
}

// --- Appearance ---------------------------------------------------------------

export const INTERFACE_STYLE_OPTIONS: Array<SettingOption<AppearanceSettings['interfaceStyle']>> = [
  { value: 'classic', label: 'Classic', summary: 'Thin outlines and square-ish corners' },
  { value: 'soft', label: 'Soft', summary: 'Rounder corners and panels without outlines' },
];

export const THEME_OPTIONS: Array<SettingOption<AppearanceSettings['theme']>> = [
  { value: 'system', label: 'Match this Mac', summary: 'Light or dark, the same as this Mac' },
  { value: 'light', label: 'Light', summary: 'Always light' },
  { value: 'dark', label: 'Dark', summary: 'Always dark' },
];

export const DENSITY_OPTIONS: Array<SettingOption<AppearanceSettings['density']>> = [
  { value: 'compact', label: 'Compact', summary: 'Tighter rows, more conversations on screen' },
  { value: 'comfortable', label: 'Comfortable', summary: 'Balanced spacing between rows' },
  { value: 'spacious', label: 'Spacious', summary: 'More room around every row' },
];

export const TEXT_SIZE_OPTIONS: Array<SettingOption<number>> = [
  { value: 0.85, label: 'Smallest', summary: 'Text is 85% of the usual size' },
  { value: 0.9, label: 'Small', summary: 'Text is 90% of the usual size' },
  { value: 1.0, label: 'Usual', summary: 'Text is the usual size' },
  { value: 1.1, label: 'Large', summary: 'Text is 110% of the usual size' },
  { value: 1.15, label: 'Larger', summary: 'Text is 115% of the usual size' },
  { value: 1.2, label: 'Largest', summary: 'Text is 120% of the usual size' },
];

export const MESSAGE_WIDTH_OPTIONS: Array<SettingOption<NonNullable<AppearanceSettings['readerMaxWidth']>>> = [
  { value: 'narrow', label: 'Narrow', summary: 'Short lines, easiest to read' },
  { value: 'standard', label: 'Standard', summary: 'A comfortable line length on most screens' },
  { value: 'wide', label: 'Wide', summary: 'Longer lines, for large screens' },
  { value: 'full', label: 'Full width', summary: 'Messages fill the whole reading area' },
];

export function optionFor<T extends string | number>(options: Array<SettingOption<T>>, value: T | undefined, fallback: T): SettingOption<T> {
  return options.find(option => option.value === value)
    ?? options.find(option => option.value === fallback)
    ?? options[0];
}

/** Nearest listed size, so a stored value between steps still shows a choice. */
export function textSizeOption(scale: number | undefined): SettingOption<number> {
  const value = typeof scale === 'number' && Number.isFinite(scale) ? scale : 1;
  return TEXT_SIZE_OPTIONS.reduce((best, option) => (
    Math.abs(option.value - value) < Math.abs(best.value - value) ? option : best
  ));
}

export function appearanceToggleCopy(key: 'showAvatars' | 'useTranslucentPanels' | 'enablePreviewPane', on: boolean): { title: string; description: string } {
  switch (key) {
    case 'showAvatars':
      return {
        title: 'Pictures next to names',
        description: on ? 'Photos, or initials when there is no photo, next to senders and accounts' : 'Names only, no photos or initials',
      };
    case 'useTranslucentPanels':
      return {
        title: 'See-through panels',
        description: on ? 'The desktop shows faintly through the panels. Fully applied after the app restarts' : 'Panels are solid',
      };
    case 'enablePreviewPane':
      return {
        title: 'Reading pane',
        description: on ? 'The selected conversation opens next to the list' : 'Conversations open in place of the list',
      };
  }
}

// --- Privacy and data -----------------------------------------------------------

export const PRIVACY_KEYS: ReadonlyArray<keyof PrivacySettings> = [
  'loadRemoteImages',
  'includeBodiesInSearchIndex',
  'redactLogs',
  'useKeychainForSecrets',
  'clearCacheOnDisconnect',
];

export function privacyCopy(key: keyof PrivacySettings, on: boolean): { title: string; description: string } {
  switch (key) {
    case 'loadRemoteImages':
      return {
        title: 'Load pictures in messages',
        description: on
          ? 'Pictures load from the web. The sender can tell that you opened the message'
          : 'Pictures stored on the web are not loaded, so senders cannot tell you opened the message',
      };
    case 'includeBodiesInSearchIndex':
      return {
        title: 'Search the text of messages',
        description: on ? 'Search finds words anywhere in a message' : 'Search finds subjects and senders only',
      };
    case 'redactLogs':
      return {
        title: 'Hide personal details in logs',
        description: on ? 'Addresses and sign-in details are left out of troubleshooting logs' : 'Troubleshooting logs may include addresses and sign-in details',
      };
    case 'useKeychainForSecrets':
      return {
        title: 'Keep sign-ins and keys in the Mac keychain',
        description: on ? 'Google sign-ins and model keys are locked away by macOS' : 'Google sign-ins and model keys are kept in the app’s own files',
      };
    case 'clearCacheOnDisconnect':
      return {
        title: 'Remove mail when an account is disconnected',
        description: on ? 'Disconnecting an account deletes its mail from this Mac' : 'Mail from a disconnected account stays on this Mac',
      };
  }
}

// --- Shortcuts -------------------------------------------------------------------

export interface ShortcutSwitchCopy {
  key: Exclude<keyof ShortcutSettings, 'mode'>;
  title: string;
  description: string;
  /** What the switch shows: whether the keys work right now. */
  checked: boolean;
  /** True when another setting decides it, so the switch cannot change anything now. */
  disabled: boolean;
}

/**
 * The switches on the Shortcuts page, described by what the keyboard does now
 * (`deriveShortcuts`), never by a stored flag that has no effect.
 */
export function shortcutSwitches(settings: ShortcutSettings): ShortcutSwitchCopy[] {
  const sc = deriveShortcuts(settings);
  const onlyCommandKeys = settings.mode === 'appleMail';
  const needsSingleKeys = onlyCommandKeys
    ? 'Not available with Only ⌘ shortcuts'
    : 'Turn on single-key shortcuts to use it';
  return [
    {
      key: 'singleKeyShortcuts',
      title: 'Single-key shortcuts',
      description: sc.singleKey
        ? 'Letters act on mail: E archives, R replies, Z undoes'
        : onlyCommandKeys ? 'Not available with Only ⌘ shortcuts' : 'Letters do nothing; shortcuts with ⌘ still work',
      checked: sc.singleKey,
      disabled: onlyCommandKeys,
    },
    {
      key: 'commandPaletteEnabled',
      title: 'Command palette',
      description: sc.commandPalette ? '⌘K opens a searchable list of every action' : '⌘K does nothing',
      checked: sc.commandPalette,
      disabled: false,
    },
    {
      key: 'composeShortcutEnabled',
      title: 'C to compose',
      description: sc.composeKey ? 'C or ⌘N starts a new message' : sc.singleKey ? 'Only ⌘N starts a new message' : needsSingleKeys,
      checked: sc.composeKey,
      disabled: !sc.singleKey,
    },
    {
      key: 'reminderShortcutEnabled',
      title: 'H for Later',
      description: sc.reminderKey ? 'H or ⌘⇧H chooses when the conversation comes back' : sc.singleKey ? 'Only ⌘⇧H chooses when the conversation comes back' : needsSingleKeys,
      checked: sc.reminderKey,
      disabled: !sc.singleKey,
    },
    {
      // J / K follow single-key shortcuts in every preset (`deriveShortcuts`),
      // so this switch reflects that instead of a flag that changes nothing.
      key: 'vimNavigation',
      title: 'J and K to move',
      description: sc.vim ? 'J moves to the next conversation, K to the previous one. Comes with single-key shortcuts' : needsSingleKeys,
      checked: sc.vim,
      disabled: true,
    },
  ];
}

export function shortcutPresetSummary(settings: ShortcutSettings): string {
  return settings.mode === 'appleMail'
    ? 'Letters type nothing; every shortcut uses ⌘'
    : 'Single letters act on mail, as listed below';
}

// --- About: app updates --------------------------------------------------------

/** One plain sentence for the update status; never build details. */
export function appUpdateStatusText(status: AutoUpdateStatus | null, now: Date = new Date()): string {
  if (!status) return 'Checking update status…';
  if (!status.isSupported) return 'This copy cannot update itself. Install new versions by hand';
  if (!status.isPackaged) return 'This is a development copy, so it does not update itself';
  if (!status.isConfigured) return 'No update source is set up for this copy';
  const checked = status.lastCheckedAt ? `. Checked ${formatDateTime(status.lastCheckedAt, now)}` : '';
  switch (status.state) {
    case 'checking': return 'Checking for updates…';
    case 'available': return 'A new version was found and is downloading…';
    case 'downloaded': return 'A new version is ready. Restart to install it';
    case 'notAvailable': return `Dumka Mail is up to date${checked}`;
    case 'error': return 'Could not check for updates. Try again later';
    case 'unavailable': return 'Updates will be checked after setup finishes';
    case 'idle':
    default:
      return 'Dumka Mail checks for new versions on its own';
  }
}

export function canCheckForAppUpdates(status: AutoUpdateStatus | null): boolean {
  return Boolean(status?.isSupported && status.isPackaged && status.isConfigured && status.state !== 'checking' && status.state !== 'downloaded');
}

// --- About: speed ---------------------------------------------------------------

export function formatMeasuredMs(ms: number | null | undefined): string {
  if (typeof ms !== 'number' || !Number.isFinite(ms) || ms <= 0) return 'Not measured yet';
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

/**
 * `detailCacheCoverage` reads like `42% detail · 30% bodies`; say it plainly.
 * Anything else is passed through unchanged.
 */
export function offlineCoverageText(coverage: string): string {
  if (/^bodies load on open$/i.test(coverage.trim())) return 'Each message is downloaded when you open it';
  const match = /(\d+(?:\.\d+)?)%\s*detail\s*·\s*(\d+(?:\.\d+)?)%\s*bodies/i.exec(coverage);
  if (!match) return coverage;
  return `${match[2]}% of the messages on screen can be read offline`;
}
