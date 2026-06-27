# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

There is **no linter** configured and **no `tsc --watch`** — type errors surface only via `npm run build` (or the editor). Run `npm run build` to typecheck before claiming a change compiles; `tsc` here is `noEmit`, so the build's emit comes entirely from Vite. There is no packaging/distribution step (no electron-builder) in `package.json`.

## Architecture

Three source roots, enforced by `tsconfig.json` path aliases (`@/*` → `renderer/src/*`, `shared/*` → `shared/*`) and mirrored in `vite.config.mts`:

- **`main/`** — Electron main process (Node, full FS / network / native access). Owns the SQLite database, Gmail HTTP sync, OAuth, the Keychain, AI provider calls, and the background sync worker.
- **`renderer/`** — React 19 SPA. No Node access; everything privileged goes through `window.electronAPI`.
- **`shared/`** — pure, dependency-free TypeScript imported by both sides: domain types (`types.ts`), the deterministic mail classifier / split-inbox router (`classifier.ts`), the search-query parser (`search.ts`), and markdown→HTML (`markdown.ts`). Keep this directory free of Electron/Node/React imports — it is the only code that runs in both processes and is what the tests in `tests/` exercise directly.

### Process boundary (this is the spine of the app)

All renderer↔main communication is IPC, defined in exactly three places that must stay in sync:

1. `main/preload.ts` — `contextBridge.exposeInMainWorld('electronAPI', {...})` defines the entire surface the renderer can call.
2. `main/index.ts` — `ipcMain.handle('channel', ...)` registers a handler for each channel.
3. The renderer calls `window.electronAPI.<method>()`.

Channel naming convention: `db:*` channels are thin wrappers over the repositories in `main/database.ts`; `api:*` channels are services (Gmail sync, OAuth, AI, attachment dialogs). When adding a capability you almost always touch all three files plus `main/database.ts`. `contextIsolation: true` and `nodeIntegration: false` are set — do not weaken these.

### Data layer (`main/database.ts` + `main/migrations.ts`)

`better-sqlite3` (synchronous). It is **externalized** from the Vite/Rollup bundle (`rollupOptions.external` in `vite.config.mts`) because it is a native module — it must remain a real `node_modules` dependency and is the only entry under `dependencies` in `package.json`.

- DB lives at `~/Library/Application Support/dumka-mail-agy/database.sqlite`, opened with WAL + `foreign_keys=ON`.
- Repositories are plain object literals (`AccountsRepo`, `ThreadsRepo`, `MessagesRepo`, `DraftsRepo`, `RemindersRepo`, `SyncStateRepo`, `ActionLogRepo`, `AIConversationsRepo`, `SearchRepo`, `SettingsRepo`) that map snake_case DB rows ↔ camelCase `shared/types.ts` interfaces. Full-text search uses an FTS5 virtual table `mail_search`.
- **Migrations are idempotent, not versioned.** `runMigrations` runs on every launch: `CREATE TABLE IF NOT EXISTS` for base schema, plus an `addColumnIfMissing`-style loop (`tablesInfo`) that `ALTER TABLE ADD COLUMN` for newer columns. There is no `user_version` counter. To evolve the schema, add to the `CREATE` block and/or append to the `tablesInfo` array — never assume a migration runs exactly once.

### Offline-first action model

Mailbox mutations are optimistic and reconciled by a worker — understand this before touching `modifyLabels` / `sendDraft`:

1. The `api:modifyLabels` / `api:sendDraft` handlers in `main/index.ts` write the local SQLite state **first** (instant UI), then attempt the remote Gmail call.
2. On a *network* error (classified by `isNetworkError`), the action is parked in `mail_action_log` with status `pending_sync` instead of failing.
3. `startBackgroundSyncWorker()` polls every 15s, replays `pending_sync` actions, and on permanent (non-network) failure **rolls back** the optimistic local change.

So `ActionKind` / `ActionStatus` in `shared/types.ts`, the action-log repo, and this worker are a single mechanism — changing one usually means changing all three.

### Gmail sync (`main/gmail.ts`)

OAuth is a loopback PKCE flow (`startOAuthFlow` spins a temporary `http` server, opens the system browser via `shell`). Requires a Google OAuth client file (see Configuration). Sync has three modes on `GmailSyncService`: `syncInbox` (initial, ~30 threads), `syncIncremental` (Gmail History API via stored `historyId`), and `syncBackfillPage` (paged historical backfill, tracked in `sync_state`). Concurrency is bounded with `poolConcurrentTasks`. `mapMessage` converts raw Gmail message JSON into the `MailMessage` shape.

### AI layer (`main/ai.ts`)

`completeAI` dispatches over a `AIProviderPreference` union to per-provider `fetch` calls (OpenAI Responses/Chat, Anthropic Messages, Gemini generateContent, DeepSeek, OpenAI-compatible). `automatic` preference picks the first provider with a configured key. Provider config (API keys, model overrides, base URLs) is read from a dotenv-style file, **not** from the SQLite DB. There is no SDK dependency — all providers are hit via raw `fetch`, so adding a provider means extending the `switch` in both `getAIProviderDescriptor` and `completeAI`.

### Renderer (`renderer/src/`)

State is centralized in a single large React context store, `stores/AppStore.tsx` (~2k lines: accounts, threads, drafts, split inbox, search, action log, AI conversations, settings). The UI is one large `App.tsx` (~3.2k lines). Keyboard-driven UX (Superhuman/Gmail/Apple-Mail shortcut modes) lives in `hooks/useKeyboard.ts`. The split-inbox tabs (Important / Purchases / LinkedIn / Automation / Other) and classification are driven by `shared/classifier.ts`, so inbox-categorization changes belong in `shared/`, not the renderer.

## Configuration & secrets (no `.env` in repo)

Runtime config is read from the user's home dir, with a legacy fallback to the pre-rename `personal-mail-client` directory:

- Google OAuth client JSON: `~/.config/dumka-mail-agy/google-oauth-client.json` (fallback `~/.config/personal-mail-client/`).
- AI provider env: `~/.config/dumka-mail-agy/openai.env` (dotenv format; `process.env` overrides file values). Keys include `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, `GEMINI_API_KEY`, `DEEPSEEK_API_KEY`, `OPENAI_COMPATIBLE_*`, and `*_MODEL` / `*_BASE_URL` overrides.
- OAuth **refresh tokens** are stored in the macOS Keychain via the `security` CLI (`main/keychain.ts`, service name `dumka-mail-agy`), with an in-memory fallback on non-macOS / test environments.

When renaming config keys or paths, preserve the `personal-mail-client` fallback so existing installs keep working.
