// The durable side of a held scheduled message: the draft's send time, the
// action's outcome and the notice for the person are written together or not
// at all, and a notice stays stored until a window acknowledges it.
// Real SQLite in a temp HOME.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { Draft, MailActionLog } from '../shared/types';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;
const accountId = 'alex.morgan@northwind.example';
const SEND_AT = '2026-11-17T09:00:00.000Z';
const NOW = new Date('2026-11-17T14:00:00.000Z');

interface Modules {
  database: typeof import('../main/database');
  held: typeof import('../main/heldScheduledSends');
}

async function withDatabase(run: (modules: Modules) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-held-sends-'));
  vi.resetModules();
  process.env.HOME = home;
  let database: Modules['database'] | null = null;
  try {
    database = await import('../main/database');
    await run({ database, held: await import('../main/heldScheduledSends') });
  } finally {
    vi.restoreAllMocks();
    database?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

function draft(id: string): Draft {
  return {
    id, accountId, threadId: null,
    to: [{ name: 'Priya Raman', email: 'priya.raman@lumenlabs.example' }], cc: [], bcc: [],
    subject: `Subject ${id}`, bodyPlain: 'Attached as promised.', bodyHtml: null, attachments: [],
    sendAt: SEND_AT, rfcMessageId: `<${id}@dumka-mail.local>`, updatedAt: '2026-11-16T18:00:00.000Z',
  } as Draft;
}

function pendingSend(id: string, draftId: string): MailActionLog {
  return {
    id, accountId, threadId: null, draftId, kind: 'send', status: 'pending_sync',
    createdAt: '2026-11-16T18:00:00.000Z', scheduledAt: SEND_AT, completedAt: null, failureMessage: null,
    payloadJson: JSON.stringify({ sendAt: SEND_AT }),
  };
}

function failed(action: MailActionLog): MailActionLog {
  return { ...action, status: 'failed', completedAt: NOW.toISOString(), failureMessage: 'Not sent: it was scheduled and could not be sent then.' };
}

function seed({ database }: Modules, id = 'd1', actionId = 'a1') {
  const stored = draft(id);
  const action = pendingSend(actionId, id);
  database.DraftsRepo.save(stored);
  database.ActionLogRepo.save(action);
  return { stored, action };
}

describe('held scheduled sends', () => {
  repositoryIt('stores the released draft, the failed action and the notice together', async () => {
    await withDatabase(modules => {
      const { database, held } = modules;
      const { stored, action } = seed(modules);
      held.storeScheduledSendHold(failed(action), { sendAt: SEND_AT, draft: stored }, NOW);

      expect(database.DraftsRepo.get('d1')).toMatchObject({ sendAt: null, subject: 'Subject d1', bodyPlain: 'Attached as promised.' });
      expect(database.ActionLogRepo.get('a1')).toMatchObject({ status: 'failed', failureMessage: expect.stringContaining('could not be sent') });
      expect(database.ActionLogRepo.listPending(NOW.toISOString())).toEqual([]);
      expect(held.readHeldScheduledSends()).toEqual([
        { actionId: 'a1', accountId, draftId: 'd1', subject: 'Subject d1', sendAt: SEND_AT, heldAt: NOW.toISOString() },
      ]);
    });
  });

  repositoryIt.each([
    ['the notice', (database: Modules['database']) => vi.spyOn(database.SettingsRepo, 'set').mockImplementation(() => { throw new Error('disk full'); })],
    ['the action', (database: Modules['database']) => vi.spyOn(database.ActionLogRepo, 'save').mockImplementation(() => { throw new Error('disk full'); })],
  ])('writes nothing when %s cannot be stored', async (_label, breakWrite) => {
    await withDatabase(modules => {
      const { database, held } = modules;
      const { stored, action } = seed(modules);
      const spy = breakWrite(database);
      expect(() => held.storeScheduledSendHold(failed(action), { sendAt: SEND_AT, draft: stored }, NOW)).toThrow('disk full');
      spy.mockRestore();

      // Still a scheduled message waiting to be handled: it will be held on the next pass.
      expect(database.DraftsRepo.get('d1')).toMatchObject({ sendAt: SEND_AT });
      expect(database.ActionLogRepo.get('a1')).toMatchObject({ status: 'pending_sync', failureMessage: null });
      expect(held.readHeldScheduledSends()).toEqual([]);
    });
  });

  repositoryIt('holding the same action twice keeps one notice', async () => {
    await withDatabase(modules => {
      const { held } = modules;
      const { stored, action } = seed(modules);
      held.storeScheduledSendHold(failed(action), { sendAt: SEND_AT, draft: stored }, NOW);
      held.storeScheduledSendHold(failed(action), { sendAt: SEND_AT, draft: stored }, NOW);
      expect(held.readHeldScheduledSends().map(item => item.actionId)).toEqual(['a1']);
    });
  });

  repositoryIt('keeps a notice until a window acknowledges it, and only that one', async () => {
    await withDatabase(modules => {
      const { held } = modules;
      const first = seed(modules, 'd1', 'a1');
      const second = seed(modules, 'd2', 'a2');
      held.storeScheduledSendHold(failed(first.action), { sendAt: SEND_AT, draft: first.stored }, NOW);
      held.storeScheduledSendHold(failed(second.action), { sendAt: SEND_AT, draft: second.stored }, NOW);

      // Reading is not showing: both are still there.
      expect(held.readHeldScheduledSends().map(item => item.actionId)).toEqual(['a1', 'a2']);
      expect(held.readHeldScheduledSends().map(item => item.actionId)).toEqual(['a1', 'a2']);

      for (const junk of [undefined, null, 'a1', {}, [], [7, '', null]]) held.acknowledgeHeldScheduledSends(junk);
      expect(held.readHeldScheduledSends()).toHaveLength(2);

      held.acknowledgeHeldScheduledSends(['a1', 'unknown']);
      expect(held.readHeldScheduledSends().map(item => item.actionId)).toEqual(['a2']);
      held.acknowledgeHeldScheduledSends(['a2']);
      expect(held.readHeldScheduledSends()).toEqual([]);
    });
  });

  repositoryIt('reads a damaged stored list as empty instead of failing', async () => {
    await withDatabase(({ database, held }) => {
      database.SettingsRepo.set(held.HELD_SCHEDULED_SENDS_KEY, '{not json');
      expect(held.readHeldScheduledSends()).toEqual([]);
    });
  });

  repositoryIt('a hold without a draft still fails the action and records nothing to show', async () => {
    await withDatabase(({ database, held }) => {
      const action = { ...pendingSend('a9', 'gone'), draftId: null };
      database.ActionLogRepo.save(action);
      held.storeScheduledSendHold(failed(action), { sendAt: SEND_AT, draft: null }, NOW);
      expect(database.ActionLogRepo.get('a9')?.status).toBe('failed');
      expect(held.readHeldScheduledSends()).toEqual([]);
    });
  });
});
