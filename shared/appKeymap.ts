import { deriveShortcuts } from './keyboard';
import type { ShortcutSettings } from './types';

export type KeymapGroup = 'Universal' | 'Mail List' | 'Compose' | 'Navigation';

/** What a person sees for each group (the ids above stay stable for code and tests). */
export const KEYMAP_GROUP_LABELS: Record<KeymapGroup, string> = {
  Universal: 'Everywhere',
  'Mail List': 'Mail',
  Compose: 'Writing',
  Navigation: 'Moving around',
};

/**
 * User-facing names of the shortcut presets. The stored values
 * (`superhuman`, `gmail`, `appleMail`) never change, so nothing migrates; the
 * labels carry no other product's name. `superhuman` and `gmail` bind the same
 * keys (`deriveShortcuts`), so they read as one preset.
 */
export const SHORTCUT_PRESET_LABELS: Record<ShortcutSettings['mode'], string> = {
  superhuman: 'Single-key shortcuts',
  gmail: 'Single-key shortcuts (earlier preset)',
  appleMail: 'Only ⌘ shortcuts',
};

export function shortcutPresetLabel(mode: ShortcutSettings['mode']): string {
  return SHORTCUT_PRESET_LABELS[mode] ?? SHORTCUT_PRESET_LABELS.superhuman;
}

export const APP_KEY_BINDING_IDS = [
  'compose',
  'searchMailbox',
  'findInMessage',
  'openAiAssistant',
  'openCalendar',
  'switchMailbox',
  'commandPalette',
  'shortcutGuide',
  'settings',
  'toggleTheme',
  'selectAccountTab',
  'toggleUnifiedInbox',
  'dismiss',
  'openThread',
  'reply',
  'replyAll',
  'draftReply',
  'forward',
  'summarize',
  'undo',
  'markDone',
  'markRead',
  'toggleRead',
  'moveToTrash',
  'reportSpam',
  'muteThread',
  'remind',
  'toggleSelect',
  'selectAll',
  'sendDraft',
  'sendDraftAlternate',
  'moveScroll',
  'vimNavigation',
  'archiveClearSection',
  'remindLaterSection',
  'moveToSection',
  'nextSection',
  'prevSection',
  'acceptInvite',
  'declineInvite',
] as const;

export type AppKeyBindingId = typeof APP_KEY_BINDING_IDS[number];

export interface AppKeyBinding {
  id: AppKeyBindingId;
  label: string;
  group: KeymapGroup;
  keys: string;
}

export function joinShortcutParts(values: Array<string | null | undefined>): string | null {
  const parts = values.filter((value): value is string => Boolean(value));
  return parts.length === 0 ? null : parts.join(' / ');
}

export function compactShortcutKeys(keys: string): string {
  return keys.replace(/ \/ /g, '/');
}

export function barShortcutKeys(keys: string, preferSingleKey: boolean): string {
  if (!keys.includes(' / ')) return compactShortcutKeys(keys);
  const parts = keys.split(' / ');
  const first = parts[0];
  const last = parts[parts.length - 1];
  if (preferSingleKey && first?.includes('⌘') && last && last.length === 1) {
    return last;
  }
  return compactShortcutKeys(keys);
}

export function appKeymapBindings(settings: ShortcutSettings): AppKeyBinding[] {
  const sc = deriveShortcuts(settings);
  const item = (
    id: AppKeyBindingId,
    label: string,
    group: KeymapGroup,
    keys: string | null,
  ): AppKeyBinding | null => (keys ? { id, label, group, keys } : null);

  return [
    item('compose', 'Compose', 'Universal', joinShortcutParts(['⌘N', sc.composeKey ? 'C' : null])),
    item('searchMailbox', 'Search mail', 'Universal', '/'),
    item('findInMessage', 'Find in message', 'Mail List', '⌘F'),
    item('openAiAssistant', 'Ask Dumka', 'Universal', '⌘J'),
    item('openCalendar', 'Open calendar', 'Universal', '⌘⇧C'),
    item('switchMailbox', 'Next or previous mailbox', 'Universal', 'G/⇧G'),
    item('commandPalette', 'Command palette', 'Universal', sc.commandPalette ? '⌘K' : null),
    item('shortcutGuide', 'Keyboard shortcuts', 'Universal', sc.singleKey ? '?' : null),
    item('settings', 'Settings', 'Universal', '⌘,'),
    item('toggleTheme', 'Change theme', 'Universal', '⌘⇧T'),
    item('selectAccountTab', 'Go to account 1 to 9', 'Universal', '⌘1...⌘9'),
    item('toggleUnifiedInbox', 'All accounts or one account', 'Universal', '⌘0'),
    item('dismiss', 'Close', 'Universal', 'Esc'),
    item('openThread', 'Open conversation', 'Mail List', joinShortcutParts(['↩', sc.singleKey ? 'O' : null])),
    item('reply', 'Reply', 'Mail List', sc.singleKey ? 'R' : null),
    item('replyAll', 'Reply all', 'Mail List', sc.singleKey ? 'A' : null),
    item('draftReply', 'Draft a reply with the model', 'Mail List', sc.singleKey ? '⇧R' : null),
    item('forward', 'Forward', 'Mail List', sc.singleKey ? 'F' : null),
    item('summarize', 'Summarize conversation', 'Mail List', sc.singleKey ? 'S' : null),
    item('undo', 'Undo', 'Mail List', sc.singleKey ? 'Z' : null),
    item('markDone', 'Archive', 'Mail List', joinShortcutParts(['⌘⇧E', sc.singleKey ? 'E' : null])),
    item('markRead', 'Mark as read', 'Mail List', '⌘⇧U'),
    item('toggleRead', 'Mark as read or unread', 'Mail List', sc.singleKey ? 'U' : null),
    item('moveToTrash', 'Move to trash', 'Mail List', sc.singleKey ? 'Backspace' : null),
    item('reportSpam', 'Move to spam', 'Mail List', sc.singleKey ? '!' : null),
    item('muteThread', 'Ignore', 'Mail List', sc.singleKey ? 'M' : null),
    item('remind', 'Later…', 'Mail List', joinShortcutParts(['⌘⇧H', sc.reminderKey ? 'H' : null])),
    item('toggleSelect', 'Select or deselect', 'Mail List', sc.singleKey ? 'X' : null),
    item('selectAll', 'Select all', 'Mail List', '⌘A'),
    // Decision sections (design-review/SPEC.md §2, §9).
    item('archiveClearSection', 'Archive the Clear section', 'Mail List', sc.singleKey ? '⇧E' : null),
    item('remindLaterSection', 'Later for the whole Later section', 'Mail List', sc.singleKey ? '⇧H' : null),
    item('moveToSection', 'Move to another section', 'Mail List', sc.singleKey ? 'V' : null),
    // Only active on a thread whose invitation still needs an answer.
    item('acceptInvite', 'Accept invitation', 'Mail List', sc.singleKey ? 'Y' : null),
    item('declineInvite', 'Decline invitation', 'Mail List', sc.singleKey ? 'N' : null),
    item('sendDraft', 'Send', 'Compose', '⌘↩'),
    item('sendDraftAlternate', 'Send, then the opposite of “After sending a reply”', 'Compose', '⌘⇧↩'),
    item('moveScroll', 'Move or scroll', 'Navigation', '↑ / ↓'),
    item('vimNavigation', 'Next or previous conversation', 'Navigation', sc.vim ? 'J/K' : null),
    // Inbox sections: the list jumps, nothing is filtered.
    item('nextSection', 'Next section', 'Navigation', sc.singleKey ? ']' : null),
    item('prevSection', 'Previous section', 'Navigation', sc.singleKey ? '[' : null),
  ].filter((binding): binding is AppKeyBinding => binding !== null);
}

export function keymapShortcut(id: AppKeyBindingId, settings: ShortcutSettings): string | undefined {
  return appKeymapBindings(settings).find(binding => binding.id === id)?.keys;
}
