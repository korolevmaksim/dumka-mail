import { useAppStore } from '../../stores/AppStore';
import { RefreshCw } from 'lucide-react';
import { CalendarAgendaPanel } from '../CalendarAgendaPanel';
import { isRenderedBackfillProgress, syncStatusAffordance } from '../../../../shared/syncStatusAffordance';

export function RightContextPanel() {
  const store = useAppStore();

  if (!store.settings.general.showRightContextPanel) return null;

  const affordance = syncStatusAffordance({
    syncHealth: store.syncHealth,
    backfillProgress: store.backfillProgress,
    hasAccount: store.accounts.length > 0,
  });

  return (
    <div className="dm-right-panel w-[var(--right-panel-w)] min-w-[280px] border-l border-[var(--border)] panel-surface bg-[var(--panel-bg)] flex flex-col overflow-y-auto p-4 gap-5 select-none shrink-0">

      {store.settings.calendar.showAgendaInRightPanel && <CalendarAgendaPanel />}

      {/* Slim sync status row — always rendered */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          <span className={`w-2 h-2 rounded-full shrink-0 ${
            store.syncHealth === 'ready' ? 'bg-[var(--success)]' :
            store.syncHealth === 'syncing' || store.syncHealth === 'indexing' ? 'bg-[var(--accent)] animate-pulse' :
            store.syncHealth === 'reconnect' ? 'bg-[var(--warning)]' :
            'bg-[var(--danger)]'
          }`}></span>
          <span className="flex-1 truncate">{store.syncStatusText}</span>
          <button
            type="button"
            onClick={() => void store.triggerSyncManual()}
            disabled={store.isSyncing || store.accounts.length === 0}
            title="Retry mailbox sync"
            className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-[background-color,color] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${store.isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {isRenderedBackfillProgress(store.backfillProgress) && (
          <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            {store.backfillProgress}
          </div>
        )}
        {affordance === 'retrySync' ? (
          <button
            type="button"
            onClick={() => void store.triggerSyncManual()}
            disabled={store.isSyncing}
            className="self-start text-[calc(10px*var(--font-scale))] font-semibold text-[var(--danger)] hover:underline cursor-pointer disabled:opacity-50"
          >
            {store.isSyncing ? 'Retrying…' : 'Retry sync'}
          </button>
        ) : affordance === 'continueIndexing' ? (
          <button
            type="button"
            onClick={() => void store.triggerBackfillManual()}
            className="self-start text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer"
          >
            Continue indexing
          </button>
        ) : null}
      </div>

    </div>
  );
}
