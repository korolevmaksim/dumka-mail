import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { ReplyPipelineState } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    const db = new Database(':memory:');
    db.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-reply-pipeline-'));
  let databaseModule: typeof import('../main/database') | null = null;
  vi.resetModules();
  process.env.HOME = home;

  try {
    databaseModule = await import('../main/database');
    return await run(databaseModule);
  } finally {
    databaseModule?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

function state(overrides: Partial<ReplyPipelineState> = {}): ReplyPipelineState {
  return {
    accountId: 'me@example.com',
    threadId: 'thread-1',
    sourceMessageId: 'message-1',
    sourceReceivedAt: '2026-07-09T09:00:00.000Z',
    sourceKind: 'inbound',
    status: 'draftReady',
    resumeStatus: null,
    draftId: 'draft-1',
    draftOrigin: 'automation',
    hasPlaceholders: true,
    waitingSince: null,
    dueAt: null,
    snoozedUntil: null,
    reason: 'Direct request needs a reply.',
    priority: 91,
    resolvedAt: null,
    createdAt: '2026-07-09T09:01:00.000Z',
    updatedAt: '2026-07-09T09:02:00.000Z',
    ...overrides,
  };
}

describe('ReplyPipelineRepo', () => {
  repositoryIt('round-trips lifecycle state, lists accounts, and finds a linked draft', async () => {
    await withIsolatedDatabase(({ ReplyPipelineRepo }) => {
      ReplyPipelineRepo.save(state());
      ReplyPipelineRepo.save(state({
        accountId: 'other@example.com',
        threadId: 'thread-2',
        sourceMessageId: 'message-2',
        draftId: null,
        draftOrigin: null,
        hasPlaceholders: false,
        status: 'waitingOnThem',
        waitingSince: '2026-07-09T10:00:00.000Z',
        dueAt: '2026-07-11T10:00:00.000Z',
      }));

      expect(ReplyPipelineRepo.get('me@example.com', 'thread-1')).toEqual(state());
      expect(ReplyPipelineRepo.findByDraftId('me@example.com', 'draft-1')).toEqual(state());
      expect(ReplyPipelineRepo.findByDraftId('other@example.com', 'draft-1')).toBeNull();
      expect(ReplyPipelineRepo.list(['me@example.com']).map(item => item.threadId)).toEqual(['thread-1']);
      expect(ReplyPipelineRepo.list(['me@example.com', 'other@example.com'])).toHaveLength(2);
    });
  });

  repositoryIt('updates a thread in place and cleans rows with thread/account cache deletion', async () => {
    await withIsolatedDatabase(({ AccountsRepo, ReplyPipelineRepo, ThreadsRepo }) => {
      ReplyPipelineRepo.save(state());
      ReplyPipelineRepo.save(state({ status: 'suppressed', draftId: null, draftOrigin: null }));
      expect(ReplyPipelineRepo.get('me@example.com', 'thread-1')?.status).toBe('suppressed');

      ThreadsRepo.delete('me@example.com', 'thread-1');
      expect(ReplyPipelineRepo.get('me@example.com', 'thread-1')).toBeNull();

      ReplyPipelineRepo.save(state({ threadId: 'thread-2' }));
      AccountsRepo.delete('me@example.com', { purgeCache: true });
      expect(ReplyPipelineRepo.list('me@example.com')).toEqual([]);
    });
  });
});
