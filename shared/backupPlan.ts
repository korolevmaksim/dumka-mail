/**
 * Pure planning helpers for local database backups: file naming and retention.
 *
 * The main process (`main/backupService.ts`) performs the actual I/O; keeping
 * the naming and pruning decisions here makes them unit-testable without
 * Electron and keeps `shared/` free of Node dependencies.
 */

export const BACKUP_FILE_PREFIX = 'dumka-backup-';
export const BACKUP_FILE_SUFFIX = '.sqlite';
export const DEFAULT_BACKUP_RETENTION = 5;
export const MAX_BACKUP_RETENTION = 50;

const BACKUP_FILE_PATTERN = /^dumka-backup-\d{8}-\d{6}\.sqlite$/;

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * UTC compact timestamp (`YYYYMMDD-HHmmss`). UTC keeps the value deterministic
 * across time zones and DST transitions, and zero padding makes the plain
 * lexicographic sort of file names chronological.
 */
export function formatBackupTimestamp(date: Date): string {
  return `${date.getUTCFullYear()}${pad2(date.getUTCMonth() + 1)}${pad2(date.getUTCDate())}`
    + `-${pad2(date.getUTCHours())}${pad2(date.getUTCMinutes())}${pad2(date.getUTCSeconds())}`;
}

/** `dumka-backup-YYYYMMDD-HHmmss.sqlite` */
export function backupFileName(date: Date): string {
  return `${BACKUP_FILE_PREFIX}${formatBackupTimestamp(date)}${BACKUP_FILE_SUFFIX}`;
}

/** Sidecar manifest written next to a backup: `dumka-backup-<ts>.manifest.json`. */
export function backupManifestFileName(backupName: string): string {
  return backupName.replace(/\.sqlite$/, '.manifest.json');
}

export function isBackupFileName(name: string): boolean {
  return BACKUP_FILE_PATTERN.test(name);
}

export function normalizeBackupRetention(value: unknown): number {
  if (value === null || value === undefined || value === '') return DEFAULT_BACKUP_RETENTION;
  const parsed = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_BACKUP_RETENTION;
  return Math.max(1, Math.min(MAX_BACKUP_RETENTION, Math.floor(parsed)));
}

/**
 * Given the file names inside the backups directory, returns the backup files
 * that should be deleted so only the newest `retention` backups survive.
 *
 * Only names matching the exact `dumka-backup-<timestamp>.sqlite` shape are
 * eligible for pruning — user files dropped into the same folder are never
 * touched. Manifest sidecars are the caller's responsibility (derive them from
 * the returned names with `backupManifestFileName`).
 */
export function planBackupPruning(fileNames: string[], retention: number): string[] {
  const keep = normalizeBackupRetention(retention);
  const backups = fileNames.filter(isBackupFileName).sort(); // oldest first
  return backups.slice(0, Math.max(0, backups.length - keep));
}

/** Name used when the live database is set aside before a staged restore. */
export function preRestoreBackupFileName(date: Date): string {
  return `database.pre-restore-${formatBackupTimestamp(date)}.sqlite`;
}

export interface BackupRunSuccess {
  ok: true;
  cancelled?: false;
  filePath: string;
  manifestPath: string;
  createdAt: string;
  sizeBytes: number;
}

export interface BackupRunCancelled {
  ok: false;
  cancelled: true;
}

export interface BackupRunFailed {
  ok: false;
  cancelled?: false;
  message: string;
}

export type BackupRunResult = BackupRunSuccess | BackupRunCancelled | BackupRunFailed;

export interface RestoreStageSuccess {
  ok: true;
}

export interface RestoreStageCancelled {
  ok: false;
  cancelled: true;
}

export interface RestoreStageFailed {
  ok: false;
  cancelled?: false;
  message: string;
}

export type RestoreStageResult = RestoreStageSuccess | RestoreStageCancelled | RestoreStageFailed;
