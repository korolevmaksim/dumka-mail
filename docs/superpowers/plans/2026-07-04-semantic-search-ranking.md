# Semantic Search Hybrid Ranking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hybrid FTS+semantic ranking with Top results/All matches sections, apply-when-ready semantic results, full-coverage scans with honest truncation/error reporting, and the per-account settings key fix.

**Architecture:** Pure RRF fusion lives in `shared/searchRanking.ts` and runs in the renderer after the existing cooperative membership filter. `api:searchSemantic` starts returning a `SemanticSearchOutcome` (status + scored results + coverage) instead of a bare array; the worker scan loses its 12k cap and reports coverage. `useMailState` publishes ordered threads plus a `topCount` section boundary; `App.tsx` renders header rows inside the existing fixed-row-height virtualization.

**Tech Stack:** TypeScript strict, React 19, Electron IPC, better-sqlite3 FTS5, vitest.

**Spec:** `docs/superpowers/specs/2026-07-04-semantic-search-product-design.md`

## Global Constraints

- No linter exists; `npm run build` (tsc noEmit) is the only type gate. Run it before claiming a task compiles.
- Tests: `npx vitest run tests/<file>.test.ts` per task; full `npm test` in the final task.
- `shared/` must stay free of Electron/Node/React imports.
- IPC spine: any channel change touches `main/preload.ts`, `main/index.ts`, and the renderer typing `renderer/src/vite-env.d.ts` together.
- Constants (copy verbatim): `RRF_K = 60`, `TOP_RESULTS_MAX = 5`, `EMBEDDING_SEARCH_TIME_BUDGET_MS = 10000`, score threshold stays `0.14`, settle delay stays `450`.
- Indicator labels (copy verbatim): `Searching`, `Done`, `Done · AI…`, `Done · AI ✓`, `Done · AI searched {N} of {M}` (compact counts, e.g. `12k`), `Done · AI unavailable`.
- Commit after each task; commit messages in English; NO Co-Authored-By or AI-attribution trailers (user rule).

---

### Task 1: RRF fusion core (`shared/searchRanking.ts`)

**Files:**
- Create: `shared/searchRanking.ts`
- Test: `tests/searchRanking.test.ts`

**Interfaces:**
- Consumes: nothing (pure module).
- Produces (used by Tasks 5, 6):
  - `RankedMatchEntry { threadId: string; messageId: string; score?: number }`
  - `RankedSourceList { accountId: string; source: 'fts' | 'semantic'; entries: RankedMatchEntry[] }` (array position = rank)
  - `SearchFusion { scoreByThreadId: Map<string, number>; semanticOnlyThreadIds: Set<string> }`
  - `fuseSearchMatches(lists: RankedSourceList[], k?: number): SearchFusion`
  - `orderSearchResults<T extends { id: string }>(filteredThreads: T[], fusion: SearchFusion, topMax?: number): { threads: T[]; topCount: number; semanticOnlyThreadIds: Set<string> }`

- [ ] **Step 1: Write the failing test**

```ts
// tests/searchRanking.test.ts
import { describe, expect, it } from 'vitest';
import {
  fuseSearchMatches,
  orderSearchResults,
  RRF_K,
  TOP_RESULTS_MAX,
  type RankedSourceList,
} from '../shared/searchRanking';

function list(
  accountId: string,
  source: 'fts' | 'semantic',
  threadIds: string[],
): RankedSourceList {
  return {
    accountId,
    source,
    entries: threadIds.map((threadId, index) => ({
      threadId,
      messageId: `${threadId}-m${index}`,
      score: source === 'semantic' ? 1 - index * 0.1 : undefined,
    })),
  };
}

function threads(ids: string[]): { id: string }[] {
  return ids.map(id => ({ id }));
}

describe('fuseSearchMatches', () => {
  it('scores a thread appearing in both lists higher than single-list threads at the same rank', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1', 't2']),
      list('a@x.com', 'semantic', ['t1', 't3']),
    ]);
    const s = fusion.scoreByThreadId;
    expect(s.get('t1')).toBeCloseTo(2 / (RRF_K + 1), 10);
    expect(s.get('t2')).toBeCloseTo(1 / (RRF_K + 2), 10);
    expect(s.get('t3')).toBeCloseTo(1 / (RRF_K + 2), 10);
    expect(s.get('t1')! > s.get('t2')!).toBe(true);
  });

  it('uses the best rank when a thread has several messages in one list', () => {
    const fusion = fuseSearchMatches([
      {
        accountId: 'a@x.com',
        source: 'fts',
        entries: [
          { threadId: 't1', messageId: 'm1' },
          { threadId: 't2', messageId: 'm2' },
          { threadId: 't1', messageId: 'm3' }, // duplicate thread, worse rank
        ],
      },
    ]);
    expect(fusion.scoreByThreadId.get('t1')).toBeCloseTo(1 / (RRF_K + 1), 10);
  });

  it('treats each account list as an independent ranked list', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1']),
      list('b@y.com', 'fts', ['t1']),
    ]);
    expect(fusion.scoreByThreadId.get('t1')).toBeCloseTo(2 / (RRF_K + 1), 10);
  });

  it('tracks semantic-only thread ids', () => {
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t1', 't2']),
      list('a@x.com', 'semantic', ['t2', 't3']),
    ]);
    expect(fusion.semanticOnlyThreadIds).toEqual(new Set(['t3']));
  });
});

describe('orderSearchResults', () => {
  it('returns a flat list (topCount 0) when matches do not exceed topMax', () => {
    const fusion = fuseSearchMatches([list('a@x.com', 'fts', ['t1', 't2'])]);
    const input = threads(['t2', 't1']); // date order
    const result = orderSearchResults(input, fusion);
    expect(result.topCount).toBe(0);
    expect(result.threads.map(t => t.id)).toEqual(['t2', 't1']);
  });

  it('puts the topMax best-fused threads first and keeps the rest date-ordered without duplicates', () => {
    // t6 best (both sources), then fts ranks t1..t5.
    const fusion = fuseSearchMatches([
      list('a@x.com', 'fts', ['t6', 't1', 't2', 't3', 't4', 't5']),
      list('a@x.com', 'semantic', ['t6']),
    ]);
    // Date order deliberately different from relevance order.
    const input = threads(['t5', 't4', 't3', 't2', 't1', 't6', 't7']);
    const result = orderSearchResults(input, fusion);
    expect(result.topCount).toBe(TOP_RESULTS_MAX);
    // Top: fused-score order.
    expect(result.threads.slice(0, 5).map(t => t.id)).toEqual(['t6', 't1', 't2', 't3', 't4']);
    // Rest: original (date) order, minus the promoted ones, no duplicates.
    expect(result.threads.slice(5).map(t => t.id)).toEqual(['t5', 't7']);
    expect(new Set(result.threads.map(t => t.id)).size).toBe(result.threads.length);
  });

  it('threads missing from the fusion map sort after scored ones within the top selection', () => {
    const fusion = fuseSearchMatches([list('a@x.com', 'fts', ['t1'])]);
    const input = threads(['t1', 't2']);
    const result = orderSearchResults(input, fusion, 1);
    expect(result.topCount).toBe(1);
    expect(result.threads.map(t => t.id)).toEqual(['t1', 't2']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/searchRanking.test.ts`
Expected: FAIL — cannot resolve `../shared/searchRanking`.

- [ ] **Step 3: Write the implementation**

```ts
// shared/searchRanking.ts
// Reciprocal Rank Fusion over per-account, per-source ranked match lists.
// Pure and dependency-free: runs in the renderer, tested directly.

export const RRF_K = 60;
export const TOP_RESULTS_MAX = 5;

export interface RankedMatchEntry {
  threadId: string;
  messageId: string;
  score?: number;
}

export interface RankedSourceList {
  accountId: string;
  source: 'fts' | 'semantic';
  entries: RankedMatchEntry[];
}

export interface SearchFusion {
  scoreByThreadId: Map<string, number>;
  semanticOnlyThreadIds: Set<string>;
}

export function fuseSearchMatches(lists: RankedSourceList[], k = RRF_K): SearchFusion {
  const scoreByThreadId = new Map<string, number>();
  const ftsThreadIds = new Set<string>();
  const semanticThreadIds = new Set<string>();

  for (const list of lists) {
    const bestRankByThread = new Map<string, number>();
    list.entries.forEach((entry, index) => {
      if (!bestRankByThread.has(entry.threadId)) {
        bestRankByThread.set(entry.threadId, index);
      }
      (list.source === 'fts' ? ftsThreadIds : semanticThreadIds).add(entry.threadId);
    });

    for (const [threadId, rank] of bestRankByThread) {
      const contribution = 1 / (k + rank + 1);
      scoreByThreadId.set(threadId, (scoreByThreadId.get(threadId) || 0) + contribution);
    }
  }

  const semanticOnlyThreadIds = new Set(
    [...semanticThreadIds].filter(threadId => !ftsThreadIds.has(threadId))
  );

  return { scoreByThreadId, semanticOnlyThreadIds };
}

export interface OrderedSearchResults<T extends { id: string }> {
  threads: T[];
  topCount: number;
  semanticOnlyThreadIds: Set<string>;
}

// filteredThreads arrive membership-filtered and date-ordered; the top section is
// pulled out by fused score, the remainder keeps its incoming (date) order.
export function orderSearchResults<T extends { id: string }>(
  filteredThreads: T[],
  fusion: SearchFusion,
  topMax = TOP_RESULTS_MAX,
): OrderedSearchResults<T> {
  if (filteredThreads.length <= topMax) {
    return { threads: filteredThreads, topCount: 0, semanticOnlyThreadIds: fusion.semanticOnlyThreadIds };
  }

  const byScore = [...filteredThreads].sort((a, b) => {
    const scoreA = fusion.scoreByThreadId.get(a.id) ?? -1;
    const scoreB = fusion.scoreByThreadId.get(b.id) ?? -1;
    return scoreB - scoreA;
  });
  const top = byScore.slice(0, topMax);
  const topIds = new Set(top.map(thread => thread.id));
  const rest = filteredThreads.filter(thread => !topIds.has(thread.id));

  return {
    threads: [...top, ...rest],
    topCount: top.length,
    semanticOnlyThreadIds: fusion.semanticOnlyThreadIds,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/searchRanking.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add shared/searchRanking.ts tests/searchRanking.test.ts
git commit -m "feat: add RRF search fusion and section ordering"
```

---

### Task 2: FTS bm25 ordering (`SearchRepo.search`)

**Files:**
- Modify: `main/repositories.ts:940-944`

**Interfaces:**
- Produces: `SearchRepo.search` result array is now bm25-ordered — array position is the FTS rank consumed by `fuseSearchMatches` (Task 1) via Task 6.

No dedicated DB test: there is no existing FTS repo test harness, and standing one up is out of scope; rank consumption is covered by Task 1's fusion tests and the change is a one-line SQL ordering clause verified by typecheck + existing suite.

- [ ] **Step 1: Apply the change**

In `main/repositories.ts`, `SearchRepo.search`, change the SQL (FTS5 `rank` is bm25; lower = better):

```ts
    const rows = db.prepare(`
      SELECT thread_id, message_id FROM mail_search
      WHERE account_id = ? AND mail_search MATCH ?
      ORDER BY rank
      LIMIT 100
    `).all(accountId, ftsQuery) as any[];
```

- [ ] **Step 2: Verify**

Run: `npm run build` — Expected: succeeds.
Run: `npx vitest run tests/search.test.ts` — Expected: PASS (parser untouched).

- [ ] **Step 3: Commit**

```bash
git add main/repositories.ts
git commit -m "feat: order FTS search results by bm25 rank"
```

---

### Task 3: Uncapped scan with coverage (`main/semanticSearchScan.ts`)

**Files:**
- Modify: `main/semanticSearchScan.ts`
- Test: `tests/semanticSearchScan.test.ts` (extend; existing tests keep passing)

**Interfaces:**
- Produces (used by Task 4): `SemanticScanOutcome { results: SemanticSearchResult[]; aborted: boolean; scanned: number }` — `scanned` counts rows compared before threshold filtering. `EMBEDDING_SEARCH_TIME_BUDGET_MS` becomes `10000`. `EMBEDDING_SEARCH_SCAN_LIMIT` is deleted; `scanLimit` option default becomes `Number.POSITIVE_INFINITY`.

- [ ] **Step 1: Write the failing tests** (append to `tests/semanticSearchScan.test.ts`)

```ts
  it('reports how many rows were scanned', async () => {
    const fetchPage = pagedProvider([
      rowWithScore(1, 0.5),
      rowWithScore(2, 0.9),
      rowWithScore(3, 0.05),
    ]);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 10, fetchPage });

    expect(outcome.scanned).toBe(3);
  });

  it('scans past 12000 rows when no scanLimit is given', async () => {
    const rows = Array.from({ length: 12500 }, (_, i) => rowWithScore(i, 0.5));
    const fetchPage = pagedProvider(rows);

    const outcome = await runSemanticScan({ queryVector: QUERY, limit: 5, fetchPage });

    expect(outcome.scanned).toBe(12500);
    expect(outcome.aborted).toBe(false);
  });

  it('returns partial results with a scanned count when the deadline is hit', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => rowWithScore(i, 0.5));
    const fetchPage = pagedProvider(rows);
    let calls = 0;
    const now = vi.fn(() => {
      calls += 1;
      // First call sets the deadline; second (page-loop check) is already past it.
      return calls === 1 ? 0 : 999999;
    });

    const outcome = await runSemanticScan({
      queryVector: QUERY,
      limit: 5,
      fetchPage,
      now,
      pageSize: 100,
    });

    expect(outcome.aborted).toBe(false);
    expect(outcome.scanned).toBe(0); // deadline before the first page
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/semanticSearchScan.test.ts`
Expected: FAIL — `scanned` is undefined.

- [ ] **Step 3: Implement**

In `main/semanticSearchScan.ts`:

```ts
export const EMBEDDING_SEARCH_PAGE_SIZE = 500;
export const EMBEDDING_SEARCH_TIME_BUDGET_MS = 10000;
export const EMBEDDING_SEARCH_SCORE_THRESHOLD = 0.14;
```

(delete `EMBEDDING_SEARCH_SCAN_LIMIT`), and:

```ts
export interface SemanticScanOutcome {
  results: SemanticSearchResult[];
  aborted: boolean;
  scanned: number;
}
```

In `runSemanticScan`:
- `const scanLimit = options.scanLimit ?? Number.POSITIVE_INFINITY;`
- add `let scanned = 0;` before the loop; inside the row loop increment `scanned += 1;` per compared row (increment before the threshold check).
- `if (isStale()) return { results: [], aborted: true, scanned };` (both stale returns)
- final `return { results, aborted: false, scanned };`

Note: `fetchPage(Math.min(pageSize, scanLimit - offset), offset)` — with `Infinity` the `Math.min` yields `pageSize`; no other loop change needed.

- [ ] **Step 4: Run tests**

Run: `npx vitest run tests/semanticSearchScan.test.ts`
Expected: PASS. If existing tests referenced `EMBEDDING_SEARCH_SCAN_LIMIT`, update them to pass an explicit `scanLimit` option instead.

- [ ] **Step 5: Commit**

```bash
git add main/semanticSearchScan.ts tests/semanticSearchScan.test.ts
git commit -m "feat: uncap semantic scan and report scanned coverage"
```

---

### Task 4: Coverage through worker + count repo method

**Files:**
- Modify: `main/repositories.ts` (add `MailEmbeddingsRepo.countForAccount` next to `scanForAccountPage`, `main/repositories.ts:1208`)
- Modify: `main/semanticSearchWorker.ts:52-68`
- Modify: `main/semanticSearchWorkerClient.ts:18-21`

**Interfaces:**
- Consumes: `SemanticScanOutcome` with `scanned` (Task 3).
- Produces (used by Task 5): `SemanticSearchScanOutcome { results: SemanticSearchResult[]; aborted: boolean; scanned: number; totalIndexed: number }` from `semanticSearchWorkerClient.search(...)`; `MailEmbeddingsRepo.countForAccount(accountId: string, model: string): number`.

- [ ] **Step 1: Add the count method** (in `main/repositories.ts`, inside `MailEmbeddingsRepo`, after `scanForAccountPage`)

```ts
  countForAccount(accountId: string, model: string): number {
    const db = getDatabase();
    const row = db.prepare(`
      SELECT COUNT(*) AS count FROM mail_embeddings
      WHERE account_id = ? AND model = ?
    `).get(accountId, model) as { count: number };
    return row.count;
  },
```

- [ ] **Step 2: Return coverage from the worker** (`main/semanticSearchWorker.ts`)

Change `handleSemanticSearch` to also count total rows:

```ts
async function handleSemanticSearch(
  request: Extract<WorkerRequest, { type: 'semanticSearch' }>
): Promise<SemanticScanOutcome & { totalIndexed: number }> {
  const staleKey = supersedeKey(request);
  activeSearchCount += 1;
  try {
    const totalIndexed = MailEmbeddingsRepo.countForAccount(request.accountId, request.model);
    const outcome = await runSemanticScan({
      queryVector: Float32Array.from(request.queryVector),
      limit: request.limit,
      fetchPage: (limit, offset) => MailEmbeddingsRepo.scanForAccountPage(request.accountId, request.model, limit, offset),
      isStale: () => latestRequestIds.get(staleKey) !== request.requestId,
      yieldBetweenPages: yieldToEventLoop,
    });
    return { ...outcome, totalIndexed };
  } finally {
    activeSearchCount -= 1;
  }
}
```

- [ ] **Step 3: Extend the client outcome type** (`main/semanticSearchWorkerClient.ts`)

```ts
export interface SemanticSearchScanOutcome {
  results: SemanticSearchResult[];
  aborted: boolean;
  scanned: number;
  totalIndexed: number;
}
```

- [ ] **Step 4: Verify**

Run: `npm run build` — Expected: succeeds.
Run: `npx vitest run tests/semanticSearchScan.test.ts tests/embeddingVectorStore.test.ts` — Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add main/repositories.ts main/semanticSearchWorker.ts main/semanticSearchWorkerClient.ts
git commit -m "feat: report semantic scan coverage from worker"
```

---

### Task 5: `SemanticSearchOutcome` end to end (types, agentic, IPC typing, key fix)

**Files:**
- Modify: `shared/types.ts` (after `SemanticSearchResult`, `shared/types.ts:1024-1032`)
- Modify: `main/agentic.ts` (`searchSemanticInternal` `main/agentic.ts:637-670`, `readAgentSettings` `main/agentic.ts:99-107`, `AgenticService.searchSemantic` `main/agentic.ts:750-751`, briefing wrapper `main/agentic.ts:763-764`)
- Modify: `renderer/src/vite-env.d.ts:140`
- Test: `tests/perAccountSettings.test.ts` (extend), `tests/semanticSearchOutcome.test.ts` (new)

**Interfaces:**
- Consumes: `semanticSearchWorkerClient.search` returning `{results, aborted, scanned, totalIndexed}` (Task 4).
- Produces (used by Task 6):

```ts
export interface SemanticSearchCoverage { scanned: number; totalIndexed: number }
export type SemanticSearchOutcomeStatus = 'ok' | 'disabled' | 'superseded' | 'error';
export interface SemanticSearchOutcome {
  status: SemanticSearchOutcomeStatus;
  results: SemanticSearchResult[];
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}
```

`window.electronAPI.searchSemantic(accountId, query, limit?)` now resolves to `SemanticSearchOutcome`.

- [ ] **Step 1: Add the types** to `shared/types.ts` directly below `SemanticSearchResult` (exact block above).

- [ ] **Step 2: Write the failing agentic outcome test**

Create `tests/semanticSearchOutcome.test.ts`. Mirror the module-mock setup used at the top of `tests/perAccountSettings.test.ts` (it already mocks `SettingsRepo` and embedding runtime pieces for `main/agentic.ts`; reuse the same `vi.mock` targets and add a mock for `main/semanticSearchWorkerClient`):

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
// Copy the vi.mock(...) block from tests/perAccountSettings.test.ts verbatim,
// then add:
vi.mock('../main/semanticSearchWorkerClient', () => ({
  semanticSearchWorkerClient: { search: vi.fn() },
}));

import { SettingsRepo } from '../main/database';
import { semanticSearchWorkerClient } from '../main/semanticSearchWorkerClient';
import { AgenticService } from '../main/agentic';
// If tests/perAccountSettings.test.ts mocks createEmbeddings via a module mock,
// import the same mocked symbol here to control it.

const ENABLED_SETTINGS = JSON.stringify({
  ai: {
    semanticSearchEnabled: true,
    embeddings: { provider: 'openAI', model: 'text-embedding-3-small', baseURL: null, dimensions: null },
  },
});

describe('searchSemantic outcome', () => {
  beforeEach(() => vi.clearAllMocks());

  it('returns disabled when semantic search is off', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(JSON.stringify({ ai: { semanticSearchEnabled: false } }));
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome).toEqual({ status: 'disabled', results: [], coverage: null });
  });

  it('returns error with the provider message when embedding the query fails', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    // Make the mocked createEmbeddings reject:
    mockedCreateEmbeddings.mockRejectedValue(new Error('401 invalid key'));
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('error');
    expect(outcome.errorMessage).toContain('401 invalid key');
    expect(outcome.results).toEqual([]);
  });

  it('returns ok with results and coverage', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockResolvedValue({ model: 'text-embedding-3-small', embeddings: [[1, 0]] });
    vi.mocked(semanticSearchWorkerClient.search).mockResolvedValue({
      results: [{ threadId: 't1', messageId: 'm1', score: 0.9, subject: 's', sender: 'x', snippet: 'sn', receivedAt: '2026-07-01T00:00:00.000Z' }],
      aborted: false,
      scanned: 120,
      totalIndexed: 300,
    });
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('ok');
    expect(outcome.results).toHaveLength(1);
    expect(outcome.coverage).toEqual({ scanned: 120, totalIndexed: 300 });
  });

  it('returns superseded when the scan was aborted by a newer request', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(ENABLED_SETTINGS);
    mockedCreateEmbeddings.mockResolvedValue({ model: 'text-embedding-3-small', embeddings: [[1, 0]] });
    vi.mocked(semanticSearchWorkerClient.search).mockResolvedValue({ results: [], aborted: true, scanned: 10, totalIndexed: 300 });
    const outcome = await AgenticService.searchSemantic('a@x.com', 'contract');
    expect(outcome.status).toBe('superseded');
  });
});
```

(Adjust the `mockedCreateEmbeddings` handle to however `tests/perAccountSettings.test.ts` mocks the embedding runtime — same module path, same export name.)

- [ ] **Step 3: Add the mixed-case key test** (append to `tests/perAccountSettings.test.ts`, modeled on the existing `uses per-account override when specified` test at `tests/perAccountSettings.test.ts:81`)

```ts
  it('matches per-account overrides stored under mixed-case account keys', async () => {
    vi.mocked(SettingsRepo.get).mockReturnValue(JSON.stringify({
      ai: {
        semanticSearchEnabled: false,
        embeddings: { provider: 'openAI', model: 'text-embedding-3-small', baseURL: null, dimensions: null },
        embeddingsByAccount: {
          'Test@Example.com ': { provider: 'gemini', model: 'gemini-embedding-2', baseURL: null, dimensions: 768 },
        },
        semanticSearchEnabledByAccount: { 'Test@Example.com ': true },
      },
    }));
    // Assert via the same public entry the sibling tests use: settings resolved
    // for 'test@example.com' must pick the gemini override and enabled=true.
  });
```

Fill the assertion using the same public call pattern as the neighboring tests in that file (they exercise `readAgentSettings` through an exported service function — reuse it verbatim).

- [ ] **Step 4: Run tests to verify they fail**

Run: `npx vitest run tests/semanticSearchOutcome.test.ts tests/perAccountSettings.test.ts`
Expected: FAIL — outcome shape not returned yet; mixed-case lookup misses.

- [ ] **Step 5: Implement in `main/agentic.ts`**

`readAgentSettings` — replace the two per-account lookups with key-normalized reads:

```ts
    if (accountId) {
      const normId = accountId.trim().toLowerCase();
      const embeddingsByAccount = parsed?.ai?.embeddingsByAccount;
      if (embeddingsByAccount) {
        const key = Object.keys(embeddingsByAccount).find(k => k.trim().toLowerCase() === normId);
        if (key) embeddings = normalizeEmbeddingSettings(embeddingsByAccount[key]);
      }
      const enabledByAccount = parsed?.ai?.semanticSearchEnabledByAccount;
      if (enabledByAccount) {
        const key = Object.keys(enabledByAccount).find(k => k.trim().toLowerCase() === normId);
        if (key) semanticSearchEnabled = enabledByAccount[key] === true;
      }
    }
```

`searchSemanticInternal` — new signature and body (import `SemanticSearchOutcome` from `../shared/types`):

```ts
async function searchSemanticInternal(
  accountId: string,
  query: string,
  limit = 60,
  scope: SemanticSearchScope = 'interactive'
): Promise<SemanticSearchOutcome> {
  const trimmed = normalizeEmbeddingText(query, 1000);
  if (!trimmed) return { status: 'disabled', results: [], coverage: null };
  const settings = readAgentSettings(accountId);
  if (!settings.semanticSearchEnabled) return { status: 'disabled', results: [], coverage: null };

  const requestKey = `${scope}:${accountId}`;
  const requestId = (semanticSearchRequestIds.get(requestKey) || 0) + 1;
  semanticSearchRequestIds.set(requestKey, requestId);

  let queryEmbedding;
  try {
    queryEmbedding = await createEmbeddings([trimmed], {
      settings: settings.embeddings,
      purpose: 'query',
    });
  } catch (error) {
    return {
      status: 'error',
      results: [],
      coverage: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
  if (semanticSearchRequestIds.get(requestKey) !== requestId) {
    return { status: 'superseded', results: [], coverage: null };
  }

  try {
    const scan = await semanticSearchWorkerClient.search(
      accountId,
      queryEmbedding.model,
      queryEmbedding.embeddings[0],
      Math.max(1, Math.min(200, limit)),
      requestId,
      scope
    );
    if (scan.aborted) return { status: 'superseded', results: [], coverage: null };
    return {
      status: 'ok',
      results: scan.results,
      coverage: { scanned: scan.scanned, totalIndexed: scan.totalIndexed },
    };
  } catch (error) {
    return {
      status: 'error',
      results: [],
      coverage: null,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
```

`AgenticService.searchSemantic` return type becomes `Promise<SemanticSearchOutcome>` (body unchanged). The briefing wrapper at `main/agentic.ts:763` keeps its array contract:

```ts
      searchSemantic: (briefingAccountId, briefingQuery, briefingLimit) =>
        searchSemanticInternal(briefingAccountId, briefingQuery, briefingLimit, 'briefing')
          .then(outcome => outcome.results),
```

`renderer/src/vite-env.d.ts:140`:

```ts
  searchSemantic: (accountId: string, query: string, limit?: number) => Promise<SemanticSearchOutcome>;
```

(add `SemanticSearchOutcome` to that file's existing `shared/types` import). `main/index.ts:1289` and `main/preload.ts:130` are pass-through and need no code change.

- [ ] **Step 6: Run tests + build**

Run: `npx vitest run tests/semanticSearchOutcome.test.ts tests/perAccountSettings.test.ts tests/dailyBriefing.test.ts && npm run build`
Expected: PASS + build succeeds (briefing consumes `.results`).

- [ ] **Step 7: Commit**

```bash
git add shared/types.ts main/agentic.ts renderer/src/vite-env.d.ts tests/semanticSearchOutcome.test.ts tests/perAccountSettings.test.ts
git commit -m "feat: return semantic search outcome with coverage and errors"
```

---

### Task 6: Renderer search state + collection helpers

**Files:**
- Modify: `renderer/src/stores/mailSearchStatus.ts`
- Modify: `renderer/src/stores/mailSearchHelpers.ts`
- Test: `tests/mailSearchHelpers.test.ts` (rewrite affected cases)

**Interfaces:**
- Consumes: `SemanticSearchOutcome` (Task 5), `RankedSourceList` (Task 1).
- Produces (used by Tasks 7, 8):

```ts
// mailSearchStatus.ts
export type MailSearchPhase = 'idle' | 'searching' | 'complete';
export type SemanticUiState = 'off' | 'pending' | 'applied' | 'error';
export interface MailSearchState {
  phase: MailSearchPhase;
  semantic: SemanticUiState;
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}
export const IDLE_SEARCH_STATE: MailSearchState;

// mailSearchHelpers.ts
export function collectFtsMatchLists(accountIds, textQuery, searchFTS): Promise<RankedSourceList[]>;
export interface SemanticCollectResult {
  lists: RankedSourceList[];
  state: 'ok' | 'off' | 'error';
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}
export function collectSemanticOutcomes(accountIds, textQuery, searchSemantic): Promise<SemanticCollectResult>;
export function flattenMatchLists(lists: RankedSourceList[]): ThreadSearchMatch[];
```

- [ ] **Step 1: Replace `mailSearchStatus.ts`**

```ts
import type { SemanticSearchCoverage } from '../../../shared/types';

export type MailSearchPhase = 'idle' | 'searching' | 'complete';
export type SemanticUiState = 'off' | 'pending' | 'applied' | 'error';

export interface MailSearchState {
  phase: MailSearchPhase;
  semantic: SemanticUiState;
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}

export const IDLE_SEARCH_STATE: MailSearchState = { phase: 'idle', semantic: 'off', coverage: null };
```

Keep a compatibility alias out — update all importers instead (`useMailState.ts`, `AppStore.tsx:371`, `SearchCockpitBar.tsx`, `searchIndicator.ts`; Task 7/8 handle them).

- [ ] **Step 2: Write the failing helper tests** (replace the semantic-collection cases in `tests/mailSearchHelpers.test.ts`; keep unrelated cases)

```ts
import { describe, expect, it, vi } from 'vitest';
import {
  collectFtsMatchLists,
  collectSemanticOutcomes,
  flattenMatchLists,
} from '../renderer/src/stores/mailSearchHelpers';
import type { SemanticSearchOutcome } from '../shared/types';

const okOutcome = (ids: string[], scanned = 10, totalIndexed = 10): SemanticSearchOutcome => ({
  status: 'ok',
  results: ids.map((id, i) => ({
    threadId: id, messageId: `${id}-m`, score: 1 - i * 0.1,
    subject: 's', sender: 'x', snippet: 'sn', receivedAt: '2026-07-01T00:00:00.000Z',
  })),
  coverage: { scanned, totalIndexed },
});

describe('collectFtsMatchLists', () => {
  it('returns one ranked list per account preserving order', async () => {
    const searchFTS = vi.fn(async (accountId: string) =>
      accountId === 'a@x.com'
        ? [{ threadId: 't1', messageId: 'm1' }, { threadId: 't2', messageId: 'm2' }]
        : [{ threadId: 't3', messageId: 'm3' }]);
    const lists = await collectFtsMatchLists(['a@x.com', 'b@y.com'], 'q', searchFTS);
    expect(lists).toHaveLength(2);
    expect(lists[0]).toMatchObject({ accountId: 'a@x.com', source: 'fts' });
    expect(lists[0].entries.map(e => e.threadId)).toEqual(['t1', 't2']);
  });
});

describe('collectSemanticOutcomes', () => {
  it('aggregates ok outcomes with summed coverage and score-carrying entries', async () => {
    const searchSemantic = vi.fn(async (accountId: string) =>
      accountId === 'a@x.com' ? okOutcome(['t1'], 100, 200) : okOutcome(['t2'], 50, 60));
    const result = await collectSemanticOutcomes(['a@x.com', 'b@y.com'], 'q', searchSemantic);
    expect(result.state).toBe('ok');
    expect(result.coverage).toEqual({ scanned: 150, totalIndexed: 260 });
    expect(result.lists).toHaveLength(2);
    expect(result.lists[0].entries[0].score).toBeCloseTo(1);
  });

  it('reports off when every account is disabled', async () => {
    const searchSemantic = vi.fn(async (): Promise<SemanticSearchOutcome> =>
      ({ status: 'disabled', results: [], coverage: null }));
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('off');
    expect(result.lists).toHaveLength(0);
  });

  it('reports error (worst state wins) and keeps successful lists', async () => {
    const searchSemantic = vi.fn(async (accountId: string): Promise<SemanticSearchOutcome> =>
      accountId === 'a@x.com'
        ? okOutcome(['t1'])
        : { status: 'error', results: [], coverage: null, errorMessage: 'HTTP 500' });
    const result = await collectSemanticOutcomes(['a@x.com', 'b@y.com'], 'q', searchSemantic);
    expect(result.state).toBe('error');
    expect(result.errorMessage).toBe('HTTP 500');
    expect(result.lists).toHaveLength(1);
  });

  it('captures thrown IPC errors per account instead of swallowing them', async () => {
    const searchSemantic = vi.fn(async () => { throw new Error('ipc broke'); });
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('error');
    expect(result.errorMessage).toBe('ipc broke');
  });

  it('treats superseded outcomes as silent (no error, no list)', async () => {
    const searchSemantic = vi.fn(async (): Promise<SemanticSearchOutcome> =>
      ({ status: 'superseded', results: [], coverage: null }));
    const result = await collectSemanticOutcomes(['a@x.com'], 'q', searchSemantic);
    expect(result.state).toBe('off');
    expect(result.errorMessage).toBeUndefined();
  });
});

describe('flattenMatchLists', () => {
  it('flattens entries preserving thread and message ids', () => {
    const flat = flattenMatchLists([
      { accountId: 'a@x.com', source: 'fts', entries: [{ threadId: 't1', messageId: 'm1' }] },
      { accountId: 'a@x.com', source: 'semantic', entries: [{ threadId: 't2', messageId: 'm2', score: 0.5 }] },
    ]);
    expect(flat).toEqual([
      { threadId: 't1', messageId: 'm1' },
      { threadId: 't2', messageId: 'm2' },
    ]);
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/mailSearchHelpers.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 4: Implement `mailSearchHelpers.ts`**

Replace `collectFtsMatches` / `collectSemanticMatchesWithTimeout` / `timeoutAfter` (keep `shouldRunSemanticSearch`, `waitUnlessCancelled`, `SEMANTIC_SEARCH_MIN_QUERY_LENGTH`, `SEMANTIC_SEARCH_SETTLE_DELAY_MS`, `ThreadSearchMatch`):

```ts
import type { SemanticSearchCoverage, SemanticSearchOutcome } from '../../../shared/types';
import type { RankedSourceList } from '../../../shared/searchRanking';

type SearchFTS = (accountId: string, query: string) => Promise<ThreadSearchMatch[]>;
type SearchSemantic = (accountId: string, query: string, limit?: number) => Promise<SemanticSearchOutcome>;

const SEMANTIC_RESULT_LIMIT = 80;

export async function collectFtsMatchLists(
  accountIds: string[],
  textQuery: string,
  searchFTS: SearchFTS,
): Promise<RankedSourceList[]> {
  const batches = await Promise.all(accountIds.map(async accountId => ({
    accountId,
    source: 'fts' as const,
    entries: await searchFTS(accountId, textQuery),
  })));
  return batches.filter(list => list.entries.length > 0);
}

export interface SemanticCollectResult {
  lists: RankedSourceList[];
  state: 'ok' | 'off' | 'error';
  coverage: SemanticSearchCoverage | null;
  errorMessage?: string;
}

export async function collectSemanticOutcomes(
  accountIds: string[],
  textQuery: string,
  searchSemantic: SearchSemantic,
): Promise<SemanticCollectResult> {
  const outcomes = await Promise.all(accountIds.map(async accountId => {
    try {
      return { accountId, outcome: await searchSemantic(accountId, textQuery, SEMANTIC_RESULT_LIMIT) };
    } catch (error) {
      const outcome: SemanticSearchOutcome = {
        status: 'error',
        results: [],
        coverage: null,
        errorMessage: error instanceof Error ? error.message : String(error),
      };
      return { accountId, outcome };
    }
  }));

  const lists: RankedSourceList[] = [];
  let coverage: SemanticSearchCoverage | null = null;
  let sawOk = false;
  let errorMessage: string | undefined;

  for (const { accountId, outcome } of outcomes) {
    if (outcome.status === 'ok') {
      sawOk = true;
      if (outcome.results.length > 0) {
        lists.push({
          accountId,
          source: 'semantic',
          entries: outcome.results.map(result => ({
            threadId: result.threadId,
            messageId: result.messageId,
            score: result.score,
          })),
        });
      }
      if (outcome.coverage) {
        coverage = coverage
          ? {
              scanned: coverage.scanned + outcome.coverage.scanned,
              totalIndexed: coverage.totalIndexed + outcome.coverage.totalIndexed,
            }
          : outcome.coverage;
      }
    } else if (outcome.status === 'error' && errorMessage === undefined) {
      errorMessage = outcome.errorMessage || 'Semantic search failed';
    }
  }

  // Worst state wins for the indicator; superseded/disabled stay silent.
  const state: SemanticCollectResult['state'] =
    errorMessage !== undefined ? 'error' : sawOk ? 'ok' : 'off';

  return { lists, state, coverage, errorMessage };
}

export function flattenMatchLists(lists: RankedSourceList[]): ThreadSearchMatch[] {
  return lists.flatMap(list => list.entries.map(entry => ({
    threadId: entry.threadId,
    messageId: entry.messageId,
  })));
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/mailSearchHelpers.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/stores/mailSearchStatus.ts renderer/src/stores/mailSearchHelpers.ts tests/mailSearchHelpers.test.ts
git commit -m "feat: add semantic outcome collection and richer search state"
```

---

### Task 7: Search indicator states

**Files:**
- Modify: `renderer/src/components/layout/searchIndicator.ts`
- Modify: `renderer/src/components/layout/SearchCockpitBar.tsx:49-54` (prop shape + title attribute)
- Test: `tests/searchIndicator.test.ts` (rewrite)

**Interfaces:**
- Consumes: `MailSearchState` (Task 6).
- Produces (used by Task 8's AppStore wiring): `getSearchIndicatorState({ draftQuery, committedQuery, searchState }): { kind: 'none' | 'searching' | 'complete' | 'error'; label: string; title?: string }`.

- [ ] **Step 1: Rewrite the test file**

```ts
// tests/searchIndicator.test.ts
import { describe, expect, it } from 'vitest';
import { getSearchIndicatorState } from '../renderer/src/components/layout/searchIndicator';
import type { MailSearchState } from '../renderer/src/stores/mailSearchStatus';

const state = (partial: Partial<MailSearchState>): MailSearchState => ({
  phase: 'complete',
  semantic: 'off',
  coverage: null,
  ...partial,
});

const base = { draftQuery: 'contract', committedQuery: 'contract' };

describe('search indicator state', () => {
  it('shows searching while input is uncommitted or phase is searching', () => {
    expect(getSearchIndicatorState({ draftQuery: 'c', committedQuery: '', searchState: state({ phase: 'idle' }) }))
      .toEqual({ kind: 'searching', label: 'Searching' });
    expect(getSearchIndicatorState({ ...base, searchState: state({ phase: 'searching' }) }))
      .toEqual({ kind: 'searching', label: 'Searching' });
  });

  it('shows plain Done when semantic is off', () => {
    expect(getSearchIndicatorState({ ...base, searchState: state({ semantic: 'off' }) }))
      .toEqual({ kind: 'complete', label: 'Done' });
  });

  it('shows AI pending while semantic results are on the way', () => {
    expect(getSearchIndicatorState({ ...base, searchState: state({ semantic: 'pending' }) }))
      .toEqual({ kind: 'searching', label: 'Done · AI…' });
  });

  it('shows AI applied with full coverage', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'applied', coverage: { scanned: 300, totalIndexed: 300 } }),
    })).toEqual({ kind: 'complete', label: 'Done · AI ✓' });
  });

  it('shows honest partial coverage with compact counts', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'applied', coverage: { scanned: 12000, totalIndexed: 45000 } }),
    })).toEqual({ kind: 'complete', label: 'Done · AI searched 12k of 45k' });
  });

  it('shows AI unavailable with the error in title', () => {
    expect(getSearchIndicatorState({
      ...base,
      searchState: state({ semantic: 'error', errorMessage: 'HTTP 500' }),
    })).toEqual({ kind: 'error', label: 'Done · AI unavailable', title: 'HTTP 500' });
  });

  it('hides the indicator when idle with no queries', () => {
    expect(getSearchIndicatorState({ draftQuery: '', committedQuery: '', searchState: state({ phase: 'idle' }) }))
      .toEqual({ kind: 'none', label: '' });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run tests/searchIndicator.test.ts`
Expected: FAIL — input shape mismatch.

- [ ] **Step 3: Implement `searchIndicator.ts`**

```ts
import type { MailSearchState } from '../../stores/mailSearchStatus';

export type SearchIndicatorKind = 'none' | 'searching' | 'complete' | 'error';

export interface SearchIndicatorInput {
  draftQuery: string;
  committedQuery: string;
  searchState: MailSearchState;
}

export interface SearchIndicatorState {
  kind: SearchIndicatorKind;
  label: string;
  title?: string;
}

function compactCount(value: number): string {
  return value >= 1000 ? `${Math.round(value / 1000)}k` : String(value);
}

export function getSearchIndicatorState({
  draftQuery,
  committedQuery,
  searchState,
}: SearchIndicatorInput): SearchIndicatorState {
  if (draftQuery !== committedQuery || searchState.phase === 'searching') {
    return { kind: 'searching', label: 'Searching' };
  }

  if (searchState.phase === 'complete') {
    switch (searchState.semantic) {
      case 'pending':
        return { kind: 'searching', label: 'Done · AI…' };
      case 'error':
        return { kind: 'error', label: 'Done · AI unavailable', title: searchState.errorMessage };
      case 'applied': {
        const coverage = searchState.coverage;
        if (coverage && coverage.scanned < coverage.totalIndexed) {
          return {
            kind: 'complete',
            label: `Done · AI searched ${compactCount(coverage.scanned)} of ${compactCount(coverage.totalIndexed)}`,
          };
        }
        return { kind: 'complete', label: 'Done · AI ✓' };
      }
      default:
        return { kind: 'complete', label: 'Done' };
    }
  }

  return { kind: 'none', label: '' };
}
```

- [ ] **Step 4: Update `SearchCockpitBar.tsx`**

At `SearchCockpitBar.tsx:49-54` the call becomes:

```ts
  const searchIndicator = getSearchIndicatorState({
    draftQuery,
    committedQuery: searchQuery,
    searchState: searchStatus,
  });
```

(`searchStatus` from the store is now a `MailSearchState` after Task 8 — this task and Task 8 must land together in one build; run the full build in Task 8.) Where the component renders the indicator chip, spread `title={searchIndicator.title}` onto the chip element and render the `error` kind with the same styling as `complete` (color tweak optional, keep existing classes).

- [ ] **Step 5: Run tests**

Run: `npx vitest run tests/searchIndicator.test.ts`
Expected: PASS. (`npm run build` still fails until Task 8 rewires the store — acceptable mid-sequence; do not commit yet if you want bisectable builds, otherwise commit knowing Task 8 lands next.)

- [ ] **Step 6: Commit**

```bash
git add renderer/src/components/layout/searchIndicator.ts renderer/src/components/layout/SearchCockpitBar.tsx tests/searchIndicator.test.ts
git commit -m "feat: surface semantic search states in the search indicator"
```

---

### Task 8: Two-phase search flow in `useMailState` + AppStore wiring

**Files:**
- Modify: `renderer/src/stores/useMailState.ts:86-120` (state), `renderer/src/stores/useMailState.ts:453-554` (effect), exports around `renderer/src/stores/useMailState.ts:1096`
- Modify: `renderer/src/stores/AppStore.tsx:371` (type), plus expose the two new fields

**Interfaces:**
- Consumes: Tasks 1, 6 exports.
- Produces (used by Task 9): store fields `searchStatus: MailSearchState`, `searchTopCount: number`, `semanticMatchThreadIds: Set<string>` (semantic-only ids for badges), all exposed through `AppStore`.

- [ ] **Step 1: Replace the status state block** (`useMailState.ts:88-113`)

```ts
  const [searchStatus, setSearchStatusState] = useState<MailSearchState>(IDLE_SEARCH_STATE);
  const searchStatusResetRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const [searchTopCount, setSearchTopCount] = useState(0);
  const [semanticMatchThreadIds, setSemanticMatchThreadIds] = useState<Set<string>>(new Set());

  const updateSearchState = useCallback((state: MailSearchState) => {
    if (searchStatusResetRef.current !== null) {
      globalThis.clearTimeout(searchStatusResetRef.current);
      searchStatusResetRef.current = null;
    }

    setSearchStatusState(state);
    // Auto-hide the Done chip only once the semantic pass has settled.
    if (state.phase === 'complete' && state.semantic !== 'pending') {
      searchStatusResetRef.current = globalThis.setTimeout(() => {
        setSearchStatusState(current =>
          current.phase === 'complete' ? { ...current, phase: 'idle' } : current);
        searchStatusResetRef.current = null;
      }, SEARCH_COMPLETE_VISIBLE_MS);
    }
  }, []);
```

Update imports: `import { IDLE_SEARCH_STATE, type MailSearchState } from './mailSearchStatus';` and rename remaining `updateSearchStatus` call sites in this file (`useMailState.ts:457`, `:475`, `:531`, `:534`) to `updateSearchState` with the new shapes shown below.

- [ ] **Step 2: Rewrite the filter effect body** (`useMailState.ts:464-536`)

```ts
    const filterThreads = async () => {
      const start = performance.now();
      const now = new Date();
      const trimmedQuery = searchQuery.trim();
      const parsed = trimmedQuery ? parseSearchQuery(searchQuery) : null;
      const textQuery = parsed ? searchTextQuery(parsed) : '';
      const ftsQuery = parsed ? buildFtsMatchQuery(parsed.textTerms) : '';
      const accountIds = activeAccount.id === 'unified'
        ? accounts.map(acc => acc.email)
        : [activeAccount.email];
      const semanticDue = Boolean(textQuery) && shouldRunSemanticSearch(textQuery);

      updateSearchState({ phase: 'searching', semantic: semanticDue ? 'pending' : 'off', coverage: null });

      const applyMatches = async (
        matchLists: RankedSourceList[],
      ): Promise<boolean> => {
        const matches = flattenMatchLists(matchLists);
        const nextFiltered = await filterVisibleThreadsCooperatively({
          threads,
          searchQuery,
          matches,
          activeSplit,
          mailboxView,
          now,
          tabCategories,
          labelDefinitions,
          mutedLabelIdsByAccount,
          getThreadCategory,
          isCancelled,
        });

        if (!nextFiltered || cancelled) return false;

        if (textQuery) {
          const fusion = fuseSearchMatches(matchLists);
          const ordered = orderSearchResults(nextFiltered, fusion);
          publishVisibleThreads(ordered.threads);
          setSearchTopCount(ordered.topCount);
          setSemanticMatchThreadIds(ordered.semanticOnlyThreadIds);
        } else {
          publishVisibleThreads(nextFiltered);
          setSearchTopCount(0);
          setSemanticMatchThreadIds(prev => (prev.size === 0 ? prev : new Set()));
        }
        return true;
      };

      try {
        let ftsLists: RankedSourceList[] = [];
        if (ftsQuery) {
          try {
            ftsLists = await collectFtsMatchLists(accountIds, ftsQuery, window.electronAPI.searchFTS);
          } catch (err) {
            console.error('Local mail search failed:', err);
            ftsLists = [];
          }
        }

        if (cancelled) return;

        const didApplyFts = await applyMatches(ftsLists);
        if (!didApplyFts || cancelled) return;

        setSpeedProof((prev: SpeedProof) => ({
          ...prev,
          searchMs: Math.round(performance.now() - start)
        }));

        if (!semanticDue) {
          if (!cancelled) updateSearchState({ phase: 'complete', semantic: 'off', coverage: null });
          return;
        }

        updateSearchState({ phase: 'complete', semantic: 'pending', coverage: null });

        // Fire semantic search only after the user has paused typing; a new
        // searchQuery commit cancels this effect and skips the IPC call.
        const settled = await waitUnlessCancelled(SEMANTIC_SEARCH_SETTLE_DELAY_MS, isCancelled);
        if (!settled || cancelled) return;

        // Apply-when-ready: no timeout race — late results still land unless
        // this effect was cancelled by a newer query (main also supersedes).
        const semantic = await collectSemanticOutcomes(accountIds, textQuery, window.electronAPI.searchSemantic);
        if (cancelled) return;

        if (semantic.lists.length > 0) {
          const didApplySemantic = await applyMatches([...ftsLists, ...semantic.lists]);
          if (!didApplySemantic || cancelled) return;
        }

        updateSearchState({
          phase: 'complete',
          semantic: semantic.state === 'ok' ? 'applied' : semantic.state === 'error' ? 'error' : 'off',
          coverage: semantic.coverage,
          errorMessage: semantic.errorMessage,
        });
      } catch (err) {
        console.error('Mail search filtering failed:', err);
        if (!cancelled) updateSearchState({ phase: 'complete', semantic: 'off', coverage: null });
      }
    };
```

Imports to add in `useMailState.ts`: `collectFtsMatchLists`, `collectSemanticOutcomes`, `flattenMatchLists` (replacing `collectFtsMatches`, `collectSemanticMatchesWithTimeout`) from `./mailSearchHelpers`; `fuseSearchMatches`, `orderSearchResults`, `type RankedSourceList` from `../../../shared/searchRanking`. The early-return at `useMailState.ts:455-459` becomes `updateSearchState(IDLE_SEARCH_STATE)` and also resets `setSearchTopCount(0)`.

- [ ] **Step 3: Export the new fields** (near `useMailState.ts:1096`): add `searchTopCount` and `semanticMatchThreadIds` beside `searchStatus`. In `AppStore.tsx`: change line 371 to `searchStatus: MailSearchState;`, add `searchTopCount: number;` and `semanticMatchThreadIds: Set<string>;` to the store interface, and wire both from `mailState` where `visibleThreads` is wired (`AppStore.tsx:574`). Update the `MailSearchStatus` import to `MailSearchState`.

- [ ] **Step 4: Verify**

Run: `npm run build`
Expected: succeeds — this is the task that makes the whole renderer typecheck again.
Run: `npx vitest run tests/mailSearchHelpers.test.ts tests/searchIndicator.test.ts tests/mailThreadFilter.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add renderer/src/stores/useMailState.ts renderer/src/stores/AppStore.tsx
git commit -m "feat: two-phase hybrid search with sections and honest states"
```

---

### Task 9: Sectioned thread list + semantic badge (`App.tsx`, `ThreadRow`)

**Files:**
- Modify: `renderer/src/App.tsx:578-609` (focus scroll), `:725-742` (row counts/virtual window), `:945-987` (list render)
- Modify: `renderer/src/components/ThreadRow.tsx` (new optional prop)

**Interfaces:**
- Consumes: `store.searchTopCount`, `store.semanticMatchThreadIds` (Task 8).
- Produces: UI only.

- [ ] **Step 1: Build row descriptors** (after `hasMailboxRows`, replacing the `virtualThreadWindow`/`virtualThreads` pair at `App.tsx:732-742`)

```tsx
  type MailboxRow =
    | { kind: 'header'; id: 'top' | 'all'; label: string }
    | { kind: 'thread'; thread: MailThread; threadIndex: number };

  const mailboxRows = useMemo<MailboxRow[]>(() => {
    const rows: MailboxRow[] = [];
    const topCount = store.searchTopCount;
    store.visibleThreads.forEach((thread, threadIndex) => {
      if (topCount > 0 && threadIndex === 0) rows.push({ kind: 'header', id: 'top', label: 'Top results' });
      if (topCount > 0 && threadIndex === topCount) rows.push({ kind: 'header', id: 'all', label: 'All matches' });
      rows.push({ kind: 'thread', thread, threadIndex });
    });
    return rows;
  }, [store.visibleThreads, store.searchTopCount]);

  const virtualThreadWindow = useMemo(() => calculateVirtualWindow({
    itemCount: mailboxRows.length,
    rowHeight: threadRowHeight,
    viewportHeight: mailboxViewport.height || 600,
    scrollTop: mailboxViewport.scrollTop,
    overscan: 10,
  }), [mailboxRows.length, threadRowHeight, mailboxViewport.height, mailboxViewport.scrollTop]);

  const virtualRows = useMemo(
    () => mailboxRows.slice(virtualThreadWindow.startIndex, virtualThreadWindow.endIndex),
    [mailboxRows, virtualThreadWindow.startIndex, virtualThreadWindow.endIndex],
  );
```

- [ ] **Step 2: Render headers and badges** (replace the `virtualThreads.map(...)` block at `App.tsx:962-984`)

```tsx
                            {virtualRows.map((row, relativeIndex) => {
                              const absoluteIndex = virtualThreadWindow.startIndex + relativeIndex;
                              if (row.kind === 'header') {
                                return (
                                  <div
                                    key={`section-${row.id}`}
                                    role="presentation"
                                    style={{ height: `${threadRowHeight}px` }}
                                    className="flex items-end pb-1.5 px-3 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
                                  >
                                    {row.label}
                                  </div>
                                );
                              }
                              const thread = row.thread;
                              return (
                                <ThreadRow
                                  key={thread.id}
                                  thread={thread}
                                  isFocused={store.focusedThreadId === thread.id}
                                  isOpened={store.openedThread?.id === thread.id}
                                  showAvatars={store.settings.appearance.showAvatars}
                                  isSelected={store.selectedThreadIds.has(thread.id)}
                                  isSelectionModeActive={store.selectedThreadIds.size > 0}
                                  isSemanticMatch={store.semanticMatchThreadIds.has(thread.id)}
                                  positionInSet={row.threadIndex + 1}
                                  setSize={store.visibleThreads.length}
                                  onClick={() => store.openThread(thread)}
                                  onToggleSelect={(e) => handleThreadSelectToggle(e, thread.id)}
                                  onContextMenu={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    setContextMenu({ x: e.clientX, y: e.clientY, thread });
                                  }}
                                />
                              );
                            })}
```

- [ ] **Step 3: Fix the focus auto-scroll** (`App.tsx:584`): the scroll target must be the row index, not the thread index:

```ts
    const targetIndex = mailboxRows.findIndex(row => row.kind === 'thread' && row.thread.id === targetId);
```

and pass `itemCount: mailboxRows.length` in the `scrollTopForIndex` call (`App.tsx:595`); add `mailboxRows` to that effect's dependency array (replacing `store.visibleThreads`).

- [ ] **Step 4: Badge prop in `ThreadRow.tsx`**

Add optional `isSemanticMatch?: boolean` to the props interface. Read the component first; render, next to the thread's date/metadata cluster (the right-aligned group), a compact badge when true:

```tsx
{isSemanticMatch && (
  <span title="AI match" aria-label="AI match" className="text-[var(--text-secondary)] opacity-70">
    <Zap aria-hidden="true" className="w-3 h-3" />
  </span>
)}
```

(`Zap` from `lucide-react`, already the icon library in `App.tsx`. Match the row's existing icon sizing/classes — inspect neighbors and copy their conventions.)

- [ ] **Step 5: Verify**

Run: `npm run build` — Expected: succeeds.
Run: `npx vitest run tests/virtualList.test.ts tests/keyboard.test.ts tests/threadDisplay.test.ts` — Expected: PASS (no math changed inside `virtualList.ts`; keyboard nav operates on `visibleThreads`, untouched).
Manual smoke (`npm run dev`): search a phrase → Top results header appears when >5 matches; j/k skips headers (focus moves thread-to-thread); ⚡ shows on semantic-only rows once AI results land.

- [ ] **Step 6: Commit**

```bash
git add renderer/src/App.tsx renderer/src/components/ThreadRow.tsx
git commit -m "feat: render search sections and semantic match badges"
```

---

### Task 10: Settings key normalization on write + final validation

**Files:**
- Modify: `renderer/src/components/settings/EmbeddingSettingsPanel.tsx` (both write sites: `updateEmbeddings` ~line 106, semantic toggle ~line 271)

**Interfaces:**
- Consumes: nothing new. Read-side normalization landed in Task 5; this makes new writes canonical.

- [ ] **Step 1: Normalize the write keys**

In `updateEmbeddings`:

```ts
  const updateEmbeddings = (patch: Partial<AIEmbeddingSettings>) => {
    if (!activeAccountId) return;
    const accountKey = activeAccountId.trim().toLowerCase();
    store.updateSettings(settings => {
      if (!settings.ai.embeddingsByAccount) {
        settings.ai.embeddingsByAccount = {};
      }
      const current = settings.ai.embeddingsByAccount[accountKey] || settings.ai.embeddings;
      settings.ai.embeddingsByAccount[accountKey] = normalizeEmbeddingSettings({
        ...current,
        ...patch,
      });
    });
    setTestStatus({ status: 'idle' });
  };
```

In the semantic toggle `onChange`:

```ts
          onChange={(value) => {
            if (!activeAccountId) return;
            const accountKey = activeAccountId.trim().toLowerCase();
            store.updateSettings(settings => {
              if (!settings.ai.semanticSearchEnabledByAccount) {
                settings.ai.semanticSearchEnabledByAccount = {};
              }
              settings.ai.semanticSearchEnabledByAccount[accountKey] = value;
            });
          }}
```

Also check this component's *read* sites (where it initializes `semanticSearchEnabled` / current embeddings from settings, e.g. `EmbeddingSettingsPanel.tsx:113`) and apply the same `accountKey` lookup so the panel displays what main resolves.

- [ ] **Step 2: Full validation**

Run: `npm run build` — Expected: succeeds.
Run: `npm test` — Expected: entire suite PASS. Fix regressions before proceeding.

- [ ] **Step 3: Commit**

```bash
git add renderer/src/components/settings/EmbeddingSettingsPanel.tsx
git commit -m "fix: normalize per-account embedding setting keys"
```

---

## Post-plan checks (not tasks)

- Review loop per user's global policy: delegate `frontend-review` (renderer) and `senior-code-reviewer` or `backend-review`-equivalent scrutiny for `main/` changes; fix Critical/Warning findings and re-run.
- The spec's `DEBUG_REPLY_RENDER` item: grep found no occurrences in source on 2026-07-04 — already gone; nothing to do.
- Merge/PR handling via superpowers:finishing-a-development-branch.
