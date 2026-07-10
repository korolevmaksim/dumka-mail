# Cleanup Sender Exclusions and Message Preview

Date: 2026-07-10
Status: Approved through product discussion

## Problem

Privacy & Cleanup currently asks the user to decide from sender identity and aggregate statistics. Sender names can be ambiguous, and legitimate high-volume senders may keep returning even after the user has decided they should not be cleanup candidates.

The workflow needs two trust-building capabilities:

1. Inspect recent messages from a sender without losing Cleanup context.
2. Persistently exclude a sender from Cleanup suggestions and manage those exclusions later.

## User Experience

### Preview recent mail

- Each sender row exposes `Preview latest` as a secondary action.
- Preview opens as an in-context side sheet above the Cleanup workspace instead of navigating to the normal mail reader.
- The sheet loads up to the three newest locally cached messages for the sender and opens the newest one first.
- Previous/next controls move through the loaded messages while showing the current position.
- The existing hardened mail renderer is reused, but remote images start blocked in Cleanup preview even when the global reader preference allows them. The user can load images explicitly from the message card.
- Closing with the visible control or Escape restores the unchanged Cleanup list and scroll position.
- The preview repeats `Archive old`, `Unsubscribe`, and `Exclude from Cleanup` so the user can act after reviewing evidence.

### Exclude from Cleanup

- Each sender row exposes `Exclude from Cleanup` as a quiet tertiary action.
- Exclusion is account-scoped and keyed by normalized sender email.
- Excluding immediately removes the row and displays a toast with `Undo`.
- Exclusion affects only Privacy & Cleanup recommendations. It does not block mail, change Gmail labels, alter search, or suppress security analysis elsewhere.
- The header exposes `Excluded (N)`, which opens an inline management sheet.
- The management sheet groups entries by account and supports `Restore` for each sender.

## Data Model

Create `cleanup_sender_exclusions`:

```sql
CREATE TABLE IF NOT EXISTS cleanup_sender_exclusions (
  account_id TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  sender_name TEXT NOT NULL,
  excluded_at TEXT NOT NULL,
  PRIMARY KEY (account_id, sender_email)
);
```

`sender_email` is stored trimmed and lower-cased. The sender-stats query filters exclusions before ordering and `LIMIT 200`, so excluded rows do not consume result capacity.

## Process Boundary

- Lightweight exclusion list/save/delete operations are thin `db:*` IPC handlers backed by `CleanupExclusionsRepo`.
- Recent sender message reads and aggregate stats remain database-worker-owned.
- Add a bounded `recentSenderMessages` worker request so preview does not load an account archive or perform N+1 thread reads.
- IPC additions remain synchronized across `main/index.ts`, `main/preload.ts`, and `renderer/src/vite-env.d.ts`.

## Safety and Failure States

- Exclusion write failure keeps the row visible and shows an error toast.
- Undo/Restore failure keeps the exclusion visible and shows an error toast.
- Preview loading failure stays inside the sheet with Retry; it does not close Cleanup.
- Empty cached preview explains that no local messages are available.
- No preview action executes directly: Archive and Unsubscribe continue to create Agent Review Queue proposals.

## Acceptance Criteria

1. Excluded senders disappear after reload and app restart.
2. Exclusions are isolated by account and editable from the Cleanup header.
3. Undo restores an excluded sender and refreshes statistics.
4. Preview shows up to three latest messages, defaults to the newest, and supports keyboard-safe close.
5. Preview actions reuse the same proposal paths as sender-row actions.
6. Exclusions are filtered in SQL before the 200-row limit.
7. Focused repository tests, full `npm test`, and `npm run build` pass.
