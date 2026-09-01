import { Mail } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';

export function ConnectGmailPanel() {
  const store = useAppStore();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--panel-bg)] p-8 text-center">
      <Mail aria-hidden="true" className="h-12 w-12 text-[var(--accent)] opacity-80" />
      <div className="max-w-sm">
        <h1 className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
          Connect Gmail to start
        </h1>
        <p className="mt-2 text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">
          Dumka Mail keeps a local copy of your mailbox. Sign in with Google to sync mail, send, and use undo.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void store.onboardAccount('')}
        className="rounded-lg bg-[var(--accent)] px-4 py-2 text-[calc(13px*var(--font-scale))] font-semibold text-white hover:opacity-95"
      >
        Connect Gmail
      </button>
    </div>
  );
}
