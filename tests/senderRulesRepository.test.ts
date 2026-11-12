import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailMessage, MailThread, SenderRule } from '../shared/types';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const require = createRequire(import.meta.url);

function canLoadNativeSqlite(): boolean {
  try {
    const Database = require('better-sqlite3') as { new (filename: string): { close: () => void } };
    const database = new Database(':memory:');
    database.close();
    return true;
  } catch {
    return false;
  }
}

const repositoryIt = canLoadNativeSqlite() ? it : it.skip;
const accountId = WORK_ACCOUNT.email;

interface Modules {
  database: typeof import('../main/database');
  repo: typeof import('../main/senderRulesRepository');
  service: typeof import('../main/senderRulesService');
}

async function withDatabase(run: (modules: Modules) => void | Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-sender-rules-'));
  vi.resetModules();
  process.env.HOME = home;
  let database: typeof import('../main/database') | null = null;
  try {
    database = await import('../main/database');
    const repo = await import('../main/senderRulesRepository');
    const service = await import('../main/senderRulesService');
    await run({ database, repo, service });
  } finally {
    database?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

function fixture(key: string): { thread: MailThread; messages: MailMessage[] } {
  const spec = WORK_INBOX.find(candidate => candidate.key === key);
  if (!spec) throw new Error(key);
  const messages = fixtureMessages(spec);
  const thread = buildMailThreadFromMessages(accountId, key, messages);
  if (!thread) throw new Error(key);
  return { thread, messages };
}

function archive(threadId: string, actionId: string, archivedAt = '2026-10-10T12:00:00.000Z') {
  return {
    actionId,
    accountId,
    threadId,
    senderEmail: 'news@dispatch.example',
    senderName: 'The Pragmatic Dispatch',
    subject: 'Issue',
    archivedAt,
  };
}

function rule(senderEmail: string, partial: Partial<SenderRule> = {}): SenderRule {
  return {
    id: 'rule-1',
    senderEmail,
    action: 'archive',
    enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z',
    confirmations: 3,
    bringBacks: 0,
    ...partial,
  };
}

describe('SenderRulesRepo', () => {
  repositoryIt('counts one confirmation per action and per thread', async () => {
    await withDatabase(({ repo }) => {
      const { SenderRulesRepo } = repo;
      expect(SenderRulesRepo.recordConfirmation(archive('t1', 'a1'))).toBe(true);
      // Replay of the same action id, and a second archive of the same thread.
      expect(SenderRulesRepo.recordConfirmation(archive('t1', 'a1'))).toBe(false);
      expect(SenderRulesRepo.recordConfirmation(archive('t1', 'a2'))).toBe(false);
      expect(SenderRulesRepo.recordConfirmation(archive('t2', 'a3'))).toBe(true);
      expect(SenderRulesRepo.listStats(accountId)).toEqual([expect.objectContaining({
        senderEmail: 'news@dispatch.example', senderName: 'The Pragmatic Dispatch', confirmations: 2, bringBacks: 0,
      })]);
    });
  });

  repositoryIt('counts a bring-back only within the window, once per archive', async () => {
    await withDatabase(({ repo }) => {
      const { SenderRulesRepo } = repo;
      SenderRulesRepo.recordConfirmation(archive('t1', 'a1', '2026-10-01T12:00:00.000Z'));
      SenderRulesRepo.recordConfirmation(archive('t2', 'a2', '2026-10-10T12:00:00.000Z'));
      const now = new Date('2026-10-10T13:00:00.000Z');
      expect(SenderRulesRepo.recordBringBack(accountId, 't1', now)).toBeNull();
      expect(SenderRulesRepo.recordBringBack(accountId, 't2', now)).toMatchObject({ senderEmail: 'news@dispatch.example', origin: 'user', ruleId: null });
      expect(SenderRulesRepo.recordBringBack(accountId, 't2', now)).toBeNull();
      expect(SenderRulesRepo.getStats(accountId, 'news@dispatch.example')).toMatchObject({ confirmations: 2, bringBacks: 1 });
    });
  });

  repositoryIt('lists rule archives until reviewed or brought back, and remembers Not now', async () => {
    await withDatabase(({ repo }) => {
      const { SenderRulesRepo } = repo;
      SenderRulesRepo.recordRuleArchive({ ...archive('t1', 'r1'), ruleId: 'rule-1' });
      SenderRulesRepo.recordRuleArchive({ ...archive('t2', 'r2', '2026-10-10T12:05:00.000Z'), ruleId: 'rule-1' });
      expect(SenderRulesRepo.listHandled(accountId).map(item => item.threadId)).toEqual(['t2', 't1']);
      // Rule archives are not confirmations.
      expect(SenderRulesRepo.getStats(accountId, 'news@dispatch.example')).toBeNull();

      const back = SenderRulesRepo.recordBringBack(accountId, 't1', new Date('2026-10-10T13:00:00.000Z'));
      expect(back).toMatchObject({ origin: 'senderRule', ruleId: 'rule-1' });
      expect(SenderRulesRepo.wasBroughtBackFromRule(accountId, 't1')).toBe(true);
      expect(SenderRulesRepo.listHandled(accountId).map(item => item.threadId)).toEqual(['t2']);

      expect(SenderRulesRepo.markHandledReviewed(accountId, new Date('2026-10-10T14:00:00.000Z'))).toBe(1);
      expect(SenderRulesRepo.listHandled(accountId)).toEqual([]);

      SenderRulesRepo.dismissOffer(accountId, 'Other@X.example', new Date('2026-10-10T14:00:00.000Z'));
      expect(SenderRulesRepo.getStats(accountId, 'other@x.example')?.dismissedAt).toBe('2026-10-10T14:00:00.000Z');
    });
  });

  repositoryIt('is purged with the account cache', async () => {
    await withDatabase(({ database, repo }) => {
      const { SenderRulesRepo } = repo;
      database.AccountsRepo.save({ id: accountId, email: accountId, displayName: 'Alex', colorHex: '#000000', createdAt: '2026-01-01T00:00:00.000Z' } as never);
      SenderRulesRepo.recordConfirmation(archive('t1', 'a1'));
      SenderRulesRepo.recordRuleArchive({ ...archive('t2', 'r1'), ruleId: 'rule-1' });
      database.AccountsRepo.delete(accountId, { purgeCache: true });
      expect(SenderRulesRepo.listStats(accountId)).toEqual([]);
      expect(SenderRulesRepo.listHandled(accountId)).toEqual([]);
    });
  });
});

describe('SenderRulesService', () => {
  function configure(service: Modules['service'], remote: () => Promise<void>, now: () => Date = () => new Date('2026-10-10T12:30:00.000Z')) {
    const published: unknown[] = [];
    service.SenderRulesService.resetForTests();
    service.SenderRulesService.configure({
      runRemoteArchive: remote,
      publish: event => { published.push(event); },
      logError: () => {},
      now,
    });
    return published;
  }

  function storeSettings(database: Modules['database'], rules: SenderRule[], autonomy: 'prepare' | 'prepareAndRules' = 'prepareAndRules') {
    database.SettingsRepo.set('appSettings', JSON.stringify({
      accountOverrides: { [accountId]: { agentAutonomy: autonomy, senderRules: rules } },
    }));
  }

  repositoryIt('archives new inbound mail of a ruled sender and suppresses its notification', async () => {
    await withDatabase(async ({ database, repo, service }) => {
      const remote = vi.fn(async () => {});
      const published = configure(service, remote);
      const { thread, messages } = fixture('dispatch-212');
      storeSettings(database, [rule(thread.senderEmail)]);
      database.ThreadsRepo.save([thread]);

      const suppressed = service.SenderRulesService.noteArrivals(messages, messages);
      expect(Array.from(suppressed)).toEqual([thread.id]);
      const [result] = await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]);

      expect(result.labelIds).not.toContain('INBOX');
      expect(database.ThreadsRepo.get(accountId, thread.id)?.labelIds).not.toContain('INBOX');
      expect(remote).toHaveBeenCalledWith(accountId, thread.id);
      const [log] = database.ActionLogRepo.list(accountId);
      expect(log).toMatchObject({ kind: 'markDone', status: 'completed', threadId: thread.id });
      expect(JSON.parse(log.payloadJson || '{}').provenance).toEqual({ origin: 'senderRule', ruleId: 'rule-1' });
      expect(repo.SenderRulesRepo.listHandled(accountId).map(item => item.threadId)).toEqual([thread.id]);
      expect(published).toContainEqual({ accountId });
    });
  });

  repositoryIt('does nothing for mail from before the rule, for Prepare only, or for people', async () => {
    await withDatabase(async ({ database, service }) => {
      const remote = vi.fn(async () => {});
      configure(service, remote);
      const { thread, messages } = fixture('dispatch-212');
      const person = fixture('pilot-date');
      database.ThreadsRepo.save([thread, person.thread]);

      storeSettings(database, [rule(thread.senderEmail, { createdAt: '2026-10-11T00:00:00.000Z' })]);
      expect(service.SenderRulesService.noteArrivals(messages, messages).size).toBe(0);
      expect((await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]))[0].labelIds).toContain('INBOX');

      storeSettings(database, [rule(thread.senderEmail)], 'prepare');
      service.SenderRulesService.noteArrivals(messages, messages);
      expect((await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]))[0].labelIds).toContain('INBOX');

      storeSettings(database, [rule(person.thread.senderEmail)]);
      service.SenderRulesService.noteArrivals(person.messages, person.messages);
      expect((await service.SenderRulesService.applyToPersistedThreads(accountId, [person.thread]))[0].labelIds).toContain('INBOX');

      // Nothing new arrived: an existing thread is never handled retroactively.
      storeSettings(database, [rule(thread.senderEmail)]);
      expect(service.SenderRulesService.noteArrivals(messages, []).size).toBe(0);
      expect((await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]))[0].labelIds).toContain('INBOX');
      expect(remote).not.toHaveBeenCalled();
    });
  });

  repositoryIt('parks the archive offline and rolls back on a permanent Gmail failure', async () => {
    await withDatabase(async ({ database, repo, service }) => {
      const { thread, messages } = fixture('dispatch-212');
      storeSettings(database, [rule(thread.senderEmail)]);
      database.ThreadsRepo.save([thread]);

      configure(service, async () => { throw Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' }); });
      service.SenderRulesService.noteArrivals(messages, messages);
      const [offline] = await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]);
      expect(offline.labelIds).not.toContain('INBOX');
      expect(database.ActionLogRepo.list(accountId)[0].status).toBe('pending_sync');

      database.ThreadsRepo.updateLabels(accountId, thread.id, ['INBOX'], []);
      repo.SenderRulesRepo.markHandledReviewed(accountId, new Date('2026-10-10T12:40:00.000Z'));
      configure(service, async () => { throw Object.assign(new Error('HTTP 403 Forbidden'), { status: 403 }); });
      service.SenderRulesService.noteArrivals(messages, messages);
      const [rejected] = await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]);
      expect(rejected.labelIds).toContain('INBOX');
      expect(database.ThreadsRepo.get(accountId, thread.id)?.labelIds).toContain('INBOX');
      expect(repo.SenderRulesRepo.listHandled(accountId)).toEqual([]);
    });
  });

  repositoryIt('learns from the user’s archive and publishes bring-backs', async () => {
    await withDatabase(({ database, repo, service }) => {
      let clock = new Date('2026-10-10T12:30:00.000Z');
      const published = configure(service, async () => {}, () => clock);
      const { thread } = fixture('dispatch-212');
      const person = fixture('pilot-date');
      database.ThreadsRepo.save([thread, person.thread]);

      service.SenderRulesService.noteArchive(accountId, database.ThreadsRepo.get(accountId, thread.id), 'act-1', null);
      service.SenderRulesService.noteArchive(accountId, database.ThreadsRepo.get(accountId, person.thread.id), 'act-2', null);
      // A rule's own archive is never a confirmation.
      service.SenderRulesService.noteArchive(accountId, database.ThreadsRepo.get(accountId, thread.id), 'act-3', JSON.stringify({ provenance: { origin: 'senderRule', ruleId: 'r' } }));
      expect(repo.SenderRulesRepo.listStats(accountId)).toEqual([expect.objectContaining({ senderEmail: thread.senderEmail, confirmations: 1 })]);

      clock = new Date('2026-10-10T12:31:00.000Z');
      service.SenderRulesService.noteRestore(accountId, thread.id);
      expect(published).toContainEqual({
        accountId,
        bringBack: { senderEmail: thread.senderEmail, senderName: expect.any(String), ruleId: null },
      });
      expect(repo.SenderRulesRepo.getStats(accountId, thread.senderEmail)?.bringBacks).toBe(1);
    });
  });

  repositoryIt('treats Undo within the toast window as no archive, not a bring-back', async () => {
    await withDatabase(({ database, repo, service }) => {
      let clock = new Date('2026-10-10T12:30:00.000Z');
      const published = configure(service, async () => {}, () => clock);
      const { thread } = fixture('dispatch-212');
      database.ThreadsRepo.save([thread]);

      service.SenderRulesService.noteArchive(accountId, database.ThreadsRepo.get(accountId, thread.id), 'act-1', null);
      expect(repo.SenderRulesRepo.getStats(accountId, thread.senderEmail)?.confirmations).toBe(1);
      clock = new Date('2026-10-10T12:30:10.000Z');
      service.SenderRulesService.noteRestore(accountId, thread.id);
      expect(repo.SenderRulesRepo.getStats(accountId, thread.senderEmail)).toMatchObject({ confirmations: 0, bringBacks: 0 });
      expect(published.some(event => (event as { bringBack?: unknown }).bringBack)).toBe(false);

      // Archiving again later counts again, and a late restore is a bring-back.
      clock = new Date('2026-10-10T12:35:00.000Z');
      service.SenderRulesService.noteArchive(accountId, database.ThreadsRepo.get(accountId, thread.id), 'act-2', null);
      clock = new Date('2026-10-10T12:36:00.000Z');
      service.SenderRulesService.noteRestore(accountId, thread.id);
      expect(repo.SenderRulesRepo.getStats(accountId, thread.senderEmail)).toMatchObject({ confirmations: 1, bringBacks: 1 });
    });
  });

  repositoryIt('stops applying a rule with two stored bring-backs before the renderer turns it off', async () => {
    await withDatabase(async ({ database, repo, service }) => {
      const remote = vi.fn(async () => {});
      configure(service, remote);
      const { thread, messages } = fixture('dispatch-212');
      // Settings still say enabled with no bring-backs.
      storeSettings(database, [rule(thread.senderEmail)]);
      database.ThreadsRepo.save([thread]);
      for (const [threadId, actionId] of [['old-1', 'r1'], ['old-2', 'r2']]) {
        repo.SenderRulesRepo.recordRuleArchive({
          actionId, accountId, threadId, senderEmail: thread.senderEmail, archivedAt: '2026-10-09T12:00:00.000Z', ruleId: 'rule-1',
        });
        repo.SenderRulesRepo.recordBringBack(accountId, threadId, new Date('2026-10-09T13:00:00.000Z'));
      }
      expect(repo.SenderRulesRepo.countBringBacksSince(accountId, thread.senderEmail, '2026-01-01T00:00:00.000Z')).toBe(2);

      expect(service.SenderRulesService.noteArrivals(messages, messages).size).toBe(0);
      const [result] = await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]);
      expect(result.labelIds).toContain('INBOX');
      expect(remote).not.toHaveBeenCalled();
    });
  });

  repositoryIt('forgets pending arrivals of a removed account', async () => {
    await withDatabase(async ({ database, service }) => {
      configure(service, async () => {});
      const { thread, messages } = fixture('dispatch-212');
      storeSettings(database, [rule(thread.senderEmail)]);
      service.SenderRulesService.noteArrivals(messages, messages);
      expect(service.SenderRulesService.pendingArrivalCount()).toBe(1);
      service.SenderRulesService.forgetAccount(accountId.toUpperCase());
      expect(service.SenderRulesService.pendingArrivalCount()).toBe(0);
    });
  });
});
