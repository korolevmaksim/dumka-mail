import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Draft, MailActionLog } from '../shared/types';

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

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-scheduled-send-'));
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

function draft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    accountId: 'me@example.com',
    threadId: null,
    to: [{ name: '', email: 'you@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Scheduled hello',
    bodyPlain: 'Hello later',
    bodyHtml: '<p>Hello later</p>',
    attachments: [],
    updatedAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

function action(overrides: Partial<MailActionLog> = {}): MailActionLog {
  return {
    id: 'action-1',
    accountId: 'me@example.com',
    threadId: null,
    draftId: 'draft-1',
    kind: 'send',
    status: 'pending_sync',
    createdAt: '2026-07-02T09:00:00.000Z',
    ...overrides,
  };
}

describe('scheduled send persistence', () => {
  repositoryIt('persists draft sendAt and gates pending send actions until scheduledAt', async () => {
    await withIsolatedDatabase(async ({ ActionLogRepo, DraftsRepo }) => {
      const dueAt = '2026-07-02T09:30:00.000Z';
      const futureAt = '2026-07-02T11:00:00.000Z';
      const now = '2026-07-02T10:00:00.000Z';

      DraftsRepo.save(draft({ sendAt: futureAt }));
      expect(DraftsRepo.get('draft-1')?.sendAt).toBe(futureAt);

      ActionLogRepo.save(action({ id: 'due', scheduledAt: dueAt }));
      ActionLogRepo.save(action({
        id: 'future',
        draftId: 'draft-future',
        scheduledAt: futureAt,
        createdAt: '2026-07-02T09:10:00.000Z',
      }));
      ActionLogRepo.save(action({
        id: 'immediate',
        kind: 'markDone',
        threadId: 'thread-1',
        draftId: null,
        createdAt: '2026-07-02T09:45:00.000Z',
      }));

      expect(ActionLogRepo.list('me@example.com').find(item => item.id === 'future')?.scheduledAt).toBe(futureAt);
      expect(ActionLogRepo.listPending(now).map(item => item.id)).toEqual(['due', 'immediate']);
      expect(ActionLogRepo.listPending('2026-07-02T11:00:00.001Z').map(item => item.id)).toEqual(['due', 'immediate', 'future']);
    });
  });
});
