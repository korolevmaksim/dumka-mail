export const SYSTEM_LOG_LEVELS = ['info', 'warning', 'error'] as const;
export type SystemLogLevel = typeof SYSTEM_LOG_LEVELS[number];

export const SYSTEM_LOG_RETENTION_OPTIONS = [1, 7, 14, 30, 90] as const;
export const SYSTEM_LOG_MAX_ENTRY_OPTIONS = [5_000, 10_000, 25_000, 50_000] as const;

export interface SystemLoggingSettings {
  retentionDays: number;
  maxEntries: number;
}

export const DEFAULT_SYSTEM_LOGGING_SETTINGS: SystemLoggingSettings = {
  retentionDays: 14,
  maxEntries: 25_000,
};

export type SystemLogDetails = Record<string, string | number | boolean | null>;

export interface SystemLogEntry {
  id: number;
  occurredAt: string;
  level: SystemLogLevel;
  source: string;
  message: string;
  details: SystemLogDetails | null;
}

export interface SystemLogQuery {
  levels?: SystemLogLevel[];
  source?: string;
  search?: string;
  beforeId?: number;
  limit?: number;
}

export interface SystemLogPage {
  entries: SystemLogEntry[];
  hasMore: boolean;
}

export interface SystemLogStats {
  total: number;
  info: number;
  warning: number;
  error: number;
  oldestAt: string | null;
  newestAt: string | null;
  sources: string[];
}

function closestAllowed(value: unknown, options: readonly number[], fallback: number): number {
  const numeric = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return fallback;
  return options.reduce((closest, option) => (
    Math.abs(option - numeric) < Math.abs(closest - numeric) ? option : closest
  ), fallback);
}

export function normalizeSystemLoggingSettings(value: unknown): SystemLoggingSettings {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<SystemLoggingSettings>
    : {};
  return {
    retentionDays: closestAllowed(
      candidate.retentionDays,
      SYSTEM_LOG_RETENTION_OPTIONS,
      DEFAULT_SYSTEM_LOGGING_SETTINGS.retentionDays,
    ),
    maxEntries: closestAllowed(
      candidate.maxEntries,
      SYSTEM_LOG_MAX_ENTRY_OPTIONS,
      DEFAULT_SYSTEM_LOGGING_SETTINGS.maxEntries,
    ),
  };
}

export function normalizeSystemLogQuery(value: unknown): Required<Pick<SystemLogQuery, 'levels' | 'limit'>> & SystemLogQuery {
  const candidate = value && typeof value === 'object' && !Array.isArray(value)
    ? value as SystemLogQuery
    : {};
  const levels = Array.isArray(candidate.levels)
    ? Array.from(new Set(candidate.levels.filter(level => SYSTEM_LOG_LEVELS.includes(level))))
    : [...SYSTEM_LOG_LEVELS];
  const rawLimit = Number(candidate.limit);
  const limit = Number.isFinite(rawLimit) ? Math.max(25, Math.min(500, Math.floor(rawLimit))) : 250;
  const source = typeof candidate.source === 'string' ? candidate.source.trim().slice(0, 80) : '';
  const search = typeof candidate.search === 'string' ? candidate.search.trim().slice(0, 200) : '';
  const rawBeforeId = Number(candidate.beforeId);
  const beforeId = Number.isSafeInteger(rawBeforeId) && rawBeforeId > 0 ? rawBeforeId : undefined;
  return {
    levels,
    limit,
    ...(source ? { source } : {}),
    ...(search ? { search } : {}),
    ...(beforeId ? { beforeId } : {}),
  };
}
