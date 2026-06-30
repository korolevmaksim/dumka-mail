import { useAppStore } from '../../stores/AppStore';
import { ThreadContextPanel } from '../ThreadContextPanel';
import { ActivityTimeline } from '../ActivityTimeline';
import { RefreshCw, RotateCcw } from 'lucide-react';
import { CalendarAgendaPanel } from '../CalendarAgendaPanel';

export function RightContextPanel() {
  const store = useAppStore();

  if (!store.settings.general.showRightContextPanel) return null;

  return (
    <div className="w-[var(--right-panel-w)] min-w-[280px] border-l border-[var(--border)] panel-surface bg-[var(--panel-bg)] flex flex-col overflow-y-auto p-4 gap-5 select-none shrink-0">

      {/* Thread context meta (RL-C3) */}
      {store.openedThread && (
        <div className="flex flex-col gap-2">
          <h3 className="text-chrome text-[var(--text-secondary)]">MESSAGE</h3>
          <ThreadContextPanel thread={store.openedThread} />
        </div>
      )}

      {store.settings.calendar.showAgendaInRightPanel && <CalendarAgendaPanel />}

      {/* Health Verdict Panel */}
      <div className="flex flex-col gap-2">
        <h3 className="text-chrome text-[var(--text-secondary)] flex items-center justify-between">
          <span className="flex items-center gap-1.5">
            MAILBOX HEALTH
            <button
              onClick={() => store.triggerSyncManual()}
              disabled={store.isSyncing}
              title="Sync Mailbox Now"
              className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-[background-color,color] duration-150 active:translate-y-px focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:opacity-40"
            >
              <RefreshCw className={`w-3 h-3 ${store.isSyncing ? 'animate-spin' : ''}`} />
            </button>
          </span>
          <span className={`w-2 h-2 rounded-full ${
            store.syncHealth === 'ready' ? 'bg-[var(--success)]' :
            store.syncHealth === 'syncing' || store.syncHealth === 'indexing' ? 'bg-[var(--accent)] animate-pulse' :
            'bg-[var(--danger)]'
          }`}></span>
        </h3>
        
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--app-bg)] flex flex-col gap-1.5">
          <div className="flex items-center justify-between font-semibold">
            <span>Verdict:</span>
            <span className={`capitalize ${
              store.syncHealth === 'ready' ? 'text-[var(--success)]' :
              store.syncHealth === 'syncing' ? 'text-[var(--accent)]' :
              'text-[var(--warning)]'
            }`}>
              {store.syncHealth}
            </span>
          </div>
          <div className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            Status: {store.syncStatusText}
          </div>
          <div className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] flex items-center justify-between mt-1">
            <span>Archive indexed:</span>
            <span className="font-medium">{store.backfillProgress}</span>
          </div>
          {store.syncHealth === 'failed' && (
            <button
              onClick={() => store.triggerBackfillManual()}
              className="mt-2 w-full py-1 text-center bg-[var(--accent)] text-white rounded font-medium cursor-pointer text-[calc(10px*var(--font-scale))]"
            >
              Continue Indexing
            </button>
          )}
        </div>
      </div>

      {/* Speed Proof Panel */}
      <div className="flex flex-col gap-2">
        <h3 className="text-chrome text-[var(--text-secondary)]">SPEED PROOF</h3>
        <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--app-bg)] flex flex-col gap-1.5 text-[calc(11px*var(--font-scale))]">
          <div className="flex justify-between items-center">
            <span>Local cache startup:</span>
            <span className="font-mono text-[var(--success)]">{store.speedProof.cacheReadyMs || 0}ms</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Gmail sync check:</span>
            <span className="font-mono text-[var(--accent)]">{store.speedProof.syncReadyMs || 0}ms</span>
          </div>
          <div className="flex justify-between items-center">
            <span>Local search index FTS:</span>
            <span className="font-mono">{store.speedProof.searchMs || 0}ms</span>
          </div>
          <div className="flex justify-between items-center">
            <span>AI completion latency:</span>
            <span className="font-mono">{store.speedProof.aiMs || 0}ms</span>
          </div>
          <div className="flex justify-between items-center border-t border-[var(--border)] pt-2 mt-1">
            <span>Visible body coverage:</span>
            <span className="font-semibold">{store.speedProof.detailCacheCoverage}</span>
          </div>
          
          <button
            onClick={() => store.triggerVisibleBodyRepair()}
            className="mt-2 text-center text-[calc(10px*var(--font-scale))] border border-[var(--border)] hover:border-[var(--strong-border)] rounded py-1 cursor-pointer text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
          >
            Cache bodies
          </button>
        </div>
      </div>

      {/* Action Log Ledger Panel */}
      <div className="flex flex-col gap-2 flex-1">
        <h3 className="text-chrome text-[var(--text-secondary)] flex items-center justify-between">
          ACTION LEDGER
          <button onClick={() => store.undoLastAction()} className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] cursor-pointer flex items-center gap-0.5">
            <RotateCcw className="w-3 h-3" /> Undo (Z)
          </button>
        </h3>
        
        <div className="flex-1 border border-[var(--border)] rounded-lg p-2.5 bg-[var(--app-bg)] overflow-y-auto max-h-[240px]">
          <ActivityTimeline logs={store.actionLog} />
        </div>
      </div>

    </div>
  );
}
