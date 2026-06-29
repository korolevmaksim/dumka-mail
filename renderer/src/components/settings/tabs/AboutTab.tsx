import { useAppStore } from '../../../stores/AppStore';
import { Activity } from 'lucide-react';

export function AboutTab() {
  const store = useAppStore();

  return (
    <div className="flex flex-col gap-5 max-w-[600px] select-text text-[calc(11px*var(--font-scale))]">
      <div className="flex flex-col gap-1 items-center justify-center p-6 border border-[var(--border)] rounded-lg bg-[var(--rail-bg)] text-center">
        <span className="w-12 h-12 rounded-2xl bg-[var(--accent)] flex items-center justify-center text-white text-[calc(24px*var(--font-scale))] font-black shadow-lg">
          Д
        </span>
        <h2 className="text-[calc(15px*var(--font-scale))] font-bold text-[var(--text-primary)] mt-3">Dumka Mail</h2>
        <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-mono">Version 1.0.0 (Build 2026.06.26)</span>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] mt-2 max-w-[400px] leading-relaxed">
          Super-fast, agentic email client built using Electron, React 19, SQLite FTS, and AI local triage planners.
        </p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3.5">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1">
          <Activity className="w-3.5 h-3.5 text-[var(--accent)]" /> Performance & Telemetry Proofs
        </span>

        <div className="grid grid-cols-2 gap-3.5 font-mono text-[calc(10px*var(--font-scale))]">
          <div className="flex flex-col bg-[var(--panel-bg)] border border-[var(--border)] p-2 rounded">
            <span className="text-[var(--text-secondary)] text-[calc(9px*var(--font-scale))] uppercase font-bold">SQL Cache Latency</span>
            <span className="text-[var(--text-primary)] text-[calc(12px*var(--font-scale))] font-bold mt-1">
              {store.speedProof.cacheReadyMs ? `${store.speedProof.cacheReadyMs}ms` : 'Measuring…'}
            </span>
          </div>
          <div className="flex flex-col bg-[var(--panel-bg)] border border-[var(--border)] p-2 rounded">
            <span className="text-[var(--text-secondary)] text-[calc(9px*var(--font-scale))] uppercase font-bold">Gmail Sync Latency</span>
            <span className="text-[var(--text-primary)] text-[calc(12px*var(--font-scale))] font-bold mt-1">
              {store.speedProof.syncReadyMs ? `${store.speedProof.syncReadyMs}ms` : 'Measuring…'}
            </span>
          </div>
          <div className="flex flex-col bg-[var(--panel-bg)] border border-[var(--border)] p-2 rounded">
            <span className="text-[var(--text-secondary)] text-[calc(9px*var(--font-scale))] uppercase font-bold">Local Search Latency</span>
            <span className="text-[var(--text-primary)] text-[calc(12px*var(--font-scale))] font-bold mt-1">
              {store.speedProof.searchMs ? `${store.speedProof.searchMs}ms` : 'Measuring…'}
            </span>
          </div>
          <div className="flex flex-col bg-[var(--panel-bg)] border border-[var(--border)] p-2 rounded">
            <span className="text-[var(--text-secondary)] text-[calc(9px*var(--font-scale))] uppercase font-bold">AI Chat Latency</span>
            <span className="text-[var(--text-primary)] text-[calc(12px*var(--font-scale))] font-bold mt-1">
              {store.speedProof.aiMs ? `${store.speedProof.aiMs}ms` : 'N/A'}
            </span>
          </div>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />
        
        <div className="flex justify-between items-center text-[calc(10px*var(--font-scale))]">
          <div className="flex flex-col gap-0.5">
            <span className="font-semibold text-[var(--text-primary)]">Body Cache Coverage</span>
            <span className="text-[var(--text-secondary)]">{store.speedProof.detailCacheCoverage}</span>
          </div>
          <button
            type="button"
            onClick={() => store.triggerVisibleBodyRepair()}
            className="px-3 py-1 bg-[var(--panel-bg)] border border-[var(--border)] hover:border-[var(--strong-border)] rounded text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)] transition-all cursor-pointer"
          >
            Repair Cache
          </button>
        </div>
      </div>
    </div>
  );
}
