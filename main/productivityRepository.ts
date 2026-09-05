import { getDatabase } from './database';
import { parseProductivityRecord, type ProductivityRecord } from '../shared/productivity';

export const ProductivityRepo = {
  list(accountIds: string[]): ProductivityRecord[] {
    if (!Array.isArray(accountIds) || accountIds.length > 100 || accountIds.some(id => typeof id !== 'string')) throw new Error('Invalid account scope.');
    if (!accountIds.length) return [];
    const rows = getDatabase().prepare(`SELECT payload FROM productivity_records WHERE account_id IN (${accountIds.map(() => '?').join(',')}) ORDER BY updated_at DESC`)
      .all(...accountIds.map(id => id.toLowerCase())) as { payload: string }[];
    return rows.map(row => parseProductivityRecord(JSON.parse(row.payload)));
  },

  save(input: unknown): ProductivityRecord {
    const record = parseProductivityRecord(input);
    const db = getDatabase();
    return db.transaction(() => {
      const current = db.prepare('SELECT revision, kind FROM productivity_records WHERE account_id = ? AND id = ?')
        .get(record.accountId, record.id) as { revision: number; kind: string } | undefined;
      if ((current?.revision ?? 0) !== record.revision || (current && current.kind !== record.kind)) {
        throw new Error('This item changed elsewhere. Refresh Today and try again.');
      }
      if (record.kind === 'correction' && record.scope === 'sender' && (!record.senderEmail.includes('@') || record.reason === 'alreadyDone')) {
        throw new Error('Only sender preferences can become rules.');
      }
      const saved = { ...record, revision: record.revision + 1, updatedAt: new Date().toISOString() };
      db.prepare(`INSERT INTO productivity_records (account_id, id, kind, revision, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(account_id, id) DO UPDATE SET revision=excluded.revision, updated_at=excluded.updated_at, payload=excluded.payload`)
        .run(saved.accountId, saved.id, saved.kind, saved.revision, saved.updatedAt, JSON.stringify(saved));
      return saved;
    })();
  },

  delete(accountId: string, id: string, revision: number): void {
    if (typeof accountId !== 'string' || typeof id !== 'string' || !Number.isSafeInteger(revision)) throw new Error('Invalid local record.');
    const result = getDatabase().prepare('DELETE FROM productivity_records WHERE account_id = ? AND id = ? AND revision = ?')
      .run(accountId.toLowerCase(), id, revision);
    if (!result.changes) throw new Error('This item changed elsewhere. Refresh and try again.');
  },
};
