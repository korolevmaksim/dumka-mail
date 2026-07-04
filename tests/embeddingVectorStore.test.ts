import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  decodeEmbeddingVector,
  decodeStoredEmbeddingVector,
  decodeStoredEmbeddingVectorAsNumbers,
  encodeEmbeddingVector,
} from '../main/embeddingVectorCodec';
import type { MailEmbeddingRow } from '../main/repositories';

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

function embeddingRow(partial: Partial<MailEmbeddingRow> = {}): MailEmbeddingRow {
  return {
    accountId: partial.accountId || 'me@example.com',
    messageId: partial.messageId || 'm1',
    threadId: partial.threadId || 't1',
    model: partial.model || 'test-model',
    textHash: partial.textHash || 'hash-1',
    vector: partial.vector || [0.25, -1.5, 3.75],
    subject: partial.subject || 'Contract draft',
    sender: partial.sender || 'Ada Lovelace',
    snippet: partial.snippet || 'Please review the contract',
    receivedAt: partial.receivedAt || '2026-07-01T00:00:00.000Z',
    indexedAt: partial.indexedAt || '2026-07-02T00:00:00.000Z',
  };
}

async function withIsolatedDatabase<T>(
  run: (databaseModule: typeof import('../main/database')) => Promise<T> | T,
): Promise<T> {
  const previousHome = process.env.HOME;
  const home = mkdtempSync(join(tmpdir(), 'dumka-embedding-store-'));
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

function insertLegacyJsonRow(
  databaseModule: typeof import('../main/database'),
  row: MailEmbeddingRow,
  vectorJson?: string,
): void {
  databaseModule.getDatabase().prepare(`
    INSERT INTO mail_embeddings (
      account_id, message_id, thread_id, model, text_hash, vector_json,
      subject, sender, snippet, received_at, indexed_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    row.accountId,
    row.messageId,
    row.threadId,
    row.model,
    row.textHash,
    vectorJson ?? JSON.stringify(row.vector),
    row.subject,
    row.sender,
    row.snippet,
    row.receivedAt,
    row.indexedAt,
  );
}

describe('embedding vector codec', () => {
  it('roundtrips float32-exact values through encode/decode', () => {
    const values = [0.25, -1.5, 3.75, 0, 42];
    const decoded = decodeEmbeddingVector(encodeEmbeddingVector(values));
    expect(Array.from(decoded)).toEqual(values);
  });

  it('roundtrips arbitrary values at float32 precision', () => {
    const values = [0.1234567890123, -0.987654321, 1e-8, 12345.6789];
    const decoded = decodeEmbeddingVector(encodeEmbeddingVector(values));
    expect(Array.from(decoded)).toEqual(values.map(Math.fround));
  });

  it('decodes buffers whose byteOffset is not 4-aligned', () => {
    const values = [0.5, -2.25, 7.125];
    const encoded = encodeEmbeddingVector(values);
    const backing = Buffer.alloc(encoded.byteLength + 1);
    encoded.copy(backing, 1);
    const misaligned = backing.subarray(1);

    expect(misaligned.byteOffset % Float32Array.BYTES_PER_ELEMENT).not.toBe(0);
    expect(() => new Float32Array(misaligned.buffer, misaligned.byteOffset, values.length)).toThrow();
    expect(Array.from(decodeEmbeddingVector(misaligned))).toEqual(values);
  });

  it('decodes an empty buffer to an empty vector', () => {
    expect(decodeEmbeddingVector(Buffer.alloc(0))).toHaveLength(0);
  });

  it('prefers the blob over stale JSON when both are present', () => {
    const decoded = decodeStoredEmbeddingVector(encodeEmbeddingVector([1, 2]), '[9,9,9]');
    expect(Array.from(decoded)).toEqual([1, 2]);
  });

  it('falls back to vector_json when the blob is missing or empty', () => {
    expect(Array.from(decodeStoredEmbeddingVector(null, '[0.5,1.5]'))).toEqual([0.5, 1.5]);
    expect(Array.from(decodeStoredEmbeddingVector(Buffer.alloc(0), '[0.5,1.5]'))).toEqual([0.5, 1.5]);
    expect(decodeStoredEmbeddingVector(null, '')).toHaveLength(0);
    expect(decodeStoredEmbeddingVector(null, null)).toHaveLength(0);
  });

  it('degrades malformed legacy vector_json to an empty vector instead of throwing', () => {
    expect(decodeStoredEmbeddingVector(null, 'not-json')).toHaveLength(0);
    expect(decodeStoredEmbeddingVector(Buffer.alloc(0), '{"truncated'))
      .toHaveLength(0);
  });

  it('keeps full float64 precision on the JSON fallback for number[] reads', () => {
    const values = [0.1234567890123456, -0.9876543210987654];
    expect(decodeStoredEmbeddingVectorAsNumbers(null, JSON.stringify(values))).toEqual(values);
    expect(decodeStoredEmbeddingVectorAsNumbers(null, '')).toEqual([]);
  });
});

describe('mail embeddings blob storage', () => {
  repositoryIt('saveMany persists Float32 blobs and clears vector_json', async () => {
    await withIsolatedDatabase(async databaseModule => {
      const { MailEmbeddingsRepo, getDatabase } = databaseModule;
      const row = embeddingRow({ vector: [0.25, -1.5, 3.75] });

      MailEmbeddingsRepo.saveMany([row]);

      const raw = getDatabase().prepare(`
        SELECT vector_json, vector_blob FROM mail_embeddings
        WHERE account_id = ? AND message_id = ? AND model = ?
      `).get(row.accountId, row.messageId, row.model) as { vector_json: string; vector_blob: Buffer };
      expect(raw.vector_json).toBe('');
      expect(Buffer.isBuffer(raw.vector_blob)).toBe(true);
      expect(raw.vector_blob.byteLength).toBe(row.vector.length * Float32Array.BYTES_PER_ELEMENT);

      const listed = MailEmbeddingsRepo.listForAccountPage(row.accountId, row.model, 10, 0);
      expect(listed).toHaveLength(1);
      expect(listed[0].vector).toEqual([0.25, -1.5, 3.75]);

      const scanned = MailEmbeddingsRepo.scanForAccountPage(row.accountId, row.model, 10, 0);
      expect(scanned).toHaveLength(1);
      expect(scanned[0].vector).toBeInstanceOf(Float32Array);
      expect(Array.from(scanned[0].vector)).toEqual([0.25, -1.5, 3.75]);
      expect(scanned[0]).toMatchObject({
        threadId: row.threadId,
        messageId: row.messageId,
        subject: row.subject,
        sender: row.sender,
        snippet: row.snippet,
        receivedAt: row.receivedAt,
      });
    });
  });

  repositoryIt('reads legacy vector_json rows through both list and scan paths', async () => {
    await withIsolatedDatabase(async databaseModule => {
      const { MailEmbeddingsRepo } = databaseModule;
      const row = embeddingRow({ vector: [0.1234567890123456, -0.5] });
      insertLegacyJsonRow(databaseModule, row);

      const listed = MailEmbeddingsRepo.listForAccountPage(row.accountId, row.model, 10, 0);
      expect(listed).toHaveLength(1);
      expect(listed[0].vector).toEqual(row.vector);

      const scanned = MailEmbeddingsRepo.scanForAccountPage(row.accountId, row.model, 10, 0);
      expect(scanned).toHaveLength(1);
      expect(scanned[0].vector[0]).toBeCloseTo(row.vector[0], 6);
      expect(scanned[0].vector[1]).toBeCloseTo(row.vector[1], 6);
    });
  });

  repositoryIt('migrates legacy vector_json rows to blobs in idempotent batches', async () => {
    await withIsolatedDatabase(async databaseModule => {
      const { MailEmbeddingsRepo, getDatabase } = databaseModule;
      const legacyRows = [1, 2, 3, 4, 5].map(index => embeddingRow({
        messageId: `legacy-${index}`,
        vector: [index, -index],
      }));
      for (const row of legacyRows) {
        insertLegacyJsonRow(databaseModule, row);
      }
      MailEmbeddingsRepo.saveMany([embeddingRow({ messageId: 'already-blob', vector: [9, 9] })]);

      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(3)).toBe(3);
      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(3)).toBe(2);
      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(3)).toBe(0);
      // Re-running after completion stays a no-op.
      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(3)).toBe(0);

      const pending = getDatabase().prepare(
        'SELECT COUNT(*) AS count FROM mail_embeddings WHERE vector_blob IS NULL'
      ).get() as { count: number };
      expect(pending.count).toBe(0);

      const scanned = MailEmbeddingsRepo.scanForAccountPage('me@example.com', 'test-model', 10, 0);
      const byMessageId = new Map(scanned.map(item => [item.messageId, item]));
      for (const row of legacyRows) {
        expect(Array.from(byMessageId.get(row.messageId)?.vector || [])).toEqual(row.vector);
      }
    });
  });

  repositoryIt('marks unreadable legacy rows without clearing their JSON so migration terminates', async () => {
    await withIsolatedDatabase(async databaseModule => {
      const { MailEmbeddingsRepo, getDatabase } = databaseModule;
      const malformed = embeddingRow({ messageId: 'malformed', model: 'broken-model' });
      insertLegacyJsonRow(databaseModule, malformed, 'not-json');

      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(10)).toBe(1);
      expect(MailEmbeddingsRepo.migrateVectorJsonBatch(10)).toBe(0);

      const raw = getDatabase().prepare(`
        SELECT vector_json, vector_blob FROM mail_embeddings WHERE message_id = ?
      `).get(malformed.messageId) as { vector_json: string; vector_blob: Buffer };
      expect(raw.vector_json).toBe('not-json');
      expect(Buffer.isBuffer(raw.vector_blob)).toBe(true);
      expect(raw.vector_blob.byteLength).toBe(0);

      // A marked row must not fail the scan page; it degrades to an empty vector.
      const scanned = MailEmbeddingsRepo.scanForAccountPage(malformed.accountId, malformed.model, 10, 0);
      expect(scanned).toHaveLength(1);
      expect(scanned[0].vector).toHaveLength(0);
    });
  });

  repositoryIt('creates the received_at index that backs scanForAccountPage ordering', async () => {
    await withIsolatedDatabase(async databaseModule => {
      const index = databaseModule.getDatabase().prepare(`
        SELECT name FROM sqlite_master
        WHERE type = 'index' AND name = 'idx_mail_embeddings_account_model_received'
      `).get();
      expect(index).toBeTruthy();
    });
  });
});
