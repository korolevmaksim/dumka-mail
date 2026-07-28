import { describe, it, expect } from 'vitest';
import {
  backupFileName,
  backupManifestFileName,
  DEFAULT_BACKUP_RETENTION,
  formatBackupTimestamp,
  isBackupFileName,
  MAX_BACKUP_RETENTION,
  normalizeBackupRetention,
  planBackupPruning,
  preRestoreBackupFileName,
} from '../shared/backupPlan';

// All expectations use UTC so the tests are timezone-independent.
const SAMPLE_DATE = new Date(Date.UTC(2026, 6, 28, 9, 7, 3));

describe('formatBackupTimestamp', () => {
  it('formats a zero-padded UTC compact timestamp', () => {
    expect(formatBackupTimestamp(SAMPLE_DATE)).toBe('20260728-090703');
  });
});

describe('backupFileName', () => {
  it('builds dumka-backup-<timestamp>.sqlite', () => {
    expect(backupFileName(SAMPLE_DATE)).toBe('dumka-backup-20260728-090703.sqlite');
  });
});

describe('backupManifestFileName', () => {
  it('swaps the .sqlite suffix for .manifest.json', () => {
    expect(backupManifestFileName('dumka-backup-20260728-090703.sqlite'))
      .toBe('dumka-backup-20260728-090703.manifest.json');
  });
});

describe('preRestoreBackupFileName', () => {
  it('builds database.pre-restore-<timestamp>.sqlite', () => {
    expect(preRestoreBackupFileName(SAMPLE_DATE)).toBe('database.pre-restore-20260728-090703.sqlite');
  });
});

describe('isBackupFileName', () => {
  it('accepts only the exact backup file shape', () => {
    expect(isBackupFileName('dumka-backup-20260728-090703.sqlite')).toBe(true);
    expect(isBackupFileName('dumka-backup-20260728-090703.manifest.json')).toBe(false);
    expect(isBackupFileName('dumka-backup-random.sqlite')).toBe(false);
    expect(isBackupFileName('database.pre-restore-20260728-090703.sqlite')).toBe(false);
    expect(isBackupFileName('notes.txt')).toBe(false);
    expect(isBackupFileName('my-dumka-backup-20260728-090703.sqlite')).toBe(false);
  });
});

describe('normalizeBackupRetention', () => {
  it('clamps to 1..MAX and defaults invalid input', () => {
    expect(normalizeBackupRetention(0)).toBe(1);
    expect(normalizeBackupRetention(-5)).toBe(1);
    expect(normalizeBackupRetention(3.9)).toBe(3);
    expect(normalizeBackupRetention(10)).toBe(10);
    expect(normalizeBackupRetention(10_000)).toBe(MAX_BACKUP_RETENTION);
    expect(normalizeBackupRetention('7')).toBe(7);
    expect(normalizeBackupRetention('abc')).toBe(DEFAULT_BACKUP_RETENTION);
    expect(normalizeBackupRetention(undefined)).toBe(DEFAULT_BACKUP_RETENTION);
    expect(normalizeBackupRetention(null)).toBe(DEFAULT_BACKUP_RETENTION);
  });
});

describe('planBackupPruning', () => {
  const names = [
    'dumka-backup-20260720-090703.sqlite',
    'dumka-backup-20260721-090703.sqlite',
    'dumka-backup-20260722-090703.sqlite',
    'dumka-backup-20260723-090703.sqlite',
    'dumka-backup-20260724-090703.sqlite',
    'dumka-backup-20260725-090703.sqlite',
    'dumka-backup-20260726-090703.sqlite',
  ];

  it('deletes the oldest backups beyond the retention count', () => {
    expect(planBackupPruning(names, 3)).toEqual([
      'dumka-backup-20260720-090703.sqlite',
      'dumka-backup-20260721-090703.sqlite',
      'dumka-backup-20260722-090703.sqlite',
      'dumka-backup-20260723-090703.sqlite',
    ]);
  });

  it('keeps everything when retention covers the directory', () => {
    expect(planBackupPruning(names, 7)).toEqual([]);
    expect(planBackupPruning(names, 100)).toEqual([]);
  });

  it('sorts by the embedded timestamp, not the input order', () => {
    const shuffled = [names[5], names[0], names[6], names[1], names[4], names[2], names[3]];
    expect(planBackupPruning(shuffled, 5)).toEqual([names[0], names[1]]);
  });

  it('never touches foreign files in the directory', () => {
    const mixed = [...names, 'notes.txt', 'dumka-backup-random.sqlite', 'important.sqlite'];
    expect(planBackupPruning(mixed, 1)).toEqual(names.slice(0, 6));
  });

  it('normalizes the retention argument', () => {
    expect(planBackupPruning(names, 0)).toEqual(names.slice(0, 6));
    expect(planBackupPruning([], 5)).toEqual([]);
  });
});
