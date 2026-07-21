import {
  DEFAULT_SYSTEM_LOGGING_SETTINGS,
  normalizeSystemLoggingSettings,
  type SystemLogDetails,
  type SystemLogEntry,
  type SystemLogLevel,
  type SystemLoggingSettings,
} from '../shared/systemLogs';
import { SystemLogRepo } from './systemLogRepository';

const SECRET_KEY_PATTERN = /(?:token|secret|password|authorization|cookie|api[-_]?key|refresh[-_]?token)/i;
const PERSONAL_KEY_PATTERN = /(?:email|username|user[-_]?name|account|path|thread[-_]?id|message[-_]?id|draft[-_]?id)/i;
const EMAIL_PATTERN = /\b([A-Z0-9._%+-])([A-Z0-9._%+-]*)@([A-Z0-9.-]+\.[A-Z]{2,})\b/gi;
const HOME_PATH_PATTERN = /\/(?:Users|home)\/[^/\s]+/g;
const BEARER_PATTERN = /\b(Bearer)\s+[A-Za-z0-9._~+\/-]+=*/gi;
const API_KEY_PATTERN = /\b(?:sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g;
const MAX_TEXT_LENGTH = 4_000;
const MAX_DETAIL_KEYS = 24;

interface LoggerRuntimeSettings extends SystemLoggingSettings {
  redactPersonalData: boolean;
}

function compactText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?|\n/g, ' ⏎ ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, MAX_TEXT_LENGTH);
}

export function sanitizeSystemLogText(value: unknown, redactPersonalData: boolean): string {
  let text = compactText(value)
    .replace(BEARER_PATTERN, '$1 [redacted]')
    .replace(API_KEY_PATTERN, '[redacted-key]');
  if (redactPersonalData) {
    text = text
      .replace(EMAIL_PATTERN, (_match, first: string, _rest: string, domain: string) => `${first}***@${domain}`)
      .replace(HOME_PATH_PATTERN, match => `${match.split('/').slice(0, -1).join('/')}/[redacted]`);
  }
  return text;
}

export function sanitizeSystemLogDetails(
  details: Record<string, unknown> | undefined,
  redactPersonalData: boolean,
): SystemLogDetails | null {
  if (!details) return null;
  const sanitized: SystemLogDetails = {};
  for (const [rawKey, rawValue] of Object.entries(details).slice(0, MAX_DETAIL_KEYS)) {
    const key = compactText(rawKey).slice(0, 80);
    if (!key) continue;
    if (SECRET_KEY_PATTERN.test(key)) {
      sanitized[key] = '[redacted]';
      continue;
    }
    if (rawValue === null || typeof rawValue === 'number' || typeof rawValue === 'boolean') {
      sanitized[key] = rawValue;
      continue;
    }
    if (rawValue instanceof Error) {
      sanitized[key] = sanitizeSystemLogText(`${rawValue.name}: ${rawValue.message}`, redactPersonalData);
      continue;
    }
    sanitized[key] = sanitizeSystemLogText(
      rawValue && typeof rawValue === 'object' ? JSON.stringify(rawValue) : rawValue,
      redactPersonalData || PERSONAL_KEY_PATTERN.test(key),
    );
  }
  return Object.keys(sanitized).length > 0 ? sanitized : null;
}

function formatConsoleArguments(args: unknown[]): string {
  return args.map(arg => {
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (arg && typeof arg === 'object') {
      try {
        return JSON.stringify(arg);
      } catch {
        return '[unserializable]';
      }
    }
    return String(arg ?? '');
  }).join(' ');
}

class ApplicationLogger {
  private settings: LoggerRuntimeSettings = {
    ...DEFAULT_SYSTEM_LOGGING_SETTINGS,
    redactPersonalData: true,
  };
  private publish: ((entry: SystemLogEntry) => void) | null = null;
  private initialized = false;
  private writesSincePrune = 0;

  initialize(
    loggingSettings: unknown,
    options: { redactPersonalData?: boolean; publish?: (entry: SystemLogEntry) => void } = {},
  ): void {
    this.settings = {
      ...normalizeSystemLoggingSettings(loggingSettings),
      redactPersonalData: options.redactPersonalData !== false,
    };
    this.publish = options.publish || null;
    this.initialized = true;
    this.prune();
  }

  updateSettings(loggingSettings: unknown, redactPersonalData = true): void {
    this.settings = {
      ...normalizeSystemLoggingSettings(loggingSettings),
      redactPersonalData,
    };
    if (this.initialized) this.prune();
  }

  write(
    level: SystemLogLevel,
    source: string,
    message: string,
    details?: Record<string, unknown>,
  ): SystemLogEntry | null {
    const cleanSource = sanitizeSystemLogText(source, false).slice(0, 80) || 'Application';
    const cleanMessage = sanitizeSystemLogText(message, this.settings.redactPersonalData) || 'No message';
    const cleanDetails = sanitizeSystemLogDetails(details, this.settings.redactPersonalData);
    const consoleMethod = level === 'warning' ? 'warn' : level;
    console[consoleMethod](`[${cleanSource}] ${cleanMessage}`, cleanDetails || '');

    if (!this.initialized) {
      return null;
    }

    try {
      const entry = SystemLogRepo.save({
        occurredAt: new Date().toISOString(),
        level,
        source: cleanSource,
        message: cleanMessage,
        details: cleanDetails,
      });
      this.publish?.(entry);
      this.writesSincePrune += 1;
      if (this.writesSincePrune >= 250) this.prune();
      return entry;
    } catch (error) {
      console.error('[Application Logger] Failed to persist a log entry:', error);
      return null;
    }
  }

  info(source: string, message: string, details?: Record<string, unknown>): SystemLogEntry | null {
    return this.write('info', source, message, details);
  }

  warning(source: string, message: string, details?: Record<string, unknown>): SystemLogEntry | null {
    return this.write('warning', source, message, details);
  }

  error(source: string, message: string, error?: unknown, details: Record<string, unknown> = {}): SystemLogEntry | null {
    const errorDetails = error instanceof Error
      ? { ...details, errorName: error.name, errorMessage: error.message }
      : error === undefined ? details : { ...details, error: String(error) };
    return this.write('error', source, message, errorDetails);
  }

  console(source: string): Pick<Console, 'log' | 'error'> {
    return {
      log: (...args: unknown[]) => { this.info(source, formatConsoleArguments(args)); },
      error: (...args: unknown[]) => { this.error(source, formatConsoleArguments(args)); },
    } as Pick<Console, 'log' | 'error'>;
  }

  private prune(): void {
    try {
      SystemLogRepo.prune(this.settings);
      this.writesSincePrune = 0;
    } catch (error) {
      console.error('[Application Logger] Failed to prune retained logs:', error);
    }
  }
}

export const SystemLogger = new ApplicationLogger();
