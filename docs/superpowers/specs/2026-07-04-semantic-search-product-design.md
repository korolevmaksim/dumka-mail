# Semantic Search → Product: Hybrid Ranking, Honest Statuses, Full Coverage

Date: 2026-07-04
Status: Approved (decisions confirmed interactively; remaining defaults delegated to recommended options)

## Problem

The last six commits (`917f0f4` … `0ad48ec`) built solid semantic-search plumbing — per-account
embeddings, a worker-thread cosine scan with supersession, reindex UI — but the product layer
discards most of that work:

1. **Scores are thrown away.** `collectSemanticMatchesWithTimeout`
   (`renderer/src/stores/mailSearchHelpers.ts:52-55`) maps `SemanticSearchResult` down to bare
   `{threadId, messageId}`; `filterVisibleThreadsCooperatively` uses matches only as a membership
   `Set`. Final order is the `threads` array order (`ORDER BY last_message_at DESC`). A highly
   relevant hit from months ago lands at the bottom; semantic hits are indistinguishable from
   exact ones. FTS results are unranked too: `SearchRepo.search`
   (`main/repositories.ts:940-944`) has no `ORDER BY rank`.
2. **All failures are silent.** Provider errors are swallowed by `.catch(() => [])`; a fixed
   1200 ms `Promise.race` discards results that arrive late (a remote embedding roundtrip alone is
   often 300–900 ms); the worker scan silently stops at 12 000 newest embeddings
   (`EMBEDDING_SEARCH_SCAN_LIMIT`, `main/semanticSearchScan.ts:5`) and on deadline returns partial
   results with `aborted: false`. `MailSearchStatus` is only `idle | searching | complete` — a
   down endpoint or misconfigured key is invisible.
3. **Coverage is capped.** The reindex pipeline embeds up to 100 000 messages
   (`EMBEDDING_FULL_INDEX_LIMIT`, `main/agentic.ts:82`) but search scans only the newest 12 000 —
   old mail is paid for (API cost) yet unsearchable.
4. **Per-account settings key bug.** `EmbeddingSettingsPanel.tsx:113,277` writes
   `embeddingsByAccount` / `semanticSearchEnabledByAccount` keyed by the raw account email, while
   `readAgentSettings` (`main/agentic.ts:100`) looks up `accountId.trim().toLowerCase()` — a
   mixed-case account email silently falls back to global settings.

## Decisions (confirmed with user)

| Decision | Choice |
| --- | --- |
| Result presentation | Two sections: **Top results** (relevance) above **All matches** (date-sorted) |
| Scope | Ranking + honest statuses + bug fixes only. Answer-with-sources and saved searches are a separate follow-up task |
| Slow semantic results | **Apply when ready** — no race/timeout discard; existing cancellation/supersession handles staleness |
| Scan coverage | **Full-index scan** with a larger worker budget; report honest coverage when the deadline truncates |
| Fusion location | **Renderer-side** fusion; pure ranking functions live in `shared/` |

## Design

### 1. Ranking (`shared/searchRanking.ts`, new)

Pure, dependency-free module (testable directly by vitest):

- **Inputs:** per-account FTS match lists (array position = bm25 rank after the `SearchRepo`
  change) and per-account semantic match lists (cosine-score-ordered, scores preserved).
- **Fusion:** Reciprocal Rank Fusion with `k = 60`. Every per-account per-source list is an
  independent ranked list; a thread's fused score is `Σ 1/(k + rank_i)` over lists it appears in
  (best message rank per list). RRF handles multi-account naturally — no cross-account score
  calibration needed.
- **Sections:** `TOP_RESULTS_MAX = 5`. Top section = top threads by fused score, **deduplicated**:
  threads shown in Top results are omitted from All matches so `visibleThreads` stays a unique
  flat array (the focus/keyboard model relies on unique thread ids). Sections are built whenever a
  text query is active and total matches exceed `TOP_RESULTS_MAX`; otherwise the list stays flat.
- **Outputs:** ordered thread ids + `topCount` boundary + the set of semantic-only thread ids
  (for the ⚡ badge).
- Ordering is applied *after* `filterVisibleThreadsCooperatively` (which stays membership-based):
  a pure `orderSearchResults(filteredThreads, fusion)` reorders the filtered array — top section by
  fused score, remainder by date.

### 2. IPC contract change: `searchSemantic` returns an outcome

`shared/types.ts`:

```ts
export interface SemanticSearchCoverage {
  scanned: number;      // embeddings compared this scan
  totalIndexed: number; // embeddings available for (account, model)
}

export type SemanticSearchStatus = 'ok' | 'disabled' | 'superseded' | 'error';

export interface SemanticSearchOutcome {
  status: SemanticSearchStatus;
  results: SemanticSearchResult[];   // scores preserved
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;             // provider/network message when status === 'error'
}
```

- `main/agentic.ts` `searchSemanticInternal` returns the outcome instead of a bare array and
  classifies failures (embedding-provider errors are caught and returned as `status: 'error'`,
  not thrown or swallowed). The daily-briefing call site keeps consuming `.results`.
- `main/index.ts` + `main/preload.ts` + renderer `electronAPI` typing updated in lockstep
  (the three-file IPC spine per AGENTS.md).

### 3. Scan: full coverage + honest truncation (`main/semanticSearchScan.ts`)

- Default `scanLimit` cap removed (parameter kept for tests); the loop is bounded by the actual
  row count.
- `EMBEDDING_SEARCH_TIME_BUDGET_MS` 1200 → 10 000. The scan runs on a worker thread and is
  superseded by newer requests, so a long budget does not block anything.
- Outcome gains `coverage: { scanned, totalIndexed }`; `totalIndexed` comes from a `COUNT(*)`
  repo method for `(account, model)`. Deadline truncation is no longer silent: partial results
  return with `scanned < totalIndexed` (the `aborted` flag remains supersession-only).
- `main/semanticSearchWorker.ts` / `semanticSearchWorkerClient.ts` pass coverage through.

### 4. Renderer flow (`useMailState.ts`, `mailSearchHelpers.ts`)

Two-phase, apply-when-ready:

1. **Phase 1 (instant):** FTS matches → fuse (bm25-only) → filter → order → publish
   `visibleThreads` + `topCount`. Status: `phase: 'complete'`, `semantic: 'pending'` (when a
   semantic pass is due).
2. **Phase 2 (whenever ready):** after the existing 450 ms settle delay, semantic outcomes
   arrive → re-fuse both sources → publish once more. No `Promise.race`, no discard — the only
   staleness guards are the existing effect-cleanup `cancelled` flag and main-side supersession.
   Late results update the Top results section in one repaint.

`collectSemanticMatchesWithTimeout` is replaced by `collectSemanticOutcomes` — per-account
outcomes, errors captured per account (not swallowed), scores preserved.

### 5. Status model (`mailSearchStatus.ts`, `searchIndicator.ts`, `SearchCockpitBar.tsx`)

```ts
export type SemanticUiState = 'off' | 'pending' | 'applied' | 'error';

export interface MailSearchState {
  phase: 'idle' | 'searching' | 'complete';
  semantic: SemanticUiState;
  coverage: SemanticSearchCoverage | null; // aggregated across accounts
  errorMessage?: string;
}
```

Indicator mapping (labels below are the spec, not placeholders):

| State | Label |
| --- | --- |
| searching | `Searching` |
| complete + semantic off | `Done` |
| complete + semantic pending | `Done · AI…` |
| complete + applied, full coverage | `Done · AI ✓` |
| complete + applied, truncated | `Done · AI searched 12k of 45k` |
| complete + error | `Done · AI unavailable` (tooltip: errorMessage) |

Multi-account aggregation: worst state wins (`error` > `pending` > `applied` > `off`); coverage
sums scanned/totalIndexed across accounts.

### 6. Thread list UI (`App.tsx`)

- The virtualized list renders row descriptors: `{kind: 'header', id} | {kind: 'thread', thread}`.
  Headers get the same fixed row height, so existing virtualization math (fixed `threadRowHeight`,
  `itemCount`, scroll offsets) keeps working with `rowCount = threads + headers`.
- Keyboard navigation (j/k, focus) iterates thread rows only; `visibleThreads` remains the flat
  unique-thread array so `focusedThreadId` logic is unchanged.
- Semantic-only hits render a compact ⚡ badge (tooltip: "AI match", score shown in the Top
  results section only).

### 7. Bug fixes folded in

- **Per-account key normalization:** `EmbeddingSettingsPanel.tsx` normalizes
  (`trim().toLowerCase()`) keys on write; `readAgentSettings` (`main/agentic.ts:100`) also
  normalizes stored map keys on read so existing mixed-case entries keep working.
- **`DEBUG_REPLY_RENDER` console spam** removed from the packaged app (separate trivial commit).

Out of scope (follow-ups): answer-with-sources view, saved semantic searches, `sqlite-vec` ANN
index (revisit if full-scan latency on 100k-message mailboxes proves too slow), the
`window.electronAPI`-undefined AppStore crash (unrelated to search).

## Error handling summary

| Failure | Before | After |
| --- | --- | --- |
| Embedding provider error | Silent `[]` | `status: 'error'` → indicator `AI unavailable` + tooltip |
| Slow provider (> 1.2 s) | Results discarded | Applied when ready |
| Scan deadline hit | Silent partial | Partial applied + `searched N of M` |
| Semantic disabled / short query | Silent `[]` | `semantic: 'off'`, plain `Done` |
| Superseded request | Silent `[]` (correct) | `status: 'superseded'`, renderer ignores (correct) |
| FTS error | Logged, empty results | Unchanged (FTS failures remain rare/local) |

## Testing

- `tests/searchRanking.test.ts` (new): RRF math, multi-account fusion, dedupe between sections,
  `topCount` boundary rules, semantic-only set, ordering of filtered results.
- `tests/mailSearchHelpers.test.ts`: outcome aggregation, per-account error capture, no-race
  behavior.
- `tests/semanticSearchScan.test.ts`: coverage reporting, uncapped scan, deadline → truncated
  coverage with results.
- `tests/perAccountSettings.test.ts`: mixed-case account keys (read + write normalization).
- `tests/searchIndicator.test.ts` (or extend existing): label mapping for all states.
- Agentic outcome statuses (`disabled` / `superseded` / `error`) in the existing agentic tests.
- Validation: `npm run build` (tsc is the only type gate; no linter exists in this repo) and
  `npm test` green before completion.

## File touch list

`shared/types.ts`, `shared/searchRanking.ts` (new), `main/repositories.ts`,
`main/semanticSearchScan.ts`, `main/semanticSearchWorker.ts`, `main/semanticSearchWorkerClient.ts`,
`main/agentic.ts`, `main/index.ts`, `main/preload.ts`, renderer `electronAPI` typing,
`renderer/src/stores/mailSearchHelpers.ts`, `mailSearchStatus.ts`, `useMailState.ts`,
`mailThreadFilter.ts` (minor), `renderer/src/components/layout/searchIndicator.ts`,
`SearchCockpitBar.tsx`, `renderer/src/App.tsx`,
`renderer/src/components/settings/EmbeddingSettingsPanel.tsx`, plus tests.
