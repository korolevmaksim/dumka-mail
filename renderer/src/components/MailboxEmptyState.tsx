import type { LucideIcon } from 'lucide-react';
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
      <Icon aria-hidden="true" className="w-10 h-10 mb-2 opacity-30" />
      <p className="font-semibold">{copy.title}</p>
      <p className="text-[calc(11px*var(--font-scale))] opacity-75 mt-1">{copy.body}</p>
      {copy.action === 'clearSearch' && (
        <button
          type="button"
          onClick={onClearSearch}
          className="mt-3 rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white hover:opacity-90"
        >
          Clear search
        </button>
      )}
    </div>
  );
}
