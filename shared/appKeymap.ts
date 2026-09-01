import { deriveShortcuts } from './keyboard';
import type { ShortcutSettings } from './types';

export type KeymapGroup = 'Universal' | 'Mail List' | 'Compose' | 'Navigation';

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
  'moveScroll',
  'vimNavigation',
  'openSplit1',
  'openSplit2',
  'openSplit3',
  'openSplit4',
  'openSplit5',
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
    item('searchMailbox', 'Search mailbox', 'Universal', '/'),
    item('findInMessage', 'Find in message', 'Mail List', '⌘F'),
    item('openAiAssistant', 'Open AI Assistant', 'Universal', '⌘J'),
    item('openCalendar', 'Open Calendar', 'Universal', '⌘⇧C'),
    item('switchMailbox', 'Switch Mailbox', 'Universal', 'G/⇧G'),
    item('commandPalette', 'Command Palette', 'Universal', sc.commandPalette ? '⌘K' : null),
    item('shortcutGuide', 'Keyboard Shortcuts', 'Universal', sc.singleKey ? '?' : null),
    item('settings', 'Settings', 'Universal', '⌘,'),
    item('toggleTheme', 'Toggle Theme', 'Universal', '⌘⇧T'),
    item('selectAccountTab', 'Select Account Tab', 'Universal', '⌘1...⌘9'),
    item('toggleUnifiedInbox', 'Toggle Unified Inbox', 'Universal', '⌘0'),
    item('dismiss', 'Dismiss / Close', 'Universal', 'Esc'),
    item('openThread', 'Open Thread', 'Mail List', joinShortcutParts(['↩', sc.singleKey ? 'O' : null])),
    item('reply', 'Reply', 'Mail List', sc.singleKey ? 'R' : null),
    item('replyAll', 'Reply All', 'Mail List', sc.singleKey ? 'A' : null),
    item('forward', 'Forward', 'Mail List', sc.singleKey ? 'F' : null),
    item('summarize', 'Summarize Thread', 'Mail List', sc.singleKey ? 'S' : null),
    item('undo', 'Undo Last Action', 'Mail List', sc.singleKey ? 'Z' : null),
    item('markDone', 'Mark Done', 'Mail List', joinShortcutParts(['⌘⇧E', sc.singleKey ? 'E' : null])),
    item('markRead', 'Mark Read', 'Mail List', '⌘⇧U'),
    item('toggleRead', 'Toggle Read/Unread', 'Mail List', sc.singleKey ? 'U' : null),
    item('moveToTrash', 'Move to Trash', 'Mail List', sc.singleKey ? 'Backspace' : null),
    item('reportSpam', 'Move to Spam', 'Mail List', sc.singleKey ? '!' : null),
    item('muteThread', 'Ignore Thread', 'Mail List', sc.singleKey ? 'M' : null),
    item('remind', 'Remind...', 'Mail List', joinShortcutParts(['⌘⇧H', sc.reminderKey ? 'H' : null])),
    item('toggleSelect', 'Toggle Selection', 'Mail List', sc.singleKey ? 'X' : null),
    item('selectAll', 'Select All Threads', 'Mail List', '⌘A'),
    item('sendDraft', 'Send Draft', 'Compose', '⌘↩'),
    item('moveScroll', 'Move / Scroll', 'Navigation', '↑ / ↓'),
    item('vimNavigation', 'Vim Navigation', 'Navigation', sc.vim ? 'J/K' : null),
    item('openSplit1', 'Open Important', 'Navigation', '1'),
    item('openSplit2', 'Open Purchases', 'Navigation', '2'),
    item('openSplit3', 'Open LinkedIn', 'Navigation', '3'),
    item('openSplit4', 'Open Automation', 'Navigation', '4'),
    item('openSplit5', 'Open Other', 'Navigation', '5'),
  ].filter((binding): binding is AppKeyBinding => binding !== null);
}

export function keymapShortcut(id: AppKeyBindingId, settings: ShortcutSettings): string | undefined {
  return appKeymapBindings(settings).find(binding => binding.id === id)?.keys;
}
