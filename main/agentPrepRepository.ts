// Storage for agent preparation (design-review/SPEC.md §5): the
// `thread_summaries` cache and the small lookups the background pass needs.
// Kept apart from `repositories.ts`; all queries are single indexed reads or
// writes of a few rows.
import { getDatabase } from './database';
import { guardRepositoryWrites } from './sqliteWriteGuard';
import { SUMMARY_BULLET_MAX, SUMMARY_MAX_BULLETS } from '../shared/agentPrompts';

export interface ThreadSummaryRecord {
  accountId: string;
  threadId: string;
  lastMessageId: string;
  bullets: string[];
  cacheKey?: string;
  model: string;
  createdAt: string;
}

interface ThreadSummaryRow {
  account_id: string;
  thread_id: string;
  last_message_id: string;
  bullets_json: string;
  cache_key: string;
  model: string;
  created_at: string;
}

function parseBullets(json: string): string[] | null {
  try {
    const value = JSON.parse(json);
    if (!Array.isArray(value)) return null;
    const bullets = value.filter((item): item is string => typeof item === 'string' && item.length > 0 && item.length <= SUMMARY_BULLET_MAX);
    return bullets.length > 0 ? bullets.slice(0, SUMMARY_MAX_BULLETS) : null;
  } catch {
    return null;
  }
}

export const ThreadSummariesRepo = {
  /** The cached summary, only while `lastMessageId` is still the thread's last message. */
  get(accountId: string, threadId: string, lastMessageId: string, cacheKey?: string): ThreadSummaryRecord | null {
    const row = getDatabase()
      .prepare('SELECT * FROM thread_summaries WHERE account_id = ? AND thread_id = ? AND last_message_id = ? AND (? IS NULL OR cache_key = ?)')
      .get(accountId, threadId, lastMessageId, cacheKey ?? null, cacheKey ?? null) as ThreadSummaryRow | undefined;
    if (!row) return null;
    const bullets = parseBullets(row.bullets_json);
    if (!bullets) return null;
    return {
      accountId: row.account_id,
      threadId: row.thread_id,
      lastMessageId: row.last_message_id,
      bullets,
      cacheKey: row.cache_key,
      model: row.model,
      createdAt: row.created_at,
    };
  },

  /** One row per thread: a newer summary replaces the stale one. */
  save(record: ThreadSummaryRecord) {
    const bullets = record.bullets.filter(Boolean).slice(0, SUMMARY_MAX_BULLETS);
    if (!record.accountId || !record.threadId || !record.lastMessageId || bullets.length === 0) return;
    getDatabase().prepare(`
      INSERT INTO thread_summaries (account_id, thread_id, last_message_id, bullets_json, model, created_at, cache_key)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(account_id, thread_id) DO UPDATE SET
        last_message_id=excluded.last_message_id,
        bullets_json=excluded.bullets_json,
        cache_key=excluded.cache_key,
        model=excluded.model,
        created_at=excluded.created_at
    `).run(record.accountId, record.threadId, record.lastMessageId, JSON.stringify(bullets), record.model || '', record.createdAt, record.cacheKey || '');
  },

  purgeAccount(accountId: string) {
    getDatabase().prepare('DELETE FROM thread_summaries WHERE account_id = ?').run(accountId);
  },
};

export const AgentPrepLookups = {
  /** Any agent draft (ready, applied or dismissed) for this message: never prepare twice. */
  hasAgentDraftForMessage(accountId: string, messageId: string): boolean {
    return Boolean(getDatabase()
      .prepare('SELECT 1 FROM agent_drafts WHERE account_id = ? AND message_id = ? LIMIT 1')
      .get(accountId, messageId));
  },

  /** Thread ids with a user-written draft. */
  userDraftThreadIds(accountId: string): Set<string> {
    const rows = getDatabase()
      .prepare("SELECT DISTINCT thread_id FROM drafts WHERE account_id = ? AND thread_id IS NOT NULL AND thread_id != ''")
      .all(accountId) as { thread_id: string }[];
    return new Set(rows.map(row => row.thread_id));
  },
};

// Interactive writes share the guard of the other repositories: one IMMEDIATE
// transaction with a bounded SQLITE_BUSY retry against the database worker.
guardRepositoryWrites(ThreadSummariesRepo, ['save', 'purgeAccount'], getDatabase);
