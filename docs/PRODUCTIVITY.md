# Today, commitments, search, and AI preferences

## User workflows

Today starts with **Needs your attention**, showing seven actions at a time. Confirmed overdue commitments rank first. Imminent commitments and overdue replies follow; distant waiting items rank below actionable mail. Reply, briefing, and review entries for the same account/thread collapse into one action. Distinct confirmed commitments remain distinct even when they share source mail. Additional queues and tools remain available under a disclosure.

Each action exposes its reason, account, deadline when available, source evidence, and an explicit primary action. Snoozing hides that conversation from the attention list for one day; **Snoozed → Bring back** reverses it. Failed or pending mail actions remain visible independently. Coverage reports briefing candidate count, lookback, generation time, warnings, and the available sync state; an empty queue does not claim the entire mailbox is clear.

**Track a commitment** opens an inline editor. Choose an account, describe the outcome, set **I owe** or **Waiting on someone**, specify the owner and optional due date, and link at least one cached source message. Existing commitments can link additional messages from other threads in the same account. Completion is manual; sending a reply does not complete an outcome. Completed and dismissed items can be restored.

Possible commitments are extracted conservatively from explicit English promises in the current briefing snippets and up to 100 messages from the loaded conversation. This is a bounded suggestion mechanism, not a full-mailbox or multilingual extraction service. Suggestions require confirmation. Relative dates use the source message date and must be reviewed. The editor also supports tracking any other commitment manually. Dismissing a suggestion suppresses that source message until restored; a new message can produce a new suggestion.

The search toolbar's filter button opens sender autocomplete, inclusive date boundaries, attachment and read-state filters, and named saved searches. Operators remain supported. Saved searches belong to the active account; searches saved in Unified are available in Unified. A rolling **last 30 days** search resolves its lower date boundary when opened. Fixed searches retain their original dates. Filter edits preserve existing text, labels, domains, and split filters. Opening and closing search results continues to use the existing mailbox reader and list position.

**Correct** on an AI proposal supports source-specific corrections. **No reply needed** suppresses draft-reply suggestions for the cited message; **Already handled** suppresses that action for that message; **Keep this sender in my inbox** suppresses its archive suggestion. These are deterministic preferences, not model fine-tuning. A new message is not suppressed by a source-only correction.

After two corrections with the same reason for distinct messages from the same sender/account, **Today → AI preferences** offers a sender-rule preview. Enabling the rule is explicit. The preview lists matching cached sender threads and explains the future suggestion scope. Sender rules suppress either draft-reply or archive suggestions; they do not send, archive, delete, or otherwise modify mail. **Undo** removes a correction/rule; eligible proposals retained in the current raw plan become visible again. Existing drafts and mail remain accessible independently of filtering.

## Storage and boundaries

`productivity_records` stores typed commitments, corrections, saved searches, and attention snoozes in the existing SQLite database. The composite key is `(account_id, id)`. The migration is idempotent and full SQLite backups include these records automatically. Account cache purging removes the associated records; retaining the cache retains them.

`shared/productivity.ts` validates both IPC inputs and stored JSON. Each write carries the last read revision; the repository atomically rejects stale writes and deletes. Writes are acknowledged before the UI changes. Hydration errors are surfaced with Retry, and account switching hides old-scope records immediately. Renderer reads cannot overwrite a newer acknowledged mutation. The AI store preserves the raw proposal plan separately from its filtered view so corrections can be reversed.

The preload and renderer declarations expose `listProductivity`, `saveProductivity`, and `deleteProductivity`; main handlers use the existing secure IPC registrar. Source-mail reads use the existing database worker through the thread-reader API. No production dependencies or external services are added.

## Verification

`tests/productivity.test.ts` covers validation, extraction, evidence linking, account boundaries, correction scope, explicit sender-rule eligibility, undo semantics, search round trips, rolling periods, Today ranking, deduplication, and snooze expiry. `tests/productivityRepository.test.ts` checks SQLite migrations, scope isolation, stale-write rejection, and restoration after closing and reopening a disk database.

UI smoke checks use real components and the real productivity hook with a synthetic IPC adapter in an ignored local fixture. They exercise saved-search restoration, commitment confirmation, correction persistence, and undo. These checks do not establish live Gmail behavior or installation of the packaged desktop app.
