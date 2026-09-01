import { describe, expect, it, vi } from 'vitest';
import { performMailboxSyncForAccount, type MailboxSyncDeps } from '../main/mailboxSync';
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
} = {}) {
  const savedStates: SyncState[] = [];
  const savedThreads: MailThread[][] = [];
  const savedMessages: MailMessage[][] = [];
  const deleted: string[] = [];
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
    syncIncremental: async () => options.incremental || { updatedThreadIds: [], deletedThreadIds: [], historyId: '20' },
    fetchThreadDetail: async (_email, threadId) => {
      if (options.fetchError) throw options.fetchError;
      return [message(threadId)];
    },
    saveThreads: async threads => { savedThreads.push(threads); },
    saveMessages: async messages => { savedMessages.push(messages); },
    deleteThread: (_accountId, threadId) => { deleted.push(threadId); },
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
    deltas,
    setPending(next: MailActionLog[]) { pending = next; },
  };
}

describe('performMailboxSyncForAccount', () => {
  it('does not advance the history cursor when a thread fetch fails', async () => {
    const h = makeDeps({
      historyId: '10',
      incremental: { updatedThreadIds: ['18f2c404b7e3d012'], deletedThreadIds: [], historyId: '20' },
      fetchError: Object.assign(new Error('fetchThreadDetail error for 18f2c404b7e3d012: HTTP 503 — backend'), { status: 503 }),
    });
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedStates).toHaveLength(0);
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
    h.deps.syncIncremental = async () => { throw new Error('HISTORY_EXPIRED'); };
    await performMailboxSyncForAccount('me@example.com', h.deps);
    expect(h.savedStates[0].historyId).toBe('100');
    expect(h.deltas[0].upserts.map(thread => thread.id)).toEqual(['inbox']);
  });
});
