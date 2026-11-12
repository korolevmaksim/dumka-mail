# Commitments, search, and AI preferences

## What is reachable in the UI now

The Today screen was removed with the decision-sections redesign (`design-review/SPEC.md` §2). Its data and services remain, but only part of it has a screen:

- **Saved searches and search filters — reachable.** The search toolbar's filter button opens sender autocomplete, inclusive date boundaries, attachment and read-state filters, and named saved searches. Operators remain supported. Saved searches belong to the active account; searches saved in Unified are available in Unified. A rolling **last 30 days** search resolves its lower date boundary when opened. Fixed searches retain their original dates. Filter edits preserve existing text, labels, and domains. Opening and closing search results uses the normal mailbox reader and list position.
- **Commitments — stored, no screen.** Records created earlier (I owe / Waiting on someone, owner, due date, linked source messages) stay in `productivity_records`, are included in backups, and are purged with the account cache. There is currently no editor, list, or extraction prompt for them.
- **AI corrections and their sender rules — stored, no screen.** Earlier corrections (**No reply needed**, **Already handled**, **Keep this sender in my inbox**) and correction-based suggestion rules are still loaded and still suppress matching proposals in the AI store, but the review queue where they were created and undone is gone. These are not the inbox sender rules of SPEC §7 (`shared/senderRules.ts`), which are listed on the account settings page.
- **Attention snoozes — stored, no screen.** They only affected the removed attention list.

The ranking, extraction, and correction logic in `shared/productivity.ts`, `shared/commitments.ts`, `shared/todayAttention.ts`, and `shared/reviewCorrections.ts` is unchanged and still tested.

## Storage and boundaries

`productivity_records` stores typed commitments, corrections, saved searches, and attention snoozes in the existing SQLite database. The composite key is `(account_id, id)`. The migration is idempotent and full SQLite backups include these records automatically. Account cache purging removes the associated records; retaining the cache retains them.

`shared/productivity.ts` validates both IPC inputs and stored JSON. Each write carries the last read revision; the repository atomically rejects stale writes and deletes. Writes are acknowledged before the UI changes. Hydration errors are surfaced with Retry, and account switching hides old-scope records immediately. Renderer reads cannot overwrite a newer acknowledged mutation.

The preload and renderer declarations expose `listProductivity`, `saveProductivity`, and `deleteProductivity`; main handlers use the existing secure IPC registrar. Source-mail reads use the existing database worker through the thread-reader API. No production dependencies or external services are added.

## Verification

`tests/productivity.test.ts` covers validation, extraction, evidence linking, account boundaries, correction scope, explicit sender-rule eligibility, undo semantics, search round trips, rolling periods, Today ranking, deduplication, and snooze expiry. `tests/productivityRepository.test.ts` checks SQLite migrations, scope isolation, stale-write rejection, and restoration after closing and reopening a disk database.

These tests exercise the stored logic; only the saved-search part has a UI today. They do not establish live Gmail behavior or installation of the packaged desktop app.
