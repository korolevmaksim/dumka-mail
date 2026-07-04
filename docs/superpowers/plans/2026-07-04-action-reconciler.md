# Action Reconciler Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract the offline action replay/rollback engine from `main/index.ts` into a testable `main/actionReconciler.ts` with injectable dependencies, fix stranded-`running` actions, and pin the engine's behavior with DI-based tests.

**Architecture:** `reconcilePendingActions(deps)` is a verbatim move of the current interval-callback body with repo/service references replaced by a `ReconcilerDeps` object; `startBackgroundSyncWorker(deps, intervalMs)` is a thin closure-guarded `setInterval` wrapper that first runs the one behavioral fix, `recoverStaleRunningActions`. `main/index.ts` keeps the draft builders and wires real dependencies at the existing call site.

**Tech Stack:** TypeScript strict, Electron main process, better-sqlite3 repos, vitest with plain DI fakes (no `vi.mock`).

**Spec:** `docs/superpowers/specs/2026-07-04-action-reconciler-design.md`

## Global Constraints

- `npm run build` (tsc noEmit) is the only type gate; no linter exists.
- `main/actionReconciler.ts` must have NO Electron imports and no runtime imports of `./database`/`./repositories` — type-only imports from `../shared/types` are allowed; the module must be importable by vitest directly.
- Behavior preservation: replay semantics move verbatim (network `break`, label-family rollback table, fall-through-to-`completed` for kinds without a branch, silent completion for label ops missing `labelId`). The ONLY behavior change is stale-`running` recovery.
- Stale-`running` policy (verbatim from spec D5): send-like kinds = `'send' | 'forwardThread' | 'autoReply'` → `failed` with `failureMessage: 'Interrupted while sending; not retried to avoid a duplicate send.'`; all other kinds → `pending_sync`.
- Worker interval default stays `15000` ms; overlap guard is closure state inside `startBackgroundSyncWorker`.
- Commit messages in English; NO Co-Authored-By or AI-attribution trailers (user rule).

---

### Task 1: `reconcilePendingActions` + `isNetworkError` with replay tests

**Files:**
- Create: `main/actionReconciler.ts`
- Test: `tests/actionReconciler.test.ts`
- (Do NOT touch `main/index.ts` yet — the old code keeps running until Task 3.)

**Interfaces:**
- Consumes: `MailActionLog`, `MailThread`, `MailRuleAction` types from `shared/types.ts` (type-only).
- Produces (used by Tasks 2, 3):

```ts
export interface ReconcilerDeps {
  actionLog: {
    listPending(nowIso?: string): MailActionLog[];
    listRunning(): MailActionLog[];
    save(log: MailActionLog): void;
  };
  threads: {
    get(accountId: string, threadId: string): MailThread | null;
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
  };
  drafts: {
    get(draftId: string): unknown;
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
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'error'>;
}
export function isNetworkError(err: any): boolean;
export function reconcilePendingActions(deps: ReconcilerDeps): Promise<void>;
```

- [ ] **Step 1: Write the failing tests**

Create `tests/actionReconciler.test.ts`:

```ts
import { describe, expect, it, vi } from 'vitest';
import { isNetworkError, reconcilePendingActions, type ReconcilerDeps } from '../main/actionReconciler';
import type { MailActionLog, MailThread } from '../shared/types';

const NOW = new Date('2026-07-04T12:00:00.000Z');

function makeAction(partial: Partial<MailActionLog>): MailActionLog {
  return {
    id: partial.id || 'a1',
    accountId: partial.accountId || 'me@example.com',
    threadId: partial.threadId === undefined ? 't1' : partial.threadId,
    draftId: partial.draftId ?? null,
    kind: partial.kind || 'markDone',
    status: partial.status || 'pending_sync',
    createdAt: partial.createdAt || '2026-07-04T11:00:00.000Z',
    scheduledAt: partial.scheduledAt ?? null,
    completedAt: partial.completedAt ?? null,
    failureMessage: partial.failureMessage ?? null,
    payloadJson: partial.payloadJson ?? null,
  };
}

interface DepsHarness {
  deps: ReconcilerDeps;
  saved: MailActionLog[];
  gmailCalls: Array<{ method: string; args: unknown[] }>;
  rollbacks: Array<{ accountId: string; threadId: string; add: string[]; remove: string[] }>;
  draftsDeleted: string[];
}

function makeDeps(options: {
  pending?: MailActionLog[];
  running?: MailActionLog[];
  drafts?: Record<string, unknown>;
  threads?: Record<string, MailThread>;
  gmailError?: Error;
  failOn?: string; // gmail method name that should reject
} = {}): DepsHarness {
  const saved: MailActionLog[] = [];
  const gmailCalls: DepsHarness['gmailCalls'] = [];
  const rollbacks: DepsHarness['rollbacks'] = [];
  const draftsDeleted: string[] = [];
  const maybeFail = (method: string) => {
    if (options.gmailError && (!options.failOn || options.failOn === method)) {
      return Promise.reject(options.gmailError);
    }
    return Promise.resolve({});
  };
  const deps: ReconcilerDeps = {
    actionLog: {
      listPending: () => options.pending || [],
      listRunning: () => options.running || [],
      save: log => { saved.push({ ...log }); },
    },
    threads: {
      get: (accountId, threadId) => options.threads?.[`${accountId}:${threadId}`] || null,
      updateLabels: (accountId, threadId, add, remove) => {
        rollbacks.push({ accountId, threadId, add, remove });
      },
    },
    drafts: {
      get: draftId => options.drafts?.[draftId] ?? null,
      delete: draftId => { draftsDeleted.push(draftId); },
    },
    gmail: {
      modifyLabels: (...args) => { gmailCalls.push({ method: 'modifyLabels', args }); return maybeFail('modifyLabels'); },
      trashThread: (...args) => { gmailCalls.push({ method: 'trashThread', args }); return maybeFail('trashThread'); },
      untrashThread: (...args) => { gmailCalls.push({ method: 'untrashThread', args }); return maybeFail('untrashThread'); },
      sendDraft: (...args) => { gmailCalls.push({ method: 'sendDraft', args }); return maybeFail('sendDraft'); },
    },
    buildForwardDraft: (accountId, thread, forwardTo) => ({ builtForward: { accountId, threadId: thread.id, forwardTo } }),
    buildAutoReplyDraft: (accountId, threadId, replyBody) => ({ builtAutoReply: { accountId, threadId, replyBody } }),
    now: () => NOW,
    logger: { log: vi.fn(), error: vi.fn() },
  };
  return { deps, saved, gmailCalls, rollbacks, draftsDeleted };
}

const NETWORK_ERROR = Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' });
const PERMANENT_ERROR = new Error('HTTP 400: invalid label');

describe('isNetworkError', () => {
  it('classifies network-ish messages and codes', () => {
    expect(isNetworkError(new Error('fetch failed'))).toBe(true);
    expect(isNetworkError(new Error('Request Failed midway'))).toBe(true);
    expect(isNetworkError(Object.assign(new Error('x'), { code: 'ETIMEDOUT' }))).toBe(true);
    expect(isNetworkError(new Error('HTTP 403 forbidden'))).toBe(false);
    expect(isNetworkError(null)).toBe(false);
  });
});

describe('reconcilePendingActions dispatch', () => {
  const LABEL_DISPATCH: Array<{ kind: MailActionLog['kind']; payloadJson?: string; method: string; add?: string[]; remove?: string[] }> = [
    { kind: 'markDone', method: 'modifyLabels', add: [], remove: ['INBOX'] },
    { kind: 'restoreInbox', method: 'modifyLabels', add: ['INBOX'], remove: [] },
    { kind: 'markRead', method: 'modifyLabels', add: [], remove: ['UNREAD'] },
    { kind: 'markUnread', method: 'modifyLabels', add: ['UNREAD'], remove: [] },
    { kind: 'moveToTrash', method: 'trashThread' },
    { kind: 'restoreFromTrash', method: 'untrashThread' },
    { kind: 'reportSpam', method: 'modifyLabels', add: ['SPAM'], remove: ['INBOX'] },
    { kind: 'restoreFromSpam', method: 'modifyLabels', add: ['INBOX'], remove: ['SPAM'] },
    { kind: 'muteThread', payloadJson: '{"labelId":"L7"}', method: 'modifyLabels', add: ['L7'], remove: ['INBOX'] },
    { kind: 'muteThread', method: 'modifyLabels', add: [], remove: ['INBOX'] },
    { kind: 'unmuteThread', payloadJson: '{"labelId":"L7"}', method: 'modifyLabels', add: ['INBOX'], remove: ['L7'] },
    { kind: 'unmuteThread', method: 'modifyLabels', add: ['INBOX'], remove: [] },
    { kind: 'applyLabel', payloadJson: '{"labelId":"L7"}', method: 'modifyLabels', add: ['L7'], remove: [] },
    { kind: 'moveToLabel', payloadJson: '{"labelId":"L7"}', method: 'modifyLabels', add: ['L7'], remove: ['INBOX'] },
    { kind: 'removeLabel', payloadJson: '{"labelId":"L7"}', method: 'modifyLabels', add: [], remove: ['L7'] },
  ];

  it.each(LABEL_DISPATCH)('replays $kind (payload $payloadJson) via $method', async spec => {
    const h = makeDeps({ pending: [makeAction({ kind: spec.kind, payloadJson: spec.payloadJson })] });
    await reconcilePendingActions(h.deps);
    expect(h.gmailCalls).toHaveLength(1);
    expect(h.gmailCalls[0].method).toBe(spec.method);
    if (spec.method === 'modifyLabels') {
      expect(h.gmailCalls[0].args).toEqual(['me@example.com', 't1', spec.add, spec.remove]);
    } else {
      expect(h.gmailCalls[0].args).toEqual(['me@example.com', 't1']);
    }
    const final = h.saved[h.saved.length - 1];
    expect(final.status).toBe('completed');
    expect(final.completedAt).toBe(NOW.toISOString());
  });

  it('marks the action running before the remote call', async () => {
    const h = makeDeps({ pending: [makeAction({ kind: 'markDone' })] });
    await reconcilePendingActions(h.deps);
    expect(h.saved[0].status).toBe('running');
  });

  it('completes label ops with a missing labelId without a remote call (pinned quirk)', async () => {
    for (const kind of ['applyLabel', 'moveToLabel', 'removeLabel'] as const) {
      const h = makeDeps({ pending: [makeAction({ kind })] });
      await reconcilePendingActions(h.deps);
      expect(h.gmailCalls).toHaveLength(0);
      expect(h.saved[h.saved.length - 1].status).toBe('completed');
    }
  });

  it('completes kinds without a dispatch branch without a remote call (pinned quirk)', async () => {
    const h = makeDeps({ pending: [makeAction({ kind: 'setReminder' })] });
    await reconcilePendingActions(h.deps);
    expect(h.gmailCalls).toHaveLength(0);
    expect(h.saved[h.saved.length - 1].status).toBe('completed');
  });
});

describe('reconcilePendingActions network failure', () => {
  it('parks the failing action as pending_sync and stops the pass', async () => {
    const first = makeAction({ id: 'a1', kind: 'markDone' });
    const second = makeAction({ id: 'a2', kind: 'markRead' });
    const h = makeDeps({ pending: [first, second], gmailError: NETWORK_ERROR });
    await reconcilePendingActions(h.deps);
    // a1: running, then back to pending_sync; a2 never touched.
    expect(h.saved.map(s => [s.id, s.status])).toEqual([
      ['a1', 'running'],
      ['a1', 'pending_sync'],
    ]);
    expect(h.gmailCalls).toHaveLength(1);
    expect(h.rollbacks).toHaveLength(0);
  });
});

describe('reconcilePendingActions permanent failure', () => {
  const ROLLBACKS: Array<{ kind: MailActionLog['kind']; payloadJson?: string; add: string[]; remove: string[] }> = [
    { kind: 'markDone', add: ['INBOX'], remove: [] },
    { kind: 'restoreInbox', add: [], remove: ['INBOX'] },
    { kind: 'markRead', add: ['UNREAD'], remove: [] },
    { kind: 'markUnread', add: [], remove: ['UNREAD'] },
    { kind: 'moveToTrash', add: ['INBOX'], remove: ['TRASH'] },
    { kind: 'restoreFromTrash', add: ['TRASH'], remove: ['INBOX'] },
    { kind: 'reportSpam', add: ['INBOX'], remove: ['SPAM'] },
    { kind: 'restoreFromSpam', add: ['SPAM'], remove: ['INBOX'] },
    { kind: 'muteThread', payloadJson: '{"labelId":"L7"}', add: ['INBOX'], remove: ['L7'] },
    { kind: 'muteThread', add: ['INBOX'], remove: [] },
    { kind: 'unmuteThread', payloadJson: '{"labelId":"L7"}', add: ['L7'], remove: ['INBOX'] },
    { kind: 'unmuteThread', add: [], remove: ['INBOX'] },
    { kind: 'applyLabel', payloadJson: '{"labelId":"L7"}', add: [], remove: ['L7'] },
    { kind: 'moveToLabel', payloadJson: '{"labelId":"L7"}', add: ['INBOX'], remove: ['L7'] },
    { kind: 'removeLabel', payloadJson: '{"labelId":"L7"}', add: ['L7'], remove: [] },
  ];

  it.each(ROLLBACKS)('fails $kind (payload $payloadJson) permanently and rolls back local labels', async spec => {
    const h = makeDeps({
      pending: [makeAction({ kind: spec.kind, payloadJson: spec.payloadJson })],
      gmailError: PERMANENT_ERROR,
    });
    await reconcilePendingActions(h.deps);
    const final = h.saved[h.saved.length - 1];
    expect(final.status).toBe('failed');
    expect(final.failureMessage).toBe('HTTP 400: invalid label');
    expect(final.completedAt).toBe(NOW.toISOString());
    expect(h.rollbacks).toEqual([
      { accountId: 'me@example.com', threadId: 't1', add: spec.add, remove: spec.remove },
    ]);
  });

  it('continues with the next action after a permanent failure', async () => {
    const h = makeDeps({
      pending: [makeAction({ id: 'a1', kind: 'markDone' }), makeAction({ id: 'a2', kind: 'markRead' })],
      gmailError: PERMANENT_ERROR,
    });
    await reconcilePendingActions(h.deps);
    expect(h.gmailCalls).toHaveLength(2);
  });
});

describe('reconcilePendingActions send-like kinds', () => {
  it('sends a pending draft and deletes it afterwards', async () => {
    const draft = { subject: 'hi' };
    const h = makeDeps({
      pending: [makeAction({ kind: 'send', draftId: 'd1' })],
      drafts: { d1: draft },
    });
    await reconcilePendingActions(h.deps);
    expect(h.gmailCalls).toEqual([{ method: 'sendDraft', args: ['me@example.com', draft] }]);
    expect(h.draftsDeleted).toEqual(['d1']);
    expect(h.saved[h.saved.length - 1].status).toBe('completed');
  });

  it('fails permanently when the pending draft is gone, without deleting anything', async () => {
    const h = makeDeps({ pending: [makeAction({ kind: 'send', draftId: 'd1' })] });
    await reconcilePendingActions(h.deps);
    const final = h.saved[h.saved.length - 1];
    expect(final.status).toBe('failed');
    expect(final.failureMessage).toBe('Draft not found for pending send.');
    expect(h.draftsDeleted).toEqual([]);
    expect(h.rollbacks).toHaveLength(0);
  });

  it('forwards a thread using the injected builder', async () => {
    const thread = { id: 't1' } as MailThread;
    const h = makeDeps({
      pending: [makeAction({ kind: 'forwardThread', payloadJson: '{"action":{"forwardTo":"x@y.com"}}' })],
      threads: { 'me@example.com:t1': thread },
    });
    await reconcilePendingActions(h.deps);
    expect(h.gmailCalls).toEqual([{
      method: 'sendDraft',
      args: ['me@example.com', { builtForward: { accountId: 'me@example.com', threadId: 't1', forwardTo: 'x@y.com' } }],
    }]);
  });

  it('fails forwardThread permanently when forwardTo or the thread is missing', async () => {
    const noTarget = makeDeps({ pending: [makeAction({ kind: 'forwardThread', payloadJson: '{}' })] });
    await reconcilePendingActions(noTarget.deps);
    expect(noTarget.saved[noTarget.saved.length - 1].status).toBe('failed');

    const noThread = makeDeps({
      pending: [makeAction({ kind: 'forwardThread', payloadJson: '{"action":{"forwardTo":"x@y.com"}}' })],
    });
    await reconcilePendingActions(noThread.deps);
    expect(noThread.saved[noThread.saved.length - 1].status).toBe('failed');
  });

  it('auto-replies via the injected builder and fails permanently on missing replyBody', async () => {
    const ok = makeDeps({
      pending: [makeAction({ kind: 'autoReply', payloadJson: '{"action":{"replyBody":"got it"}}' })],
    });
    await reconcilePendingActions(ok.deps);
    expect(ok.gmailCalls).toEqual([{
      method: 'sendDraft',
      args: ['me@example.com', { builtAutoReply: { accountId: 'me@example.com', threadId: 't1', replyBody: 'got it' } }],
    }]);

    const missing = makeDeps({ pending: [makeAction({ kind: 'autoReply', payloadJson: '{"action":{}}' })] });
    await reconcilePendingActions(missing.deps);
    expect(missing.saved[missing.saved.length - 1].status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/actionReconciler.test.ts`
Expected: FAIL — cannot resolve `../main/actionReconciler`.

- [ ] **Step 3: Write the implementation**

Create `main/actionReconciler.ts`. `isNetworkError` moves VERBATIM from `main/index.ts:1357-1377`. The replay loop moves VERBATIM from `main/index.ts:1391-1516` (the body inside the current interval's `try`), with only these mechanical substitutions: `ActionLogRepo` → `deps.actionLog`, `GmailSyncService` → `deps.gmail`, `ThreadsRepo` → `deps.threads`, `DraftsRepo` → `deps.drafts`, `buildForwardDraftFromThread(...)` → `deps.buildForwardDraft(...)`, `buildAutoReplyDraftFromRule(...)` → `deps.buildAutoReplyDraft(...)`, `new Date().toISOString()` → `now().toISOString()`, `console` → `logger`:

```ts
import type { MailActionLog, MailRuleAction, MailThread } from '../shared/types';

export interface ReconcilerDeps {
  actionLog: {
    listPending(nowIso?: string): MailActionLog[];
    listRunning(): MailActionLog[];
    save(log: MailActionLog): void;
  };
  threads: {
    get(accountId: string, threadId: string): MailThread | null;
    updateLabels(accountId: string, threadId: string, add: string[], remove: string[]): void;
  };
  drafts: {
    get(draftId: string): unknown;
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
  now?: () => Date;
  logger?: Pick<Console, 'log' | 'error'>;
}

export function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  const code = String(err.code || '').toUpperCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('timeout') ||
    msg.includes('request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('dns') ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  );
}

// One reconciliation pass: replay every pending_sync action against Gmail.
// Moved verbatim from main/index.ts startBackgroundSyncWorker; semantics are
// pinned by tests/actionReconciler.test.ts — change them deliberately or not at all.
export async function reconcilePendingActions(deps: ReconcilerDeps): Promise<void> {
  const now = deps.now || (() => new Date());
  const logger = deps.logger || console;

  const pendingActions = deps.actionLog.listPending();
  if (pendingActions.length === 0) return;

  logger.log(`[Sync Worker] Found ${pendingActions.length} pending actions to sync`);

  for (const action of pendingActions) {
    action.status = 'running';
    deps.actionLog.save(action);

    try {
      const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
      if (action.kind === 'markDone') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], ['INBOX']);
      } else if (action.kind === 'restoreInbox') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], []);
      } else if (action.kind === 'markRead') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], ['UNREAD']);
      } else if (action.kind === 'markUnread') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['UNREAD'], []);
      } else if (action.kind === 'moveToTrash') {
        await deps.gmail.trashThread(action.accountId, action.threadId!);
      } else if (action.kind === 'restoreFromTrash') {
        await deps.gmail.untrashThread(action.accountId, action.threadId!);
      } else if (action.kind === 'reportSpam') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['SPAM'], ['INBOX']);
      } else if (action.kind === 'restoreFromSpam') {
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], ['SPAM']);
      } else if (action.kind === 'muteThread') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, labelId ? [labelId] : [], ['INBOX']);
      } else if (action.kind === 'unmuteThread') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        await deps.gmail.modifyLabels(action.accountId, action.threadId!, ['INBOX'], labelId ? [labelId] : []);
      } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        if (labelId) {
          await deps.gmail.modifyLabels(action.accountId, action.threadId!, [labelId], action.kind === 'moveToLabel' ? ['INBOX'] : []);
        }
      } else if (action.kind === 'removeLabel') {
        const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
        if (labelId) await deps.gmail.modifyLabels(action.accountId, action.threadId!, [], [labelId]);
      } else if (action.kind === 'send') {
        if (action.draftId) {
          const draft = deps.drafts.get(action.draftId);
          if (!draft) throw new Error('Draft not found for pending send.');
          await deps.gmail.sendDraft(action.accountId, draft);
          deps.drafts.delete(action.draftId);
        }
      } else if (action.kind === 'forwardThread') {
        const payloadAction = payload.action as MailRuleAction | undefined;
        const forwardTo = payloadAction?.forwardTo;
        const thread = action.threadId ? deps.threads.get(action.accountId, action.threadId) : null;
        if (!forwardTo) throw new Error('Forward rule action is missing forwardTo.');
        if (!thread) throw new Error('Thread not found for pending forward rule.');
        await deps.gmail.sendDraft(
          action.accountId,
          deps.buildForwardDraft(action.accountId, thread, forwardTo),
        );
      } else if (action.kind === 'autoReply') {
        const payloadAction = payload.action as MailRuleAction | undefined;
        const replyBody = payloadAction?.replyBody?.trim();
        if (!replyBody) throw new Error('Auto-reply rule action is missing replyBody.');
        if (!action.threadId) throw new Error('Thread id is missing for pending auto-reply rule.');
        await deps.gmail.sendDraft(
          action.accountId,
          deps.buildAutoReplyDraft(action.accountId, action.threadId, replyBody),
        );
      }

      action.status = 'completed';
      action.completedAt = now().toISOString();
      deps.actionLog.save(action);
      logger.log(`[Sync Worker] Successfully synced action ${action.id} of kind ${action.kind}`);
    } catch (err: any) {
      if (isNetworkError(err)) {
        logger.log(`[Sync Worker] Network still offline, will retry action ${action.id} later:`, err.message);
        action.status = 'pending_sync';
        deps.actionLog.save(action);
        break;
      } else {
        logger.error(`[Sync Worker] Action ${action.id} failed permanently:`, err);
        action.status = 'failed';
        action.completedAt = now().toISOString();
        action.failureMessage = err.message;
        deps.actionLog.save(action);

        // Roll back local DB changes for labels on permanent failure
        if (action.threadId) {
          if (action.kind === 'markDone') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], []);
          } else if (action.kind === 'restoreInbox') {
            deps.threads.updateLabels(action.accountId, action.threadId, [], ['INBOX']);
          } else if (action.kind === 'markRead') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['UNREAD'], []);
          } else if (action.kind === 'markUnread') {
            deps.threads.updateLabels(action.accountId, action.threadId, [], ['UNREAD']);
          } else if (action.kind === 'moveToTrash') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], ['TRASH']);
          } else if (action.kind === 'restoreFromTrash') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['TRASH'], ['INBOX']);
          } else if (action.kind === 'reportSpam') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], ['SPAM']);
          } else if (action.kind === 'restoreFromSpam') {
            deps.threads.updateLabels(action.accountId, action.threadId, ['SPAM'], ['INBOX']);
          } else if (action.kind === 'muteThread') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            deps.threads.updateLabels(action.accountId, action.threadId, ['INBOX'], typeof rollbackPayload.labelId === 'string' ? [rollbackPayload.labelId] : []);
          } else if (action.kind === 'unmuteThread') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            deps.threads.updateLabels(action.accountId, action.threadId, typeof rollbackPayload.labelId === 'string' ? [rollbackPayload.labelId] : [], ['INBOX']);
          } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel' || action.kind === 'removeLabel') {
            const rollbackPayload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
            const labelId = typeof rollbackPayload.labelId === 'string' ? rollbackPayload.labelId : null;
            if (labelId && action.kind === 'removeLabel') {
              deps.threads.updateLabels(action.accountId, action.threadId, [labelId], []);
            } else if (labelId) {
              deps.threads.updateLabels(action.accountId, action.threadId, action.kind === 'moveToLabel' ? ['INBOX'] : [], [labelId]);
            }
          }
        }
      }
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actionReconciler.test.ts`
Expected: PASS (all cases). Also run `npm run build` — expected green (the new module compiles; `main/index.ts` untouched).

- [ ] **Step 5: Commit**

```bash
git add main/actionReconciler.ts tests/actionReconciler.test.ts
git commit -m "feat: extract action reconciliation engine with tests"
```

---

### Task 2: `recoverStaleRunningActions` + `startBackgroundSyncWorker`

**Files:**
- Modify: `main/actionReconciler.ts`
- Test: `tests/actionReconciler.test.ts` (append)

**Interfaces:**
- Consumes: `ReconcilerDeps`, `reconcilePendingActions` (Task 1).
- Produces (used by Task 3):

```ts
export const SEND_LIKE_KINDS: ReadonlySet<ActionKind>; // 'send' | 'forwardThread' | 'autoReply'
export function recoverStaleRunningActions(deps: ReconcilerDeps): void;
export function startBackgroundSyncWorker(deps: ReconcilerDeps, intervalMs?: number): NodeJS.Timeout;
```

- [ ] **Step 1: Write the failing tests** (append the `describe` blocks to `tests/actionReconciler.test.ts`; MERGE the two import lines below into the file's existing top-of-file imports — do not paste import statements mid-file)

```ts
import { afterEach, beforeEach } from 'vitest';                                      // merge into existing vitest import
import { recoverStaleRunningActions, startBackgroundSyncWorker } from '../main/actionReconciler';  // merge into existing module import

describe('recoverStaleRunningActions', () => {
  it('re-queues stale running label actions as pending_sync', () => {
    const h = makeDeps({ running: [makeAction({ id: 'a1', kind: 'markDone', status: 'running' })] });
    recoverStaleRunningActions(h.deps);
    expect(h.saved).toHaveLength(1);
    expect(h.saved[0]).toMatchObject({ id: 'a1', status: 'pending_sync' });
    expect(h.gmailCalls).toHaveLength(0);
    expect(h.rollbacks).toHaveLength(0);
  });

  it.each(['send', 'forwardThread', 'autoReply'] as const)(
    'fails stale running %s without retrying (no duplicate send)',
    kind => {
      const h = makeDeps({ running: [makeAction({ id: 'a1', kind, status: 'running' })] });
      recoverStaleRunningActions(h.deps);
      expect(h.saved[0]).toMatchObject({
        id: 'a1',
        status: 'failed',
        failureMessage: 'Interrupted while sending; not retried to avoid a duplicate send.',
        completedAt: NOW.toISOString(),
      });
      expect(h.gmailCalls).toHaveLength(0);
    },
  );

  it('is a no-op when nothing is stuck in running', () => {
    const h = makeDeps({});
    recoverStaleRunningActions(h.deps);
    expect(h.saved).toHaveLength(0);
  });
});

describe('startBackgroundSyncWorker', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('recovers stale running actions once at start, then reconciles on the interval', async () => {
    const h = makeDeps({
      running: [makeAction({ id: 'stale', kind: 'markDone', status: 'running' })],
      pending: [makeAction({ id: 'p1', kind: 'markRead' })],
    });
    const timer = startBackgroundSyncWorker(h.deps, 1000);
    // Recovery ran synchronously at start; no reconcile yet.
    expect(h.saved.map(s => s.id)).toEqual(['stale']);
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.gmailCalls).toHaveLength(1);
    clearInterval(timer);
  });

  it('does not overlap passes (closure guard)', async () => {
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    const h = makeDeps({ pending: [makeAction({ id: 'p1', kind: 'markDone' })] });
    h.deps.gmail.modifyLabels = () => { h.gmailCalls.push({ method: 'modifyLabels', args: [] }); return gate; };
    const timer = startBackgroundSyncWorker(h.deps, 1000);
    await vi.advanceTimersByTimeAsync(1000); // pass 1 starts, blocks on gate
    await vi.advanceTimersByTimeAsync(2000); // two more ticks while blocked
    expect(h.gmailCalls).toHaveLength(1);    // guard prevented overlapping passes
    release();
    clearInterval(timer);
  });

  it('two workers do not share a guard', async () => {
    const h1 = makeDeps({ pending: [] });
    const h2 = makeDeps({ pending: [] });
    const t1 = startBackgroundSyncWorker(h1.deps, 1000);
    const t2 = startBackgroundSyncWorker(h2.deps, 1000);
    await vi.advanceTimersByTimeAsync(1000);
    // Both workers ran their (empty) pass without interfering.
    clearInterval(t1);
    clearInterval(t2);
  });
});
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run tests/actionReconciler.test.ts`
Expected: FAIL — new exports missing.

- [ ] **Step 3: Implement** (append to `main/actionReconciler.ts`)

```ts
import type { ActionKind } from '../shared/types';  // merge into the existing type-only import

export const SEND_LIKE_KINDS: ReadonlySet<ActionKind> = new Set(['send', 'forwardThread', 'autoReply']);

// A crash or quit can strand actions in 'running' — listPending never picks them
// up again. Label-family Gmail calls are idempotent, so replaying is safe; a send
// may already have left the outbox, so it is failed rather than risking a duplicate.
export function recoverStaleRunningActions(deps: ReconcilerDeps): void {
  const now = deps.now || (() => new Date());
  for (const action of deps.actionLog.listRunning()) {
    if (SEND_LIKE_KINDS.has(action.kind)) {
      action.status = 'failed';
      action.failureMessage = 'Interrupted while sending; not retried to avoid a duplicate send.';
      action.completedAt = now().toISOString();
    } else {
      action.status = 'pending_sync';
    }
    deps.actionLog.save(action);
  }
}

export function startBackgroundSyncWorker(deps: ReconcilerDeps, intervalMs = 15000): NodeJS.Timeout {
  const logger = deps.logger || console;
  recoverStaleRunningActions(deps);

  let active = false;
  return setInterval(async () => {
    if (active) return;
    active = true;
    try {
      await reconcilePendingActions(deps);
    } catch (e) {
      logger.error('[Sync Worker] Error in background sync loop:', e);
    } finally {
      active = false;
    }
  }, intervalMs);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/actionReconciler.test.ts && npm run build`
Expected: PASS + green build.

- [ ] **Step 5: Commit**

```bash
git add main/actionReconciler.ts tests/actionReconciler.test.ts
git commit -m "feat: add stale-running recovery and reconciler worker loop"
```

---

### Task 3: Wire `main/index.ts` + `ActionLogRepo.listRunning`

**Files:**
- Modify: `main/repositories.ts` (inside `ActionLogRepo`, after `listPending` which ends near `main/repositories.ts:1540`)
- Modify: `main/index.ts` (delete `isNetworkError` at `:1357-1377` and `startBackgroundSyncWorker` at `:1385-1523` and the `syncWorkerActive` flag at `:1379`; add import; rewrite the call at `:635`)

**Interfaces:**
- Consumes: everything Tasks 1-2 exported.
- Produces: behavioral parity — the app runs on the extracted engine.

- [ ] **Step 1: Add `listRunning`** (in `main/repositories.ts`, directly after `listPending`, same row-mapping shape)

```ts
  listRunning(): MailActionLog[] {
    const db = getDatabase();
    const rows = db.prepare(`
      SELECT * FROM mail_action_log
      WHERE status = 'running'
      ORDER BY created_at ASC
    `).all() as any[];

    return rows.map(r => ({
      id: r.id,
      accountId: r.account_id,
      threadId: r.thread_id,
      draftId: r.draft_id,
      kind: r.kind,
      status: r.status,
      createdAt: r.created_at,
      scheduledAt: r.scheduled_at,
      completedAt: r.completed_at,
      failureMessage: r.failure_message,
      payloadJson: r.payload_json
    }));
  },
```

- [ ] **Step 2: Rewire `main/index.ts`**

1. Add to the existing `./actionReconciler`-free import block:
   `import { isNetworkError, startBackgroundSyncWorker } from './actionReconciler';`
2. Delete the local `isNetworkError` function (`main/index.ts:1357-1377`), the `syncWorkerActive` flag (`:1379`), and the local `startBackgroundSyncWorker` function (`:1385-1523`). All six optimistic-path `isNetworkError(...)` call sites keep compiling via the import.
3. Replace the bare call at `main/index.ts:635` with the wired deps literal:

```ts
  startBackgroundSyncWorker({
    actionLog: ActionLogRepo,
    threads: ThreadsRepo,
    drafts: DraftsRepo,
    gmail: GmailSyncService,
    buildForwardDraft: buildForwardDraftFromThread,
    buildAutoReplyDraft: buildAutoReplyDraftFromRule,
  });
```

(`ActionLogRepo` structurally satisfies the `actionLog` deps slot once `listRunning` exists; `now`/`logger` use their defaults.)

- [ ] **Step 3: Full validation**

Run: `npm run build`
Expected: green (this proves the deps literal typechecks against `ReconcilerDeps` and no dangling references remain).
Run: `npm test`
Expected: full suite green.

- [ ] **Step 4: Commit**

```bash
git add main/repositories.ts main/index.ts
git commit -m "refactor: run background sync on the extracted reconciler"
```

---

## Post-plan checks (not tasks)

- Whole-branch review after Task 3 (spec-compliance + the behavior-preservation guarantee: diff the moved code against the deleted code).
- The reconciler is main-process only — no IPC/renderer changes, no visual QA needed.
