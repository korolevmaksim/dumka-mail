# AGENTS.md

This file provides guidance to Codex (Codex.ai/code) when working with code in this repository.

## What this is

Dumka Mail — a cross-platform agentic Gmail client built on Electron, React 19, and Tailwind CSS 4. It is a local-first desktop app: Gmail is synced into a local SQLite cache, mailbox actions are applied optimistically and reconciled in the background, and an AI layer (OpenAI / Anthropic / Gemini / DeepSeek / any OpenAI-compatible endpoint) provides triage, summarization, and drafting. Several files reference a Swift original (`addColumnIfMissing in Swift`); this is a TypeScript port of an earlier macOS/Swift app, so macOS conventions (Keychain, `~/Library/Application Support`, `hiddenInset` traffic lights) are first-class.

## Commands

```bash
npm run dev          # Vite dev server + Electron (vite-plugin-electron) with HMR
npm run build        # tsc typecheck (noEmit) then vite build → dist/ + dist-electron/
npm test             # vitest run (one-shot)
npm run test:watch   # vitest watch
npx vitest run tests/search.test.ts          # run a single test file
npx vitest run -t "parses from operator"     # run tests matching a name
```

There is **no linter** configured and **no `tsc --watch`** — type errors surface only via `npm run build` (or the editor). Run `npm run build` to typecheck before claiming a change compiles; `tsc` here is `noEmit`, so the build's emit comes entirely from Vite. Local macOS packaging uses `electron-builder` through `npm run package:mac` / `npm run dist:mac`.

## Architecture

Three source roots, enforced by `tsconfig.json` path aliases (`@/*` → `renderer/src/*`, `shared/*` → `shared/*`) and mirrored in `vite.config.mts`:

- **`main/`** — Electron main process (Node, full FS / network / native access). Owns the SQLite database, Gmail HTTP sync, OAuth, the Keychain, AI provider calls, and the background sync worker. Bulk mail persistence runs through a Node worker thread so SQLite FTS indexing does not block the Electron main event loop.
- **`renderer/`** — React 19 SPA. No Node access; everything privileged goes through `window.electronAPI`.
- **`shared/`** — pure, dependency-free TypeScript imported by both sides: domain types (`types.ts`), the decision engine (`decision.ts`) and thread signals (`threadSignals.ts`), inbox sections (`inboxSections.ts`), per-account settings (`accountSettings.ts`), sender rules (`senderRules.ts`), the search-query parser (`search.ts`), and markdown→HTML (`markdown.ts`). The older split-inbox classifier (`classifier.ts`, `categoryEngine.ts`) still backs custom categories, mail rules and briefings, but no longer drives the inbox. Keep this directory free of Electron/Node/React imports — it is the only code that runs in both processes and is what the tests in `tests/` exercise directly.

### Process boundary (this is the spine of the app)

All renderer↔main communication is IPC, defined in exactly three places that must stay in sync:

1. `main/preload.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` defines the entire surface the renderer can call.
2. `main/index.ts` — `ipcMain.handle('channel', ...)` registers a handler for each channel.
3. The renderer calls `window.electronAPI.<method>()`.

Channel naming convention: `db:*` channels are thin wrappers over the repositories in `main/database.ts`; `api:*` channels are services (Gmail sync, OAuth, AI, attachment dialogs). When adding a capability you almost always touch all three files plus `main/database.ts`. `contextIsolation: true` and `nodeIntegration: false` are set — do not weaken these.

### Data layer (`main/database.ts` + `main/migrations.ts`)

`better-sqlite3` (synchronous). It is **externalized** from the Vite/Rollup bundle (`rollupOptions.external` in `vite.config.mts`) because it is a native module — it must remain a real `node_modules` dependency and must remain under `dependencies` in `package.json` alongside the MCP SDK. Version 13 uses Node-API prebuilds; verify it loads in both Node and Electron instead of forcing a per-Electron ABI rebuild. See `docs/DEPENDENCIES.md` for pinned versions and the scoped security override.

- DB lives at `~/Library/Application Support/dumka-mail/database.sqlite`, opened with WAL + `foreign_keys=ON`. The app migrates the pre-rename `dumka-mail-agy` support directory on first launch when the new directory does not exist.
- Repositories are plain object literals (`AccountsRepo`, `ThreadsRepo`, `MessagesRepo`, `DraftsRepo`, `RemindersRepo`, `SyncStateRepo`, `ActionLogRepo`, `AIConversationsRepo`, `SearchRepo`, `SettingsRepo`) that map snake_case DB rows ↔ camelCase `shared/types.ts` interfaces. Full-text search uses an FTS5 virtual table `mail_search`.
- Bulk thread/message writes and interactive full-mailbox/thread-detail reads must go through `main/databaseWorkerClient.ts` (`main/databaseWorker.ts` is a separate Vite Electron entry). Do not run archive-sized `ThreadsRepo.list`, `MessagesRepo.listForThread`, or `MessagesRepo.save` work from IPC handlers or sync loops on the Electron main event loop.
- Two connections share the WAL database (main thread and database worker). Interactive writes on the main thread are wrapped by `guardRepositoryWrites` (`main/sqliteWriteGuard.ts`): one IMMEDIATE transaction with a bounded SQLITE_BUSY retry; bulk writers commit in chunks and yield. Wrap every new interactive repository write the same way (see the end of `main/repositories.ts`, `main/senderRulesRepository.ts`).
- Smaller repositories live next to their feature: `main/agentPrepRepository.ts` (`thread_summaries`), `main/senderRulesRepository.ts` (`sender_rule_stats`, `sender_rule_archives`), `main/productivityRepository.ts`, `main/calendarRepository.ts`. Account cache purge (`AccountsRepo.delete(..., { purgeCache: true })`) must delete their rows too.
- History backfill is owned by `api:runBackfillPage` in `main/index.ts`: it fetches the Gmail page, persists it through the database worker, saves `sync_state`, and returns only progress. The renderer should not shuttle full backfill `MailMessage` pages over IPC.
- Scheduled Gmail reconciliation is main-process-owned. `runMailboxSyncForAccount` coalesces concurrent requests per account and publishes `MailboxDelta` events after persistence; the renderer applies those deltas to its cached mailbox snapshots instead of running a second 60-second sync loop or reloading the full archive.
- **Migrations are idempotent, not versioned.** `runMigrations` runs on every launch: `CREATE TABLE IF NOT EXISTS` for base schema, plus an `addColumnIfMissing`-style loop (`tablesInfo`) that `ALTER TABLE ADD COLUMN` for newer columns. There is no `user_version` counter. To evolve the schema, add to the `CREATE` block and/or append to the `tablesInfo` array — never assume a migration runs exactly once.

### Offline-first action model

Mailbox mutations are optimistic and reconciled by a worker — understand this before touching `modifyLabels` / `sendDraft`:

1. The `api:modifyLabels` / `api:sendDraft` handlers in `main/index.ts` write the local SQLite state **first** (instant UI), then attempt the remote Gmail call.
2. On a *network* error (classified by `isNetworkError`), the action is parked in `mail_action_log` with status `pending_sync` instead of failing.
3. `startBackgroundSyncWorker()` polls every 15s, replays `pending_sync` actions, and on permanent (non-network) failure **rolls back** the optimistic local change.

So `ActionKind` / `ActionStatus` in `shared/types.ts`, the action-log repo, and this worker are a single mechanism — changing one usually means changing all three.

Actions the main process takes on its own use the same path and say so in the payload: sender-rule archives (`main/senderRulesService.ts`) write SQLite first, log a `markDone` with `{ auto: true, provenance: { origin: 'senderRule', ruleId } }`, call Gmail, and park or roll back like `E`. `auto` keeps them out of `Z`, which undoes the user's own actions.

### Gmail sync (`main/gmail.ts`)

OAuth is a loopback PKCE flow (`startOAuthFlow` spins a temporary `http` server, opens the system browser via `shell`). Requires a Google OAuth client file (see Configuration). Sync has three modes on `GmailSyncService`: `syncInbox` (initial, ~30 threads), `syncIncremental` (Gmail History API via stored `historyId`), and `syncBackfillPage` (paged historical backfill, tracked in `sync_state`). Concurrency is bounded with `poolConcurrentTasks`. `mapMessage` converts raw Gmail message JSON into the `MailMessage` shape.

### Decisions and the agent pipeline

- Thread signals (`shared/threadSignals.ts`: invite, list/unsubscribe headers, bulk, auto-submitted, `fromUser`, last message id) are computed when a thread is built from its messages and stored in `threads.signals_json`; older rows are backfilled.
- `shared/decision.ts` assigns every inbox thread one decision (`reply | read | event | later | clear | unsubscribe | people | automated`). Three layers, strongest last: deterministic rules (always available, set `protected` for people, security notices and invitations), a model refinement limited to allowed transitions, and a user correction (`V`). Model rows and corrections are cached in `thread_decisions` and expire when the thread's last message changes.
- `main/agentPrepService.ts` runs the model work in the main process: decision batches (≤ 12 threads), prepared reply drafts for `reply` threads (≤ 5 per pass, stored in `agent_drafts`, never sent), on-demand thread summaries, and the streaming "Ask Dumka" chat. Nothing is requested unless a provider is configured and the account allows mail text to reach the model. Background work is opt-in on top of that: decision batches run only while `backgroundSorting` resolves to true for the account (`ai.backgroundSorting`, off by default, overridable per account) and drafts are prepared in advance only with `ai.proactiveDraftsEnabled` as well; otherwise the model is called only when the user asks (summary, `Draft a reply`, chat). Background work may use its own provider and model (`ai.automationProvider`, `ai.automationModel`). **No model id is built into the app** (they go stale within months): the model always comes from settings, chosen from the provider's own list (`GET /models`), and a provider with a key but no chosen model reports `Missing model` and is not called. Do not add default or "known" model ids anywhere in `main/`, `shared/` or `renderer/` — `tests/aiModelCatalog.test.ts` fails if one appears. `shared/aiModelCatalog.ts` only filters and orders the provider's list. `main/aiStream.ts` streams provider responses (with a non-streaming fallback) and every request is cancellable (`api:cancelAI`).
- Sender rules (`shared/senderRules.ts`, `main/senderRulesService.ts`): `api:modifyLabels` counts confirmations (an archive of a non-protected `clear` / `unsubscribe` thread, once per thread and action id) and bring-backs (back to the inbox within 7 days). A rule is created only by the user's consent in the inbox offer row or the row menu. After a sync persists a thread with new inbound mail, `performMailboxSyncForAccount` calls `afterPersist`, which archives it when an enabled rule matches and the account's autonomy is `prepareAndRules`; such threads raise no notification. The rules themselves are settings and stay renderer-owned; main publishes `api:senderRulesChanged` and the renderer counts bring-backs on the rule and switches it off at two. Main also enforces this on its own: a rule whose stats show two bring-backs since it was created is not applied even if the settings still say it is enabled, and an Undo within 15 s of the user's own archive is not counted as a bring-back. A rule archive parked as `pending_sync` is revalidated against current state (`SenderRulesService.parkedArchiveBlockReason`) before the reconciler replays it and whenever a sync persists the thread, and any label change that adds INBOX cancels it — so a parked archive can never fire on a thread that has since become protected or been brought back. The archive batch after an unsubscribe goes through `planArchiveAfterUnsubscribe`, which keeps protected and non-routine conversations in the inbox.

### AI layer (`main/ai.ts`)

OpenAI Decisions sorting is a separate path (`main/openAIDecisions.ts`,
`shared/openAIDecisions.ts`), selected by `ai.sortingEngine`. Its model comes
only from `ai.decisionsModel`; never infer it from a model name or hardcode an
API-specific model. `ai.decisionsMinConfidence` controls when to keep local
rules. Settings loads the provider catalog through the existing model picker.
See `docs/DECISIONS.md` for permissions, cache identity and response validation.

`completeAI` dispatches over a `AIProviderPreference` union to per-provider `fetch` calls (OpenAI Responses/Chat, Anthropic Messages, Gemini generateContent, DeepSeek, OpenAI-compatible). `automatic` preference picks the first provider with a configured key. Provider config (API keys, model overrides, base URLs) is read from a dotenv-style file, **not** from the SQLite DB. There is no SDK dependency — all providers are hit via raw `fetch`, so adding a provider means extending the `switch` in both `getAIProviderDescriptor` and `completeAI`.

### Renderer (`renderer/src/`)

State is centralized in one React context store, `stores/AppStore.tsx`, composed from hooks (`useMailState`, `useDraftsState`, `useAIState`, `useInboxSections`, `useSenderRules`, `useSettingsState`, …). `App.tsx` lays out the shell: left rail, mailbox list, reading area (at most three columns). Keyboard-driven UX (Superhuman/Gmail/Apple-Mail shortcut modes) lives in `hooks/useKeyboard.ts`; the shortcut guide and palette entries come from `shared/appKeymap.ts`.

- **Sectioned inbox** (`components/mailbox/`, `stores/useInboxSections.ts`, `lib/inboxListItems.ts`): the inbox is grouped by decision (`Reply / People, Read, Event, Later, Automated, Clear, Unsubscribe`); Clear and Unsubscribe start collapsed; `⇧E` / `⇧H` act on Clear / Later as one undoable batch, never on protected threads. Section headers, group rows and thread rows are items of one virtualized list. Above it sit the section jump bar (`SectionJumpBar`: one link per section, `[` / `]`; it scrolls the one list through `lib/sectionJumpBridge.ts` and never filters it or opens a collapsed group, so it is a navigation landmark, not a tab list), the sender-rule offer row and "Handled for you". Other mailboxes (Sent, All mail, search, …) are flat lists. Decision logic belongs in `shared/`, not the renderer.
- **Reader** (`components/reader/`): `ThreadReader` with `ThreadHeader`, the summary block for long threads, and `ReplyDock`, the docked editor where a prepared draft appears. "Ask Dumka" (`⌘J` / palette) opens a floating panel over the reading area.
- **Settings**: per-account values resolve through `shared/accountSettings.ts` (`settings.accountOverrides[accountId]`, falling back to the app value) and are edited on the account page (`components/settings/AccountSettingsPage.tsx`).

Mailbox navigation is cache-first: `stores/mailboxIndex.ts` indexes a loaded scope once into mailbox buckets rather than rescanning the archive. Thread reading initially expands the latest three messages, reveals earlier history in batches, and defers offscreen HTML iframes; preserve these responsiveness boundaries when extending the list or reader.

## Configuration & secrets (no `.env` in repo)

Runtime config is read from the user's home dir, with a legacy fallback to the pre-rename `personal-mail-client` directory:

- Google OAuth client JSON: `~/.config/dumka-mail/google-oauth-client.json` (fallbacks `~/.config/dumka-mail-agy/` and `~/.config/personal-mail-client/`).
- AI provider settings are configured through Settings -> AI Configuration. Advanced dotenv preload path: `~/.config/dumka-mail/ai.env` (`process.env` overrides file values; legacy fallback filenames include `openai.env` under `~/.config/dumka-mail/`, `~/.config/dumka-mail-agy/`, and `~/.config/personal-mail-client/`). Keys include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `OPENROUTER_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_COMPATIBLE_*`, and `*_MODEL` / `*_BASE_URL` overrides. OpenRouter also supports optional `OPENROUTER_REFERER` and `OPENROUTER_APP_TITLE` headers.
- OAuth **refresh tokens** are stored in the macOS Keychain via the `security` CLI (`main/keychain.ts`, service name `dumka-mail`, fallback `dumka-mail-agy`), with an in-memory fallback on non-macOS / test environments.

When renaming config keys or paths, preserve the `personal-mail-client` fallback so existing installs keep working.
