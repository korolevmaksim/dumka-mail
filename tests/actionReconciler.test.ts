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
