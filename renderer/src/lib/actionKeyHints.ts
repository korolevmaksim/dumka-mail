// Key hints shown next to actions must match what the keyboard actually does
// in the current shortcut mode (`deriveShortcuts`): a single key when it is
// bound, otherwise its ⌘-modified alternative when one exists, otherwise no
// key at all. Pure (no React) so the table is unit-tested.
import { deriveShortcuts } from '../../../shared/keyboard';
import type { ShortcutSettings } from '../../../shared/types';

export interface ActionKeyHint {
  /** Key caps to render, e.g. `['E']` or `['⌘', '⇧', 'E']`; empty when unbound. */
  keys: string[];
  /** `aria-keyshortcuts` value; undefined when unbound. */
  aria?: string;
}

export interface ActionKeyHints {
  reply: ActionKeyHint;
  replyAll: ActionKeyHint;
  forward: ActionKeyHint;
  archive: ActionKeyHint;
  later: ActionKeyHint;
  /** Moving through the list (no thread open). */
  move: ActionKeyHint;
  undo: ActionKeyHint;
  toggleRead: ActionKeyHint;
  mute: ActionKeyHint;
  spam: ActionKeyHint;
  trash: ActionKeyHint;
  archiveClearSection: ActionKeyHint;
  remindLaterSection: ActionKeyHint;
  moveToSection: ActionKeyHint;
  /** `[` / `]`: previous / next inbox section. */
  jumpSection: ActionKeyHint;
  acceptInvite: ActionKeyHint;
  declineInvite: ActionKeyHint;
}

const NONE: ActionKeyHint = { keys: [] };

function single(enabled: boolean, key: string, aria: string = key): ActionKeyHint {
  return enabled ? { keys: [key], aria } : NONE;
}

/** Text form of a hint for titles and menus (`E`, `⌘⇧E`); undefined when unbound. */
export function hintLabel(hint: ActionKeyHint): string | undefined {
  return hint.keys.length > 0 ? hint.keys.join('') : undefined;
}

export function actionKeyHints(settings: ShortcutSettings): ActionKeyHints {
  const sc = deriveShortcuts(settings);
  return {
    reply: single(sc.singleKey, 'R'),
    replyAll: single(sc.singleKey, 'A'),
    forward: single(sc.singleKey, 'F'),
    // `⌘⇧E` / `⌘⇧H` work in every mode (useKeyboard), so they stand in when single keys are off.
    archive: sc.singleKey ? { keys: ['E'], aria: 'E' } : { keys: ['⌘', '⇧', 'E'], aria: 'Meta+Shift+E' },
    later: sc.reminderKey ? { keys: ['H'], aria: 'H' } : { keys: ['⌘', '⇧', 'H'], aria: 'Meta+Shift+H' },
    // Arrows always move through the list; J / K only with vim navigation.
    move: sc.vim ? { keys: ['J', 'K'], aria: 'J K' } : { keys: ['↑', '↓'], aria: 'ArrowUp ArrowDown' },
    undo: single(sc.singleKey, 'Z'),
    toggleRead: single(sc.singleKey, 'U'),
    mute: single(sc.singleKey, 'M'),
    spam: single(sc.singleKey, '!'),
    trash: single(sc.singleKey, '⌫', 'Backspace'),
    archiveClearSection: sc.singleKey ? { keys: ['⇧', 'E'], aria: 'Shift+E' } : NONE,
    remindLaterSection: sc.singleKey ? { keys: ['⇧', 'H'], aria: 'Shift+H' } : NONE,
    moveToSection: single(sc.singleKey, 'V'),
    jumpSection: sc.singleKey ? { keys: ['[', ']'], aria: '[ ]' } : NONE,
    acceptInvite: single(sc.singleKey, 'Y'),
    declineInvite: single(sc.singleKey, 'N'),
  };
}

/**
 * Prepared-pane section lines carry their own keys from `shared/inboxSections`;
 * drop the section keys that are not bound in this mode.
 */
export function boundSectionKeys(keys: readonly string[], hints: ActionKeyHints): string[] {
  const joined = keys.join('');
  if (joined === '⇧E') return hints.archiveClearSection.keys;
  if (joined === '⇧H') return hints.remindLaterSection.keys;
  return [...keys];
}
