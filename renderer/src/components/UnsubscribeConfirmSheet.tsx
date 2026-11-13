import { useCallback, useId, useRef, useState, type KeyboardEvent } from 'react';
import { MailMinus, X } from 'lucide-react';
import { useDialogFocus } from '../hooks/useDialogFocus';
import {
  UNSUBSCRIBE_IRREVERSIBLE_NOTICE,
  describeUnsubscribeMethod,
  unsubscribeSheetTitle,
  type UnsubscribeTarget,
} from '../../../shared/unsubscribeConfirm';

interface UnsubscribeConfirmSheetProps {
  targets: UnsubscribeTarget[];
  busy?: boolean;
  onConfirm: (options: { archive: boolean }) => void;
  onCancel: () => void;
}

/**
 * Confirmation for unsubscribing from one or several senders (SPEC §6).
 * `⌘↩` or the button confirms, `Esc` cancels, focus stays inside.
 */
export function UnsubscribeConfirmSheet({ targets, busy = false, onConfirm, onCancel }: UnsubscribeConfirmSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  // Focus starts on Cancel: unsubscribing cannot be undone, so a stray Enter must not do it. `⌘↩` confirms.
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [archive, setArchive] = useState(true);
  const titleId = useId();
  const noticeId = useId();
  const checkboxId = useId();

  const cancel = useCallback(() => {
    if (!busy) onCancel();
  }, [busy, onCancel]);
  useDialogFocus(dialogRef, cancelRef, cancel);

  const confirm = () => {
    if (busy || targets.length === 0) return;
    onConfirm({ archive });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    // Keep mail shortcuts (and the composer's ⌘↩ send) from firing behind the sheet.
    event.stopPropagation();
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      confirm();
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) cancel();
    }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={noticeId}
        onKeyDown={handleKeyDown}
        className="dm-overlay flex max-h-[80vh] w-[min(460px,92vw)] flex-col overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl select-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 id={titleId} className="flex min-w-0 items-center gap-2 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            <MailMinus aria-hidden="true" className="h-4 w-4 shrink-0 text-[var(--accent-ink)]" />
            <span className="truncate">{unsubscribeSheetTitle(targets)}</span>
          </h2>
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel unsubscribe"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <ul className="flex-1 divide-y divide-[var(--border)] overflow-y-auto px-4" aria-label="Senders">
          {targets.map(target => (
            <li key={`${target.accountId}:${target.senderEmail}:${target.threadId}`} className="flex items-center gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
                  {target.senderName || target.senderEmail}
                </div>
                <div className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{target.senderEmail}</div>
              </div>
              <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                {describeUnsubscribeMethod(target.method)}
              </span>
            </li>
          ))}
        </ul>

        <div className="flex flex-col gap-3 border-t border-[var(--border)] px-4 py-3">
          <p id={noticeId} className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            {UNSUBSCRIBE_IRREVERSIBLE_NOTICE}
          </p>
          <label htmlFor={checkboxId} className="flex items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">
            <input
              id={checkboxId}
              type="checkbox"
              checked={archive}
              onChange={event => setArchive(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--accent)]"
            />
            Also archive their messages
          </label>
          <div className="flex items-center justify-end gap-2">
            <button
              ref={cancelRef}
              type="button"
              onClick={cancel}
              className="rounded-md border border-[var(--control-border)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={confirm}
              disabled={busy || targets.length === 0}
              aria-keyshortcuts="Meta+Enter"
              className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-fill)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Unsubscribing…' : 'Unsubscribe'}
              <kbd className="text-[calc(10px*var(--font-scale))] font-normal opacity-80">⌘↩</kbd>
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
