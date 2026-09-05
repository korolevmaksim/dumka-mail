import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runMigrations } from '../main/migrations';
import type { SavedMailSearch } from '../shared/productivity';

const state = vi.hoisted(() => ({ db: null as Database.Database | null }));
vi.mock('../main/database', () => ({ getDatabase: () => state.db }));
import { ProductivityRepo } from '../main/productivityRepository';

const saved: SavedMailSearch = { kind: 'search', id: 's1', accountId: 'a@example.com', revision: 0, updatedAt: '2026-09-05T10:00:00Z', name: 'Invoices', query: 'invoice', period: 'fixed' };
describe('productivity persistence', () => {
  beforeEach(() => { state.db = new Database(':memory:'); runMigrations(state.db); });
  afterEach(() => state.db?.close());
  it('survives migrations and round-trips account-scoped records', () => {
    const row = ProductivityRepo.save(saved);
    ProductivityRepo.save({ ...saved, accountId: 'b@example.com', name: 'Other account' });
    if (!state.db) throw new Error('Test database unavailable');
    runMigrations(state.db);
    expect(ProductivityRepo.list(['a@example.com'])).toEqual([row]);
    expect(ProductivityRepo.list(['missing@example.com'])).toEqual([]);
    expect(ProductivityRepo.list(['a@example.com', 'b@example.com'])).toHaveLength(2);
  });
  it('rejects stale updates and stale deletes without losing acknowledged data', () => {
    const first = ProductivityRepo.save(saved);
    const second = ProductivityRepo.save({ ...first, name: 'Renamed' });
    expect(() => ProductivityRepo.save({ ...first, name: 'Stale edit' })).toThrow(/changed elsewhere/);
    expect(() => ProductivityRepo.delete(first.accountId, first.id, first.revision)).toThrow(/changed elsewhere/);
    expect(ProductivityRepo.list([first.accountId])).toEqual([second]);
    ProductivityRepo.delete(second.accountId, second.id, second.revision);
    expect(ProductivityRepo.list([second.accountId])).toEqual([]);
  });
  it('restores commitments and corrections after a database close and reopen', () => {
    const directory = mkdtempSync(join(tmpdir(), 'dumka-productivity-'));
    const filename = join(directory, 'state.sqlite');
    state.db?.close();
    state.db = new Database(filename);
    try {
      runMigrations(state.db);
      const commitment = ProductivityRepo.save({ kind: 'commitment', id: 'c', accountId: saved.accountId, revision: 0, updatedAt: saved.updatedAt,
        title: 'Send budget', direction: 'mine', owner: saved.accountId, dueDate: null, status: 'confirmed',
        evidence: [{ threadId: 't', messageId: 'm', subject: 'Budget', sender: saved.accountId, quote: 'I will send it', receivedAt: saved.updatedAt }] });
      const correction = ProductivityRepo.save({ kind: 'correction', id: 'r', accountId: saved.accountId, revision: 0, updatedAt: saved.updatedAt,
        reason: 'alreadyDone', scope: 'source', threadId: 't', messageId: 'm', senderEmail: saved.accountId, action: 'draftReply', subject: 'Budget' });
      state.db.close();
      state.db = new Database(filename);
      runMigrations(state.db);
      expect(ProductivityRepo.list([saved.accountId])).toEqual(expect.arrayContaining([commitment, correction]));
    } finally {
      state.db.close(); state.db = new Database(':memory:');
      rmSync(directory, { recursive: true, force: true });
    }
  });
  it('rejects an invalid record without writing a partial row', () => {
    expect(() => ProductivityRepo.save({ ...saved, name: '' })).toThrow();
    expect(ProductivityRepo.list([saved.accountId])).toEqual([]);
  });
});
