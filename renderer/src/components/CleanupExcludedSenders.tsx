import { useRef } from 'react';
import { Undo2, X } from 'lucide-react';
import type { CleanupSenderExclusion } from '../../../shared/types';
import { useDialogFocus } from '../hooks/useDialogFocus';

interface CleanupExcludedSendersProps {
  exclusions: CleanupSenderExclusion[];
  restoringKey: string | null;
  showAccount: boolean;
  onRestore: (exclusion: CleanupSenderExclusion) => void;
  onClose: () => void;
}

function exclusionKey(exclusion: CleanupSenderExclusion): string {
  return `${exclusion.accountId}:${exclusion.senderEmail}`;
}

export function CleanupExcludedSenders({
  exclusions,
  restoringKey,
  showAccount,
  onRestore,
  onClose,
}: CleanupExcludedSendersProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  useDialogFocus(dialogRef, closeButtonRef, onClose);

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/15" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-exclusions-title"
        className="dm-side-sheet flex h-full w-[min(520px,64vw)] min-w-[380px] flex-col border-l border-[var(--border)] bg-[var(--panel-bg)] shadow-[-6px_0_12px_rgba(0,0,0,0.08)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div>
            <h2 id="cleanup-exclusions-title" className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              Excluded senders
            </h2>
            <p className="mt-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
              Hidden only from Cleanup suggestions. Mail and security analysis are unchanged.
            </p>
          </div>
          <button ref={closeButtonRef} type="button" onClick={onClose} aria-label="Close excluded senders" className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-4">
          {exclusions.length === 0 ? (
            <div className="rounded-lg border border-[var(--border)] p-4 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
              No senders are excluded from Cleanup.
            </div>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--border)]" aria-label="Excluded Cleanup senders">
              {exclusions.map(exclusion => {
                const key = exclusionKey(exclusion);
                return (
                  <li key={key} className="flex items-center gap-3 py-2.5">
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold text-[var(--text-primary)]">{exclusion.senderName || exclusion.senderEmail}</div>
                      <div className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{exclusion.senderEmail}</div>
                      <div className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                        {showAccount ? `${exclusion.accountId} · ` : ''}Excluded {new Date(exclusion.excludedAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={restoringKey === key}
                      onClick={() => onRestore(exclusion)}
                      className="flex shrink-0 items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40"
                    >
                      <Undo2 className="h-3 w-3" /> {restoringKey === key ? 'Restoring…' : 'Restore'}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
