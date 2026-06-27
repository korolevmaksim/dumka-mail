// Pure, dependency-free port of `UI/Root/BottomShortcutBar.swift` from the Swift
// original (PersonalMailClient). Lives in `shared/` so both the Electron main
// process and the React renderer can derive the bottom shortcut bar's hints and
// the greedy overflow-collapse layout. No Electron / Node / React / DOM imports.
//
// Two pieces are ported:
//   1. `ShortcutHintFactory` (Swift lines 173-251) -> `hintsForContext`, which
//      produces the context-aware, shortcut-mode-aware hint list.
//   2. `ShortcutHintLayout` (Swift lines 87-171) -> `resolveHintLayout`, the
//      greedy "drop the lowest-priority hints + append a `+N more` chip" layout.
//
// The Swift factories also took `InboxSettings` (reminder hint) and
// `SnippetSettings` (snippet hint) and an AI-panel context. The TypeScript
// surface here is intentionally narrowed to `ShortcutSettings` per the required
// signature, so the reminder/snippet hints (which depend on those other
// settings objects) are omitted; everything else is ported verbatim, including
// the exact single-key swaps, ordering, and layout constants/thresholds.

import type { ShortcutSettings } from './types'

export type HintContext = 'list' | 'reader' | 'compose' | 'search'

export interface ShortcutHint {
  keys: string
  label: string
}

// --- Effective shortcut flags (ported from `ShortcutSettings` computed
// properties in `Models/AppSettings.swift` lines 195-209) ---

function effectiveSingleKey(s: ShortcutSettings): boolean {
  // mode != .appleMail && singleKeyShortcuts
  return s.mode !== 'appleMail' && s.singleKeyShortcuts
}

function effectiveComposeShortcut(s: ShortcutSettings): boolean {
  return effectiveSingleKey(s) && s.composeShortcutEnabled
}

function effectiveVimNavigation(s: ShortcutSettings): boolean {
  // effectiveSingleKeyShortcuts && (mode == .superhuman || mode == .gmail || vimNavigation)
  return (
    effectiveSingleKey(s) &&
    (s.mode === 'superhuman' || s.mode === 'gmail' || s.vimNavigation)
  )
}

// --- Hint factories ---

// Ported from `ShortcutHintFactory.mailList` (Swift 208-250). The reminder hint
// (`inbox.enableReminders`) is omitted because it depends on `InboxSettings`,
// which is outside this function's signature. `isThreadOpen` distinguishes the
// list context (a thread is selectable/openable) from the reader context (a
// thread is already open).
function mailListHints(s: ShortcutSettings, isThreadOpen: boolean): ShortcutHint[] {
  const singleKey = effectiveSingleKey(s)
  const replyKey = singleKey ? 'R' : '⌘R'
  const replyAllKey = singleKey ? 'A' : '⌘⇧R'
  const forwardKey = singleKey ? 'F' : '⌘⇧F'
  const summarizeKey = singleKey ? 'S' : '⌘⇧S'
  // Swift: `singleKey && inbox.archiveOnDoneShortcut ? "E" : "⌘⇧E"`. Without
  // InboxSettings here, archive-on-done is treated as the default-on behavior,
  // matching the existing target bar's "E … (done)" hint.
  const doneKey = singleKey ? 'E' : '⌘⇧E'
  const readKey = singleKey ? 'U' : '⌘⇧U'
  const readLabel = singleKey ? 'read/unread' : 'read'
  const undoKey = singleKey ? 'Z' : '⌘Z'
  const composeKey = singleKey && effectiveComposeShortcut(s) ? 'C' : '⌘N'
  const searchKey = singleKey ? '/' : '⌘F'

  const hints: ShortcutHint[] = [
    { keys: replyKey, label: 'reply' },
    { keys: replyAllKey, label: 'reply all' },
    { keys: forwardKey, label: 'forward' },
    { keys: summarizeKey, label: 'summarize' },
    { keys: doneKey, label: 'done' },
    { keys: readKey, label: readLabel },
    { keys: composeKey, label: 'compose' },
    { keys: searchKey, label: 'search' },
    { keys: '⌘⇧P', label: 'queue' },
  ]

  // Swift inserts undo at index 0.
  hints.unshift({ keys: undoKey, label: 'undo' })

  if (effectiveVimNavigation(s)) {
    hints.push({ keys: 'J/K', label: isThreadOpen ? 'next/prev' : 'move' })
  }
  if (!isThreadOpen) {
    hints.push({ keys: singleKey ? '↩/O' : '↩', label: 'open' })
  }
  if (s.commandPaletteEnabled) {
    hints.push({ keys: singleKey ? '?' : '⌘K', label: 'command' })
  }

  return hints
}

// Ported from `ShortcutHintFactory.compose` (Swift 192-206). The snippet hint
// (`snippets.enabled && snippets.expandWithTab`) is omitted because it depends
// on `SnippetSettings`, which is outside this function's signature.
function composeHints(s: ShortcutSettings): ShortcutHint[] {
  const hints: ShortcutHint[] = [
    { keys: '⌘↩/⌘⇧D', label: 'send' },
    { keys: '⌘⇧A', label: 'attach' },
    { keys: '⌘J', label: 'ask AI' },
    { keys: 'esc', label: 'discard' },
  ]
  if (s.commandPaletteEnabled) {
    // Swift: insert at `min(3, hints.count)`.
    hints.splice(Math.min(3, hints.length), 0, { keys: '⌘K', label: 'commands' })
  }
  return hints
}

// Search session hints. The Swift original has no dedicated search factory (the
// search field overlays the list), so this is a focused adaptation that reuses
// the same single-key conventions: `esc` closes the search, enter/open opens the
// selected result, optional vim navigation, optional command palette.
function searchHints(s: ShortcutSettings): ShortcutHint[] {
  const singleKey = effectiveSingleKey(s)
  const hints: ShortcutHint[] = [
    { keys: 'esc', label: 'close' },
    { keys: singleKey ? '↩/O' : '↩', label: 'open' },
  ]
  if (effectiveVimNavigation(s)) {
    hints.push({ keys: 'J/K', label: 'move' })
  }
  if (s.commandPaletteEnabled) {
    hints.push({ keys: singleKey ? '?' : '⌘K', label: 'command' })
  }
  return hints
}

/**
 * Context-aware hint list honoring the shortcut mode/flags, ported from
 * `ShortcutHintFactory` + `shortcutHints` in `BottomShortcutBar.swift`.
 */
export function hintsForContext(ctx: HintContext, s: ShortcutSettings): ShortcutHint[] {
  switch (ctx) {
    case 'list':
      return mailListHints(s, false)
    case 'reader':
      return mailListHints(s, true)
    case 'compose':
      return composeHints(s)
    case 'search':
      return searchHints(s)
  }
}

// --- Overflow layout (ported from `ShortcutHintLayout`, Swift 87-171) ---

const HORIZONTAL_PADDING = 24
const ITEM_SPACING = 12
const KEY_LABEL_SPACING = 4
const KEY_HORIZONTAL_PADDING = 10
const KEY_GLYPH_WIDTH = 7.5
const LABEL_GLYPH_WIDTH = 6.7
const SAFETY_WIDTH_PER_HINT = 4

export interface ShortcutHintLayout {
  displayHints: ShortcutHint[]
  overflowCount: number
  estimatedWidth: number
}

function overflowHint(overflowCount: number): ShortcutHint {
  return { keys: `+${overflowCount}`, label: 'more' }
}

function estimatedWidthForHint(hint: ShortcutHint): number {
  return (
    KEY_HORIZONTAL_PADDING +
    hint.keys.length * KEY_GLYPH_WIDTH +
    KEY_LABEL_SPACING +
    hint.label.length * LABEL_GLYPH_WIDTH +
    SAFETY_WIDTH_PER_HINT
  )
}

function estimatedTotalWidth(visibleHints: ShortcutHint[], totalHintCount: number): number {
  const overflowCount = totalHintCount - visibleHints.length
  const displayHints =
    overflowCount > 0 ? [...visibleHints, overflowHint(overflowCount)] : visibleHints
  if (displayHints.length === 0) return HORIZONTAL_PADDING

  const hintsWidth = displayHints.reduce((acc, hint) => acc + estimatedWidthForHint(hint), 0)
  const spacingWidth = (displayHints.length - 1) * ITEM_SPACING
  return HORIZONTAL_PADDING + hintsWidth + spacingWidth
}

// Ported from `removalPriority` (Swift 147-170). Higher priority hints are
// dropped first; priority 0 (the command-palette hint) is never removable.
function removalPriority(hint: ShortcutHint): number {
  const k = hint.keys
  const l = hint.label
  if (
    ((k === '⌘K' || k === '⌘K/?') && (l === 'command' || l === 'commands')) ||
    (k === '?' && (l === 'command' || l === 'commands'))
  ) {
    return 0
  }
  if (k === 'E' && l === 'mark done') return 100
  if (k === 'J/K' && (l === 'move' || l === 'next/prev')) return 90
  if ((k === '⌘⇧F' || k === '⌘⇧F/F' || k === 'F') && l === 'forward') return 45
  if ((k === '⌘⇧R' || k === '⌘⇧R/A' || k === 'A') && l === 'reply all') return 40
  if ((k === '↩' || k === '↩/O') && l === 'open') return 35
  if (
    (k === '⌘⇧U' || k === '⌘⇧U/U' || k === 'U') &&
    (l === 'read' || l === 'read/unread')
  ) {
    return 30
  }
  if ((k === '⌘R' || k === '⌘R/R' || k === 'R') && l === 'reply') return 25
  return 10
}

// Ported from `removableHintIndex` (Swift 134-145): among hints with priority
// > 0, pick the maximum by (priority, then index). Swift's `max(by:)` with the
// given comparator breaks priority ties by choosing the highest index.
function removableHintIndex(hints: ShortcutHint[]): number | null {
  let best: { index: number; priority: number } | null = null
  for (let index = 0; index < hints.length; index++) {
    const priority = removalPriority(hints[index])
    if (priority <= 0) continue
    if (best === null) {
      best = { index, priority }
      continue
    }
    const currentGreater =
      priority === best.priority ? index > best.index : priority > best.priority
    if (currentGreater) best = { index, priority }
  }
  return best ? best.index : null
}

/**
 * Greedy overflow-collapse layout, ported from `ShortcutHintLayout.resolve`
 * (Swift 97-110). Repeatedly drops the lowest-priority removable hint while the
 * estimated rendered width exceeds `availableWidthPx`, then appends a synthetic
 * `+N more` overflow chip. The command-palette hint (priority 0) is protected
 * and never dropped.
 */
export function resolveHintLayout(
  hints: ShortcutHint[],
  availableWidthPx: number
): ShortcutHintLayout {
  const visibleHints = [...hints]

  while (estimatedTotalWidth(visibleHints, hints.length) > availableWidthPx) {
    const indexToRemove = removableHintIndex(visibleHints)
    if (indexToRemove === null) break
    visibleHints.splice(indexToRemove, 1)
  }

  const overflowCount = hints.length - visibleHints.length
  const displayHints =
    overflowCount > 0 ? [...visibleHints, overflowHint(overflowCount)] : visibleHints

  return {
    displayHints,
    overflowCount,
    estimatedWidth: estimatedTotalWidth(visibleHints, hints.length),
  }
}

/**
 * Whether a hint is the tappable "open the command palette / show all
 * shortcuts" affordance, ported from `ShortcutHint.opensShortcutDiscovery`
 * (Swift 65-68): the command-palette hint or the `+N more` overflow chip.
 */
export function opensCommandPalette(hint: ShortcutHint): boolean {
  return (
    ((hint.keys === '⌘K' || hint.keys === '⌘K/?' || hint.keys === '?') &&
      (hint.label === 'command' || hint.label === 'commands')) ||
    (hint.keys.startsWith('+') && hint.label === 'more')
  )
}
