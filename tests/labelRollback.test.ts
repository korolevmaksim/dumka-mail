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

describe('LabelRollbacks', () => {
  let database: typeof import('../main/database');
  let rollbacks: typeof import('../main/labelRollback')['LabelRollbacks'];
  let home: string;
  let previousHome: string | undefined;

  beforeEach(async () => {
    if (!sqliteAvailable()) return;
    previousHome = process.env.HOME;
    home = mkdtempSync(join(tmpdir(), 'dumka-label-rollback-'));
    vi.resetModules();
    process.env.HOME = home;
    database = await import('../main/database');
    rollbacks = (await import('../main/labelRollback')).LabelRollbacks;
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

  /** An action as the main process runs it: journal entry, label write, plan. */
  function start(id: string, kind: ActionKind, minute: number, add: string[], remove: string[], overrides: Partial<MailActionLog> = {}) {
    database.ActionLogRepo.save(action(id, kind, minute, overrides));
    rollbacks.track(id, database.ThreadsRepo.updateLabels(accountId, 'thread-1', add, remove));
  }

  /** Gmail rejected the action: rolled back and marked failed in one write, as the callers do. */
  function reject(id: string, fallback: { add: string[]; remove: string[] } = { add: [], remove: [] }) {
    rollbacks.rollback({ id, accountId, threadId: 'thread-1' }, fallback);
    const stored = database.ActionLogRepo.get(id);
    if (stored) database.ActionLogRepo.save({ ...stored, status: 'failed' });
  }

  sqliteIt('updateLabels reports only what it really changed', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);

    expect(database.ThreadsRepo.updateLabels(accountId, 'thread-1', ['TRASH'], ['INBOX', 'UNREAD'])).toEqual({ added: ['TRASH'], removed: ['INBOX'] });
    expect(database.ThreadsRepo.updateLabels(accountId, 'thread-1', ['TRASH'], ['INBOX'])).toEqual({ added: [], removed: [] });
    expect(database.ThreadsRepo.updateLabels(accountId, 'no-such-thread', ['TRASH'], [])).toEqual({ added: [], removed: [] });
  });

  sqliteIt('puts back only what the action changed, so a label it found in place stays', () => {
    // Already archived when the archive was asked for again.
    database.ThreadsRepo.save([thread(['UNREAD'])]);
    start('archive', 'markDone', 0, [], ['INBOX']);

    reject('archive');

    expect(labels()).toEqual(['UNREAD']);
    expect(rollbacks.planFor('archive')).toBeNull();
  });

  sqliteIt('leaves a label alone that a newer action Gmail accepted has taken over', () => {
    database.ThreadsRepo.save([thread(['INBOX', 'UNREAD'])]);
    start('older', 'markRead', 0, [], ['UNREAD']);
    start('newer', 'markRead', 1, [], ['UNREAD']);
    // Gmail accepted the newer one.
    rollbacks.forget('newer');
    database.ActionLogRepo.save(action('newer', 'markRead', 1, { status: 'completed' }));

    // Gmail rejects the older one: its rollback would put UNREAD back.
    reject('older');

    expect(labels()).toEqual(['INBOX']);
  });

  sqliteIt('restores the label when both overlapping actions are rejected, whichever fails first', () => {
    for (const order of [['older', 'newer'], ['newer', 'older']]) {
      rollbacks.resetForTests();
      database.ThreadsRepo.save([thread(['INBOX'])]);
      // Two archives of one thread: the second finds INBOX already gone.
      start(`older-${order[0]}`, 'markDone', 0, [], ['INBOX']);
      start(`newer-${order[0]}`, 'markDone', 1, [], ['INBOX']);
      expect(labels()).toEqual([]);

      reject(`${order[0]}-${order[0]}`);
      reject(`${order[1]}-${order[0]}`);

      // Gmail took neither, so the thread is back in the inbox.
      expect(labels(), `rejected ${order.join(', then ')}`).toEqual(['INBOX']);
    }
  });

  sqliteIt('hands over what it found even when the newer action changed that label itself', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);
    // Archive, then "restore to inbox" before Gmail answered the archive.
    start('archive', 'markDone', 0, [], ['INBOX']);
    start('restore', 'restoreInbox', 1, ['INBOX'], []);
    expect(rollbacks.planFor('restore')).toEqual({ add: [], remove: ['INBOX'] });

    // The archive is rejected: INBOX is the restore's to decide, and what
    // lies under the restore is now "in the inbox", not "archived".
    reject('archive');
    expect(labels()).toEqual(['INBOX']);
    expect(rollbacks.planFor('restore')).toEqual({ add: ['INBOX'], remove: [] });

    reject('restore');
    expect(labels()).toEqual(['INBOX']);
  });

  sqliteIt('keeps the part a newer action shares and undoes the rest', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);
    // Move to Trash (TRASH on, INBOX off), then archive (INBOX off).
    start('trash', 'moveToTrash', 0, ['TRASH'], ['INBOX']);
    start('archive', 'markDone', 1, [], ['INBOX']);
    rollbacks.forget('archive');
    database.ActionLogRepo.save(action('archive', 'markDone', 1, { status: 'completed' }));

    reject('trash');

    // Out of Trash again, but still archived, as the accepted action left it.
    expect(labels()).toEqual([]);
  });

  sqliteIt.each([
    ['an older action', action('other', 'markRead', -1, { status: 'completed' })],
    ['a newer action that failed', action('other', 'markRead', 1, { status: 'failed' })],
    ['a newer action of another thread', action('other', 'markRead', 1, { status: 'completed', threadId: 'thread-2' })],
    ['a newer action that changes no labels', action('other', 'setReminder', 1, { status: 'completed' })],
  ])('rolls back fully next to %s', (_name, other) => {
    database.ThreadsRepo.save([thread(['INBOX', 'UNREAD'])]);
    start('older', 'markRead', 0, [], ['UNREAD']);
    database.ActionLogRepo.save(other);

    reject('older');

    expect(labels()).toEqual(['INBOX', 'UNREAD']);
  });

  sqliteIt('uses the labels of the kind when no plan is known, still respecting a newer action', () => {
    // After a restart: a parked "mark read" is replayed and rejected.
    database.ThreadsRepo.save([thread(['INBOX'])]);
    database.ActionLogRepo.save(action('parked', 'markRead', 0, { status: 'pending_sync' }));

    reject('parked', { add: ['UNREAD'], remove: [] });
    expect(labels()).toEqual(['INBOX', 'UNREAD']);

    database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']);
    database.ActionLogRepo.save(action('parked-2', 'markRead', 2, { status: 'pending_sync' }));
    database.ActionLogRepo.save(action('later', 'markRead', 3, { status: 'completed' }));
    reject('parked-2', { add: ['UNREAD'], remove: [] });
    expect(labels()).toEqual(['INBOX']);
  });

  sqliteIt('rolls back as asked when the action has no journal entry or no id', () => {
    database.ThreadsRepo.save([thread(['INBOX'])]);
    database.ActionLogRepo.save(action('newer', 'markRead', 1, { status: 'completed' }));

    rollbacks.rollback({ id: 'not-in-the-journal', accountId, threadId: 'thread-1' }, { add: ['UNREAD'], remove: [] });
    expect(labels()).toEqual(['INBOX', 'UNREAD']);

    database.ThreadsRepo.updateLabels(accountId, 'thread-1', [], ['UNREAD']);
    rollbacks.rollback({ accountId, threadId: 'thread-1' }, { add: ['UNREAD'], remove: [] });
    expect(labels()).toEqual(['INBOX', 'UNREAD']);
  });
});
