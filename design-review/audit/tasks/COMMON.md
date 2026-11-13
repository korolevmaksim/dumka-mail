# Common rules for the audit follow-up work

Repository: the repo root (branch `redesign/decision-sections`, uncommitted work in progress).
Read `AGENTS.md` first. The findings you are fixing come from `design-review/audit/AUDIT.md`; the screenshots they
refer to are in `design-review/audit/shots/` (PNG; view them, they show the current state).

Hard rules:

- Several people are editing this same checkout at the same time, each in their own files. Edit ONLY the files listed
  in your task. Never reformat, revert or "clean up" a file outside that list, and never run `git checkout`, `git stash`,
  `git reset`, `git add` or `git commit`.
- Do not launch the Electron app, the harness or a dev server (another person is using the only instance). Verify with
  `npx tsc --noEmit -p .` and `npx vitest run` (both must pass before you finish; if a failure is in a file you do not
  own, report it instead of fixing it).
- No new dependencies. No changes to IPC (`main/preload.ts`, `main/index.ts`, `renderer/src/vite-env.d.ts`).
- Do not edit `renderer/src/index.css`. If you need CSS, put it in a `.css` file next to your components and import it.
- The interface language is English. Sentence case for labels and headings. Plain words; never implementation terms
  (SQLite, FTS, cache eviction, backdrop filter) in user-facing text.
- No hardcoded AI model ids anywhere (a test enforces it).

Shared building blocks to use, not re-implement:

- Dates and times: `shared/dateFormat.ts` — `formatTime`, `formatDay`, `formatWeekdayDay`, `formatDateTime`,
  `formatFullDateTime`, `formatTimeRange`, `formatEventWhen`, `formatDuration`. The app is 24-hour everywhere, month
  before day ("Nov 12, 14:30"), no seconds. Do not call `toLocaleString` / `toLocaleTimeString` / `toLocaleDateString`
  in UI code.
- Colour tokens (CSS variables): surfaces `--app-bg --rail-bg --panel-bg --raised-surface`, text
  `--text-primary --text-secondary --text-tertiary`, lines `--border --strong-border`, rows `--hover-row --selected-row`.
  Filled buttons: `bg-[var(--accent-fill)] text-[var(--on-accent)]` (never white text on raw `--accent`; it fails AA).
  Coloured text or icons: `--accent-ink`, `--ai-solid`, `--success-solid`, `--warning-solid`, `--danger-solid`.
  Destructive fill: `--danger-fill` with `--on-accent`.
- Text sizes: use `text-[calc(Npx*var(--font-scale))]`. Nothing below 11px; body 12–13px; keyboard hints 10px minimum.
- Controls: `renderer/src/components/settings/SettingsControls.tsx` (`Toggle`, `SETTINGS_BUTTON_CLASS`,
  `SETTINGS_SELECT_CLASS`, `SETTINGS_INPUT_CLASS`). Mail's own look is the reference for everything:
  `renderer/src/components/reader/ThreadHeader.tsx`, `renderer/src/components/reader/ReplyDock.tsx`,
  `renderer/src/components/mailbox/MailboxListHeader.tsx`, `renderer/src/components/settings/AccountSettingsPage.tsx`.
- Every interactive element: visible `focus-visible` outline (`outline-2 outline-[var(--accent)]`), an accessible
  name, a text label or a `title` for icon-only buttons, and a hit area of at least 24×24px.

When you finish, reply with: what you changed (file by file, briefly), what you verified and how, and anything you
could not do or are unsure about. Be exact about what is verified by tests versus only by reading the code.
