# Task: one vocabulary, and settings written for people

Read `design-review/audit/tasks/COMMON.md` first and follow it.

Five independent reviewers agreed on two things here (see `design-review/audit/AUDIT.md`, U5 and U6):
the Appearance, Shortcuts and Privacy pages speak implementation language and look different from the account page;
and one action goes by several names across the app.

Look at `design-review/audit/shots/24-settings-appearance.png`, `25-settings-shortcuts.png`,
`27-settings-privacy.png`, `48-light-settings-appearance.png`, `12-command-palette.png`, `13-shortcut-guide.png`,
and the reference for how settings should read and look: `22-settings-account.png`, `28-settings-ai-background-on.png`
(component: `renderer/src/components/settings/AccountSettingsPage.tsx`).

## Files you own

- `renderer/src/components/settings/tabs/AppearanceSettingsTab.tsx`
- `renderer/src/components/settings/tabs/BasicSettingsTabs.tsx`
- `renderer/src/components/settings/tabs/WorkspaceSettingsTabs.tsx`
- `renderer/src/components/settings/tabs/DataBackupTab.tsx`
- `renderer/src/components/settings/tabs/AboutTab.tsx`
- `renderer/src/components/settings/SettingsPanel.tsx`, `shared/settingsNav.ts`
- `shared/appKeymap.ts`, `renderer/src/lib/actionKeyHints.ts`
- the keyboard shortcut guide overlay and the command palette components (find them under `renderer/src/components/`;
  only their labels and layout of labels — not their behaviour)
- existing tests of the files above, and new tests under `tests/`

Do NOT edit: anything under `renderer/src/components/reader/`, `renderer/src/components/mailbox/`,
`renderer/src/calendar/`, `renderer/src/components/settings/AccountSettingsPage.tsx`, `AddModelSheet.tsx`,
`BackgroundWorkSection.tsx`, `ModelPicker.tsx`, `tabs/AIModelTab.tsx`, `tabs/AISettingsTab.tsx`, `shared/keyboard.ts`,
`renderer/src/hooks/useKeyboard.ts`. If a label there needs to change to match the vocabulary, list it in your report.

## What to fix

1. **One vocabulary for actions, everywhere a label is shown** (command palette, shortcut guide, keymap, settings):
   - `Archive` (never `Mark Done`, `Mark Done (Archive)`); the group action stays `Archive the Clear section`.
   - `Later` for snoozing a conversation to a time (never `Remind…`, `Snooze/Reminder`); `Open Later` is the mailbox.
   - `Reminder` only for the "remind me if no reply" feature.
   - `Ask Dumka` for the chat; `the model` for the AI in running text; `Ignore` stays `Ignore`.
   - The shortcut presets must not carry another product's name as the user-facing label
     (e.g. `Superhuman mode` → a neutral name such as `Single-key shortcuts`; keep stored setting values unchanged so
     nothing migrates). Old names may stay as search synonyms in the command palette, not as visible labels.
   Keep every key binding and every binding id as is; only labels change. Update tests that assert labels.
2. **Appearance, Shortcuts, Privacy and data, About: rewrite every label and description in plain language**, saying
   what the person gets, not how it is built. Examples of what must go: `Perform offline SQL FTS indexing`,
   `Purge SQLite Cache on Disconnect`, `Evict local SQLite records`, `native backdrop filter vibrancy`,
   `Standard (800px)`, `Enable Vim Navigation keys`, `packaged builds`. Sentence case throughout. The page title must
   equal its name in the navigation (`Privacy and data`, not `Privacy & Security`). `App updates` belongs on About,
   not under privacy: move it (keep the setting keys).
3. **Same structure and look as the account page**: the same card, row, title/description typography, the same
   `Toggle`, select and button classes, the same spacing. A setting row = title, one-line description of the current
   effect, control on the right. A description must describe the state the control is in now (never an `Off: …`
   sentence under a switch that is on).
4. **Shortcuts page.** It should let a person find a key: show the actual bindings grouped as in the shortcut guide
   (reuse `appKeymapBindings`), with the few switches on top, and a button that opens the full guide. A hint must never
   show a key that the current settings disable.
5. **Empty space.** These pages are short forms in a 600px column; that is fine, but there must be no broken-looking
   blank halves caused by a missing max-width or misaligned cards. Match the account page's column.

Do not remove any setting or change what a setting does or how it is stored. Do not start the app; say clearly in
your report that the result was not looked at on screen.
