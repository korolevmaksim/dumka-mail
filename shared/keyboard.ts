// Pure, dependency-free port of the mode-gating + single-key keymap logic from
// the Swift reference `AppKeyboardController` (Stores/AppKeyboardController.swift)
// and the `ShortcutSettings` effective* computed properties
// (Models/AppSettings.swift). This file lives in `shared/` and is imported by
// both the Electron main process and the React renderer, so it must stay free of
// any electron/node/react/DOM imports.

import type { ShortcutSettings } from './types';

/**
 * The resolved (effective) gating flags derived from the user's
 * `ShortcutSettings`, mirroring the Swift `effective*` computed properties:
 *
 * - `singleKey`     → `effectiveSingleKeyShortcuts`
 * - `composeKey`    → `effectiveComposeShortcutEnabled`
 * - `reminderKey`   → `effectiveReminderShortcutEnabled`
 * - `vim`           → `effectiveVimNavigation`
 * - `commandPalette`→ `commandPaletteEnabled` (the raw toggle; the `?`/⌘K paths
 *                     additionally require this to be on)
 */
export interface ResolvedShortcuts {
  singleKey: boolean;
  vim: boolean;
  composeKey: boolean;
  reminderKey: boolean;
  commandPalette: boolean;
}

/**
 * Derive the effective gating flags from raw shortcut settings.
 *
 * Apple Mail mode disables ALL single-key shortcuts entirely (regardless of the
 * individual toggles) — only ⌘-modified shortcuts and arrows/return survive
 * there. Superhuman and Gmail modes force vim (j/k) navigation on; in every mode
 * the `vimNavigation` toggle is additionally OR'd in (but it is still gated
 * behind `singleKey`, so it has no effect in Apple Mail mode).
 *
 * Mirrors Swift:
 *   effectiveSingleKeyShortcuts   = (mode != .appleMail) && singleKeyShortcuts
 *   effectiveComposeShortcutEnabled  = effectiveSingleKeyShortcuts && composeShortcutEnabled
 *   effectiveReminderShortcutEnabled = effectiveSingleKeyShortcuts && reminderShortcutEnabled
 *   effectiveVimNavigation = effectiveSingleKeyShortcuts &&
 *                            (mode == .superhuman || mode == .gmail || vimNavigation)
 */
export function deriveShortcuts(s: ShortcutSettings): ResolvedShortcuts {
  const singleKey = s.mode !== 'appleMail' && s.singleKeyShortcuts;
  return {
    singleKey,
    composeKey: singleKey && s.composeShortcutEnabled,
    reminderKey: singleKey && s.reminderShortcutEnabled,
    vim: singleKey && (s.mode === 'superhuman' || s.mode === 'gmail' || s.vimNavigation),
    commandPalette: s.commandPaletteEnabled,
  };
}

/**
 * The set of mail-list actions a bare (unmodified) key can resolve to.
 * `'none'` means the key is not bound (or is gated off by the current settings).
 */
export type MailKeyAction =
  | 'open'
  | 'archive'
  | 'toggleRead'
  | 'reply'
  | 'replyAll'
  | 'forward'
  | 'summarize'
  | 'compose'
  | 'remind'
  | 'undo'
  | 'search'
  | 'shortcutGuide'
  | 'next'
  | 'prev'
  | 'none';

/**
 * Map a bare key character to a mail action, honoring the resolved gating flags.
 *
 * The caller is responsible for ensuring this is only consulted when no
 * ⌘/⌃/⌥ modifier is pressed and no text input is focused — this function only
 * encodes the keymap + per-key gating, mirroring the single-key block of the
 * Swift `AppKeyboardController.action(for:...)` (lines 174-235).
 *
 * Bindings (superhuman / gmail; all are `'none'` in appleMail because
 * `singleKey` is false there):
 *   ?  → shortcut guide
 *   /  → search
 *   c  → compose   (only when composeKey enabled)
 *   r  → reply
 *   a  → replyAll
 *   f  → forward
 *   s  → summarize
 *   e  → archive   (mark done)
 *   u  → toggleRead
 *   h  → remind    (only when reminderKey enabled)
 *   o  → open
 *   z  → undo
 *   j  → next      (only when vim enabled)
 *   k  → prev      (only when vim enabled)
 */
export function resolveSingleKey(key: string, r: ResolvedShortcuts): MailKeyAction {
  if (!r.singleKey) {
    return 'none';
  }

  // `?` (Shift+/) and `/` are distinct characters and must be checked before
  // lower-casing letters — they are not letters, so casing is irrelevant, but
  // keeping them first makes the precedence explicit.
  if (key === '?') {
    return 'shortcutGuide';
  }
  if (key === '/') {
    return 'search';
  }

  switch (key.toLowerCase()) {
    case 'c':
      return r.composeKey ? 'compose' : 'none';
    case 'r':
      return 'reply';
    case 'a':
      return 'replyAll';
    case 'f':
      return 'forward';
    case 's':
      return 'summarize';
    case 'e':
      return 'archive';
    case 'u':
      return 'toggleRead';
    case 'h':
      return r.reminderKey ? 'remind' : 'none';
    case 'o':
      return 'open';
    case 'z':
      return 'undo';
    case 'j':
      return r.vim ? 'next' : 'none';
    case 'k':
      return r.vim ? 'prev' : 'none';
    default:
      return 'none';
  }
}
