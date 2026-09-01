import { AlertTriangle, LoaderCircle } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';

export function MailboxSyncBanner() {
  const store = useAppStore();
  if (store.syncHealth !== 'failed') return null;

  return (
    <section
      role="alert"
      aria-live="assertive"
      className="flex shrink-0 items-center gap-3 border-b border-[var(--danger)]/35 bg-[var(--danger)]/10 px-4 py-2 text-[var(--text-primary)]"
    >
      <AlertTriangle aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--danger)]" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-[calc(11px*var(--font-scale))] font-semibold">
          Mail sync failed
        </div>
        <div className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          {store.syncStatusText || 'Gmail could not be reached.'} Cached mail is still available.
        </div>
      </div>
      <button
        type="button"
        onClick={() => void store.triggerSyncManual()}
        disabled={store.isSyncing}
        className="flex shrink-0 items-center gap-1.5 rounded-md bg-[var(--danger)] px-3 py-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-white hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--danger)] focus-visible:outline-offset-2 disabled:cursor-wait disabled:opacity-60"
      >
        {store.isSyncing && <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 animate-spin motion-reduce:animate-none" />}
        {store.isSyncing ? 'Retrying…' : 'Retry sync'}
      </button>
    </section>
  );
}
