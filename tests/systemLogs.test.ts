import { describe, expect, it } from 'vitest';
import { sanitizeSystemLogDetails, sanitizeSystemLogText } from '../main/systemLogger';
import {
  DEFAULT_SYSTEM_LOGGING_SETTINGS,
  normalizeSystemLogQuery,
  normalizeSystemLoggingSettings,
  type SystemLogDetails,
} from '../shared/systemLogs';

describe('system logging settings', () => {
  it('uses bounded defaults for invalid persisted settings', () => {
    expect(normalizeSystemLoggingSettings({ retentionDays: 'nope', maxEntries: -1 })).toEqual(
      DEFAULT_SYSTEM_LOGGING_SETTINGS,
    );
  });

  it('normalizes migrated numeric values to supported choices', () => {
    expect(normalizeSystemLoggingSettings({ retentionDays: 12, maxEntries: 42_000 })).toEqual({
      retentionDays: 14,
      maxEntries: 50_000,
    });
  });

  it('normalizes viewer queries to bounded IPC-safe values', () => {
    expect(normalizeSystemLogQuery({
      levels: ['warning', 'warning', 'invalid'],
      source: `  ${'S'.repeat(100)}  `,
      search: `  ${'q'.repeat(250)}  `,
      beforeId: 42,
      limit: 50_000,
    })).toEqual({
      levels: ['warning'],
      source: 'S'.repeat(80),
      search: 'q'.repeat(200),
      beforeId: 42,
      limit: 500,
    });
  });

  it('rejects invalid pagination and uses all severities by default', () => {
    expect(normalizeSystemLogQuery({ beforeId: -1, limit: 1 })).toEqual({
      levels: ['info', 'warning', 'error'],
      limit: 25,
    });
  });
});

describe('system log redaction', () => {
  it('always removes credentials and optionally masks personal identifiers', () => {
    const text = 'm.korolev@example.com used Bearer secret-token and sk-abcdefghijklmnop from /Users/maksim/project';
    const sanitized = sanitizeSystemLogText(text, true);

    expect(sanitized).toContain('m***@example.com');
    expect(sanitized).toContain('Bearer [redacted]');
    expect(sanitized).toContain('[redacted-key]');
    expect(sanitized).toContain('/Users/[redacted]/project');
    expect(sanitized).not.toContain('secret-token');
  });

  it('redacts secret fields and keeps structured scalar diagnostics', () => {
    const details = sanitizeSystemLogDetails({
      accessToken: 'sensitive',
      durationMs: 42,
      completed: true,
      accountId: 'person@example.com',
    }, true) as SystemLogDetails;

    expect(details.accessToken).toBe('[redacted]');
    expect(details.durationMs).toBe(42);
    expect(details.completed).toBe(true);
    expect(details.accountId).toBe('p***@example.com');
  });
});
