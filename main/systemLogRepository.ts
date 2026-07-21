import type Database from 'better-sqlite3';
import { getDatabase } from './database';
import {
  normalizeSystemLogQuery,
  type SystemLogDetails,
  type SystemLogEntry,
  type SystemLogLevel,
  type SystemLogPage,
  type SystemLogQuery,
  type SystemLoggingSettings,
  type SystemLogStats,
} from '../shared/systemLogs';

export interface NewSystemLogEntry {
  occurredAt: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details: SystemLogDetails | null;
}

interface SystemLogRow {
  id: number;
  occurred_at: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details_json: string | null;
}

function mapRow(row: SystemLogRow): SystemLogEntry {
  let details: SystemLogDetails | null = null;
  if (row.details_json) {
    try {
      const parsed = JSON.parse(row.details_json);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        details = parsed as SystemLogDetails;
      }
    } catch {
      details = { parseError: 'Stored log details could not be decoded.' };
    }
  }
  return {
    id: row.id,
    occurredAt: row.occurred_at,
    level: row.level,
    source: row.source,
    message: row.message,
    details,
  };
}

export function createSystemLogRepository(database?: Database.Database) {
  const db = () => database || getDatabase();

  return {
    save(input: NewSystemLogEntry): SystemLogEntry {
      const result = db().prepare(`
        INSERT INTO application_logs (occurred_at, level, source, message, details_json)
        VALUES (?, ?, ?, ?, ?)
      `).run(
        input.occurredAt,
        input.level,
        input.source,
        input.message,
        input.details ? JSON.stringify(input.details) : null,
      );
      const row = db().prepare(`
        SELECT id, occurred_at, level, source, message, details_json
        FROM application_logs WHERE id = ?
      `).get(Number(result.lastInsertRowid)) as SystemLogRow;
      return mapRow(row);
    },

    list(queryValue: SystemLogQuery = {}): SystemLogPage {
      const query = normalizeSystemLogQuery(queryValue);
      if (query.levels.length === 0) return { entries: [], hasMore: false };

      const clauses: string[] = [];
      const params: Array<string | number> = [];
      clauses.push(`level IN (${query.levels.map(() => '?').join(', ')})`);
      params.push(...query.levels);
      if (query.source) {
        clauses.push('source = ?');
        params.push(query.source);
      }
      if (query.search) {
        clauses.push('(message LIKE ? ESCAPE \'\\\' OR source LIKE ? ESCAPE \'\\\')');
        const escaped = query.search.replace(/[\\%_]/g, match => `\\${match}`);
        params.push(`%${escaped}%`, `%${escaped}%`);
      }
      if (query.beforeId) {
        clauses.push('id < ?');
        params.push(query.beforeId);
      }

      const rows = db().prepare(`
        SELECT id, occurred_at, level, source, message, details_json
        FROM application_logs
        WHERE ${clauses.join(' AND ')}
        ORDER BY id DESC
        LIMIT ?
      `).all(...params, query.limit + 1) as SystemLogRow[];
      const hasMore = rows.length > query.limit;
      return {
        entries: rows.slice(0, query.limit).reverse().map(mapRow),
        hasMore,
      };
    },

    stats(): SystemLogStats {
      const counts = db().prepare(`
        SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN level = 'info' THEN 1 ELSE 0 END) AS info,
          SUM(CASE WHEN level = 'warning' THEN 1 ELSE 0 END) AS warning,
          SUM(CASE WHEN level = 'error' THEN 1 ELSE 0 END) AS error,
          MIN(occurred_at) AS oldest_at,
          MAX(occurred_at) AS newest_at
        FROM application_logs
      `).get() as {
        total: number;
        info: number | null;
        warning: number | null;
        error: number | null;
        oldest_at: string | null;
        newest_at: string | null;
      };
      const sources = db().prepare(`
        SELECT DISTINCT source FROM application_logs ORDER BY source COLLATE NOCASE ASC
      `).all() as Array<{ source: string }>;
      return {
        total: counts.total,
        info: counts.info || 0,
        warning: counts.warning || 0,
        error: counts.error || 0,
        oldestAt: counts.oldest_at,
        newestAt: counts.newest_at,
        sources: sources.map(row => row.source),
      };
    },

    clear(): number {
      return db().prepare('DELETE FROM application_logs').run().changes;
    },

    prune(settings: SystemLoggingSettings, now = new Date()): number {
      const cutoff = new Date(now.getTime() - settings.retentionDays * 86_400_000).toISOString();
      let deleted = db().prepare('DELETE FROM application_logs WHERE occurred_at < ?').run(cutoff).changes;
      const oldestRetained = db().prepare(`
        SELECT id FROM application_logs
        ORDER BY id DESC
        LIMIT 1 OFFSET ?
      `).get(Math.max(0, settings.maxEntries - 1)) as { id: number } | undefined;
      if (oldestRetained) {
        deleted += db().prepare('DELETE FROM application_logs WHERE id < ?').run(oldestRetained.id).changes;
      }
      return deleted;
    },
  };
}

export const SystemLogRepo = createSystemLogRepository();
