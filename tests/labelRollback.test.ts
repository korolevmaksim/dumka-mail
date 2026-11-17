import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ActionKind, MailActionLog, MailThread } from '../shared/types';
import { applyPendingLabelAction, labelChangesOfAction } from '../shared/mailActions';

const require = createRequire(import.meta.url);

function sqliteAvailable(): boolean {
  try {
    const Database = require('better-sqlite3') as new (filename: string) => { close(): void };
    new Database(':memory:').close();
    return true;
  } catch {
    return false;
  }
}

const sqliteIt = sqliteAvailable() ? it : it.skip;
const accountId = 'alex.morgan@northwind.example';

function thread(labelIds: string[]): MailThread {
  return {
    id: 'thread-1',
    accountId,
    subject: 'Quarterly plan',
    snippet: '',
    lastMessageAt: new Date(Date.UTC(2026, 10, 17)).toISOString(),
    senderNames: ['Jordan Lee'],
    senderEmail: 'jordan.lee@northwind.example',
    to: [],
    cc: [],
    labelIds,
    hasAttachments: false,
    isUnread: labelIds.includes('UNREAD'),
  } as unknown as MailThread;
}

function action(id: string, kind: ActionKind, minute: number, overrides: Partial<MailActionLog> = {}): MailActionLog {
  return {
    id,
    accountId,
    threadId: 'thread-1',
    kind,
    status: 'running',
    createdAt: new Date(Date.UTC(2026, 10, 17, 19, minute)).toISOString(),
    payloadJson: null,
    ...overrides,
  };
}

describe('labelChangesOfAction', () => {
  const label = JSON.stringify({ labelId: 'Label_7' });
  const cases: Array<[ActionKind, string | null]> = [
    ['markDone', null], ['unsubscribeSender', null], ['restoreInbox', null], ['markRead', null], ['markUnread', null],
    ['moveToTrash', null], ['restoreFromTrash', null], ['reportSpam', null], ['restoreFromSpam', null],
    ['muteThread', label], ['muteThread', null], ['unmuteThread', label], ['unmuteThread', null],
    ['applyLabel', label], ['applyLabel', null], ['removeLabel', label], ['moveToLabel', label], ['moveToLabel', null],
    ['setReminder', null], ['send', null], ['forwardThread', null], ['ruleShadowMatch', null],
  ];

  it.each(cases)('names exactly the labels applyPendingLabelAction changes for %s (payload %s)', (kind, payloadJson) => {
    const changes = labelChangesOfAction({ kind, payloadJson });
    const all = ['INBOX', 'UNREAD', 'TRASH', 'SPAM', 'Label_7'];
    // From a thread that has every label, and from one that has none.
    for (const start of [all, [] as string[]]) {
      const after = applyPendingLabelAction(thread(start), action('a', kind, 0, { payloadJson })).labelIds;
      const added = after.filter(item => !start.includes(item)).sort();
      const removed = start.filter(item => !after.includes(item)).sort();
      expect(added).toEqual(changes.add.filter(item => !start.includes(item)).sort());
      expect(removed).toEqual(changes.remove.filter(item => start.includes(item)).sort());
    }
  });
});

describe('ThreadsRepo.rollbackLabels', () => {
  let database: typeof import('../main/database');
  let home: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    if (!sqliteAvailable()) return;
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'dumka-label-rollback-'));
    vi.resetModules();
    process.env.HOME = home;
    database = await import('../main/database');
  });

  afterEach(() => {
    if (!sqliteAvailable()) return;
    database.getDatabase().close();
    if (previousHome === undefined) delete process.env.HOME;
    else process.env.HOME = previousHome;
    vi.resetModules();
    rmSync(home, { recursive: true, force: true });
  });

  const labels = () => database.ThreadsRepo.get(accountId, 'thread-1')?.labelIds.slice().sort();

  sqliteIt('updateLabels reports only what it really changed', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);

    expect(database.ThreadsRepo.updateLabels(accountId, 'thread-1', ['TRASH'], ['INBOX', 'UNREAD'])).toEqual({ added: ['TRASH'], removed: ['INBOX'] });
    expect(database.ThreadsRepo.updateLabels(accountId, 'thread-1', ['TRASH'], ['INBOX'])).toEqual({ added: [], removed: [] });
    expect(database.ThreadsRepo.updateLabels(accountId, 'no-such-thread', ['TRASH'], [])).toEqual({ added: [], removed: [] });
  });

  sqliteIt('puts back only what the action changed, so a label it found in place stays', () => {
    // Already archived when the archive was asked for again.
    database.ThreadsRepo.save([thread(['UNREAD'])]);
    const applied = database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['INBOX']);

    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', applied.removed, applied.added);

    expect(labels()).toEqual(['UNREAD']);
  });

  sqliteIt('leaves a label alone that a newer action of the thread has taken over', () => {
    // Older "mark read" (in flight), then a newer "mark read" that Gmail accepted.
    database.ThreadsRepo.save([thread(['INBOX'])]);
    database.ActionLogRepo.save(action('older', 'markRead', 0));
    database.ActionLogRepo.save(action('newer', 'markRead', 1, { status: 'completed' }));

    // Gmail rejects the older one: its rollback would put UNREAD back.
    const change = database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], [], { actionId: 'older' });

    expect(change).toEqual({ added: [], removed: [] });
    expect(labels()).toEqual(['INBOX']);
  });

  sqliteIt('still rolls back the labels the newer action did not touch', () => {
    // Older: move to Trash. Newer: mark read.
    database.ThreadsRepo.save([thread(['TRASH'])]);
    database.ActionLogRepo.save(action('older', 'moveToTrash', 0));
    database.ActionLogRepo.save(action('newer', 'markRead', 1, { status: 'pending_sync' }));

    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['INBOX'], ['TRASH'], { actionId: 'older' });

    expect(labels()).toEqual(['INBOX']);
  });

  sqliteIt('keeps the part a newer action shares and undoes the rest', () => {
    // Older: move to Trash (TRASH on, INBOX off). Newer: archive (INBOX off).
    database.ThreadsRepo.save([thread(['TRASH'])]);
    database.ActionLogRepo.save(action('older', 'moveToTrash', 0));
    database.ActionLogRepo.save(action('newer', 'markDone', 1, { status: 'completed' }));

    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['INBOX'], ['TRASH'], { actionId: 'older' });

    // Out of Trash again, but still archived, as the newer action left it.
    expect(labels()).toEqual([]);
  });

  sqliteIt.each([
    ['an older action', action('other', 'markRead', -1, { status: 'completed' })],
    ['a newer action that failed', action('other', 'markRead', 1, { status: 'failed' })],
    ['a newer action of another thread', action('other', 'markRead', 1, { status: 'completed', threadId: 'thread-2' })],
    ['a newer action that changes no labels', action('other', 'setReminder', 1, { status: 'completed' })],
  ])('rolls back fully next to %s', (_name, other) => {
    database.ThreadsRepo.save([thread(['INBOX'])]);
    database.ActionLogRepo.save(action('older', 'markRead', 0));
    database.ActionLogRepo.save(other);

    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], [], { actionId: 'older' });

    expect(labels()).toEqual(['INBOX', 'UNREAD']);
  });

  sqliteIt('rolls back as asked when the action has no journal entry or no id is given', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);
    database.ActionLogRepo.save(action('newer', 'markRead', 1, { status: 'completed' }));

    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], [], { actionId: 'not-in-the-journal' });
    expect(labels()).toEqual(['INBOX', 'UNREAD']);

    database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']);
    database.ThreadsRepo.rollbackLabels(accountId, 'thread-1', ['UNREAD'], []);
    expect(labels()).toEqual(['INBOX', 'UNREAD']);
  });
});
