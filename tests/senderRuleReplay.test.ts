// Parked sender-rule archives (external review, finding 1): a rule archive
// that waited offline is revalidated before it reaches Gmail, dropped when the
// thread no longer qualifies, and cancelled when the user brings it back.
// Real SQLite in a temp HOME; Gmail is a fake.
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailActionLog, MailMessage, MailThread, SenderRule } from '../shared/types';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

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
const accountId = WORK_ACCOUNT.email;

interface Modules {
  database: typeof import('../main/database');
  repo: typeof import('../main/senderRulesRepository');
  service: typeof import('../main/senderRulesService');
  reconciler: typeof import('../main/actionReconciler');
  mailboxSync: typeof import('../main/mailboxSync');
}

async function withDatabase(run: (modules: Modules) => Promise<void>) {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-rule-replay-'));
  vi.resetModules();
  process.env.HOME = home;
  let database: Modules['database'] | null = null;
  try {
    database = await import('../main/database');
    await run({
      database,
      repo: await import('../main/senderRulesRepository'),
      service: await import('../main/senderRulesService'),
      reconciler: await import('../main/actionReconciler'),
      mailboxSync: await import('../main/mailboxSync'),
    });
  } finally {
    database?.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  }
}

function rule(senderEmail: string, partial: Partial<SenderRule> = {}): SenderRule {
  return {
    id: 'rule-1', senderEmail, action: 'archive', enabled: true,
    createdAt: '2026-01-01T00:00:00.000Z', confirmations: 3, bringBacks: 0, ...partial,
  };
}

function storeSettings(database: Modules['database'], rules: SenderRule[], autonomy: 'prepare' | 'prepareAndRules' = 'prepareAndRules') {
  database.SettingsRepo.set('appSettings', JSON.stringify({
    accountOverrides: { [accountId]: { agentAutonomy: autonomy, senderRules: rules } },
  }));
}

const spec = WORK_INBOX.find(thread => thread.key === 'dispatch-212')!;
const messages: MailMessage[] = fixtureMessages(spec);
const thread: MailThread = buildMailThreadFromMessages(accountId, spec.key, messages)!;

/** A new message from the same sender carrying an invite only as a Gmail attachment. */
function withInvitation(): MailMessage[] {
  const last = messages[messages.length - 1];
  const invite: MailMessage = {
    ...last,
    id: `${spec.key}-invite`,
    subject: 'Invitation: Reader call',
    receivedAt: '2026-10-10T13:00:00.000Z',
    labelIds: ['INBOX', 'UNREAD', 'CATEGORY_UPDATES'],
    hasAttachments: true,
    attachments: [{ id: 'att-ics', filename: 'invite.ics', mimeType: 'text/calendar', sizeBytes: 900, attachmentId: 'att-ics' }],
  };
  return [...messages, invite];
}

interface Parked {
  action: MailActionLog;
  gmail: { modifyLabels: ReturnType<typeof vi.fn> };
  published: unknown[];
  reconcile: () => Promise<void>;
}

/** Applies the rule while Gmail is offline, leaving one parked archive. */
async function parkRuleArchive({ database, service, reconciler }: Modules): Promise<Parked> {
  const published: unknown[] = [];
  service.SenderRulesService.resetForTests();
  service.SenderRulesService.configure({
    runRemoteArchive: async () => { throw Object.assign(new Error('fetch failed'), { code: 'ENOTFOUND' }); },
    publish: event => { published.push(event); },
    logError: () => {},
    now: () => new Date('2026-10-10T12:30:00.000Z'),
  });
  storeSettings(database, [rule(thread.senderEmail)]);
  database.MessagesRepo.save(messages);
  database.ThreadsRepo.save([thread]);
  service.SenderRulesService.noteArrivals(messages, messages);
  const [archived] = await service.SenderRulesService.applyToPersistedThreads(accountId, [thread]);
  expect(archived.labelIds).not.toContain('INBOX');
  const [action] = database.ActionLogRepo.list(accountId);
  expect(action).toMatchObject({ kind: 'markDone', status: 'pending_sync' });

  const gmail = {
    modifyLabels: vi.fn(async () => undefined),
    trashThread: vi.fn(async () => undefined),
    untrashThread: vi.fn(async () => undefined),
    sendDraft: vi.fn(async () => undefined),
  };
  const deps = {
    actionLog: database.ActionLogRepo,
    threads: database.ThreadsRepo,
    drafts: database.DraftsRepo,
    gmail,
    buildForwardDraft: () => ({}),
    buildAutoReplyDraft: () => ({}),
    // The same hooks main/index.ts passes.
    validateAgentProposalReplay: (replayed: MailActionLog, payload: Record<string, unknown>) => {
      const provenance = payload.provenance as { origin?: unknown } | undefined;
      if (provenance?.origin === 'senderRule') service.SenderRulesService.assertParkedArchiveReplayable(replayed);
    },
    onPermanentFailure: (failed: MailActionLog) => { service.SenderRulesService.afterReplayRejected(failed); },
    logger: { log: () => {}, error: () => {} },
  };
  return { action, gmail, published, reconcile: () => reconciler.reconcilePendingActions(deps) };
}

function statusOf(database: Modules['database'], id: string) {
  return database.ActionLogRepo.get(id);
}

function inInbox(database: Modules['database']): boolean {
  return Boolean(database.ThreadsRepo.get(accountId, thread.id)?.labelIds.includes('INBOX'));
}

describe('parked sender-rule archives', () => {
  repositoryIt('replays exactly once when nothing changed', async () => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      await parked.reconcile();
      await parked.reconcile();
      expect(parked.gmail.modifyLabels).toHaveBeenCalledTimes(1);
      expect(parked.gmail.modifyLabels).toHaveBeenCalledWith(accountId, thread.id, [], ['INBOX']);
      expect(statusOf(modules.database, parked.action.id)?.status).toBe('completed');
      expect(modules.repo.SenderRulesRepo.listHandled(accountId).map(item => item.threadId)).toEqual([thread.id]);
    });
  });

  repositoryIt('does not replay after a new invitation arrived, and the thread is back in the inbox', async () => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      // The sync stored the new message; the overlay kept INBOX off locally.
      const updated = buildMailThreadFromMessages(accountId, thread.id, withInvitation())!;
      expect(updated.signals?.hasCalendarInvite).toBe(true);
      modules.database.ThreadsRepo.save([{ ...updated, labelIds: updated.labelIds.filter(label => label !== 'INBOX') }]);

      await parked.reconcile();
      expect(parked.gmail.modifyLabels).not.toHaveBeenCalled();
      expect(statusOf(modules.database, parked.action.id)).toMatchObject({ status: 'failed' });
      expect(statusOf(modules.database, parked.action.id)?.failureMessage).toMatch(/Sender rule archive not sent/);
      expect(inInbox(modules.database)).toBe(true);
      expect(modules.repo.SenderRulesRepo.listHandled(accountId)).toEqual([]);
      expect(parked.published).toContainEqual({ accountId });
    });
  });

  repositoryIt('drops the parked archive at sync time so the new invitation shows in the inbox', async () => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      const { database, service, mailboxSync } = modules;
      const fresh = withInvitation();
      const delta = await mailboxSync.performMailboxSyncForAccount(accountId, {
        getSyncState: () => ({ accountId, historyId: '1' } as never),
        saveSyncState: () => undefined,
        nextSyncState: (id, _base, historyId) => ({ accountId: id, historyId } as never),
        syncInbox: async () => { throw new Error('not used'); },
        syncIncremental: async () => ({ updatedThreadIds: [thread.id], deletedThreadIds: [], historyId: '2' }),
        fetchThreadDetail: async () => fresh,
        saveThreads: async threads => database.ThreadsRepo.save(threads),
        saveMessages: async saved => database.MessagesRepo.save(saved),
        deleteThread: () => undefined,
        listPendingActions: id => database.ActionLogRepo.listOpenMutations(id),
        publishDelta: (id, upserts, deletedThreadIds) => ({ accountId: id, upserts, deletedThreadIds, revision: 1, completedAt: '' }),
        afterPersist: (id, threads) => service.SenderRulesService.applyToPersistedThreads(id, threads),
        revalidateParked: (id, threads) => { service.SenderRulesService.revalidateParkedArchives(id, threads); },
      });
      expect(delta.upserts[0].labelIds).toContain('INBOX');
      expect(inInbox(database)).toBe(true);
      expect(statusOf(database, parked.action.id)?.status).toBe('failed');
      await parked.reconcile();
      expect(parked.gmail.modifyLabels).not.toHaveBeenCalled();
    });
  });

  repositoryIt('replays nothing after the user brought the conversation back', async () => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      const { database, service } = modules;
      // What api:modifyLabels does for a restore.
      service.SenderRulesService.cancelParkedArchivesOnRestore(accountId, thread.id);
      database.ThreadsRepo.updateLabels(accountId, thread.id, ['INBOX'], []);
      service.SenderRulesService.noteRestore(accountId, thread.id);

      await parked.reconcile();
      expect(parked.gmail.modifyLabels).not.toHaveBeenCalled();
      expect(statusOf(database, parked.action.id)?.status).toBe('failed');
      expect(inInbox(database)).toBe(true);
      // The bring-back still counts against the rule.
      expect(modules.repo.SenderRulesRepo.countBringBacksSince(accountId, thread.senderEmail, '2026-01-01T00:00:00.000Z')).toBe(1);
    });
  });

  repositoryIt.each([
    ['the rule is switched off', (database: Modules['database']) => storeSettings(database, [rule(thread.senderEmail, { enabled: false })])],
    ['the rule is auto-disabled', (database: Modules['database']) => storeSettings(database, [rule(thread.senderEmail, { enabled: false, autoDisabledAt: '2026-10-10T12:40:00.000Z' })])],
    ['autonomy is back to Prepare only', (database: Modules['database']) => storeSettings(database, [rule(thread.senderEmail)], 'prepare')],
  ])('is not replayed when %s', async (_label, change) => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      change(modules.database);
      await parked.reconcile();
      expect(parked.gmail.modifyLabels).not.toHaveBeenCalled();
      expect(statusOf(modules.database, parked.action.id)?.status).toBe('failed');
      expect(inInbox(modules.database)).toBe(true);
      expect(modules.repo.SenderRulesRepo.listHandled(accountId)).toEqual([]);
    });
  });

  repositoryIt('is not replayed once a second bring-back is recorded for the sender', async () => {
    await withDatabase(async modules => {
      const parked = await parkRuleArchive(modules);
      const { SenderRulesRepo } = modules.repo;
      for (const [threadId, actionId] of [['old-1', 'r-old-1'], ['old-2', 'r-old-2']]) {
        SenderRulesRepo.recordRuleArchive({ actionId, accountId, threadId, senderEmail: thread.senderEmail, archivedAt: '2026-10-09T12:00:00.000Z', ruleId: 'rule-1' });
        SenderRulesRepo.recordBringBack(accountId, threadId, new Date('2026-10-09T13:00:00.000Z'));
      }
      await parked.reconcile();
      expect(parked.gmail.modifyLabels).not.toHaveBeenCalled();
      expect(inInbox(modules.database)).toBe(true);
    });
  });
});
