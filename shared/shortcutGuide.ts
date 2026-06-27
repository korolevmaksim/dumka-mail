import type { ShortcutSettings } from './types'

/**
 * Keyboard shortcut reference guide rendered in the Settings → Shortcuts pane.
 *
 * This is a dependency-free port of the Swift `ShortcutGuideFactory.sections`
 * (UI/Settings/SettingsComposeWorkflowPanes.swift), which itself derives its
 * key labels from `CommandPaletteController.defaultCommands`
 * (UI/CommandPalette/CommandPaletteController.swift).
 *
 * The Swift factory takes `shortcuts`, `inbox`, and `snippets`. The guide only
 * receives the user's `ShortcutSettings` here, so the inbox/snippet-driven
 * branches use Swift's default `InboxSettings()` / `SnippetSettings()` values
 * (every split + reminders enabled, snippets expand-with-Tab on), matching the
 * factory's behaviour for a fresh install. See the named constants below.
 */

export interface GuideItem {
  keys: string
  label: string
}

export interface ShortcutGuideSection {
  title: string
  items: GuideItem[]
}

// Swift default InboxSettings() / SnippetSettings() values that the guide
// would otherwise read from the live settings. Kept named to document the port.
const ARCHIVE_ON_DONE_SHORTCUT = true
const ENABLE_REMINDERS = true
const ENABLE_SPLIT_INBOX = true
const SHOW_PURCHASES_SPLIT = true
const SHOW_LINKEDIN_SPLIT = true
const SHOW_AUTOMATION_SPLIT = true
const SNIPPETS_ENABLED = true
const SNIPPETS_EXPAND_WITH_TAB = true

// --- Ported `ShortcutSettings` computed properties (AppSettings.swift) ---

function effectiveSingleKeyShortcuts(s: ShortcutSettings): boolean {
  return s.mode !== 'appleMail' && s.singleKeyShortcuts
}

function effectiveComposeShortcutEnabled(s: ShortcutSettings): boolean {
  return effectiveSingleKeyShortcuts(s) && s.composeShortcutEnabled
}

function effectiveReminderShortcutEnabled(s: ShortcutSettings): boolean {
  return effectiveSingleKeyShortcuts(s) && s.reminderShortcutEnabled
}

function effectiveVimNavigation(s: ShortcutSettings): boolean {
  return (
    effectiveSingleKeyShortcuts(s) &&
    (s.mode === 'superhuman' || s.mode === 'gmail' || s.vimNavigation)
  )
}

/** Port of `CommandPaletteController.shortcutLabel`: join non-null parts with " / ". */
function shortcutLabel(values: Array<string | null>): string | null {
  const parts = values.filter((value): value is string => value != null)
  return parts.length === 0 ? null : parts.join(' / ')
}

function compact(items: Array<GuideItem | null>): GuideItem[] {
  return items.filter((item): item is GuideItem => item != null)
}

export function shortcutGuideSections(s: ShortcutSettings): ShortcutGuideSection[] {
  const singleKey = effectiveSingleKeyShortcuts(s)

  // Shortcut strings, ported verbatim from `defaultCommands`. A null shortcut
  // means the corresponding command is omitted from the guide.
  const composeShortcut = shortcutLabel(['⌘N', effectiveComposeShortcutEnabled(s) ? 'C' : null])
  const searchShortcut = shortcutLabel(['⌘F', singleKey ? '/' : null])
  const doneShortcut = shortcutLabel([
    '⌘⇧E',
    singleKey && ARCHIVE_ON_DONE_SHORTCUT ? 'E' : null,
  ])
  const readShortcut = '⌘⇧U'
  const toggleReadShortcut = singleKey ? 'U' : null
  const reminderShortcut = ENABLE_REMINDERS
    ? shortcutLabel(['⌘⇧H', effectiveReminderShortcutEnabled(s) ? 'H' : null])
    : null
  const summarizeShortcut = shortcutLabel(['⌘⇧S', singleKey ? 'S' : null])
  const undoShortcut = shortcutLabel(['⌘Z', singleKey ? 'Z' : null])
  const commandPaletteShortcut = s.commandPaletteEnabled
    ? shortcutLabel(['⌘K', singleKey ? '?' : null])
    : null
  const replyShortcut = shortcutLabel(['⌘R', singleKey ? 'R' : null])
  const replyAllShortcut = shortcutLabel(['⌘⇧R', singleKey ? 'A' : null])
  const forwardShortcut = shortcutLabel(['⌘⇧F', singleKey ? 'F' : null])
  const openShortcut = shortcutLabel(['↩', singleKey ? 'O' : null])

  // Split shortcuts only exist when the split inbox is enabled (default true).
  const splitShortcut = (enabled: boolean, key: string): string | null =>
    ENABLE_SPLIT_INBOX && enabled && singleKey ? key : null

  const item = (label: string, keys: string | null): GuideItem | null =>
    keys == null ? null : { label, keys }

  const sections: ShortcutGuideSection[] = [
    {
      title: 'Universal',
      items: compact([
        item('Compose', composeShortcut),
        item('Search', searchShortcut),
        item('Ask AI', '⌘J'),
        item('Focus Queue', '⌘⇧P'),
        item('Refresh Gmail', '⌘⇧N'),
        item('Continue Older Mail', '⌘⇧I'),
        item('Command Palette', commandPaletteShortcut),
        item('Settings', '⌘,'),
        { label: 'Select Account Tab', keys: '⌘1...⌘9' },
        { label: 'Dismiss / Close', keys: 'Esc' },
      ]),
    },
    {
      title: 'Mail List',
      items: compact([
        item('Open Thread', openShortcut),
        item('Reply', replyShortcut),
        item('Reply All', replyAllShortcut),
        item('Forward', forwardShortcut),
        item('Summarize Thread', summarizeShortcut),
        item('Cache Visible Bodies', '⌘⇧B'),
        item('Undo Last Action', undoShortcut),
        item('Mark Done', doneShortcut),
        item('Mark Read', readShortcut),
        item('Toggle Read/Unread', toggleReadShortcut),
        item('Remind...', reminderShortcut),
      ]),
    },
    {
      title: 'Compose',
      items: compact([
        item('Send Draft', '⌘↩ / ⌘⇧D'),
        item('Attach Files', '⌘⇧A'),
        SNIPPETS_ENABLED && SNIPPETS_EXPAND_WITH_TAB
          ? { label: 'Expand Default Snippet', keys: 'Tab' }
          : null,
      ]),
    },
    {
      title: 'Navigation',
      items: compact([
        { label: 'Move / Scroll', keys: '↑ / ↓' },
        effectiveVimNavigation(s) ? { label: 'Vim Navigation', keys: 'J/K' } : null,
        item('Open Important', splitShortcut(true, '1')),
        item('Open Purchases', splitShortcut(SHOW_PURCHASES_SPLIT, '2')),
        item('Open LinkedIn', splitShortcut(SHOW_LINKEDIN_SPLIT, '3')),
        item('Open Automation', splitShortcut(SHOW_AUTOMATION_SPLIT, '4')),
        item('Open Other', splitShortcut(true, '5')),
      ]),
    },
  ]

  return sections.filter((section) => section.items.length > 0)
}
