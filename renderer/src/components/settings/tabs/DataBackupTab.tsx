import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { Database, FileDown, FolderOpen, HardDriveDownload, RotateCcw } from 'lucide-react';
import { Toggle } from '../SettingsControls';
import { emitToast } from '../../../lib/toastBus';
import type { MailboxExportProgress, MailboxExportScope } from '../../../../../shared/mboxExport';

const RETENTION_OPTIONS = [2, 3, 5, 10, 20];

const SCOPE_OPTIONS: Array<{ value: MailboxExportScope; label: string }> = [
  { value: 'all', label: 'All locally cached mail' },
  { value: 'inbox', label: 'Inbox only' },
  { value: 'sent', label: 'Sent only' },
];

function formatBackupTime(iso: string | null): string {
  if (!iso) return 'Never';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return 'Never';
  return date.toLocaleString();
}

export function DataBackupTab() {
  const store = useAppStore();
  const data = store.settings.data;

  const [backupBusy, setBackupBusy] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [exportAccountId, setExportAccountId] = useState(store.accounts[0]?.email || '');
  const [exportScope, setExportScope] = useState<MailboxExportScope>('all');
  const [exportProgress, setExportProgress] = useState<MailboxExportProgress | null>(null);
  const [exportResult, setExportResult] = useState<{ filePath: string; exportedMessages: number } | null>(null);

  const exportRunning = exportProgress?.state === 'running';
  const exportPercent = useMemo(() => {
    if (!exportProgress || exportProgress.totalThreads <= 0) return 0;
    return Math.min(100, Math.round((exportProgress.processedThreads / exportProgress.totalThreads) * 100));
  }, [exportProgress]);

  useEffect(() => {
    const unsubscribe = window.electronAPI.onMailboxExportProgress(progress => {
      setExportProgress(progress);
      if (progress.state === 'failed') {
        emitToast({ type: 'error', message: progress.message || 'The export failed.' });
      }
    });
    return unsubscribe;
  }, []);

  // Accounts load asynchronously; default the selector once they arrive.
  useEffect(() => {
    if (!exportAccountId && store.accounts.length > 0) {
      setExportAccountId(store.accounts[0].email);
    }
  }, [exportAccountId, store.accounts]);

  const runBackup = async () => {
    setBackupBusy(true);
    try {
      const result = await window.electronAPI.createBackup();
      if (result.ok) {
        await store.updateSettings(s => { s.data.lastBackupAt = result.createdAt; });
        emitToast({ type: 'success', message: 'Backup completed.', actionLabel: 'Reveal', onAction: () => window.electronAPI.revealInFolder(result.filePath) });
      } else if (!result.cancelled) {
        emitToast({ type: 'error', message: result.message || 'The backup failed.' });
      }
    } catch (error) {
      emitToast({ type: 'error', message: error instanceof Error ? error.message : 'The backup failed.' });
    } finally {
      setBackupBusy(false);
    }
  };

  const runRestore = () => {
    emitToast({
      type: 'warning',
      message: 'Restore replaces all local data with the backup and restarts the app. Your current database is preserved as a pre-restore copy.',
      actionLabel: 'Choose Backup & Restart',
      duration: 8000,
      onAction: () => {
        setRestoreBusy(true);
        window.electronAPI.stageRestoreFromBackup()
          .then(result => {
            // On success the app relaunches; only failures and cancels come back here.
            if (!result.ok && !result.cancelled) {
              emitToast({ type: 'error', message: result.message || 'The backup could not be restored.' });
            }
          })
          .catch(error => {
            emitToast({ type: 'error', message: error instanceof Error ? error.message : 'The backup could not be restored.' });
          })
          .finally(() => setRestoreBusy(false));
      },
    });
  };

  const runExport = async () => {
    if (!exportAccountId) return;
    setExportResult(null);
    setExportProgress(null);
    try {
      const result = await window.electronAPI.exportMailboxMbox(exportAccountId, exportScope);
      if (result.ok) {
        setExportResult({ filePath: result.filePath, exportedMessages: result.exportedMessages });
      } else if (!result.cancelled) {
        emitToast({ type: 'error', message: result.message || 'The export failed.' });
      }
    } catch (error) {
      emitToast({ type: 'error', message: error instanceof Error ? error.message : 'The export failed.' });
    } finally {
      setExportProgress(null);
    }
  };

  const cancelExport = () => {
    void window.electronAPI.cancelMailboxExport(exportAccountId);
  };

  const selectClassName = 'bg-[var(--panel-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer';
  const primaryButtonClassName = 'px-3 py-1.5 bg-[var(--accent)] text-white rounded font-medium text-[calc(10px*var(--font-scale))] disabled:opacity-50 cursor-pointer transition-opacity';
  const secondaryButtonClassName = 'px-3 py-1.5 border border-[var(--border)] rounded text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--panel-bg)] disabled:opacity-50 cursor-pointer transition-colors';

  return (
    <div className="flex flex-col gap-4 max-w-[600px]">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">Data & Backup</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Your mail lives on this device. Back it up, restore it, or take it with you.</p>
      </div>

      {/* Backup */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <Database className="w-3.5 h-3.5 text-[var(--accent)]" /> Backup
        </span>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Last backup</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{formatBackupTime(data.lastBackupAt)}</span>
          </div>
          <button type="button" onClick={runBackup} disabled={backupBusy} className={primaryButtonClassName}>
            {backupBusy ? 'Backing up…' : 'Back Up Now'}
          </button>
        </div>
        <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">
          Saves a consistent copy of the local database (accounts, mail cache, settings) to a location you choose, with a small JSON manifest alongside it.
        </span>
      </div>

      {/* Automatic backups */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <HardDriveDownload className="w-3.5 h-3.5 text-[var(--accent)]" /> Automatic Backups
        </span>
        <div className="flex items-center justify-between py-0.5">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Daily automatic backup</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Stored in the app's support folder, checked on launch and once a day</span>
          </div>
          <Toggle
            checked={data.autoBackupEnabled}
            onChange={(val) => store.updateSettings(s => { s.data.autoBackupEnabled = val; })}
          />
        </div>
        {data.autoBackupEnabled && (
          <div className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Backups to keep</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Older backups are pruned automatically</span>
            </div>
            <select
              value={data.autoBackupRetention}
              onChange={(e) => store.updateSettings(s => { s.data.autoBackupRetention = Number(e.target.value); })}
              className={selectClassName}
            >
              {RETENTION_OPTIONS.map(option => (
                <option key={option} value={option}>{option}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Restore */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <RotateCcw className="w-3.5 h-3.5 text-[var(--accent)]" /> Restore
        </span>
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Restore from a backup file</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">
              The app restarts to apply the backup. Your current database is preserved as a pre-restore copy.
            </span>
          </div>
          <button type="button" onClick={runRestore} disabled={restoreBusy} className={secondaryButtonClassName}>
            {restoreBusy ? 'Preparing…' : 'Restore…'}
          </button>
        </div>
      </div>

      {/* Export */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1.5">
          <FileDown className="w-3.5 h-3.5 text-[var(--accent)]" /> Export as .mbox
        </span>
        <div className="flex items-center gap-2">
          <select
            value={exportAccountId}
            onChange={(e) => setExportAccountId(e.target.value)}
            disabled={exportRunning}
            className={`${selectClassName} flex-1 min-w-0`}
          >
            {store.accounts.length === 0 && <option value="">No accounts</option>}
            {store.accounts.map(account => (
              <option key={account.id} value={account.email}>{account.email}</option>
            ))}
          </select>
          <select
            value={exportScope}
            onChange={(e) => setExportScope(e.target.value as MailboxExportScope)}
            disabled={exportRunning}
            className={selectClassName}
          >
            {SCOPE_OPTIONS.map(option => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            type="button"
            onClick={runExport}
            disabled={exportRunning || !exportAccountId}
            className={primaryButtonClassName}
          >
            {exportRunning ? 'Exporting…' : 'Export'}
          </button>
        </div>

        {exportRunning && exportProgress && (
          <div className="flex flex-col gap-1.5">
            <div className="h-1.5 rounded-full bg-[var(--strong-border)]/40 overflow-hidden">
              <div className="h-full bg-[var(--accent)] transition-all" style={{ width: `${exportPercent}%` }} />
            </div>
            <div className="flex items-center justify-between">
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                {exportProgress.processedMessages.toLocaleString()} messages · {exportProgress.processedThreads.toLocaleString()} / {exportProgress.totalThreads.toLocaleString()} threads
              </span>
              <button type="button" onClick={cancelExport} className="text-[calc(10px*var(--font-scale))] text-[var(--danger)] hover:underline cursor-pointer">
                Cancel
              </button>
            </div>
          </div>
        )}

        {exportResult && (
          <div className="flex items-center justify-between gap-3 bg-[var(--panel-bg)] border border-[var(--border)] rounded-md px-3 py-2">
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                Exported {exportResult.exportedMessages.toLocaleString()} messages
              </span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] truncate">{exportResult.filePath}</span>
            </div>
            <button
              type="button"
              onClick={() => window.electronAPI.revealInFolder(exportResult.filePath)}
              className="shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer flex items-center gap-1"
            >
              <FolderOpen className="w-3 h-3" /> Reveal
            </button>
          </div>
        )}

        <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">
          Exports contain message text and headers only. Attachments are not stored locally, so they are not part of the export.
        </span>
      </div>
    </div>
  );
}
