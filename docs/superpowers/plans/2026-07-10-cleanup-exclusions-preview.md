# Cleanup Sender Exclusions and Message Preview Implementation Plan

**Goal:** Let users inspect recent sender mail before deciding, then persistently exclude trusted senders from Cleanup with an editable account-scoped list.

**Spec:** `docs/superpowers/specs/2026-07-10-cleanup-exclusions-preview.md`

## 1. Persistence and query behavior

- Add the idempotent `cleanup_sender_exclusions` table and account index.
- Add `CleanupSenderExclusion` shared type.
- Implement `CleanupExclusionsRepo.list/save/delete` with normalized email identity.
- Add an exclusion anti-join to `MessagesRepo.senderCleanupStats` before ordering/limit.
- Extend repository tests for normalization, account isolation, persistence, restore, and stats filtering.

## 2. Worker and IPC contracts

- Add bounded `MessagesRepo.listLatestBySender`.
- Add a `recentSenderMessages` request to the database worker/client.
- Add typed exclusion list/save/delete and recent-message IPC methods across main, preload, and renderer declarations.

## 3. Cleanup UI

- Add `Preview latest` and `Exclude from Cleanup` sender actions.
- Add an `Excluded (N)` header control and editable exclusion sheet.
- Add optimistic row removal only after persistence succeeds, with Undo toast.
- Share existing Archive/Unsubscribe proposal handlers with the preview sheet.

## 4. Sender preview

- Create a focused `CleanupSenderPreview` component.
- Load up to three newest cached messages and render one at a time with `MessageCard`.
- Add previous/next navigation, position indicator, loading/error/empty states, Escape close, and the decision actions.

## 5. Verification and documentation

- Run focused Cleanup/repository tests.
- Run full `npm test` and `npm run build`.
- Keep the original Cleanup spec as history and link this follow-up from the implementation summary.
