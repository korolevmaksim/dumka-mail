# Privacy & Cleanup Center

Date: 2026-07-04
Status: Approved (user delegated all decision points to recommended options; decisions documented below)

## Problem

The competitive analysis (`local-research/competitive-feature-intelligence-2026-07-03.md:313-330,
371-379, 405-408, 525-539`) ranks the "Privacy and Cleanup Center" as the highest-value
unshipped opportunity (rank 3, 23/25): *"See which senders waste your attention or track you,
then clean them up safely."* Its prescribed first slice is exactly two bullets:

1. A **"Cleanup" tab** with sender groups, tracker count, unsubscribe candidate, recent volume,
   and suggested action.
2. **Bulk actions are dry-run first** and reversible through the action log.

Validation experiment 3 adds a hard requirement: users must be able to explain *"what the app
did and what did not leave the machine"* — on-screen data-flow transparency is part of the
feature, not decoration.

Two known bugs in the AgentPlan machinery this feature reuses are folded in:

- **Bug A:** `runAITriagePlan` replaces the whole review queue via `setAgentPlan(reviewPlan)`
  (`renderer/src/stores/useAIState.ts:759`), discarding briefing-added/manual items, instead of
  merging via the existing `mergeAgentPlanItem` (`shared/agentPlan.ts:247-279`).
- **Bug B:** `AITriagePlanCard.tsx` (203 lines) is imported nowhere; a legacy `triagePlan`
  selection/preview/apply surface in `useAIState.ts` (:88, :235-369) and ~10 `AppStoreContextType`
  entries exist almost solely for it.

## Decisions (delegated; recommended options applied)

| # | Decision | Choice | Rationale |
| --- | --- | --- | --- |
| C1 | Surface | Full-workspace pane behind a store boolean `cleanupOpen`, mounted exactly like Settings (`App.tsx:911-914` ternary), with a LeftRail button. NOT a new `MailboxView` | The Settings pattern is one boolean + one ternary branch; a new MailboxView touches 6+ files of `Record<MailboxView,…>` plumbing and G-cycling for no benefit. The doc mandates "a workflow tab, not settings" — a top-level LeftRail entry satisfies that |
| C2 | Stats computation | New `senderCleanupStats` request type on the existing **database worker** (`main/databaseWorker.ts` / `databaseWorkerClient.ts`), exposed as `api:listCleanupSenderStats`. The verified fast CTE (0.6 s over 20.8k messages) must NOT run on the main event loop | Repo precedent (semantic scans, bulk persistence) offloads heavy SQLite work to workers; the worker protocol is a simple typed union — adding a read request is mechanical |
| C3 | Unsubscribe flag | SQL heuristic in the same CTE: sender has any message with `headers_json LIKE '%list-unsubscribe%'` (SQLite LIKE is ASCII case-insensitive) | Exact parsing (`parseUnsubscribeCandidate`) needs hydrated messages — too heavy per-sender for the list; the heuristic is header-presence, which is exactly what the parser keys on. Precise methods are resolved lazily only when the user acts (C6) |
| C4 | Tracker counts | LEFT JOIN the existing `message_security` table (per-message `tracker_count`, `risk_level`, `main/migrations.ts:220-230`) grouped per sender; display as "trackers found among analyzed messages" (analysis coverage is partial by design) | Zero re-analysis cost; honest label avoids implying full coverage |
| C5 | Suggested action | Pure function `suggestCleanupAction(stats)` in `shared/cleanup.ts`: high risk → `review` ; unsubscribe-flag AND recent30d ≥ 3 → `unsubscribe`; recent30d ≥ 10 OR (threadCount ≥ 10 AND unread ratio ≥ 0.7) → `archiveOld`; else `none` | Deterministic, local, testable — matches the briefing/classifier house style |
| C6 | Actions → review queue (dry-run) | Cleanup row buttons build `AgentPlanItem`s and merge them into the EXISTING Agent Review Queue via `mergeAgentPlanItem` (never replace). The queue IS the dry-run: items land as `proposed`, nothing executes until Approve. New `AgentPlanSource` member `'cleanup'`. Two actions in slice: **Archive old** — one `archive` item per read thread of that sender older than 30 days, capped at 25 oldest per click (`autoSelected`, `low` risk); **Unsubscribe** — one new `unsubscribe` action-kind item (`manualOnly`, `high` risk) whose apply path calls the existing `window.electronAPI.unsubscribeThread` (`main/preload.ts:131`, handler `main/index.ts:1310`) | Reuses the shipped approval machinery end-to-end; archive maps to reversible `markDone` (rollback exists in the reconciler); unsubscribe is classified high-risk per the doc's own risk-labels fix; the 25 cap keeps the queue reviewable |
| C7 | New action kind | Extend `AgentPlanActionKind` with `'unsubscribe'`: `AgentReviewQueueCard` gets label/icon/description entries; `applyAgentPlanItem` dispatches to `unsubscribeThread(accountId, threadId)`; eligibility follows the `gmail` scope rules | The union is exhaustively consumed in 3 places (`ACTION_LABEL`/`ACTION_ICON`/`actionDescription`) — tsc finds them all |
| C8 | Privacy transparency | Panel header carries a static line: "Computed locally from your cached mail. Nothing leaves your machine until you approve an action." Unsubscribe plan items carry the method summary in `citation.evidence` (e.g. "One-click HTTP unsubscribe → https://…" or "Mail to unsubscribe@…"), resolved at item-build time by hydrating that sender's newest flagged message through `parseUnsubscribeCandidate` | Satisfies validation experiment 3's "explain what did and did not leave the machine" with data the user sees before approving |
| C9 | Bug A fix | `runAITriagePlan` merges: `setAgentPlan(prev => reviewPlan.items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev))` and unions auto-selected ids into the existing selection instead of resetting | Additive queue semantics everywhere; `mergeAgentPlanItem` already dedups by item id |
| C10 | Bug B fix | Delete `AITriagePlanCard.tsx`; remove the dead-card-only legacy surface from `useAIState.ts` (`selectedTriageThreadIds`, `triageActionPreview`, `triageQueueReadiness`, `toggleTriagePlanItemSelection`, `selectAllApplicableTriagePlanItems`, `clearTriagePlanSelection`, `applyTriagePlanItem`, `applySelectedTriagePlanItems`) and their `AppStoreContextType` entries. KEEP `triagePlan`/`setTriagePlan` (still written by `runAITriagePlan` :756-757 and read by the `AICopilotPanel.tsx:190-193` scroll effect). Remove `MailTriageActionPreview`/`MailTriageQueueReadiness` from `shared/types.ts` only if a grep shows no remaining consumers (tests included) | Removes ~350 lines of dead surface without touching the live triage planner |
| C11 | Out of scope (YAGNI) | Tracker-strip bulk action, block sender, create-rule action, keep-newest, sender trust history, "what leaves my machine" settings panel, whole-account (non-cached) stats, message `sizeEstimate` column | First slice per the doc; each is a natural follow-up |

## Design

### 1. Data layer

**`SenderCleanupStat`** (new interface in `shared/types.ts`):

```ts
export interface SenderCleanupStat {
  accountId: AccountID;
  senderEmail: string;          // lower-cased grouping key
  senderName: string;           // MAX(sender_name) representative
  threadCount: number;
  messageCount: number;
  unreadCount: number;
  lastReceivedAt: string;       // ISO
  recent30dCount: number;
  hasUnsubscribeHeader: boolean;
  trackerCount: number;         // SUM over message_security (analyzed msgs only)
  maxRiskLevel: 'low' | 'medium' | 'high' | null; // null = never analyzed
  attachmentBytes: number;      // SUM of attachments_json sizeBytes
}
```

**`MessagesRepo.senderCleanupStats(accountId: string): SenderCleanupStat[]`** — the verified
CTE shape (sender_stats GROUP BY lower(sender_email); att_bytes via `json_each` pre-aggregated
JOIN — the correlated-subquery form measured 36 s vs 0.6 s and is forbidden; message_security
LEFT JOIN for tracker sums/risk; `strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')` for the 30-day
cutoff since `received_at` is ISO-8601). Ordered by `recent30dCount DESC, messageCount DESC`,
`LIMIT 200`.

**Database worker:** add `{ type: 'senderCleanupStats'; accountId: string }` to the
`WorkerPayload` unions in `main/databaseWorker.ts` + `main/databaseWorkerClient.ts`; client
method `senderCleanupStats(accountId): Promise<SenderCleanupStat[]>`.

**IPC:** `api:listCleanupSenderStats` (`main/index.ts`) → `databaseWorkerClient.senderCleanupStats`
→ preload `listCleanupSenderStats(accountId)` → `vite-env.d.ts` typing. Unified account view:
the renderer calls per account and concatenates (same pattern as search).

### 2. Suggestion + plan building (`shared/cleanup.ts`, new; pure)

```ts
export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none';
export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction; // C5 rules, in that precedence order
export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25;
```

`shared/agentPlan.ts` additions:

- `AgentPlanSource` += `'cleanup'`; `AgentPlanActionKind` += `'unsubscribe'` (in `shared/types.ts`).
- `buildCleanupArchiveItem({ stat, thread }): AgentPlanItem` — action `'archive'`, risk `low`,
  `selectionPolicy: 'autoSelected'`, citation evidence "Read thread from <sender>, last activity
  <date>; part of Cleanup archive-old batch".
- `buildCleanupUnsubscribeItem({ stat, candidate }): AgentPlanItem` — action `'unsubscribe'`,
  risk `high`, `selectionPolicy: 'manualOnly'`, `citation.evidence` = human-readable method
  summary from the `UnsubscribeCandidate` (C8); `threadId`/`payload.sourceMessageId` from the
  candidate.

### 3. Renderer

- **Store:** `cleanupOpen: boolean` + `setCleanupOpen` in `AppStore` (beside `settingsOpen`).
  Every nav path that calls `setSettingsOpen(false)` also closes cleanup
  (`LeftRail.tsx:16,39; App.tsx:807-809,848; useKeyboard.ts:118,133,141,157,166`).
- **LeftRail:** `Eraser` icon button "Cleanup" following the Settings button pattern
  (`LeftRail.tsx:82-88`); opens the pane, closes settings.
- **`CleanupPanel.tsx`** (new, `renderer/src/components/`): mounted in the `App.tsx:911-914`
  ternary (`settingsOpen ? Settings : cleanupOpen ? Cleanup : mail`). Contents:
  - Header with the C8 privacy line and account context (active account, or per-account
    sections in unified view).
  - Loads stats via `listCleanupSenderStats` on open (loading/error/empty states; refresh button).
  - Sender rows: name/email, volume (`messageCount`, `recent30dCount`/30d, unread), last
    activity, tracker badge (count + "among analyzed"), risk badge (`maxRiskLevel`),
    unsubscribe-capable badge, suggested-action chip.
  - Row actions: **Archive old (N)** — fetches that sender's read threads older than 30 days
    from the already-loaded `store.threads` (no new IPC; threads carry `senderEmail`,
    `isUnread`, `lastMessageAt`), caps at 25 oldest, builds archive items, merges each via the
    additive queue path, opens the AI panel; toast "N actions added to review queue".
    **Unsubscribe** — resolves the candidate lazily: `listMessagesForThread` on the sender's
    newest flagged thread → `parseUnsubscribeCandidate` → if null, toast "No usable unsubscribe
    method"; else build + merge the item, open the panel. Both buttons only add `proposed`
    items — the review queue is the dry-run gate.
- **`AgentReviewQueueCard.tsx`:** add `unsubscribe` entries to `ACTION_LABEL` ('Unsubscribe'),
  `ACTION_ICON` (`MailMinus`), `actionDescription` ("Send the sender's unsubscribe request").
- **`useAIState.ts`:** `applyAgentPlanItem` gains the `unsubscribe` branch —
  `executeMailAction('unsubscribeSender', threadId, null, async (actionId) =>
  window.electronAPI.unsubscribeThread(item.accountId, item.threadId, actionId),
  payloadForAgentPlanItem(item))` (the handler already writes its own action-log row when given
  `actionId`; verify the customAction contract in `useMailState.ts:675-911` and reuse it the
  way existing custom actions do). `agentPlanActionPreview` treats `unsubscribe` as `gmail`
  scope (requires valid credentials).
- **Bug A fix (C9)** in `runAITriagePlan`; **Bug B removal (C10)**.

### 4. Error handling

- Stats query failure → in-panel error state with retry (no toast spam).
- Worker unavailable → same error state; the panel never blocks the mail UI.
- Unsubscribe candidate resolution failures → per-row toast, row stays actionable for archive.
- All executed actions flow through the existing optimistic `executeMailAction` + reconciler
  offline semantics (archive = `markDone`, replayable + rollback; unsubscribe = `unsubscribeSender`,
  existing handler owns its ledger row).

### 5. Testing

- `tests/cleanup.test.ts` (new): `suggestCleanupAction` rule matrix + boundary values;
  `buildCleanupArchiveItem`/`buildCleanupUnsubscribeItem` shapes (risk, policy, evidence text,
  ids stable/dedupable).
- `tests/agentPlan.test.ts`: extend for source `'cleanup'` and merge behavior.
- `tests/senderCleanupStats.test.ts` (new): repo query against a real in-memory/temp
  better-sqlite3 DB seeded with fixture rows (pattern: `tests/embeddingVectorStore.test.ts`
  `canLoadNativeSqlite` guard) — verifies grouping, 30d window, unsubscribe LIKE flag,
  tracker join, attachment byte sums, ordering, LIMIT.
- `tests/aiTriage.test.ts` or new case: Bug A regression — plan run merges instead of
  replacing (briefing item survives `runAITriagePlan`). (Test at the pure level:
  `mergeAgentPlanItem` fold over an existing plan.)
- Existing suites stay green after Bug B removal (grep-verify no test imports the removed
  surface; update any that do).

## Validation

`npm run build` green; new + full `npm test` green. No linter exists. Manual visual smoke of
the panel deferred to the user (same as the search branch).

## File touch list

Create: `shared/cleanup.ts`, `renderer/src/components/CleanupPanel.tsx`,
`tests/cleanup.test.ts`, `tests/senderCleanupStats.test.ts`.
Modify: `shared/types.ts`, `shared/agentPlan.ts`, `main/repositories.ts`,
`main/databaseWorker.ts`, `main/databaseWorkerClient.ts`, `main/index.ts`, `main/preload.ts`,
`renderer/src/vite-env.d.ts`, `renderer/src/stores/AppStore.tsx`,
`renderer/src/stores/useAIState.ts`, `renderer/src/components/layout/LeftRail.tsx`,
`renderer/src/App.tsx`, `renderer/src/components/AgentReviewQueueCard.tsx`,
`renderer/src/hooks/useKeyboard.ts`, `tests/agentPlan.test.ts`.
Delete: `renderer/src/components/AITriagePlanCard.tsx`.
