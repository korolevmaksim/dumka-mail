# Action Reconciliation Engine Extraction

Date: 2026-07-04
Status: Approved (user delegated all decision points to recommended options; decisions documented below)

## Problem

The offline action-log replay/rollback engine is the highest data-integrity risk in the app and
has zero tests:

- It lives inside `main/index.ts` (1733 lines before this change) — a side-effectful Electron
  entry file with top-level `app`/`BrowserWindow` imports that vitest cannot import. The engine
  itself is `startBackgroundSyncWorker` (`main/index.ts:1385-1523`) plus `isNetworkError`
  (`main/index.ts:1357-1377`).
- The replay loop dispatches ~15 `ActionKind` branches against Gmail (label ops, trash/untrash,
  spam, mute, `send`, `forwardThread`, `autoReply`) and on permanent failure rolls back
  optimistic local label changes. A bug in the `send` branch double-sends mail; a bug in
  rollback corrupts local mailbox state.
- **Stranded `running` actions (real bug):** the loop sets each action to `running` before the
  remote call. If the process crashes or quits mid-call, the action stays `running` forever —
  `ActionLogRepo.listPending` (`main/repositories.ts:1514-1521`) selects only `pending_sync`, so
  the action is never retried, never failed, and never rolled back.

## Decisions (delegated; recommended options applied)

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| D1 | Module boundary | New `main/actionReconciler.ts` exporting `isNetworkError`, `reconcilePendingActions(deps)` (one pass), `recoverStaleRunningActions(deps)`, and `startBackgroundSyncWorker(deps, intervalMs?)` (thin `setInterval` + overlap guard) | One pass is the testable unit; the interval wrapper stays trivial |
| D2 | Draft builders | `buildForwardDraftFromThread` / `buildAutoReplyDraftFromRule` STAY in `main/index.ts`; the reconciler receives them as injected functions | They are shared with the optimistic paths (`main/index.ts:1126,1156`) and pull in `escapeHtml`, `MessagesRepo`, auto-reply safety helpers — moving them would balloon scope |
| D3 | Dependency injection | Plain `ReconcilerDeps` object of structural types (`Pick<typeof ActionLogRepo, ...>` etc.) — no vi.mock needed in tests | Matches repo style (plain object repos); structural `Pick` types cannot drift from the real objects |
| D4 | Behavior scope | Extraction is behavior-preserving, with exactly ONE fix: stale-`running` recovery at worker start | The stranded-`running` bug is the data-integrity motivation for this task; everything else moves verbatim |
| D5 | Stale-`running` policy | Send-like kinds (`send`, `forwardThread`, `autoReply`) → `failed` (`'Interrupted while sending; not retried to avoid a duplicate send.'`; never risk a double-send). Replayable label-family kinds (the `REPLAYABLE_KINDS` dispatch set minus send-like) created within `RECOVERY_MAX_AGE_MS` (7 days) → reset to `pending_sync` with `failureMessage`/`completedAt` nulled (Gmail label/trash ops are idempotent — safe to replay). Replayable kinds older than 7 days → `failed` (`'Interrupted too long ago; not retried automatically.'`; stale destructive intent, e.g. an ancient `moveToTrash`, must not replay). All other kinds (no dispatch branch — e.g. `unsubscribeSender`, `setReminder`, calendar CRUD) → `failed` (`'Interrupted before completion; not retried automatically.'`) | A crash after Gmail accepted a send but before the status write is indistinguishable from a crash before the call; retrying is the dangerous branch. Re-queueing a kind without a dispatch branch would hit the loop's fall-through and fabricate a `completed` record without doing any work |

## Design

### 1. `main/actionReconciler.ts` (new)

```ts
export interface ReconcilerDeps {
  actionLog: {
    listPending(nowIso?: string): MailActionLog[];
    listRunning(): MailActionLog[];          // new repo method, see §3
    save(log: MailActionLog): void;
  };
  threads: {
    get(accountId: string, threadId: string): MailThread | null;
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
  };
  drafts: {
    get(draftId: string): MailDraft | null;
    delete(draftId: string): void;
  };
  gmail: {
    modifyLabels(accountId: string, threadId: string, add: string[], remove: string[]): Promise<unknown>;
    trashThread(accountId: string, threadId: string): Promise<unknown>;
    untrashThread(accountId: string, threadId: string): Promise<unknown>;
    sendDraft(accountId: string, draft: unknown): Promise<unknown>;
  };
  buildForwardDraft(accountId: string, thread: MailThread, forwardTo: string): unknown;
  buildAutoReplyDraft(accountId: string, threadId: string, replyBody: string): unknown;
  now?: () => Date;                           // default: () => new Date()
  logger?: Pick<Console, 'log' | 'error'>;    // default: console
}
```

- `isNetworkError(err: unknown): boolean` — moved verbatim from `main/index.ts:1357-1377`.
  `main/index.ts` imports it back (six optimistic-path call sites keep working unchanged).
- `reconcilePendingActions(deps): Promise<void>` — the body of the current interval callback
  (everything from `listPending` through the loop), moved verbatim with these mechanical
  substitutions only: `ActionLogRepo` → `deps.actionLog`, `GmailSyncService` → `deps.gmail`,
  `ThreadsRepo` → `deps.threads`, `DraftsRepo` → `deps.drafts`, builder calls → injected
  functions, `new Date()` → `deps.now()`, `console` → `deps.logger`.
  Semantics preserved EXACTLY, including: the `break` on network error (stop the pass, keep the
  rest `pending_sync`); rollback only for label-family kinds; kinds without a dispatch branch
  fall through to `completed` (current quirk — preserved and pinned by a test);
  `applyLabel`/`moveToLabel`/`removeLabel` with a missing `labelId` make no remote call and
  complete silently (same quirk — pinned by a test).
- `recoverStaleRunningActions(deps): void` — the one behavioral fix (D4/D5). For each
  `deps.actionLog.listRunning()` row:
  - send-like kind → `status: 'failed'`,
    `failureMessage: 'Interrupted while sending; not retried to avoid a duplicate send.'`,
    `completedAt: now()`;
  - kind not in `REPLAYABLE_KINDS` (no dispatch branch in the replay loop) →
    `status: 'failed'`, `failureMessage: 'Interrupted before completion; not retried automatically.'`,
    `completedAt: now()` — re-queueing would fall through to a fabricated `completed`;
  - replayable label-family kind older than `RECOVERY_MAX_AGE_MS` (7 days, by `createdAt`
    vs `now()`) → `status: 'failed'`,
    `failureMessage: 'Interrupted too long ago; not retried automatically.'`, `completedAt: now()`;
  - replayable label-family kind within the window → `status: 'pending_sync'` with
    `failureMessage: null` and `completedAt: null` (clears stale fields from an earlier
    failed-offline life of the row).

  No remote calls, no rollback (the optimistic local state is still the user's intent; the
  next pass replays it). Exports: `SEND_LIKE_KINDS`, `REPLAYABLE_KINDS`, `RECOVERY_MAX_AGE_MS`.
- `startBackgroundSyncWorker(deps, intervalMs = 15000): NodeJS.Timeout` — calls
  `recoverStaleRunningActions(deps)` once inside a try/catch (a repo error during recovery is
  logged and must not abort app startup — the call runs synchronously from Electron's
  `whenReady` handler), then `setInterval` with the existing
  `syncWorkerActive` overlap guard held as CLOSURE state inside this function (not module
  state — two workers in a test must not share a guard). `reconcilePendingActions` itself is
  guard-free. Returns the timer handle (enables clearing in tests; `main/index.ts` ignores it).

### 2. `main/index.ts` changes

- Delete `isNetworkError` and `startBackgroundSyncWorker` bodies (~170 lines).
- `import { isNetworkError, startBackgroundSyncWorker } from './actionReconciler';`
- The call site (`main/index.ts:635`) becomes `startBackgroundSyncWorker(reconcilerDeps)` with a
  deps literal wiring the real `ActionLogRepo` / `ThreadsRepo` / `DraftsRepo` /
  `GmailSyncService` / builders. `syncWorkerActive` module flag in `index.ts` is deleted (moves
  into the reconciler module).

### 3. `main/repositories.ts`

- Add `ActionLogRepo.listRunning(): MailActionLog[]` — same row mapping as `listPending`, with
  `WHERE status = 'running' ORDER BY created_at ASC`.

### 4. Tests (`tests/actionReconciler.test.ts`, new — the point of the exercise)

Pure DI fakes (in-memory arrays/objects; no `vi.mock`). Coverage:

1. **Dispatch table** — each replayable kind calls the right gmail method with the right
   add/remove labels (table-driven over the 15 kinds).
2. **Success path** — `completed` + `completedAt` set via injected `now`.
3. **Network failure** — current action back to `pending_sync`, loop `break`s (later actions
   remain untouched `pending_sync`, no further gmail calls).
4. **Permanent failure** — `failed` + `failureMessage` + `completedAt`; rollback table-driven
   over the label-family kinds (exact add/remove inversions from `main/index.ts:1482-1512`);
   send-like kinds get NO rollback.
5. **Payload quirks pinned** — mute/unmute with/without `labelId`; label ops with missing
   `labelId` complete without a remote call; unknown kind (e.g. `setReminder`) completes
   without a remote call.
6. **Send branch** — draft present: `sendDraft` then `drafts.delete`; draft missing: permanent
   failure, no delete. `forwardThread` missing `forwardTo`/thread and `autoReply` missing
   `replyBody`/`threadId`: permanent failures.
7. **Stale-`running` recovery** — fresh label kind → `pending_sync` (with stale
   `failureMessage`/`completedAt` nulled); label kind older than 7 days → `failed` with the
   too-long-ago message; each send-like kind → `failed` with the exact duplicate-send message;
   non-replayable kind (`unsubscribeSender`, `setReminder`) → `failed` with the
   interrupted-before-completion message; empty list → no-op; recovery runs before the first
   pass; a throwing recovery is logged and does not prevent the interval passes.
8. **Overlap guard** — a second pass started while one is in flight returns immediately
   (exercise via a gmail fake that blocks on a controllable promise).

No Electron imports anywhere in the new module — it must be importable by vitest directly.

## Error handling

Unchanged by design: network-classified errors park work for the next pass; everything else is
permanent (`failed` + rollback where defined). The outer try/catch around a pass logs and
releases the guard flag (moved verbatim).

## Out of scope

Retry backoff, action-log UI changes, the `autoMarkRead`/calendar/reminder kinds (they never
enter `pending_sync` replay today), moving the draft builders, changing `listPending` ordering.

## Validation

`npm run build` green; `npx vitest run tests/actionReconciler.test.ts` green; full `npm test`
green. No linter exists (tsc via build is the only type gate).

## File touch list

Create `main/actionReconciler.ts`, `tests/actionReconciler.test.ts`; modify `main/index.ts`,
`main/repositories.ts`.
