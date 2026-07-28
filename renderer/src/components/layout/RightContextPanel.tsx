import { useAppStore } from '../../stores/AppStore';
import { RefreshCw } from 'lucide-react';
import { CalendarAgendaPanel } from '../CalendarAgendaPanel';

export function RightContextPanel() {
  const store = useAppStore();

  if (!store.settings.general.showRightContextPanel) return null;

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
            onClick={() => store.triggerSyncManual()}
            disabled={store.isSyncing}
            title="Sync Mailbox Now"
            className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-[background-color,color] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
          >
            <RefreshCw className={`w-3 h-3 ${store.isSyncing ? 'animate-spin' : ''}`} />
          </button>
        </div>
        {store.syncHealth === 'failed' && (
          <button
            onClick={() => store.triggerBackfillManual()}
            className="self-start text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline cursor-pointer"
          >
            Continue Indexing
          </button>
        )}
      </div>

    </div>
  );
}
