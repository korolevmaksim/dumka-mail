import { LoaderCircle, type LucideIcon } from 'lucide-react';
import type { MailboxEmptyCopy } from '../../../shared/mailboxEmptyCopy';

export function MailboxEmptyState({
  icon: Icon,
  copy,
  onClearSearch,
}: {
  icon: LucideIcon;
  copy: MailboxEmptyCopy;
  onClearSearch: () => void;
}) {
  return (
    <div role="status" aria-live="polite" className="flex flex-col items-center justify-center flex-1 p-6 text-center text-[var(--text-secondary)]">
      {copy.busy
        ? <LoaderCircle aria-hidden="true" className="w-8 h-8 mb-2 animate-spin text-[var(--accent-ink)] opacity-70 motion-reduce:animate-none" />
        : <Icon aria-hidden="true" className="w-10 h-10 mb-2 opacity-30" />}
      <p className="font-semibold">{copy.title}</p>
      <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">{copy.body}</p>
      {copy.action === 'clearSearch' && (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-3 rounded-md bg-[var(--accent-fill)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-90"
        >
          Clear search
        </button>
      )}
    </div>
  );
}
