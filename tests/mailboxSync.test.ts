import { describe, expect, it, vi } from 'vitest';
import { GoogleReauthorizationRequiredError } from '../main/googleAuthState';
import { MAX_THREAD_READS_PER_PASS, performMailboxSyncForAccount, type MailboxSyncDeps } from '../main/mailboxSync';
import type { MailActionLog, MailMessage, MailThread, SyncState } from '../shared/types';

function thread(id: string, labels: string[] = ['INBOX']): MailThread {
  return {
    id,
    accountId: 'me@example.com',
    subject: id,
    snippet: '',
    lastMessageAt: '2026-07-03T08:00:00.000Z',
    senderNames: ['Sender'],
    senderEmail: 'sender@example.com',
    labelIds: labels,
    hasAttachments: false,
    isUnread: false,
    reminderAt: null,
  };
}

function message(threadId: string): MailMessage {
  return {
    id: `${threadId}-m1`,
    accountId: 'me@example.com',
    threadId,
    senderName: 'Sender',
    senderEmail: 'sender@example.com',
    subject: threadId,
    snippet: '',
    receivedAt: '2026-07-03T08:00:00.000Z',
    labelIds: ['INBOX'],
    hasAttachments: false,
    isUnread: false,
    to: [],
    cc: [],
    bcc: [],
    attachments: [],
  };
}

function makeDeps(options: {
  historyId?: string | null;
  incremental?: { updatedThreadIds: string[]; deletedThreadIds: string[]; historyId: string };
  fetchError?: Error;
  pending?: MailActionLog[];
  /** Conversations left on the queue by earlier passes, most urgent first. */
  queued?: string[];
  /** Message ids the local cache holds, by conversation. A deleted conversation is reported as losing `<id>-m1`. */
  stored?: Record<string, string[]>;
} = {}) {
  const savedStates: SyncState[] = [];
  const savedThreads: MailThread[][] = [];
  const savedMessages: MailMessage[][] = [];
  const deleted: string[] = [];
  const deleteCalls: string[][] = [];
  const removalCalls: string[][] = [];
  const stored = new Map(Object.entries(options.stored || {}).map(([threadId, messageIds]) => [threadId, new Set(messageIds)]));
  const fetched: string[] = [];
  const queue: string[] = [...(options.queued || [])];
  const postponed: string[] = [];
  let quotaAllows = true;
  const deltas: Array<{ upserts: MailThread[]; deletedThreadIds: string[] }> = [];
  let pending = options.pending || [];
  const deps: MailboxSyncDeps = {
    getSyncState: () => options.historyId
      ? {
          accountId: 'me@example.com',
          historyId: options.historyId,
          historyBackfillPagesSynced: 0,
          historyBackfillThreadsSynced: 0,
        }
      : null,
    saveSyncState: state => { savedStates.push(state); },
    nextSyncState: (accountId, base, historyId, lastFullSyncAt) => ({
      accountId,
      historyId,
      lastFullSyncAt: lastFullSyncAt ?? base?.lastFullSyncAt ?? null,
      historyBackfillPageToken: base?.historyBackfillPageToken || null,
      lastHistoryBackfillAt: base?.lastHistoryBackfillAt || null,
      historyBackfillCompletedAt: base?.historyBackfillCompletedAt || null,
      historyBackfillPagesSynced: base?.historyBackfillPagesSynced || 0,
      historyBackfillThreadsSynced: base?.historyBackfillThreadsSynced || 0,
    }),
    syncInbox: async () => ({ threads: [thread('inbox')], messages: [message('inbox')], historyId: '100' }),
    syncIncremental: async () => {
      const incremental = options.incremental || { updatedThreadIds: [], deletedThreadIds: [], historyId: '20' };
      return {
        updatedThreadIds: incremental.updatedThreadIds,
        deletedMessageIds: Object.fromEntries(incremental.deletedThreadIds.map(threadId => [threadId, [`${threadId}-m1`]])),
        historyId: incremental.historyId,
      };
    },
    fetchThreadDetail: async (_email, threadId) => {
      fetched.push(threadId);
      if (options.fetchError) throw options.fetchError;
      return [message(threadId)];
    },
    saveThreads: async threads => { savedThreads.push(threads); },
    saveMessages: async messages => { savedMessages.push(messages); },
    deleteThreads: async (_accountId, threadIds) => {
      deleteCalls.push(threadIds);
      deleted.push(...threadIds);
    },
    removeDeletedMessages: async (_accountId, deletions) => {
      removalCalls.push(deletions.map(item => item.threadId));
      const outcome = { removedThreadIds: [] as string[], remainingThreadIds: [] as string[], shortenedThreads: [] as MailThread[] };
      for (const { threadId, messageIds, alsoChanged } of deletions) {
        const left = stored.get(threadId);
        const removedMessages = messageIds.filter(messageId => left?.delete(messageId)).length;
        // As the repository decides: a conversation goes with its last message.
        if (alsoChanged || (left && left.size > 0) || (left && removedMessages === 0)) {
          outcome.remainingThreadIds.push(threadId);
          if (removedMessages > 0) outcome.shortenedThreads.push(thread(threadId));
        } else {
          outcome.removedThreadIds.push(threadId);
          deleted.push(threadId);
        }
      }
      return outcome;
    },
    queueThreadReads: (state, threadIds) => {
      savedStates.push(state);
      // Newly reported conversations go in front of what was already waiting.
      for (const threadId of threadIds) {
        const at = queue.indexOf(threadId);
        if (at >= 0) queue.splice(at, 1);
      }
      queue.unshift(...[...threadIds].reverse());
    },
    dueThreadReads: (_accountId, limit) => queue.filter(threadId => !postponed.includes(threadId)).slice(0, limit),
    settleThreadReads: (_accountId, done, failed) => {
      for (const threadId of done) queue.splice(queue.indexOf(threadId), 1);
      postponed.push(...failed);
    },
    takeThreadRead: () => quotaAllows,
    listPendingActions: () => pending,
    publishDelta: (_accountId, upserts, deletedThreadIds) => {
      deltas.push({ upserts, deletedThreadIds });
      return { accountId: 'me@example.com', upserts, deletedThreadIds, revision: 1, completedAt: '2026-07-04T12:00:00.000Z' };
    },
    now: () => new Date('2026-07-04T12:00:00.000Z'),
    logger: { warning: vi.fn() },
  };
  return {
    deps,
    savedStates,
    savedThreads,
    savedMessages,
    deleted,
    deleteCalls,
    removalCalls,
    fetched,
    queue,
    postponed,
    deltas,
    setPending(next: MailActionLog[]) { pending = next; },
    setQuotaAllows(next: boolean) { quotaAllows = next; },
  };
}

describe('performMailboxSyncForAccount', () => {
  it('publishes threads as the post-persist step (sender rules) left them', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1', 't2'], deletedThreadIds: [], historyId: '20' },
    });
    const calls: string[][] = [];
    h.deps.afterPersist = async (_accountId, threads) => {
      calls.push(threads.map(item => item.id));
      expect(h.savedMessages.length).toBeGreaterThan(0);
      return threads.map(item => item.id === 't1' ? { ...item, labelIds: [] } : item);
    };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    // The most recently changed conversation is read first.
    expect(calls).toEqual([['t2'], ['t1']]);
    expect(h.deltas[0].upserts.map(item => [item.id, item.labelIds])).toEqual([['t2', ['INBOX']], ['t1', []]]);
  });

  it('runs the post-persist step after messages on a full sync and survives its failure', async () => {
    const h = makeDeps();
    h.deps.afterPersist = async () => {
      expect(h.savedMessages).toHaveLength(1);
      throw new Error('boom');
    };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['inbox']);
  });

  it('keeps a conversation queued when its fetch fails, with the cursor already moved on', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['18f2c404b7e3d012'], deletedThreadIds: [], historyId: '20' },
      fetchError: Object.assign(new Error('fetchThreadDetail error for 18f2c404b7e3d012: HTTP 503 — backend'), { status: 503 }),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedStates.map(state => state.historyId)).toEqual(['20']);
    expect(h.queue).toEqual(['18f2c404b7e3d012']);
    expect(h.postponed).toEqual(['18f2c404b7e3d012']);
    expect(h.deleted).toHaveLength(0);
    expect(h.deltas[0].upserts).toHaveLength(0);
  });

  it('re-applies a pending archive before persisting a synced thread', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1'], deletedThreadIds: [], historyId: '20' },
      pending: [{
        id: 'a1',
        accountId: 'me@example.com',
        threadId: 't1',
        kind: 'markDone',
        status: 'pending_sync',
        createdAt: '2026-07-04T11:00:00.000Z',
      }],
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedThreads[0][0].labelIds).toEqual([]);
    expect(h.savedMessages[0][0].labelIds).toEqual([]);
    expect(h.savedStates[0].historyId).toBe('20');
  });

  it('re-reads pending actions immediately before persisting a fetched thread', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1'], deletedThreadIds: [], historyId: '20' },
    });
    h.deps.fetchThreadDetail = async (_email, threadId) => {
      h.setPending([{
        id: 'late',
        accountId: 'me@example.com',
        threadId,
        kind: 'markDone',
        status: 'pending_sync',
        createdAt: '2026-07-04T12:00:00.000Z',
      }]);
      return [message(threadId)];
    };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedThreads[0][0].labelIds).toEqual([]);
    expect(h.savedMessages[0][0].labelIds).toEqual([]);
  });

  it('deletes a 404 thread and still advances the history cursor', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['gone'], deletedThreadIds: [], historyId: '20' },
      fetchError: Object.assign(new Error('fetchThreadDetail error for gone: HTTP 404 — notFound'), { status: 404 }),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual(['gone']);
    expect(h.savedStates[0].historyId).toBe('20');
  });

  it('falls back to a full inbox sync when history is expired', async () => {
    const h = makeDeps({ historyId: '10' });
    const base = h.deps.getSyncState('me@example.com');
    if (!base) throw new Error('Expected initial sync state');
    const oldState = { ...base, historyBackfillPageToken: 'old-page',
      historyBackfillThreadsSynced: 2000, historyBackfillCompletedAt: '2026-07-01T12:00:00Z' };
    h.deps.getSyncState = () => oldState;
    h.deps.syncIncremental = async () => { throw new Error('HISTORY_EXPIRED'); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedStates[0].historyId).toBe('100');
    expect(h.savedStates[0]).toMatchObject({ historyBackfillPageToken: null, historyBackfillCompletedAt: null,
      historyBackfillPagesSynced: 0, historyBackfillThreadsSynced: 0 });
    expect(h.deltas[0].upserts.map(thread => thread.id)).toEqual(['inbox']);
  });

  it('preserves backfill progress committed while the history was being listed', async () => {
    const h = makeDeps({ historyId: '10' });
    const current = h.deps.getSyncState('me@example.com');
    if (!current) throw new Error('Expected initial sync state');
    h.deps.getSyncState = () => current;
    h.deps.syncIncremental = async () => {
      current.historyBackfillPageToken = 'new-page';
      current.historyBackfillPagesSynced = 2;
      current.historyBackfillThreadsSynced = 40;
      return { updatedThreadIds: ['t1'], deletedMessageIds: {}, historyId: '20' };
    };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedStates[0]).toMatchObject({ historyId: '20', historyBackfillPageToken: 'new-page',
      historyBackfillPagesSynced: 2, historyBackfillThreadsSynced: 40 });
  });
});

const quotaError = () => Object.assign(
  new Error('fetchThreadDetail error for t: HTTP 403 — {"error":{"status":"RESOURCE_EXHAUSTED","errors":[{"reason":"rateLimitExceeded"}]}}'),
  { status: 403, rateLimited: true },
);

describe('a message Gmail deleted for good', () => {
  it('takes only that message away and reads the conversation again', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['kept'], historyId: '20' },
      stored: { kept: ['kept-m1', 'kept-m2'] },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual([]);
    expect(h.fetched).toEqual(['kept']);
    expect(h.deltas[0].deletedThreadIds).toEqual([]);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['kept']);
  });

  it('removes the conversation when that was its last message', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['emptied', 'never-stored'], historyId: '20' },
      stored: { emptied: ['emptied-m1'] },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual(['emptied', 'never-stored']);
    expect(h.fetched).toEqual([]);
    expect(h.queue).toEqual([]);
    expect(h.deltas[0].deletedThreadIds).toEqual(['emptied', 'never-stored']);
  });

  it('keeps a conversation that was changed as well, even with no message left, and reads it', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['draft'], deletedThreadIds: ['draft'], historyId: '20' },
      stored: { draft: ['draft-m1'] },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual([]);
    expect(h.fetched).toEqual(['draft']);
    expect(h.deltas[0]).toMatchObject({ deletedThreadIds: [] });
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['draft']);
  });

  it('removes a shortened conversation after all when Gmail no longer has it', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['kept'], historyId: '20' },
      stored: { kept: ['kept-m1', 'kept-m2'] },
      fetchError: Object.assign(new Error('fetchThreadDetail error for kept: HTTP 404 — notFound'), { status: 404 }),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleteCalls).toEqual([['kept']]);
    expect(h.queue).toEqual([]);
    expect(h.deltas[0].deletedThreadIds).toEqual(['kept']);
  });

  it('reads changed conversations before shortened ones and keeps both queued without quota', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['new-mail'], deletedThreadIds: ['kept'], historyId: '20' },
      stored: { kept: ['kept-m1', 'kept-m2'] },
    });
    h.setQuotaAllows(false);
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.queue).toEqual(['new-mail', 'kept']);
    h.setQuotaAllows(true);
    h.deps.syncIncremental = async () => ({ updatedThreadIds: [], deletedMessageIds: {}, historyId: '20' });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toEqual(['new-mail', 'kept']);
  });

  it('tells the window about a shortened conversation at once, before its turn to be read', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['kept', 'emptied'], historyId: '20' },
      stored: { kept: ['kept-m1', 'kept-m2'], emptied: ['emptied-m1'] },
    });
    h.setQuotaAllows(false);
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toEqual([]);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['kept']);
    expect(h.deltas[0].deletedThreadIds).toEqual(['emptied']);
  });

  it('publishes a shortened conversation once when it was read in the same pass', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['kept'], historyId: '20' },
      stored: { kept: ['kept-m1', 'kept-m2'] },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['kept']);
  });

  it('reads a conversation stored without messages instead of removing it', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['bare'], historyId: '20' },
      stored: { bare: [] },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual([]);
    expect(h.fetched).toEqual(['bare']);
    expect(h.deltas[0].deletedThreadIds).toEqual([]);
  });

  it('reads a conversation again when Gmail did not name the deleted message', async () => {
    const h = makeDeps({ historyId: '10', stored: { kept: ['kept-m1'] } });
    h.deps.syncIncremental = async () => ({ updatedThreadIds: [], deletedMessageIds: { kept: [] }, historyId: '20' });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual([]);
    expect(h.fetched).toEqual(['kept']);
  });
});

describe('mailbox sync under the Gmail quota', () => {
  const ids = (count: number, prefix = 't') => Array.from({ length: count }, (_, index) => `${prefix}${index + 1}`);

  it('stops at the first quota error instead of trying every remaining conversation', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ids(10), deletedThreadIds: [], historyId: '20' },
    });
    h.deps.fetchThreadDetail = async (_email, threadId) => {
      h.fetched.push(threadId);
      if (h.fetched.length > 3) throw quotaError();
      return [message(threadId)];
    };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toHaveLength(4);
    expect(h.deltas[0].upserts).toHaveLength(3);
    expect(h.queue).toHaveLength(7);
    // The conversation Gmail refused is not at fault and is not postponed.
    expect(h.postponed).toEqual([]);
    expect(h.savedStates.map(state => state.historyId)).toEqual(['20']);
    expect(vi.mocked(h.deps.logger!.warning).mock.calls.map(call => call[1])).toEqual([
      'Gmail quota reached; the remaining conversations wait for a later pass.',
    ]);
  });

  it('works a long list off across passes without listing or reading anything twice', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ids(60), deletedThreadIds: [], historyId: '20' },
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toHaveLength(MAX_THREAD_READS_PER_PASS);
    expect(h.queue).toHaveLength(60 - MAX_THREAD_READS_PER_PASS);

    // Later passes: Gmail has nothing new, the queue is all there is to do.
    h.deps.syncIncremental = async () => ({ updatedThreadIds: [], deletedMessageIds: {}, historyId: '20' });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.queue).toEqual([]);
    expect([...h.fetched].sort()).toEqual(ids(60).sort());
    expect(h.deltas.map(delta => delta.upserts.length)).toEqual([25, 25, 10]);
  });

  it('reads nothing while the quota does not allow it and keeps everything queued', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ids(3), deletedThreadIds: ['gone'], historyId: '20' },
    });
    h.setQuotaAllows(false);
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toEqual([]);
    expect(h.queue).toHaveLength(3);
    // Deletions need no Gmail request and are applied all the same.
    expect(h.deltas[0].deletedThreadIds).toEqual(['gone']);
  });

  it('reads the conversations of an earlier pass when Gmail reports nothing new', async () => {
    const h = makeDeps({ historyId: '20', queued: ['old1', 'old2'] });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toEqual(['old1', 'old2']);
    expect(h.queue).toEqual([]);
  });

  it('removes all reported deletions in one request before reading anything', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1'], deletedThreadIds: ids(184, 'd'), historyId: '20' },
    });
    const order: string[] = [];
    const removeDeletedMessages = h.deps.removeDeletedMessages;
    h.deps.removeDeletedMessages = async (accountId, deletions) => { order.push('remove'); return removeDeletedMessages(accountId, deletions); };
    const fetchThreadDetail = h.deps.fetchThreadDetail;
    h.deps.fetchThreadDetail = async (email, threadId) => { order.push('fetch'); return fetchThreadDetail(email, threadId); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(order).toEqual(['remove', 'fetch']);
    expect(h.removalCalls).toHaveLength(1);
    expect(h.deltas[0].deletedThreadIds).toHaveLength(184);
  });

  it('does not report a removed conversation as deleted when an earlier pass queued it and Gmail still has it', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: [], deletedThreadIds: ['queued-earlier', 'gone'], historyId: '20' },
      queued: ['queued-earlier'],
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deleted).toEqual(['queued-earlier', 'gone']);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['queued-earlier']);
    expect(h.deltas[0].deletedThreadIds).toEqual(['gone']);
  });

  it('gives up for this pass after three failed reads in a row', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ids(10), deletedThreadIds: [], historyId: '20' },
      fetchError: Object.assign(new Error('fetchThreadDetail error: HTTP 503 — backend'), { status: 503 }),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toHaveLength(3);
    expect(h.postponed).toHaveLength(3);
    expect(h.queue).toHaveLength(10);
  });

  it('stops without postponing anything when the account has to sign in again', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ids(5), deletedThreadIds: [], historyId: '20' },
      fetchError: new GoogleReauthorizationRequiredError('me@example.com', 'credentials_rejected'),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.fetched).toHaveLength(1);
    expect(h.postponed).toEqual([]);
    expect(h.queue).toHaveLength(5);
  });

  it('publishes the deletions even when the queue could not be read', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1'], deletedThreadIds: ['gone'], historyId: '20' },
    });
    h.deps.dueThreadReads = () => { throw new Error('disk I/O error'); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deltas[0].deletedThreadIds).toEqual(['gone']);
    expect(h.queue).toEqual(['t1']);
  });

  it('publishes what it stored even when the queue could not be updated', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['t1'], deletedThreadIds: [], historyId: '20' },
    });
    h.deps.settleThreadReads = () => { throw new Error('database is locked'); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.deltas[0].upserts.map(item => item.id)).toEqual(['t1']);
  });

  it('keeps a conversation queued when Gmail no longer has it but the local removal failed', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['gone'], deletedThreadIds: [], historyId: '20' },
      fetchError: Object.assign(new Error('fetchThreadDetail error for gone: HTTP 404 — notFound'), { status: 404 }),
    });
    h.deps.deleteThreads = async () => { throw new Error('Database worker did not answer'); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.queue).toEqual(['gone']);
    expect(h.deltas[0].deletedThreadIds).toEqual([]);
  });
});
