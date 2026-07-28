/**
 * Local database backup, automatic backup scheduling, and restore staging.
 *
 * Backups use better-sqlite3's online `db.backup()` API, which is safe against
 * the live WAL-mode database: it produces a consistent, fully checkpointed
 * single-file copy without blocking writers.
 *
 * Restore never overwrites the live database while the app is running. The
 * chosen file is validated, copied to `<appSupport>/pending-restore.sqlite`,
 * and the app relaunches; on the next launch `applyPendingRestoreIfAny()`
 * swaps it into place BEFORE `initializeDatabase()` opens the first
 * connection, moving the current database aside as
 * `database.pre-restore-<timestamp>.sqlite`. Migrations are idempotent and run
 * on every launch, so restoring an older backup upgrades cleanly.
 */
import { app, dialog, type BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { AccountsRepo, getDatabase, SettingsRepo } from './database';
import { ensureAppSupportDir } from './appPaths';
import { SystemLogger } from './systemLogger';
import {
  backupFileName,
  backupManifestFileName,
  DEFAULT_BACKUP_RETENTION,
  normalizeBackupRetention,
  planBackupPruning,
  preRestoreBackupFileName,
  type BackupRunResult,
  type RestoreStageResult,
} from '../shared/backupPlan';

const SQLITE_HEADER = Buffer.from('SQLite format 3\0', 'latin1');
const AUTO_BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PENDING_RESTORE_NAME = 'pending-restore.sqlite';
const LIVE_DATABASE_NAME = 'database.sqlite';

interface DataBackupSettings {
  autoBackupEnabled: boolean;
  autoBackupRetention: number;
  lastBackupAt: string | null;
}

function backupsDir(): string {
  return path.join(ensureAppSupportDir(), 'backups');
}

function readDataSettings(): DataBackupSettings {
  try {
    const raw = SettingsRepo.get('appSettings');
    const parsed = raw ? JSON.parse(raw) : {};
    const data = parsed?.data || {};
    return {
      autoBackupEnabled: data.autoBackupEnabled === true,
      autoBackupRetention: normalizeBackupRetention(data.autoBackupRetention),
      lastBackupAt: typeof data.lastBackupAt === 'string' ? data.lastBackupAt : null,
    };
  } catch {
    return { autoBackupEnabled: false, autoBackupRetention: DEFAULT_BACKUP_RETENTION, lastBackupAt: null };
  }
}

/** Persists the last-successful-backup timestamp inside the appSettings blob. */
export function recordSuccessfulBackup(createdAt: string): void {
  try {
    const raw = SettingsRepo.get('appSettings') || '{}';
    const parsed = JSON.parse(raw);
    parsed.data = { ...(parsed.data || {}), lastBackupAt: createdAt };
    SettingsRepo.set('appSettings', JSON.stringify(parsed));
  } catch (error) {
    SystemLogger.warning('Backup', 'Could not record the backup timestamp in settings.', { error });
  }
}

async function performBackup(
  filePath: string,
  createdAt: string,
  appVersion: string,
): Promise<{ manifestPath: string; sizeBytes: number }> {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  await getDatabase().backup(filePath);
  const manifestPath = path.join(path.dirname(filePath), backupManifestFileName(path.basename(filePath)));
  const manifest = {
    app: 'dumka-mail',
    appVersion,
    createdAt,
    accounts: AccountsRepo.list().length,
    source: LIVE_DATABASE_NAME,
  };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2), 'utf8');
  return { manifestPath, sizeBytes: fs.statSync(filePath).size };
}

function pruneAutoBackups(dir: string, retention: number): void {
  let names: string[] = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return;
  }
  for (const doomed of planBackupPruning(names, retention)) {
    for (const candidate of [doomed, backupManifestFileName(doomed)]) {
      try {
        fs.rmSync(path.join(dir, candidate), { force: true });
      } catch (error) {
        SystemLogger.warning('Backup', 'Failed to prune an old backup file.', { file: candidate, error });
      }
    }
  }
}

/** Interactive backup: the user picks the destination via a Save dialog. */
export async function createManualBackup(
  win: BrowserWindow | null,
  appVersion: string,
): Promise<BackupRunResult> {
  if (!win) return { ok: false, message: 'No window is available for the save dialog.' };
  const now = new Date();
  const createdAt = now.toISOString();
  const { filePath } = await dialog.showSaveDialog(win, {
    title: 'Back Up Dumka Mail Database',
    defaultPath: path.join(app.getPath('downloads'), backupFileName(now)),
    filters: [{ name: 'SQLite Database', extensions: ['sqlite'] }],
  });
  if (!filePath) return { ok: false, cancelled: true };

  try {
    const { manifestPath, sizeBytes } = await performBackup(filePath, createdAt, appVersion);
    SystemLogger.info('Backup', 'Manual database backup completed.', { sizeBytes });
    return { ok: true, filePath, manifestPath, createdAt, sizeBytes };
  } catch (error) {
    SystemLogger.error('Backup', 'Manual database backup failed.', error);
    return { ok: false, message: error instanceof Error ? error.message : String(error) };
  }
}

/** Scheduled backup into `<appSupport>/backups/` with retention pruning. */
export async function createAutoBackup(
  retention: number,
  appVersion: string,
): Promise<{ filePath: string; createdAt: string }> {
  const dir = backupsDir();
  fs.mkdirSync(dir, { recursive: true });
  const now = new Date();
  const createdAt = now.toISOString();
  const filePath = path.join(dir, backupFileName(now));
  await performBackup(filePath, createdAt, appVersion);
  pruneAutoBackups(dir, retention);
  return { filePath, createdAt };
}

let autoBackupTimer: ReturnType<typeof setInterval> | null = null;
let autoBackupRunning = false;

async function runAutoBackupIfDue(reason: 'launch' | 'daily'): Promise<void> {
  if (autoBackupRunning) return;
  const settings = readDataSettings();
  if (!settings.autoBackupEnabled) return;
  const lastRun = settings.lastBackupAt ? Date.parse(settings.lastBackupAt) : Number.NaN;
  if (Number.isFinite(lastRun) && Date.now() - lastRun < AUTO_BACKUP_INTERVAL_MS) return;

  autoBackupRunning = true;
  try {
    await createAutoBackup(settings.autoBackupRetention, app.getVersion());
    recordSuccessfulBackup(new Date().toISOString());
    SystemLogger.info('Backup', 'Automatic database backup completed.', { reason });
  } catch (error) {
    SystemLogger.error('Backup', 'Automatic database backup failed.', error);
  } finally {
    autoBackupRunning = false;
  }
}

/** Checks once on launch, then once every 24 hours while the app runs. */
export function startAutoBackupScheduler(): void {
  if (autoBackupTimer) return;
  void runAutoBackupIfDue('launch');
  autoBackupTimer = setInterval(() => {
    void runAutoBackupIfDue('daily');
  }, AUTO_BACKUP_INTERVAL_MS);
  autoBackupTimer.unref?.();
}

function validateSqliteHeader(filePath: string): string | null {
  let fd: number | null = null;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(SQLITE_HEADER.length);
    const read = fs.readSync(fd, header, 0, SQLITE_HEADER.length, 0);
    if (read !== SQLITE_HEADER.length || !header.equals(SQLITE_HEADER)) {
      return 'The selected file is not a SQLite database.';
    }
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // Best effort.
      }
    }
  }
}

/**
 * Restore flow, phase 1: pick a backup file, validate it, and stage it as
 * `<appSupport>/pending-restore.sqlite`. The caller relaunches the app on
 * success; phase 2 happens in `applyPendingRestoreIfAny()` on the next launch.
 */
export async function stageRestoreFromBackup(win: BrowserWindow | null): Promise<RestoreStageResult> {
  if (!win) return { ok: false, message: 'No window is available for the file dialog.' };
  const { filePaths } = await dialog.showOpenDialog(win, {
    title: 'Restore Dumka Mail Database',
    properties: ['openFile'],
    filters: [{ name: 'Dumka Mail Backup', extensions: ['sqlite', 'db'] }],
  });
  const sourcePath = filePaths?.[0];
  if (!sourcePath) return { ok: false, cancelled: true };

  const headerError = validateSqliteHeader(sourcePath);
  if (headerError) {
    SystemLogger.warning('Backup Restore', 'Restore rejected: invalid SQLite header.', { reason: headerError });
    return { ok: false, message: headerError };
  }

  const stagingPath = path.join(ensureAppSupportDir(), PENDING_RESTORE_NAME);
  try {
    fs.copyFileSync(sourcePath, stagingPath);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    SystemLogger.error('Backup Restore', 'Failed to stage the selected backup.', error);
    return { ok: false, message: `Could not copy the backup into place: ${message}` };
  }

  // Validate the staged copy: it must open and carry the app's core schema.
  try {
    const staged = new Database(stagingPath);
    try {
      const row = staged
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'accounts'")
        .get();
      if (!row) {
        throw new Error('The file is a SQLite database but not a Dumka Mail backup (no accounts table).');
      }
    } finally {
      staged.close();
    }
  } catch (error) {
    try {
      fs.rmSync(stagingPath, { force: true });
    } catch {
      // Best effort cleanup of the rejected staging file.
    }
    const message = error instanceof Error ? error.message : String(error);
    SystemLogger.warning('Backup Restore', 'Restore rejected: staged file failed validation.', { reason: message });
    return { ok: false, message };
  }

  return { ok: true };
}

/**
 * Restore flow, phase 2: if a staged restore file exists, swap it in for the
 * live database. MUST run before `initializeDatabase()` opens the database.
 * The current database is preserved as `database.pre-restore-<ts>.sqlite`.
 */
export function applyPendingRestoreIfAny(): { applied: boolean; preRestorePath?: string; error?: string } {
  const supportDir = ensureAppSupportDir();
  const stagingPath = path.join(supportDir, PENDING_RESTORE_NAME);
  if (!fs.existsSync(stagingPath)) return { applied: false };

  const dbPath = path.join(supportDir, LIVE_DATABASE_NAME);
  const preRestorePath = path.join(supportDir, preRestoreBackupFileName(new Date()));

  try {
    if (fs.existsSync(dbPath)) {
      fs.renameSync(dbPath, preRestorePath);
    }
    // Drop the old WAL/SHM sidecars; they belong to the pre-restore database
    // and must not replay into the restored file.
    for (const suffix of ['-wal', '-shm']) {
      const sidecar = `${dbPath}${suffix}`;
      if (fs.existsSync(sidecar)) {
        fs.rmSync(sidecar, { force: true });
      }
    }
    fs.renameSync(stagingPath, dbPath);
    console.log('[Backup Restore] Applied staged database restore; previous database kept at', preRestorePath);
    return { applied: true, preRestorePath: fs.existsSync(preRestorePath) ? preRestorePath : undefined };
  } catch (error) {
    // Best-effort rollback so the app can still boot with the previous data.
    try {
      if (fs.existsSync(stagingPath)) fs.rmSync(stagingPath, { force: true });
      if (!fs.existsSync(dbPath) && fs.existsSync(preRestorePath)) {
        fs.renameSync(preRestorePath, dbPath);
      }
    } catch {
      // Nothing more we can do; the error is reported below.
    }
    const message = error instanceof Error ? error.message : String(error);
    console.error('[Backup Restore] Failed to apply staged restore:', message);
    return { applied: false, error: message };
  }
}
