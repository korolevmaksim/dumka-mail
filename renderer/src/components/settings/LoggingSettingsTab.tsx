import { useCallback, useEffect, useState } from 'react';
import { Activity, Database, ScrollText, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import {
  SYSTEM_LOG_MAX_ENTRY_OPTIONS,
  SYSTEM_LOG_RETENTION_OPTIONS,
  type SystemLogStats,
} from '../../../../shared/systemLogs';
import { SettingsPaneHeader } from './SettingsControls';
import { SystemLogViewer } from './SystemLogViewer';

const EMPTY_STATS: SystemLogStats = {
  total: 0,
  info: 0,
  warning: 0,
  error: 0,
  oldestAt: null,
  newestAt: null,
  sources: [],
};

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

export function LoggingSettingsTab() {
  const store = useAppStore();
  const [viewerOpen, setViewerOpen] = useState(false);
  const [stats, setStats] = useState<SystemLogStats>(EMPTY_STATS);

  const refreshStats = useCallback(() => {
    void window.electronAPI.getSystemLogStats().then(setStats).catch(() => setStats(EMPTY_STATS));
  }, []);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  if (viewerOpen) {
    return (
      <SystemLogViewer
        onClose={() => {
          setViewerOpen(false);
          refreshStats();
        }}
      />
    );
  }

  return (
    <div className="flex flex-col gap-5 max-w-[720px] select-text">
      <SettingsPaneHeader
        icon={ScrollText}
        title="Logging"
        subtitle="Inspect local application activity without opening Terminal or hunting for files."
      />

      <section className="dm-panel border border-[var(--border)] rounded-lg bg-[var(--rail-bg)] overflow-hidden">
        <div className="flex items-center justify-between gap-4 px-4 py-3.5 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] bg-[var(--accent-surface)]">
              <Activity className="h-4 w-4 text-[var(--accent-ink)]" />
            </span>
            <div className="min-w-0">
              <div className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Application Log</div>
              <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                {stats.total === 0
                  ? 'No events recorded yet'
                  : `${formatCount(stats.total)} events · ${formatCount(stats.error)} errors · ${formatCount(stats.warning)} warnings`}
              </div>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setViewerOpen(true)}
            className="shrink-0 inline-flex items-center gap-2 px-3 py-1.5 rounded bg-[var(--accent-solid)] text-white text-[calc(11px*var(--font-scale))] font-semibold hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] focus-visible:outline-offset-2 cursor-pointer"
          >
            <ScrollText className="h-3.5 w-3.5" />
            Show Logs
          </button>
        </div>

        <div className="px-4 py-3.5 flex flex-col gap-4">
          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0">
              <label htmlFor="log-retention" className="block text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Retention period</label>
              <p className="mt-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Entries older than this are removed automatically.</p>
            </div>
            <select
              id="log-retention"
              value={store.settings.logging.retentionDays}
              onChange={event => {
                const retentionDays = Number(event.target.value);
                store.updateSettings(settings => { settings.logging.retentionDays = retentionDays; });
                window.setTimeout(refreshStats, 250);
              }}
              className="dm-control h-[var(--settings-control-h)] min-w-[132px] bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
            >
              {SYSTEM_LOG_RETENTION_OPTIONS.map(days => (
                <option key={days} value={days}>{days === 1 ? '1 day' : `${days} days`}</option>
              ))}
            </select>
          </div>

          <div className="h-px bg-[var(--border)]" />

          <div className="flex items-center justify-between gap-5">
            <div className="min-w-0">
              <label htmlFor="log-entry-limit" className="block text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Maximum records</label>
              <p className="mt-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">A size guard removes the oldest records even within retention.</p>
            </div>
            <select
              id="log-entry-limit"
              value={store.settings.logging.maxEntries}
              onChange={event => {
                const maxEntries = Number(event.target.value);
                store.updateSettings(settings => { settings.logging.maxEntries = maxEntries; });
                window.setTimeout(refreshStats, 250);
              }}
              className="dm-control h-[var(--settings-control-h)] min-w-[132px] bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
            >
              {SYSTEM_LOG_MAX_ENTRY_OPTIONS.map(limit => (
                <option key={limit} value={limit}>{formatCount(limit)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <div className="grid grid-cols-2 gap-3">
        <div className="dm-inset flex gap-3 rounded-lg bg-[var(--app-bg)] p-3.5">
          <Database className="mt-0.5 h-4 w-4 shrink-0 text-[var(--info)]" />
          <div>
            <div className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Stored locally</div>
            <p className="mt-0.5 text-[calc(9px*var(--font-scale))] leading-relaxed text-[var(--text-secondary)]">Structured events stay in Dumka Mail’s SQLite database and are never uploaded by this feature.</p>
          </div>
        </div>
        <div className="dm-inset flex gap-3 rounded-lg bg-[var(--app-bg)] p-3.5">
          <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-[var(--success)]" />
          <div>
            <div className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Safe by default</div>
            <p className="mt-0.5 text-[calc(9px*var(--font-scale))] leading-relaxed text-[var(--text-secondary)]">Tokens are always removed. Personal identifiers follow the Redact Logs preference under Privacy.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
