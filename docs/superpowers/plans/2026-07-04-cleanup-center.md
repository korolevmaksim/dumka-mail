# Privacy & Cleanup Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A full-workspace Cleanup pane that shows per-sender stats (volume, trackers, unsubscribe capability) computed locally from the SQLite cache and feeds dry-run Archive-old / Unsubscribe actions into the existing Agent Review Queue, while fixing the two known AgentPlan bugs (queue replacement, dead triage card).

**Architecture:** A new `senderCleanupStats` aggregate query on `MessagesRepo` runs inside the existing database worker thread (never on the main event loop) and is exposed via the strict 3-file IPC chain (`main/index.ts` → `main/preload.ts` → `renderer/src/vite-env.d.ts`). Pure suggestion rules and AgentPlan item builders live in `shared/` (dependency-free, unit-tested). The renderer mounts `CleanupPanel` exactly like Settings — one store boolean plus one ternary branch — and all row actions merge `proposed` items into the Agent Review Queue via `mergeAgentPlanItem`, which is the dry-run gate.

**Tech Stack:** TypeScript strict, Electron (main + worker_threads), better-sqlite3, React 19, Tailwind CSS 4 (CSS-variable tokens), lucide-react, vitest.

**Spec:** `docs/superpowers/specs/2026-07-04-cleanup-center-design.md`

## Global Constraints

- **CTE anti-pattern ban:** the per-sender attachment-bytes aggregation MUST use a pre-aggregated `json_each` JOIN CTE. The correlated-subquery form measured **36 s vs 0.6 s** on the live 20.8k-message DB and is forbidden.
- **`CLEANUP_ARCHIVE_BATCH_LIMIT = 25`** — max archive items added to the review queue per "Archive old" click.
- **Suggestion rules (spec C5, in this exact precedence order):** `maxRiskLevel === 'high'` → `review`; `hasUnsubscribeHeader AND recent30dCount >= 3` → `unsubscribe`; `recent30dCount >= 10 OR (threadCount >= 10 AND unread ratio >= 0.7)` → `archiveOld`; else `none`. Unread ratio = `unreadCount / messageCount`.
- **Privacy copy (spec C8, verbatim):** `Computed locally from your cached mail. Nothing leaves your machine until you approve an action.`
- **Commits:** commit after each task; messages in English; **NO `Co-Authored-By:` trailer and NO AI-attribution lines** (user rule, overrides any harness default).
- **Type gate:** no linter exists; `npm run build` (tsc noEmit + vite build) is the only type gate. Run it before claiming a task compiles.
- **`shared/` stays dependency-free:** no Electron/Node/React imports — it runs in both processes and is what `tests/` exercises directly.
- **IPC spine:** any channel change touches `main/preload.ts`, `main/index.ts`, and `renderer/src/vite-env.d.ts` together.
- Tests per task: `npx vitest run tests/<file>.test.ts`; full `npm test` in the final task.

---

### Task 1: Shared types, suggestion rules, and exhaustive-map entries

Widening `AgentPlanActionKind` with `'unsubscribe'` breaks two exhaustively-typed maps in `AgentReviewQueueCard.tsx` (`ACTION_LABEL` is `Record<AgentPlanActionKind, string>`; `ACTION_ICON` is indexed by `item.action` under `strict: true`). **This task therefore also adds the card's `unsubscribe` entries so the build stays green mid-sequence.** Nothing produces `'unsubscribe'` items until Task 2, so this is safe.

**Files:**
- Modify: `shared/types.ts:469-470` (widen `AgentPlanSource`, `AgentPlanActionKind`), `shared/types.ts:1022` (insert `SenderCleanupStat` after `ThreadAgentInsights`)
- Create: `shared/cleanup.ts`
- Modify: `renderer/src/components/AgentReviewQueueCard.tsx:1,5-36` (label/icon/description entries)
- Test: `tests/cleanup.test.ts` (new)

**Interfaces:**
- Consumes: nothing (pure).
- Produces (used by Tasks 2, 3, 6, 8):
  - `SenderCleanupStat` interface in `shared/types.ts` (exact shape below)
  - `AgentPlanSource` includes `'cleanup'`; `AgentPlanActionKind` includes `'unsubscribe'`
  - `shared/cleanup.ts`: `export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none'`, `export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25`, `export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction`

- [ ] **Step 1: Write the failing test**

Create `tests/cleanup.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { CLEANUP_ARCHIVE_BATCH_LIMIT, suggestCleanupAction } from '../shared/cleanup';
import type { SenderCleanupStat } from '../shared/types';

function stat(partial: Partial<SenderCleanupStat> = {}): SenderCleanupStat {
  return {
    accountId: 'me@example.com',
    senderEmail: 'news@example.com',
    senderName: 'Example News',
    threadCount: 4,
    messageCount: 6,
    unreadCount: 1,
    lastReceivedAt: '2026-07-01T00:00:00.000Z',
    recent30dCount: 2,
    hasUnsubscribeHeader: false,
    trackerCount: 0,
    maxRiskLevel: null,
    attachmentBytes: 0,
    ...partial,
  };
}

describe('suggestCleanupAction', () => {
  it('exports the archive batch limit used by the panel', () => {
    expect(CLEANUP_ARCHIVE_BATCH_LIMIT).toBe(25);
  });

  it('recommends review for high-risk senders above every other rule', () => {
    expect(suggestCleanupAction(stat({
      maxRiskLevel: 'high',
      hasUnsubscribeHeader: true,
      recent30dCount: 50,
      threadCount: 20,
      messageCount: 20,
      unreadCount: 20,
    }))).toBe('review');
  });

  it('does not treat medium or low risk as review', () => {
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'medium' }))).toBe('none');
    expect(suggestCleanupAction(stat({ maxRiskLevel: 'low' }))).toBe('none');
  });

  it('recommends unsubscribe at the recent30d >= 3 boundary when the header exists', () => {
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 3 }))).toBe('unsubscribe');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 2 }))).toBe('none');
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: false, recent30dCount: 3 }))).toBe('none');
  });

  it('prefers unsubscribe over archiveOld when both match', () => {
    expect(suggestCleanupAction(stat({ hasUnsubscribeHeader: true, recent30dCount: 15 }))).toBe('unsubscribe');
  });

  it('recommends archiveOld at the recent30d >= 10 boundary', () => {
    expect(suggestCleanupAction(stat({ recent30dCount: 10 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ recent30dCount: 9 }))).toBe('none');
  });

  it('recommends archiveOld for 10+ threads with unread ratio >= 0.7', () => {
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 10, unreadCount: 7, recent30dCount: 0 }))).toBe('archiveOld');
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 10, unreadCount: 6, recent30dCount: 0 }))).toBe('none');
    expect(suggestCleanupAction(stat({ threadCount: 9, messageCount: 10, unreadCount: 9, recent30dCount: 0 }))).toBe('none');
  });

  it('never divides by zero for senders with no messages', () => {
    expect(suggestCleanupAction(stat({ threadCount: 10, messageCount: 0, unreadCount: 0, recent30dCount: 0 }))).toBe('none');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/cleanup.test.ts`
Expected: FAIL — `Cannot find module '../shared/cleanup'` (and `SenderCleanupStat` does not exist yet).

- [ ] **Step 3: Add the shared types**

In `shared/types.ts`, replace lines 469-470:

```ts
export type AgentPlanSource = 'triageQueue' | 'dailyBriefing' | 'command';
export type AgentPlanActionKind = 'openThread' | 'markRead' | 'archive' | 'draftReply' | 'setReminder' | 'applyLabel';
```

with:

```ts
export type AgentPlanSource = 'triageQueue' | 'dailyBriefing' | 'command' | 'cleanup';
export type AgentPlanActionKind = 'openThread' | 'markRead' | 'archive' | 'draftReply' | 'setReminder' | 'applyLabel' | 'unsubscribe';
```

In `shared/types.ts`, insert after the closing brace of `ThreadAgentInsights` (line 1022, before `SemanticSearchResult`):

```ts
export interface SenderCleanupStat {
  accountId: AccountID;
  /** Lower-cased grouping key. */
  senderEmail: string;
  /** MAX(sender_name) representative display name. */
  senderName: string;
  threadCount: number;
  messageCount: number;
  unreadCount: number;
  /** ISO-8601 timestamp of the newest cached message from this sender. */
  lastReceivedAt: string;
  recent30dCount: number;
  hasUnsubscribeHeader: boolean;
  /** SUM of tracker_count over message_security rows (analyzed messages only). */
  trackerCount: number;
  /** null = no message from this sender was ever analyzed. */
  maxRiskLevel: 'low' | 'medium' | 'high' | null;
  /** SUM of attachments_json sizeBytes across cached messages. */
  attachmentBytes: number;
}
```

- [ ] **Step 4: Add the `unsubscribe` entries to AgentReviewQueueCard (keeps the build green)**

In `renderer/src/components/AgentReviewQueueCard.tsx`, replace line 1:

```ts
import { AlertCircle, CheckCircle2, ExternalLink, FileText, MailCheck, MailPlus, ShieldAlert, Tag, X } from 'lucide-react';
```

with:

```ts
import { AlertCircle, CheckCircle2, ExternalLink, FileText, MailCheck, MailMinus, MailPlus, ShieldAlert, Tag, X } from 'lucide-react';
```

Replace the `ACTION_LABEL` and `ACTION_ICON` constants (lines 5-21) with:

```ts
const ACTION_LABEL: Record<AgentPlanActionKind, string> = {
  openThread: 'Open',
  markRead: 'Mark read',
  archive: 'Archive',
  draftReply: 'Draft',
  setReminder: 'Remind',
  applyLabel: 'Label',
  unsubscribe: 'Unsubscribe',
};

const ACTION_ICON = {
  openThread: ExternalLink,
  markRead: MailCheck,
  archive: CheckCircle2,
  draftReply: MailPlus,
  setReminder: FileText,
  applyLabel: Tag,
  unsubscribe: MailMinus,
};
```

In `actionDescription` (lines 29-36), insert one line before the final `return`:

```ts
  if (item.action === 'unsubscribe') return "Send the sender's unsubscribe request.";
```

so the function reads:

```ts
function actionDescription(item: AgentPlanItem): string {
  if (item.action === 'draftReply') return 'Opens a local reply draft. It will not send anything.';
  if (item.action === 'archive') return 'Removes Inbox locally first, then syncs to Gmail.';
  if (item.action === 'markRead') return 'Marks the thread read locally first, then syncs to Gmail.';
  if (item.action === 'setReminder') return 'Creates a local reminder for tomorrow morning.';
  if (item.action === 'applyLabel') return 'Applies the selected Gmail label.';
  if (item.action === 'unsubscribe') return "Send the sender's unsubscribe request.";
  return 'Opens the source thread for manual review.';
}
```

- [ ] **Step 5: Create `shared/cleanup.ts`**

```ts
import type { SenderCleanupStat } from './types';

export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none';

/** Max archive items added to the review queue per "Archive old" click. */
export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25;

/**
 * Deterministic suggested action for a sender row, evaluated in this exact
 * precedence order (spec C5):
 *  1. maxRiskLevel === 'high'                             -> 'review'
 *  2. hasUnsubscribeHeader AND recent30dCount >= 3        -> 'unsubscribe'
 *  3. recent30dCount >= 10
 *     OR (threadCount >= 10 AND unread ratio >= 0.7)      -> 'archiveOld'
 *  4. otherwise                                           -> 'none'
 */
export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction {
  if (stat.maxRiskLevel === 'high') return 'review';
  if (stat.hasUnsubscribeHeader && stat.recent30dCount >= 3) return 'unsubscribe';
  const unreadRatio = stat.messageCount > 0 ? stat.unreadCount / stat.messageCount : 0;
  if (stat.recent30dCount >= 10 || (stat.threadCount >= 10 && unreadRatio >= 0.7)) return 'archiveOld';
  return 'none';
}
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `npx vitest run tests/cleanup.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 7: Type-check**

Run: `npm run build`
Expected: green. If tsc reports another exhaustive consumer of `AgentPlanActionKind` that this plan missed, add the `unsubscribe` entry there in the same style and re-run.

- [ ] **Step 8: Commit**

```bash
git add shared/types.ts shared/cleanup.ts renderer/src/components/AgentReviewQueueCard.tsx tests/cleanup.test.ts
git commit -m "feat: add cleanup sender stat types and suggestion rules"
```

---

### Task 2: Cleanup AgentPlan item builders (`shared/agentPlan.ts`)

**Files:**
- Modify: `shared/agentPlan.ts:1-13` (type imports), append builders after `mergeAgentPlanItem` (line 279)
- Test: `tests/cleanup.test.ts` (extend), `tests/agentPlan.test.ts` (extend)

**Interfaces:**
- Consumes (from Task 1): `SenderCleanupStat`, `AgentPlanActionKind` incl. `'unsubscribe'`, `AgentPlanSource` incl. `'cleanup'`. Also existing: `UnsubscribeCandidate` (`shared/types.ts:1005-1014`), `MailThread` (`shared/types.ts:43-55`), private helpers `itemId(source, threadId, action, sourceItemId?)` (`shared/agentPlan.ts:25-28`) and `snippet(value)` (`shared/agentPlan.ts:20-23`).
- Produces (used by Task 8):
  - `export function buildCleanupArchiveItem({ stat, thread }: { stat: SenderCleanupStat; thread: MailThread }): AgentPlanItem` — action `'archive'`, risk `'low'`, `selectionPolicy: 'autoSelected'`, id `agent:cleanup:archive:<threadId>`
  - `export function buildCleanupUnsubscribeItem({ stat, candidate }: { stat: SenderCleanupStat; candidate: UnsubscribeCandidate }): AgentPlanItem` — action `'unsubscribe'`, risk `'high'`, `selectionPolicy: 'manualOnly'`, id `agent:cleanup:unsubscribe:<sanitized senderEmail>`, `citation.evidence` = human-readable unsubscribe-method summary (spec C8)

- [ ] **Step 1: Write the failing tests**

Append to `tests/cleanup.test.ts` (below the `suggestCleanupAction` describe; extend the top import block as shown):

```ts
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../shared/agentPlan';
import type { MailThread, UnsubscribeCandidate } from '../shared/types';

const cleanupThread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Weekly digest',
  snippet: 'Here are the weekly product updates and links.',
  lastMessageAt: '2026-05-20T08:00:00.000Z',
  senderNames: ['Example News'],
  senderEmail: 'news@example.com',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};

function candidate(partial: Partial<UnsubscribeCandidate> = {}): UnsubscribeCandidate {
  return {
    accountId: 'me@example.com',
    threadId: 'thread-9',
    messageId: 'msg-9',
    senderEmail: 'news@example.com',
    senderName: 'Example News',
    methods: [{ kind: 'httpPost', url: 'https://example.com/unsub', isOneClick: true }],
    recommendedMethod: { kind: 'httpPost', url: 'https://example.com/unsub', isOneClick: true },
    canOneClick: true,
    ...partial,
  };
}

describe('buildCleanupArchiveItem', () => {
  it('builds a low-risk auto-selected archive proposal with batch evidence', () => {
    const item = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });

    expect(item).toMatchObject({
      id: 'agent:cleanup:archive:thread-1',
      accountId: 'me@example.com',
      threadId: 'thread-1',
      action: 'archive',
      title: 'Archive old thread',
      riskLevel: 'low',
      selectionPolicy: 'autoSelected',
      approvalState: 'proposed',
      sourceItemId: 'cleanup:news@example.com',
    });
    expect(item.citation.evidence).toBe(
      'Read thread from Example News, last activity 2026-05-20; part of Cleanup archive-old batch.'
    );
    expect(item.citation.snippet).toBe('Here are the weekly product updates and links.');
  });

  it('produces a stable id so re-clicks dedup through mergeAgentPlanItem', () => {
    const first = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });
    const second = buildCleanupArchiveItem({ stat: stat(), thread: cleanupThread });
    expect(first.id).toBe(second.id);
  });
});

describe('buildCleanupUnsubscribeItem', () => {
  it('builds a high-risk manual-only unsubscribe proposal citing the one-click method', () => {
    const item = buildCleanupUnsubscribeItem({ stat: stat(), candidate: candidate() });

    expect(item).toMatchObject({
      id: 'agent:cleanup:unsubscribe:news-example-com',
      accountId: 'me@example.com',
      threadId: 'thread-9',
      action: 'unsubscribe',
      title: 'Unsubscribe from sender',
      riskLevel: 'high',
      selectionPolicy: 'manualOnly',
      approvalState: 'proposed',
      payload: { sourceMessageId: 'msg-9' },
    });
    expect(item.citation.evidence).toBe('One-click HTTP unsubscribe → https://example.com/unsub');
    expect(item.citation.messageId).toBe('msg-9');
  });

  it('describes mailto methods as a mail action', () => {
    const item = buildCleanupUnsubscribeItem({
      stat: stat(),
      candidate: candidate({
        methods: [{ kind: 'mailto', url: 'mailto:unsubscribe@example.com', isOneClick: false, email: 'unsubscribe@example.com' }],
        recommendedMethod: { kind: 'mailto', url: 'mailto:unsubscribe@example.com', isOneClick: false, email: 'unsubscribe@example.com' },
        canOneClick: false,
      }),
    });
    expect(item.citation.evidence).toBe('Mail to unsubscribe@example.com');
  });

  it('falls back to a link description for plain http methods', () => {
    const item = buildCleanupUnsubscribeItem({
      stat: stat(),
      candidate: candidate({
        methods: [{ kind: 'httpGet', url: 'https://example.com/optout', isOneClick: false }],
        recommendedMethod: null,
        canOneClick: false,
      }),
    });
    expect(item.citation.evidence).toBe('Open unsubscribe link → https://example.com/optout');
  });
});
```

Append to `tests/agentPlan.test.ts` inside the existing `describe('Agent Plan builders', ...)` block (extend its imports: add `buildCleanupArchiveItem` to the `../shared/agentPlan` import and `SenderCleanupStat` to the type import):

```ts
  it('merges cleanup items additively into an existing plan and dedups by id', () => {
    const cleanupStat: SenderCleanupStat = {
      accountId: 'me@example.com',
      senderEmail: 'digest@example.com',
      senderName: 'Digest Bot',
      threadCount: 12,
      messageCount: 20,
      unreadCount: 15,
      lastReceivedAt: '2026-07-03T08:00:00.000Z',
      recent30dCount: 11,
      hasUnsubscribeHeader: true,
      trackerCount: 4,
      maxRiskLevel: 'medium',
      attachmentBytes: 0,
    };
    const archiveItem = buildCleanupArchiveItem({ stat: cleanupStat, thread });
    const planWithBriefing = buildAgentPlanFromDailyBriefingItem({ briefing, item: briefingItem });

    const merged = mergeAgentPlanItem(planWithBriefing, archiveItem);
    expect(merged.items).toHaveLength(2);
    expect(merged.items[0].id).toBe('agent:cleanup:archive:thread-1');
    expect(merged.source).toBe('dailyBriefing');

    const deduped = mergeAgentPlanItem(merged, archiveItem);
    expect(deduped.items).toHaveLength(2);
    expect(deduped.coverage.proposedActionCount).toBe(2);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/cleanup.test.ts tests/agentPlan.test.ts`
Expected: FAIL — `buildCleanupArchiveItem` / `buildCleanupUnsubscribeItem` are not exported from `../shared/agentPlan`.

- [ ] **Step 3: Implement the builders**

In `shared/agentPlan.ts`, extend the type import block (lines 1-13) to add `SenderCleanupStat` and `UnsubscribeCandidate`:

```ts
import type {
  AgentPlan,
  AgentPlanActionKind,
  AgentPlanItem,
  AgentPlanRiskLevel,
  AgentPlanSelectionPolicy,
  DailyBriefing,
  DailyBriefingItem,
  MailThread,
  MailTriagePlan,
  MailTriagePlanItem,
  SenderCleanupStat,
  TriageRecommendation,
  UnsubscribeCandidate,
} from './types';
```

Append at the end of the file (after `mergeAgentPlanItem`, line 279):

```ts
function describeUnsubscribeMethod(candidate: UnsubscribeCandidate): string {
  const method = candidate.recommendedMethod || candidate.methods[0] || null;
  if (!method) return 'Unsubscribe via List-Unsubscribe header';
  if (method.kind === 'mailto') return `Mail to ${method.email || method.url}`;
  if (method.kind === 'httpPost' && method.isOneClick) return `One-click HTTP unsubscribe → ${method.url}`;
  return `Open unsubscribe link → ${method.url}`;
}

export function buildCleanupArchiveItem({
  stat,
  thread,
}: {
  stat: SenderCleanupStat;
  thread: MailThread;
}): AgentPlanItem {
  const sender = stat.senderName || stat.senderEmail;
  const lastActivity = (thread.lastMessageAt || '').slice(0, 10);

  return {
    id: itemId('cleanup', thread.id, 'archive'),
    accountId: thread.accountId,
    threadId: thread.id,
    subject: thread.subject,
    sender,
    action: 'archive',
    title: 'Archive old thread',
    reason: `Read thread from ${sender} with no activity since ${lastActivity}.`,
    citation: {
      accountId: thread.accountId,
      threadId: thread.id,
      messageId: null,
      subject: thread.subject,
      sender,
      senderEmail: stat.senderEmail,
      snippet: snippet(thread.snippet),
      evidence: `Read thread from ${sender}, last activity ${lastActivity}; part of Cleanup archive-old batch.`,
      receivedAt: thread.lastMessageAt,
    },
    riskLevel: 'low',
    confidence: 90,
    selectionPolicy: 'autoSelected',
    approvalState: 'proposed',
    sourceItemId: `cleanup:${stat.senderEmail}`,
  };
}

export function buildCleanupUnsubscribeItem({
  stat,
  candidate,
}: {
  stat: SenderCleanupStat;
  candidate: UnsubscribeCandidate;
}): AgentPlanItem {
  const sender = candidate.senderName || stat.senderName || stat.senderEmail;

  return {
    id: itemId('cleanup', candidate.threadId, 'unsubscribe', stat.senderEmail),
    accountId: candidate.accountId,
    threadId: candidate.threadId,
    subject: `Unsubscribe from ${stat.senderEmail}`,
    sender,
    action: 'unsubscribe',
    title: 'Unsubscribe from sender',
    reason: `${stat.recent30dCount} message${stat.recent30dCount === 1 ? '' : 's'} in the last 30 days from ${stat.senderEmail}.`,
    citation: {
      accountId: candidate.accountId,
      threadId: candidate.threadId,
      messageId: candidate.messageId,
      subject: `Unsubscribe from ${stat.senderEmail}`,
      sender,
      senderEmail: stat.senderEmail,
      snippet: '',
      evidence: describeUnsubscribeMethod(candidate),
      receivedAt: stat.lastReceivedAt,
    },
    riskLevel: 'high',
    confidence: 75,
    selectionPolicy: 'manualOnly',
    approvalState: 'proposed',
    sourceItemId: `cleanup:${stat.senderEmail}`,
    payload: {
      sourceMessageId: candidate.messageId,
    },
  };
}
```

Notes for the implementer:
- `itemId` sanitizes the source part with `/[^a-z0-9_-]+/gi` → `'-'`, so `news@example.com` becomes `news-example-com` (the unsubscribe id is stable **per sender**, dedupable across re-clicks even when the resolved thread changes).
- The archive id keys on the thread id, so each thread in a batch is its own dedupable item.
- `confidence` values (90 archive / 75 unsubscribe) are deterministic local-rule confidences; the spec fixes risk/policy but not confidence — these are the plan's chosen constants, keep them.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/cleanup.test.ts tests/agentPlan.test.ts`
Expected: PASS.

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add shared/agentPlan.ts tests/cleanup.test.ts tests/agentPlan.test.ts
git commit -m "feat: add cleanup agent plan item builders"
```

---

### Task 3: `MessagesRepo.senderCleanupStats` aggregate query

**Files:**
- Modify: `main/repositories.ts:9-27` (type import), `main/repositories.ts:525` (new method after `listRecentBySender`, inside `MessagesRepo`)
- Test: `tests/senderCleanupStats.test.ts` (new)

**Interfaces:**
- Consumes (from Task 1): `SenderCleanupStat` from `shared/types.ts`. Existing: `getDatabase()` from `main/database.ts`, tables `messages` (`main/migrations.ts:113-136`) and `message_security` (`main/migrations.ts:220-230`).
- Produces (used by Task 4): `MessagesRepo.senderCleanupStats(accountId: string): SenderCleanupStat[]` — grouped by `lower(sender_email)`, ordered `recent_30d DESC, message_count DESC`, `LIMIT 200`.

**Query-shape constraint (verified against the live 1.4 GB DB):** the attachment-bytes aggregation MUST be a separate pre-aggregated `json_each` CTE joined back to the sender CTE (0.6 s). A correlated per-sender subquery is O(n²) and measured 35.9 s — forbidden.

- [ ] **Step 1: Write the failing test**

Create `tests/senderCleanupStats.test.ts`. The isolated-DB harness mirrors `tests/embeddingVectorStore.test.ts` (`canLoadNativeSqlite` guard + `withIsolatedDatabase` that points `HOME` at a temp dir and imports `../main/database` fresh, which runs the real `runMigrations`):

```ts
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { MailMessage, MessageSecurityInsight } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as {
      new (filename: string): { close: () => void };
    };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

let messageSeq = 0;

function message(partial: Partial<MailMessage> = {}): MailMessage {
  messageSeq += 1;
  return {
    id: partial.id || `msg-${messageSeq}`,
    threadId: partial.threadId || `thread-${messageSeq}`,
    accountId: partial.accountId || 'me@example.com',
    senderName: partial.senderName ?? 'Example News',
    senderEmail: partial.senderEmail || 'news@example.com',
    subject: partial.subject || 'Weekly digest',
    snippet: partial.snippet || 'Digest content',
    receivedAt: partial.receivedAt || isoDaysAgo(5),
    labelIds: partial.labelIds || ['INBOX'],
    hasAttachments: partial.hasAttachments ?? false,
    isUnread: partial.isUnread ?? false,
    to: partial.to || [],
    cc: partial.cc || [],
    bcc: partial.bcc || [],
    bodyHtml: partial.bodyHtml ?? null,
    bodyPlain: partial.bodyPlain ?? null,
    attachments: partial.attachments || [],
    headers: partial.headers || [],
    rfcMessageId: null,
    rfcReferences: null,
    rfcInReplyTo: null,
  };
}

function insight(partial: Partial<MessageSecurityInsight> = {}): MessageSecurityInsight {
  return {
    accountId: partial.accountId || 'me@example.com',
    messageId: partial.messageId || 'msg-1',
    threadId: partial.threadId || 'sec-thread',
    riskLevel: partial.riskLevel || 'low',
    warnings: partial.warnings || [],
    trackerCount: partial.trackerCount ?? 0,
    phishingLinkCount: partial.phishingLinkCount ?? 0,
    analyzedAt: partial.analyzedAt || isoDaysAgo(1),
  };
}

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-cleanup-stats-'));
  let databaseModule: typeof import('../main/database') | null = null;

  vi.resetModules();
  process.env.HOME = home;

  try {
    databaseModule = await import('../main/database');
    return await run(databaseModule);
  } finally {
    if (databaseModule) {
      databaseModule.getDatabase().close();
    }
    if (previousHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = previousHome;
    }
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

describe('MessagesRepo.senderCleanupStats', () => {
  repositoryIt('groups senders case-insensitively with counts, unread and the 30-day window', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      const newest = isoDaysAgo(5);
      MessagesRepo.save([
        message({ senderEmail: 'News@Example.COM', threadId: 't1', isUnread: true, receivedAt: newest }),
        message({ senderEmail: 'news@example.com', threadId: 't2', isUnread: false, receivedAt: isoDaysAgo(45) }),
        message({ senderEmail: 'other@example.com', senderName: 'Other', threadId: 't3', receivedAt: isoDaysAgo(1) }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      const news = stats.find(s => s.senderEmail === 'news@example.com');

      expect(news).toMatchObject({
        accountId: 'me@example.com',
        senderEmail: 'news@example.com',
        senderName: 'Example News',
        threadCount: 2,
        messageCount: 2,
        unreadCount: 1,
        recent30dCount: 1,
        hasUnsubscribeHeader: false,
        trackerCount: 0,
        maxRiskLevel: null,
        attachmentBytes: 0,
      });
      expect(news?.lastReceivedAt).toBe(newest);
    });
  });

  repositoryIt('flags unsubscribe-capable senders via the List-Unsubscribe header', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'promo@example.com',
          headers: [{ name: 'List-Unsubscribe', value: '<https://example.com/unsub>, <mailto:unsubscribe@example.com>' }],
        }),
        message({ senderEmail: 'human@example.com', headers: [{ name: 'Reply-To', value: 'human@example.com' }] }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'promo@example.com')?.hasUnsubscribeHeader).toBe(true);
      expect(stats.find(s => s.senderEmail === 'human@example.com')?.hasUnsubscribeHeader).toBe(false);
    });
  });

  repositoryIt('sums tracker counts and takes the max risk level from message_security', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo, MessageSecurityRepo }) => {
      MessagesRepo.save([
        message({ id: 'sec-1', threadId: 'sec-thread', senderEmail: 'promo@example.com' }),
        message({ id: 'sec-2', threadId: 'sec-thread', senderEmail: 'promo@example.com' }),
        message({ id: 'sec-3', threadId: 'plain-thread', senderEmail: 'plain@example.com' }),
      ]);
      MessageSecurityRepo.saveMany([
        insight({ messageId: 'sec-1', trackerCount: 2, riskLevel: 'medium' }),
        insight({ messageId: 'sec-2', trackerCount: 3, riskLevel: 'high' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      const promo = stats.find(s => s.senderEmail === 'promo@example.com');
      expect(promo?.trackerCount).toBe(5);
      expect(promo?.maxRiskLevel).toBe('high');
      expect(stats.find(s => s.senderEmail === 'plain@example.com')?.maxRiskLevel).toBeNull();
    });
  });

  repositoryIt('sums attachment bytes through the pre-aggregated json_each join', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          attachments: [{ id: 'att-1', filename: 'report.pdf', mimeType: 'application/pdf', sizeBytes: 1000 }],
        }),
        message({
          senderEmail: 'files@example.com',
          hasAttachments: true,
          attachments: [
            { id: 'att-2', filename: 'image.png', mimeType: 'image/png', sizeBytes: 2500 },
            { id: 'att-3', filename: 'sheet.xlsx', mimeType: 'application/vnd.ms-excel', sizeBytes: 500 },
          ],
        }),
        message({ senderEmail: 'files@example.com' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.find(s => s.senderEmail === 'files@example.com')?.attachmentBytes).toBe(4000);
    });
  });

  repositoryIt('orders by 30-day volume then message count and caps at 200 senders', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({ senderEmail: 'a@example.com', threadId: 'a1', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'a@example.com', threadId: 'a2', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'b@example.com', threadId: 'b1', receivedAt: isoDaysAgo(1) }),
        message({ senderEmail: 'b@example.com', threadId: 'b2', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'b@example.com', threadId: 'b3', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'c@example.com', threadId: 'c1', receivedAt: isoDaysAgo(2) }),
        message({ senderEmail: 'c@example.com', threadId: 'c2', receivedAt: isoDaysAgo(3) }),
        message({ senderEmail: 'c@example.com', threadId: 'c3', receivedAt: isoDaysAgo(60) }),
        message({ senderEmail: 'c@example.com', threadId: 'c4', receivedAt: isoDaysAgo(90) }),
      ]);

      const ordered = MessagesRepo.senderCleanupStats('me@example.com').map(s => s.senderEmail);
      expect(ordered).toEqual(['b@example.com', 'c@example.com', 'a@example.com']);

      const bulk: MailMessage[] = [];
      for (let index = 0; index < 205; index += 1) {
        bulk.push(message({
          senderEmail: `bulk-${index}@example.com`,
          threadId: `bulk-thread-${index}`,
          receivedAt: isoDaysAgo(2),
        }));
      }
      MessagesRepo.save(bulk);

      expect(MessagesRepo.senderCleanupStats('me@example.com')).toHaveLength(200);
    });
  });

  repositoryIt('scopes results to the requested account', async () => {
    await withIsolatedDatabase(async ({ MessagesRepo }) => {
      MessagesRepo.save([
        message({ accountId: 'me@example.com', senderEmail: 'mine@example.com' }),
        message({ accountId: 'other@account.com', senderEmail: 'theirs@example.com' }),
      ]);

      const stats = MessagesRepo.senderCleanupStats('me@example.com');
      expect(stats.map(s => s.senderEmail)).toEqual(['mine@example.com']);
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/senderCleanupStats.test.ts`
Expected: FAIL — `MessagesRepo.senderCleanupStats is not a function` (tests skip instead if the native module cannot load — that also means implement first, then run on a machine where better-sqlite3 loads; the Mac dev machine loads it).

- [ ] **Step 3: Implement the query**

In `main/repositories.ts`, add `SenderCleanupStat` to the type import block (after `MessageSecurityInsight,` at line 26):

```ts
  MessageSecurityInsight,
  SenderCleanupStat,
} from '../shared/types';
```

Inside `MessagesRepo`, add a comma after the closing brace of `listRecentBySender` (line 525) and append this method before the object's closing `};`:

```ts
  senderCleanupStats(accountId: string): SenderCleanupStat[] {
    const db = getDatabase();
    // NOTE: attachment bytes MUST stay a pre-aggregated json_each JOIN.
    // A correlated per-sender subquery measured 35.9 s vs 0.6 s for this form.
    const rows = db.prepare(`
      WITH sender_stats AS (
        SELECT
          account_id,
          lower(sender_email) AS sender_key,
          MAX(sender_name) AS sender_name,
          COUNT(DISTINCT thread_id) AS thread_count,
          COUNT(*) AS message_count,
          SUM(is_unread) AS unread_count,
          MAX(received_at) AS last_received_at,
          SUM(CASE WHEN received_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-30 days') THEN 1 ELSE 0 END) AS recent_30d,
          MAX(CASE WHEN headers_json LIKE '%list-unsubscribe%' THEN 1 ELSE 0 END) AS has_unsubscribe
        FROM messages
        WHERE account_id = @accountId
        GROUP BY account_id, sender_key
      ),
      att_bytes AS (
        SELECT
          m.account_id,
          lower(m.sender_email) AS sender_key,
          SUM(COALESCE(json_extract(att.value, '$.sizeBytes'), 0)) AS attachment_bytes
        FROM messages m,
          json_each(CASE WHEN json_valid(m.attachments_json) THEN m.attachments_json ELSE '[]' END) att
        WHERE m.account_id = @accountId AND m.has_attachments = 1
        GROUP BY m.account_id, sender_key
      ),
      security AS (
        SELECT
          m.account_id,
          lower(m.sender_email) AS sender_key,
          SUM(s.tracker_count) AS tracker_count,
          MAX(CASE s.risk_level WHEN 'high' THEN 3 WHEN 'medium' THEN 2 WHEN 'low' THEN 1 ELSE 0 END) AS max_risk_rank
        FROM messages m
        JOIN message_security s ON s.account_id = m.account_id AND s.message_id = m.id
        WHERE m.account_id = @accountId
        GROUP BY m.account_id, sender_key
      )
      SELECT
        st.account_id,
        st.sender_key,
        st.sender_name,
        st.thread_count,
        st.message_count,
        st.unread_count,
        st.last_received_at,
        st.recent_30d,
        st.has_unsubscribe,
        COALESCE(sec.tracker_count, 0) AS tracker_count,
        COALESCE(sec.max_risk_rank, 0) AS max_risk_rank,
        COALESCE(ab.attachment_bytes, 0) AS attachment_bytes
      FROM sender_stats st
      LEFT JOIN att_bytes ab ON ab.account_id = st.account_id AND ab.sender_key = st.sender_key
      LEFT JOIN security sec ON sec.account_id = st.account_id AND sec.sender_key = st.sender_key
      ORDER BY st.recent_30d DESC, st.message_count DESC
      LIMIT 200
    `).all({ accountId }) as any[];

    const riskForRank: Record<number, SenderCleanupStat['maxRiskLevel']> = {
      3: 'high',
      2: 'medium',
      1: 'low',
      0: null,
    };

    return rows.map(r => ({
      accountId: r.account_id,
      senderEmail: r.sender_key,
      senderName: r.sender_name || r.sender_key,
      threadCount: r.thread_count,
      messageCount: r.message_count,
      unreadCount: r.unread_count || 0,
      lastReceivedAt: r.last_received_at,
      recent30dCount: r.recent_30d || 0,
      hasUnsubscribeHeader: r.has_unsubscribe === 1,
      trackerCount: r.tracker_count || 0,
      maxRiskLevel: riskForRank[r.max_risk_rank as number] ?? null,
      attachmentBytes: r.attachment_bytes || 0,
    }));
  }
```

Implementation notes:
- `received_at` is ISO-8601, so the 30-day cutoff uses `strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 days')` string comparison — never `datetime()`.
- SQLite `LIKE` is ASCII case-insensitive by default, so `'%list-unsubscribe%'` matches the stored `List-Unsubscribe` header name inside `headers_json`.
- `MAX()` over risk-level strings is lexicographic and wrong (`'medium' > 'low' > 'high'`); the numeric `CASE` rank is required.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/senderCleanupStats.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Type-check**

Run: `npm run build`
Expected: green.

- [ ] **Step 6: Commit**

```bash
git add main/repositories.ts tests/senderCleanupStats.test.ts
git commit -m "feat: add MessagesRepo.senderCleanupStats aggregate query"
```

---

### Task 4: Database worker request type + IPC chain

Mechanical plumbing so the ~0.6 s aggregate never runs on the Electron main event loop. **No new tests:** the worker/client are thin typed pass-throughs around the repo method that Task 3 already tests against a real DB, and the repo precedent (saveMessages/saveThreads) is also untested at the worker layer; `npm run build` is the gate here.

**Files:**
- Modify: `main/databaseWorker.ts:5-7` (request union), `main/databaseWorker.ts:42-56` (handler)
- Modify: `main/databaseWorkerClient.ts:3-7` (imports + payload union), method after `saveThreads` (line 134)
- Modify: `main/index.ts:1348` (register `api:listCleanupSenderStats` after the `api:unsubscribeThread` handler)
- Modify: `main/preload.ts:131` (add `listCleanupSenderStats` after `unsubscribeThread`)
- Modify: `renderer/src/vite-env.d.ts:2-36` (import), `:141` (method after `unsubscribeThread`)

**Interfaces:**
- Consumes (from Task 3): `MessagesRepo.senderCleanupStats(accountId: string): SenderCleanupStat[]`.
- Produces (used by Task 8): `window.electronAPI.listCleanupSenderStats(accountId: string): Promise<SenderCleanupStat[]>`.

- [ ] **Step 1: Extend the worker request union and handler**

In `main/databaseWorker.ts`, replace the `WorkerRequest` type (lines 5-7):

```ts
type WorkerRequest =
  | { id: number; type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean; indexBodies?: boolean }
  | { id: number; type: 'saveThreads'; threads: MailThread[] }
  | { id: number; type: 'senderCleanupStats'; accountId: string };
```

In the same file, inside the `parentPort?.on('message', ...)` handler, insert a branch after the `saveMessages` block (line 49) and before `ThreadsRepo.save(request.threads);`:

```ts
    if (request.type === 'senderCleanupStats') {
      send({ id: request.id, ok: true, result: MessagesRepo.senderCleanupStats(request.accountId) });
      return;
    }
```

- [ ] **Step 2: Extend the worker client**

In `main/databaseWorkerClient.ts`, replace lines 3-7:

```ts
import type { MailMessage, MailThread, SenderCleanupStat } from '../shared/types';

type WorkerPayload =
  | { type: 'saveMessages'; messages: MailMessage[]; notifyOfNew?: boolean; indexBodies?: boolean }
  | { type: 'saveThreads'; threads: MailThread[] }
  | { type: 'senderCleanupStats'; accountId: string };
```

Add a method to `DatabaseWorkerClient` after `saveThreads` (line 134), before `shutdown()`:

```ts
  senderCleanupStats(accountId: string): Promise<SenderCleanupStat[]> {
    return this.request<SenderCleanupStat[]>({ type: 'senderCleanupStats', accountId });
  }
```

- [ ] **Step 3: Register the IPC handler**

In `main/index.ts`, directly after the closing `});` of the `api:unsubscribeThread` handler (line 1348), add:

```ts
registerSecureHandler('api:listCleanupSenderStats', (_, accountId: string) => databaseWorkerClient.senderCleanupStats(accountId));
```

- [ ] **Step 4: Expose it in preload**

In `main/preload.ts`, directly after the `unsubscribeThread` line (line 131), add:

```ts
  listCleanupSenderStats: (accountId: string) => ipcRenderer.invoke('api:listCleanupSenderStats', accountId),
```

- [ ] **Step 5: Type the renderer surface**

In `renderer/src/vite-env.d.ts`, add `SenderCleanupStat` to the import block from `'../../shared/types'` (after `SemanticSearchOutcome,` at line 34):

```ts
  SemanticSearchOutcome,
  SenderCleanupStat,
  ThreadAgentInsights
```

and directly after the `unsubscribeThread` entry (line 141), add:

```ts
  listCleanupSenderStats: (accountId: string) => Promise<SenderCleanupStat[]>;
```

- [ ] **Step 6: Type-check and run the existing suites**

Run: `npm run build`
Expected: green.
Run: `npx vitest run tests/senderCleanupStats.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 7: Commit**

```bash
git add main/databaseWorker.ts main/databaseWorkerClient.ts main/index.ts main/preload.ts renderer/src/vite-env.d.ts
git commit -m "feat: expose cleanup sender stats through database worker and IPC"
```

---

### Task 5: Bug A merge fix + Bug B dead-surface removal

Bug A: `runAITriagePlan` replaces the whole Agent Review Queue via `setAgentPlan(reviewPlan)` (`renderer/src/stores/useAIState.ts:759`) and resets the selection, silently discarding briefing-added/manual items. Fix: fold every rebuilt item through `mergeAgentPlanItem` and union auto-selected ids into the existing selection.

Bug B: `renderer/src/components/AITriagePlanCard.tsx` (203 lines) is imported nowhere (verified: `grep -rn AITriagePlanCard` hits only its own file). Its entire supporting surface in `useAIState.ts` / `AppStore.tsx` is dead except `triagePlan`/`setTriagePlan`, which stay (still written by `runAITriagePlan` and read by the `AICopilotPanel.tsx:190-193` scroll effect).

**Files:**
- Modify: `renderer/src/stores/useAIState.ts:2` (imports), `:88` (state), `:235-369` (legacy functions), `:694-767` (`runAITriagePlan`), `:837-884` (hook return)
- Modify: `renderer/src/stores/AppStore.tsx:27-39` (imports), `:480-495` (context type)
- Delete: `renderer/src/components/AITriagePlanCard.tsx`
- Modify: `shared/types.ts:926-944` (remove `MailTriageActionPreview`, `MailTriageQueueReadiness` — only after the grep in Step 7 confirms zero remaining consumers)
- Test: `tests/agentPlan.test.ts` (extend)

**Interfaces:**
- Consumes: `mergeAgentPlanItem(plan: AgentPlan | null, item: AgentPlanItem): AgentPlan` (`shared/agentPlan.ts:247-279`, already imported in `useAIState.ts:10`).
- Produces: additive-queue semantics that Task 8 relies on (a Cleanup item merged before/after a triage run survives it). Removes from the store surface: `selectedTriageThreadIds`, `toggleTriagePlanItemSelection`, `selectAllApplicableTriagePlanItems`, `clearTriagePlanSelection`, `applySelectedTriagePlanItems`, `applyTriagePlanItem`, `triageQueueReadiness`, `triageActionPreview`. **Keeps:** `triagePlan`, `setTriagePlan`.

- [ ] **Step 1: Write the pure-level Bug A regression test**

Append inside `describe('Agent Plan builders', ...)` in `tests/agentPlan.test.ts` (add `AgentPlan` to the type import from `'../shared/types'`):

```ts
  it('preserves pre-existing items when a triage plan is folded in item-by-item (Bug A regression)', () => {
    const briefingPlan = buildAgentPlanFromDailyBriefingItem({ briefing, item: briefingItem });
    const triageReviewPlan = buildAgentPlanFromTriagePlan({
      plan: triagePlan,
      threads: [thread],
      aiAssisted: false,
    });

    // This is exactly the fold runAITriagePlan must use instead of replacing the plan.
    const merged = triageReviewPlan.items.reduce<AgentPlan | null>(
      (acc, item) => mergeAgentPlanItem(acc, item),
      briefingPlan,
    );

    expect(merged?.items.map(item => item.id)).toContain(briefingPlan.items[0].id);
    expect(merged?.items).toHaveLength(2);
    expect(merged?.coverage.proposedActionCount).toBe(2);
  });
```

- [ ] **Step 2: Run it**

Run: `npx vitest run tests/agentPlan.test.ts`
Expected: PASS immediately — `mergeAgentPlanItem` already implements additive semantics. This test does not reproduce the store bug (the bug lives in a React hook with no render harness in this repo); it locks the exact fold expression the store fix adopts, so a future regression in merge semantics fails here.

- [ ] **Step 3: Fix `runAITriagePlan` (Bug A)**

In `renderer/src/stores/useAIState.ts`, replace lines 751-764:

```ts
    const defaultSelected = new Set(
      plan.items
        .filter(item => item.recommendation === 'readNow' || item.recommendation === 'setReminder')
        .map(item => item.threadId)
    );
    setSelectedTriageThreadIds(defaultSelected);
    setTriagePlan(plan);
    const reviewPlan = buildAgentPlanFromTriagePlan({ plan, threads: visibleThreads, aiAssisted: usedAI });
    setAgentPlan(reviewPlan);
    setSelectedAgentPlanItemIds(new Set(
      reviewPlan.items
        .filter(item => item.selectionPolicy === 'autoSelected')
        .map(item => item.id)
    ));
```

with:

```ts
    setTriagePlan(plan);
    const reviewPlan = buildAgentPlanFromTriagePlan({ plan, threads: visibleThreads, aiAssisted: usedAI });
    setAgentPlan(prev => reviewPlan.items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      for (const item of reviewPlan.items) {
        if (item.selectionPolicy === 'autoSelected') next.add(item.id);
      }
      return next;
    });
```

(The `setSelectedTriageThreadIds` call is removed here because Step 5 deletes that state entirely.)

- [ ] **Step 4: Delete the dead card**

```bash
git rm renderer/src/components/AITriagePlanCard.tsx
```

- [ ] **Step 5: Prune the legacy surface from `useAIState.ts`**

All removals in `renderer/src/stores/useAIState.ts` (current line anchors, top to bottom — work bottom-up so anchors stay valid):

1. Hook return block (lines 837-884): delete these entries — `selectedTriageThreadIds,`, `setSelectedTriageThreadIds,`, `triageQueueReadiness,`, `triageActionPreview,`, `toggleTriagePlanItemSelection,`, `selectAllApplicableTriagePlanItems,`, `clearTriagePlanSelection,`, `applySelectedTriagePlanItems,`, `applyTriagePlanItem,`. **Keep** `triagePlan,`, `setTriagePlan,` and every `agentPlan*` entry. The return block becomes:

```ts
  return {
    aiPanelOpen,
    setAiPanelOpen,
    aiProvider,
    setAiProvider,
    aiProviderDesc,
    aiConversations,
    activeAIConversation,
    activeAIMessages,
    triagePlan,
    setTriagePlan,
    agentPlan,
    setAgentPlan,
    dailyBriefing,
    setDailyBriefing,
    dailyBriefingLoading,
    aiPanelLoading,
    aiModel,
    setAiModel,
    selectedAgentPlanItemIds,
    agentPlanQueueReadiness,
    agentPlanActionPreview,
    startNewAIConversation,
    selectAIConversation,
    sendAIMessage,
    runAIAction,
    runAIPromptShortcut,
    runAITriagePlan,
    runDailyBriefing,
    dismissDailyBriefingItem,
    addDailyBriefingItemToAgentPlan,
    toggleAgentPlanItemSelection,
    selectAllApplicableAgentPlanItems,
    clearAgentPlanSelection,
    applySelectedAgentPlanItems,
    applyAgentPlanItem,
    rejectAgentPlanItem,
    loadAIConversations
  };
```

2. Delete the legacy function block, lines 235-369 in one contiguous cut: `triageActionPreview` (235-266), `triageQueueReadiness` IIFE (268-299), `toggleTriagePlanItemSelection` (301-311), `selectAllApplicableTriagePlanItems` (313-319), `clearTriagePlanSelection` (321-323), `applyTriagePlanItem` (325-354), `applySelectedTriagePlanItems` (356-369).

3. Delete the state line 88: `const [selectedTriageThreadIds, setSelectedTriageThreadIds] = useState<Set<string>>(new Set());`

4. Trim the type import on line 2: remove `MailTriagePlanItem` and `MailTriageActionPreview` (no longer referenced); **keep** `MailTriagePlan`.

- [ ] **Step 6: Prune `AppStoreContextType` in `AppStore.tsx`**

In `renderer/src/stores/AppStore.tsx`:

1. Delete these interface entries (current anchors 480-481, 485-488, 494-495):

```ts
  selectedTriageThreadIds: Set<string>;
  toggleTriagePlanItemSelection: (threadId: string) => void;
```
```ts
  selectAllApplicableTriagePlanItems: () => void;
  clearTriagePlanSelection: () => void;
  applySelectedTriagePlanItems: () => Promise<void>;
  applyTriagePlanItem: (item: MailTriagePlanItem, queuedActionLog?: any) => Promise<void>;
```
```ts
  triageQueueReadiness: MailTriageQueueReadiness | null;
  triageActionPreview: (item: MailTriagePlanItem) => MailTriageActionPreview;
```

**Keep** `triagePlan: MailTriagePlan | null;` and `setTriagePlan: ...` (lines 451-452) and every `agentPlan*` / `selectedAgentPlanItemIds` entry.

2. Remove the now-unused imports from the `'../../../shared/types'` block: `MailTriageActionPreview` (line 27), `MailTriagePlanItem` (line 28), `MailTriageQueueReadiness` (line 39). **Keep** `MailTriagePlan` (line 29).

- [ ] **Step 7: Grep-verify and remove the dead shared types**

Run:

```bash
grep -rn "MailTriageActionPreview\|MailTriageQueueReadiness" \
  --include="*.ts" --include="*.tsx" \
  shared main renderer tests
```

Expected output: hits only in `shared/types.ts` (the definitions at 928-935 and 937-944). If any other consumer appears, fix it first and re-run. Then delete from `shared/types.ts` the block (lines 926-944):

```ts
// === Triage action preview structures ===

export interface MailTriageActionPreview {
  threadId: string;
  recommendation: TriageRecommendation;
  isSelected: boolean;
  eligibility: 'ready' | 'requiresRemoteGmailCredential' | 'requiresReconnect' | 'remoteUnavailable' | 'remoteUnknown' | 'focusOnly';
  scope: 'gmail' | 'local' | 'focus';
  selectionPolicy: 'autoSelected' | 'explicitOptIn' | 'previewOnly';
}

export interface MailTriageQueueReadiness {
  summary: string;
  level: 'ready' | 'warning';
  executableActionCount: number;
  blockedActionCount: number;
  canApplySelected: boolean;
  applyButtonTitle: string;
}
```

- [ ] **Step 8: Validate**

Run: `npm run build`
Expected: green — tsc is the safety net that catches any missed consumer of the removed surface.
Run: `npm test`
Expected: all suites pass (the earlier grep of `tests/` confirmed no test imports the removed surface).

- [ ] **Step 9: Commit**

```bash
git add -A shared/types.ts renderer/src/stores/useAIState.ts renderer/src/stores/AppStore.tsx renderer/src/components/AITriagePlanCard.tsx tests/agentPlan.test.ts
git commit -m "fix: merge triage plans into agent review queue and drop dead triage surface"
```

---

### Task 6: `unsubscribe` apply path + `addAgentPlanItems` store helper

Wires the new action kind through the store: `applyAgentPlanItem` dispatches `unsubscribe` through `executeMailAction`'s `customAction` contract exactly like the existing `unsubscribeThread` store action does (`renderer/src/stores/useMailState.ts:1098-1110`: `executeMailAction('unsubscribeSender', threadId, null, async (actionId) => window.electronAPI.unsubscribeThread(...))`). The `api:unsubscribeThread` handler (`main/index.ts:1310-1348`) accepts the `actionId` and owns its own action-ledger row updates (running → completed/failed), so the renderer must pass `actionId` through and not double-write remote state. Also adds the generic `addAgentPlanItems` helper that `CleanupPanel` (Task 8) uses to merge items additively and open the AI panel.

**No new tests:** `applyAgentPlanItem` / `addAgentPlanItems` are React-hook glue over `executeMailAction` and `mergeAgentPlanItem`, both already covered (merge semantics in `tests/agentPlan.test.ts`; ledger flow by the reconciler suites). This repo has no React render-test harness. `npm run build` gates the wiring.

**Files:**
- Modify: `renderer/src/stores/useAIState.ts` — `agentPlanActionPreview` scope ternary (was `:371-401`, shifted up ~135 lines after Task 5; locate by name), `applyAgentPlanItem` dispatch chain (was `:500-560`; locate by name), new `addAgentPlanItems` after `addDailyBriefingItemToAgentPlan` (was `:574-585`), hook return block
- Modify: `renderer/src/stores/AppStore.tsx:450` (context type entry after `addDailyBriefingItemToAgentPlan`)

**Interfaces:**
- Consumes: `AgentPlanItem` with `action: 'unsubscribe'` (Task 1/2), `window.electronAPI.unsubscribeThread(email, threadId, actionId?)` (`main/preload.ts:131`), `executeMailAction` (`AppStore.tsx:403` signature), `mergeAgentPlanItem`.
- Produces (used by Task 8): `addAgentPlanItems(items: AgentPlanItem[]): void` on the store — merges every item via `mergeAgentPlanItem`, auto-selects `autoSelected` items, opens the AI panel.

- [ ] **Step 1: Treat `unsubscribe` as gmail scope in `agentPlanActionPreview`**

In `renderer/src/stores/useAIState.ts`, in `agentPlanActionPreview`, replace the scope ternary:

```ts
    const scope: AgentPlanActionPreview['scope'] =
      item.action === 'markRead' || item.action === 'archive' || item.action === 'applyLabel'
        ? 'gmail'
        : item.action === 'openThread'
          ? 'focus'
          : 'local';
```

with:

```ts
    const scope: AgentPlanActionPreview['scope'] =
      item.action === 'markRead' || item.action === 'archive' || item.action === 'applyLabel' || item.action === 'unsubscribe'
        ? 'gmail'
        : item.action === 'openThread'
          ? 'focus'
          : 'local';
```

(gmail scope means eligibility becomes `requiresReconnect` without valid credentials — the C7 rule.)

- [ ] **Step 2: Add the `unsubscribe` dispatch branch to `applyAgentPlanItem`**

In the same file, in `applyAgentPlanItem`, insert a branch between the `applyLabel` branch and the `draftReply` branch:

```ts
    } else if (item.action === 'unsubscribe') {
      await executeMailAction(
        'unsubscribeSender',
        item.threadId,
        null,
        async (actionId: string) => window.electronAPI.unsubscribeThread(item.accountId, item.threadId, actionId),
        payloadForAgentPlanItem(item, { accountId: item.accountId })
      );
```

Notes:
- The handler already archives the thread remotely and writes its own ledger rows keyed by `actionId`; `executeMailAction`'s `unsubscribeSender` optimistic branch (`useMailState.ts:810-823`) removes INBOX locally first.
- The `{ accountId: item.accountId }` payload extra lets `executeMailAction` resolve the correct account in unified view (it reads `payload.accountId` at `useMailState.ts:688-694`); `DailyBriefingCard.payloadFor` sets the same field.
- If the handler finds no safe method it throws (`main/agentic.ts:822-823` — `No safe unsubscribe method found for this thread.`); `executeMailAction` marks the action failed and reloads threads. Task 8 minimizes this path by only building items from candidates with a non-null `recommendedMethod`.

- [ ] **Step 3: Add `addAgentPlanItems`**

In the same file, directly after `addDailyBriefingItemToAgentPlan` (ends with `emitToast({ type: 'success', message: 'Added to Agent Review Queue.' });` + closing lines), add:

```ts
  const addAgentPlanItems = (items: AgentPlanItem[]) => {
    if (items.length === 0) return;
    setAgentPlan(prev => items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      for (const item of items) {
        if (item.selectionPolicy === 'autoSelected') next.add(item.id);
      }
      return next;
    });
    setAiPanelOpen(true);
  };
```

Add `addAgentPlanItems,` to the hook's return block, directly after `addDailyBriefingItemToAgentPlan,`.

- [ ] **Step 4: Type the store entry**

In `renderer/src/stores/AppStore.tsx`, directly after the `addDailyBriefingItemToAgentPlan` interface entry (line 450), add:

```ts
  addAgentPlanItems: (items: AgentPlanItem[]) => void;
```

(`AgentPlanItem` is already imported at line 31.)

- [ ] **Step 5: Validate**

Run: `npm run build`
Expected: green.
Run: `npx vitest run tests/agentPlan.test.ts tests/cleanup.test.ts`
Expected: PASS (unchanged).

- [ ] **Step 6: Commit**

```bash
git add renderer/src/stores/useAIState.ts renderer/src/stores/AppStore.tsx
git commit -m "feat: wire unsubscribe action kind through agent review queue"
```

---

### Task 7: `cleanupOpen` store state, LeftRail button, close-on-nav

Adds the Settings-pattern boolean and every navigation-close site. **The `<CleanupPanel />` mount in `App.tsx` happens in Task 8** (the component does not exist yet; mounting it here would break the build). With this task alone, the Eraser button toggles state that nothing renders yet — that is expected and safe.

**No new tests:** pure JSX/state wiring with no logic to unit-test (this repo has no React render-test harness); `npm run build` gates it.

**Files:**
- Modify: `renderer/src/stores/useSettingsState.ts:14` (state), `:486,495` (return entries)
- Modify: `renderer/src/stores/AppStore.tsx:460` (context type entries after `setSettingsOpen`)
- Modify: `renderer/src/components/layout/LeftRail.tsx:1,16,39,82-88` (icon import, close-on-account-switch, Settings button, new Cleanup button)
- Modify: `renderer/src/App.tsx:807-809,848` (mailbox menu + split tab close sites)
- Modify: `renderer/src/hooks/useKeyboard.ts:118,133,141,157,166` (five nav close sites)

**Interfaces:**
- Consumes: nothing new.
- Produces (used by Task 8): `cleanupOpen: boolean` and `setCleanupOpen(open: boolean): void` on the store (flow into the store automatically via the existing `...settingsState` spread at `AppStore.tsx:907`).

- [ ] **Step 1: Add the state to `useSettingsState`**

In `renderer/src/stores/useSettingsState.ts`, after line 14 (`const [settingsOpen, setSettingsOpen] = useState<boolean>(false);`), add:

```ts
  const [cleanupOpen, setCleanupOpen] = useState<boolean>(false);
```

In the hook's return object, add `cleanupOpen,` after `settingsOpen,` (line 486) and `setCleanupOpen,` after `setSettingsOpen,` (line 495).

- [ ] **Step 2: Type the store entries**

In `renderer/src/stores/AppStore.tsx`, after line 460 (`setSettingsOpen: (open: boolean) => void;`), add:

```ts
  cleanupOpen: boolean;
  setCleanupOpen: (open: boolean) => void;
```

- [ ] **Step 3: LeftRail — close sites and the Cleanup button**

In `renderer/src/components/layout/LeftRail.tsx`:

1. Replace line 1:

```ts
import { Inbox, Plus, Sun, Moon, Monitor, Settings, Sparkles } from 'lucide-react';
```

with:

```ts
import { Eraser, Inbox, Plus, Sun, Moon, Monitor, Settings, Sparkles } from 'lucide-react';
```

2. In the Unified Inbox button handler (line 16) and the per-account button handler (line 39), add `store.setCleanupOpen(false);` directly after each `store.setSettingsOpen(false);`:

```ts
              onClick={() => {
                store.setActiveAccount(UNIFIED_ACCOUNT);
                store.setSettingsOpen(false);
                store.setCleanupOpen(false);
              }}
```

```ts
            onClick={() => {
              store.setActiveAccount(acc);
              store.setSettingsOpen(false);
              store.setCleanupOpen(false);
            }}
```

3. Replace the Settings button (lines 82-88) with a Cleanup button + a Settings button that also closes cleanup (so re-opening Settings never leaves a hidden Cleanup pane to resurface):

```tsx
        <button
          onClick={() => {
            store.setCleanupOpen(!store.cleanupOpen);
            store.setSettingsOpen(false);
          }}
          title="Privacy & Cleanup"
          className={`cursor-pointer ${store.cleanupOpen ? 'text-[var(--accent)] scale-110' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Eraser className="w-4.5 h-4.5" />
        </button>
        <button
          onClick={() => {
            store.setSettingsOpen(!store.settingsOpen);
            store.setCleanupOpen(false);
          }}
          title="Settings"
          className={`cursor-pointer ${store.settingsOpen ? 'text-[var(--accent)] scale-110' : 'text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          <Settings className="w-4.5 h-4.5" />
        </button>
```

- [ ] **Step 4: App.tsx nav close sites**

In `renderer/src/App.tsx`:

1. Mailbox dropdown item handler (lines 806-810) — add the cleanup close:

```ts
                            onClick={() => {
                              store.setMailboxView(mailbox.id);
                              store.setSettingsOpen(false);
                              store.setCleanupOpen(false);
                              setMailboxMenuOpen(false);
                            }}
```

2. Split tab click handler (lines 846-849):

```ts
                          onClick={() => {
                            store.setActiveSplit(category.id);
                            store.setSettingsOpen(false);
                            store.setCleanupOpen(false);
                          }}
```

- [ ] **Step 5: useKeyboard nav close sites**

In `renderer/src/hooks/useKeyboard.ts`, add `currentStore.setCleanupOpen(false);` directly after each of the five `currentStore.setSettingsOpen(false);` calls — verify current anchors first with:

```bash
grep -n "setSettingsOpen(false)" renderer/src/hooks/useKeyboard.ts
```

Expected five hits (currently lines 118, 133, 141, 157, 166): Cmd+1-9 account switch, Cmd+0 unified toggle, G/Shift+G mailbox cycle, unmodified 1-9 split switch, `/` search focus. Example (account switch):

```ts
        if (currentStore.accounts[idx]) {
          currentStore.setActiveAccount(currentStore.accounts[idx]);
          currentStore.setSettingsOpen(false);
          currentStore.setCleanupOpen(false);
        }
```

Apply the same one-line addition at all five sites. (The `setSettingsOpen(true)` site at line ~299 needs no change — the Task 8 ternary renders Settings above Cleanup.)

- [ ] **Step 6: Validate**

Run: `npm run build`
Expected: green.

- [ ] **Step 7: Commit**

```bash
git add renderer/src/stores/useSettingsState.ts renderer/src/stores/AppStore.tsx renderer/src/components/layout/LeftRail.tsx renderer/src/App.tsx renderer/src/hooks/useKeyboard.ts
git commit -m "feat: add cleanup pane store state and navigation wiring"
```

---

### Task 8: `CleanupPanel` component, App mount, full validation

The pane itself. Loads stats per account over IPC, renders sender rows with badges and the two dry-run actions, and merges built items into the Agent Review Queue via `addAgentPlanItems` (Task 6). Follows the repo's Tailwind CSS-variable conventions (`var(--border)`, `var(--panel-bg)`, `calc(NNpx*var(--font-scale))` — same vocabulary as `DailyBriefingCard.tsx` / `AgentReviewQueueCard.tsx`; full-pane shell like `SettingsPanel`).

Behavior decisions locked here (spec-conformant interpretations):
- **Archive-old candidates** come from the already-loaded `store.threads` (no new IPC): same account, same lower-cased `senderEmail`, `!isUnread`, currently carrying an `INBOX` label (archiving a non-inbox thread is a no-op), `lastMessageAt` older than 30 days; sorted oldest-first; capped at `CLEANUP_ARCHIVE_BATCH_LIMIT`.
- **Unsubscribe resolution** probes the sender's newest threads (up to 5) via `listMessagesForThread`, scanning messages newest-first with `parseUnsubscribeCandidate`; only a candidate with a non-null `recommendedMethod` is usable (the main-process handler throws otherwise — `main/agentic.ts:822-823`).
- Unified view renders per-account sections; single-account view renders one section without a heading.

**Files:**
- Create: `renderer/src/components/CleanupPanel.tsx`
- Modify: `renderer/src/App.tsx:15` (import), `:911-914` (ternary mount)
- Test: full-suite validation (`npm run build` + `npm test`); the panel's logic lives in already-tested pure modules (`shared/cleanup.ts`, `shared/agentPlan.ts`, `shared/mailSecurity.ts`, repo query) — the component itself is JSX orchestration with no render-test harness in this repo.

**Interfaces:**
- Consumes: `window.electronAPI.listCleanupSenderStats(accountId): Promise<SenderCleanupStat[]>` (Task 4); `suggestCleanupAction`, `CLEANUP_ARCHIVE_BATCH_LIMIT`, `CleanupSuggestedAction` (Task 1); `buildCleanupArchiveItem`, `buildCleanupUnsubscribeItem` (Task 2); `store.addAgentPlanItems(items)` (Task 6); `store.cleanupOpen` / `store.setCleanupOpen` (Task 7); `parseUnsubscribeCandidate` (`shared/mailSecurity.ts:213`); `window.electronAPI.listMessagesForThread` (`vite-env.d.ts:53`).
- Produces: `export function CleanupPanel(): JSX.Element` mounted in the App ternary.

- [ ] **Step 1: Create `renderer/src/components/CleanupPanel.tsx`**

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Eraser, MailMinus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { MailThread, SenderCleanupStat } from '../../../shared/types';
import { CLEANUP_ARCHIVE_BATCH_LIMIT, suggestCleanupAction, type CleanupSuggestedAction } from '../../../shared/cleanup';
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../../../shared/agentPlan';
import { parseUnsubscribeCandidate } from '../../../shared/mailSecurity';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';

const PRIVACY_NOTE = 'Computed locally from your cached mail. Nothing leaves your machine until you approve an action.';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const UNSUBSCRIBE_THREAD_PROBE_LIMIT = 5;

const RISK_TONE: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
  medium: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]',
  high: 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]',
};

const SUGGESTION_META: Record<Exclude<CleanupSuggestedAction, 'none'>, { label: string; tone: string }> = {
  review: { label: 'Review', tone: 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]' },
  unsubscribe: { label: 'Unsubscribe', tone: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]' },
  archiveOld: { label: 'Archive old', tone: 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]' },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function archiveCandidatesFor(stat: SenderCleanupStat, threads: MailThread[]): MailThread[] {
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return threads
    .filter(thread =>
      thread.accountId === stat.accountId &&
      thread.senderEmail.toLowerCase() === stat.senderEmail &&
      !thread.isUnread &&
      thread.labelIds.some(label => label.toUpperCase() === 'INBOX') &&
      Date.parse(thread.lastMessageAt) < cutoff
    )
    .sort((a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt))
    .slice(0, CLEANUP_ARCHIVE_BATCH_LIMIT);
}

export function CleanupPanel() {
  const store = useAppStore();
  const [stats, setStats] = useState<SenderCleanupStat[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [unsubscribeBusyKey, setUnsubscribeBusyKey] = useState<string | null>(null);

  const accountsToLoad = useMemo(() => {
    if (!store.activeAccount) return [];
    if (store.activeAccount.id === 'unified') return store.accounts.filter(acc => acc.email);
    return [store.activeAccount];
  }, [store.activeAccount, store.accounts]);

  const loadStats = useCallback(async () => {
    if (accountsToLoad.length === 0) {
      setStats([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        accountsToLoad.map(acc => window.electronAPI.listCleanupSenderStats(acc.email))
      );
      setStats(results.flat());
    } catch (err) {
      console.error('Cleanup sender stats failed:', err);
      setStats(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accountsToLoad]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  const handleArchiveOld = (stat: SenderCleanupStat) => {
    const candidates = archiveCandidatesFor(stat, store.threads);
    if (candidates.length === 0) {
      emitToast({ type: 'info', message: 'No read threads older than 30 days for this sender in the local cache.' });
      return;
    }
    store.addAgentPlanItems(candidates.map(thread => buildCleanupArchiveItem({ stat, thread })));
    emitToast({
      type: 'success',
      message: `${candidates.length} action${candidates.length === 1 ? '' : 's'} added to review queue.`,
    });
  };

  const handleUnsubscribe = async (stat: SenderCleanupStat) => {
    const busyKey = `${stat.accountId}:${stat.senderEmail}`;
    setUnsubscribeBusyKey(busyKey);
    try {
      const senderThreads = store.threads
        .filter(thread => thread.accountId === stat.accountId && thread.senderEmail.toLowerCase() === stat.senderEmail)
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
        .slice(0, UNSUBSCRIBE_THREAD_PROBE_LIMIT);

      for (const thread of senderThreads) {
        const messages = await window.electronAPI.listMessagesForThread(stat.accountId, thread.id);
        const newestFirst = [...messages].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
        for (const sourceMessage of newestFirst) {
          const candidate = parseUnsubscribeCandidate(sourceMessage);
          if (candidate?.recommendedMethod) {
            store.addAgentPlanItems([buildCleanupUnsubscribeItem({ stat, candidate })]);
            emitToast({ type: 'success', message: '1 action added to review queue.' });
            return;
          }
        }
      }
      emitToast({ type: 'warning', message: 'No usable unsubscribe method found for this sender.' });
    } catch (err) {
      console.error('Unsubscribe candidate resolution failed:', err);
      emitToast({ type: 'error', message: 'Could not resolve an unsubscribe method for this sender.' });
    } finally {
      setUnsubscribeBusyKey(null);
    }
  };

  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-bg)] h-full overflow-hidden select-none text-[calc(11px*var(--font-scale))]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] text-[calc(13px*var(--font-scale))]">
            <Eraser className="h-4 w-4 text-[var(--accent)]" /> Privacy &amp; Cleanup
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{PRIVACY_NOTE}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={loading}
            title="Refresh stats"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => store.setCleanupOpen(false)}
            title="Close cleanup"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {loading && stats === null && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Computing sender stats from the local cache…
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
            <span>Could not compute sender stats: {error}</span>
            <button
              type="button"
              onClick={() => void loadStats()}
              className="rounded border border-[var(--danger)]/40 px-2 py-1 font-semibold hover:bg-[var(--danger)]/15"
            >
              Retry
            </button>
          </div>
        )}

        {!error && stats !== null && accountsToLoad.length === 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Connect a Gmail account to see cleanup stats.
          </div>
        )}

        {!error && stats !== null && accountsToLoad.map(acc => {
          const accountStats = stats.filter(stat => stat.accountId === acc.email);
          return (
            <section key={acc.email} className="flex flex-col gap-2">
              {accountsToLoad.length > 1 && (
                <h3 className="text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {acc.email}
                </h3>
              )}

              {accountStats.length === 0 ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  No sender activity in the local cache yet.
                </div>
              ) : accountStats.map(stat => {
                const archiveCandidates = archiveCandidatesFor(stat, store.threads);
                const suggestion = suggestCleanupAction(stat);
                const busyKey = `${stat.accountId}:${stat.senderEmail}`;

                return (
                  <article key={busyKey} className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="truncate font-semibold text-[var(--text-primary)]">
                          {stat.senderName || stat.senderEmail}
                        </span>
                        <span className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                          {stat.senderEmail}
                        </span>
                      </div>
                      {suggestion !== 'none' && (
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[calc(8px*var(--font-scale))] font-semibold uppercase ${SUGGESTION_META[suggestion].tone}`}>
                          {SUGGESTION_META[suggestion].label}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                      <span>{stat.messageCount} message{stat.messageCount === 1 ? '' : 's'}</span>
                      <span>{stat.recent30dCount}/30d</span>
                      <span>{stat.unreadCount} unread</span>
                      <span>Last activity {formatDate(stat.lastReceivedAt)}</span>
                      {stat.attachmentBytes > 0 && <span>{formatBytes(stat.attachmentBytes)} attachments</span>}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {stat.trackerCount > 0 && (
                        <span className="flex items-center gap-1 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--warning)]">
                          <ShieldAlert className="h-3 w-3" /> {stat.trackerCount} tracker{stat.trackerCount === 1 ? '' : 's'} among analyzed
                        </span>
                      )}
                      {stat.maxRiskLevel && (
                        <span className={`rounded border px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] font-semibold uppercase ${RISK_TONE[stat.maxRiskLevel]}`}>
                          {stat.maxRiskLevel} risk
                        </span>
                      )}
                      {stat.hasUnsubscribeHeader && (
                        <span className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                          Unsubscribe available
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={archiveCandidates.length === 0}
                        onClick={() => handleArchiveOld(stat)}
                        title={`Add up to ${CLEANUP_ARCHIVE_BATCH_LIMIT} archive proposals to the review queue`}
                        className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Archive className="h-3 w-3" /> Archive old ({archiveCandidates.length})
                      </button>
                      <button
                        type="button"
                        disabled={!stat.hasUnsubscribeHeader || unsubscribeBusyKey === busyKey}
                        onClick={() => void handleUnsubscribe(stat)}
                        title="Add an unsubscribe proposal to the review queue"
                        className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MailMinus className="h-3 w-3" /> {unsubscribeBusyKey === busyKey ? 'Resolving…' : 'Unsubscribe'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Mount it in App.tsx**

In `renderer/src/App.tsx`, after the `SettingsPanel` import (line 15), add:

```ts
import { CleanupPanel } from './components/CleanupPanel';
```

Replace the workspace ternary (lines 911-914):

```tsx
            <div className="flex flex-1 overflow-hidden">
              {store.settingsOpen ? (
                <SettingsPanel />
              ) : (
```

with:

```tsx
            <div className="flex flex-1 overflow-hidden">
              {store.settingsOpen ? (
                <SettingsPanel />
              ) : store.cleanupOpen ? (
                <CleanupPanel />
              ) : (
```

(The closing side of the ternary is unchanged — the new branch reuses the existing `)}` structure because it inserts a nested ternary, not a new JSX block.)

- [ ] **Step 3: Full validation**

Run: `npm run build`
Expected: green (tsc + vite).
Run: `npm test`
Expected: all suites pass, including `tests/cleanup.test.ts`, `tests/senderCleanupStats.test.ts`, `tests/agentPlan.test.ts`.

- [ ] **Step 4: Commit**

```bash
git add renderer/src/components/CleanupPanel.tsx renderer/src/App.tsx
git commit -m "feat: add Privacy & Cleanup panel"
```

---

## Post-plan checks (not tasks)

- **Whole-branch review:** run the delegated domain review over the full `feature/cleanup-center` diff (renderer + main + shared) per the review loop; the unsubscribe path also touches remote actions, so include a security pass over the new IPC channel and the unsubscribe dispatch.
- **Manual visual smoke is deferred to the user** (same as the search branch): open the pane via the Eraser rail button, check loading/error/empty states, run one Archive-old batch and one Unsubscribe through the Agent Review Queue, verify close-on-nav (G-cycle, Cmd+0, split tabs, `/`).
- **Known product boundary:** stats cover the **local cache only** (initial sync + incremental + backfilled pages), not the whole Gmail account — the panel's privacy line is honest about the source, and "trackers among analyzed" reflects partial security-analysis coverage by design.
- Bug A's store-level behavior (queue survives a triage rerun) is locked at the pure level only; if a React render harness ever lands, add a hook-level test.

## Spec coverage map

| Spec item | Where in this plan |
| --- | --- |
| C1 surface: store boolean + Settings-pattern ternary + LeftRail button, not a MailboxView | Task 7 (state, rail, close-on-nav), Task 8 Step 2 (ternary mount) |
| C2 stats on the database worker, exposed as `api:listCleanupSenderStats` | Task 3 (query), Task 4 (worker + IPC chain) |
| C3 unsubscribe flag via `headers_json LIKE '%list-unsubscribe%'` | Task 3 Step 3 (`has_unsubscribe` in `sender_stats`), tested in Task 3 Step 1 |
| C4 tracker counts via `message_security` LEFT JOIN, "among analyzed" label | Task 3 (`security` CTE), Task 8 row badge copy |
| C5 `suggestCleanupAction` rules + precedence | Task 1 (`shared/cleanup.ts` + rule-matrix tests) |
| C6 dry-run actions merge into the Agent Review Queue; archive batch capped at 25; unsubscribe manualOnly/high | Task 2 (builders), Task 6 (`addAgentPlanItems`), Task 8 (row handlers, `CLEANUP_ARCHIVE_BATCH_LIMIT` cap) |
| C7 `AgentPlanActionKind` += `'unsubscribe'`; card label/icon/description; apply dispatch; gmail scope eligibility | Task 1 (union + card entries), Task 6 (dispatch + preview scope) |
| C8 privacy line + method summary in `citation.evidence` resolved at build time via `parseUnsubscribeCandidate` | Task 1/8 (`PRIVACY_NOTE` verbatim), Task 2 (`describeUnsubscribeMethod`), Task 8 (`handleUnsubscribe` lazy resolution) |
| C9 Bug A: merge instead of replace, union selection | Task 5 Steps 1-3 (fold fix + pure regression test) |
| C10 Bug B: delete dead card, prune legacy surface, keep `triagePlan`/`setTriagePlan`, remove shared types after grep | Task 5 Steps 4-7 |
| C11 out-of-scope items | Not implemented anywhere (verified: no tracker-strip/block-sender/rule actions, no new columns) |
| Design §1 `SenderCleanupStat` shape | Task 1 Step 3 (verbatim interface) |
| Design §1 CTE shape, ISO `strftime` cutoff, ordering, LIMIT 200, anti-pattern ban | Task 3 Step 3 + Global Constraints |
| Design §1 worker payload union + client method + preload + vite-env typing | Task 4 |
| Design §2 builders (`buildCleanupArchiveItem`, `buildCleanupUnsubscribeItem`), `AgentPlanSource` += `'cleanup'` | Task 2, Task 1 |
| Design §3 store boolean, close-on-nav in every listed site, LeftRail Eraser button | Task 7 |
| Design §3 CleanupPanel contents (header, per-account load, states, badges, row actions, toasts) | Task 8 Step 1 |
| Design §3 `applyAgentPlanItem` unsubscribe branch via `executeMailAction` customAction contract | Task 6 Step 2 |
| Design §4 error handling (in-panel error + retry, no toast spam; per-row unsubscribe toasts; optimistic/reconciler semantics) | Task 8 (error state, `handleUnsubscribe` toasts), Task 6 (executeMailAction path) |
| Testing §5 `tests/cleanup.test.ts` rule matrix + builder shapes | Tasks 1-2 |
| Testing §5 `tests/agentPlan.test.ts` cleanup source + merge behavior | Task 2 Step 1, Task 5 Step 1 |
| Testing §5 `tests/senderCleanupStats.test.ts` real temp better-sqlite3 DB (grouping, 30d window, LIKE flag, tracker join, attachment sums, ordering, LIMIT) | Task 3 |
| Testing §5 Bug A pure-level regression; suites green after Bug B removal | Task 5 Steps 1-2, 8 |
| Validation: `npm run build` + full `npm test`; manual smoke deferred | Task 8 Step 3, Post-plan checks |
| File touch list (create/modify/delete) | Tasks 1-8 collectively match the spec's list, plus `renderer/src/stores/useSettingsState.ts` (where `settingsOpen` actually lives — the spec's "AppStore" is the context that re-exports it) |
