import { FileText, Trash2 } from 'lucide-react';
import { formatDateTime } from '../../../../shared/dateFormat';
import type { Draft } from '../../../../shared/types';

function formatDraftRecipientLine(draft: Draft): string {
  const recipients = [...draft.to, ...draft.cc, ...draft.bcc]
    .map(recipient => recipient.email)
    .filter(Boolean);
  return recipients.length > 0 ? `To ${recipients.join(', ')}` : 'No recipients';
}

function formatDraftUpdatedAt(updatedAt: string): string {
  const date = new Date(updatedAt);
  if (!Number.isFinite(date.getTime())) return '';
  return formatDateTime(date);
}

function formatDraftSendAt(sendAt?: string | null): string | null {
  if (!sendAt) return null;
  const date = new Date(sendAt);
  if (!Number.isFinite(date.getTime())) return null;
  return formatDateTime(date);
}

export function DraftRow({
  draft,
  onOpen,
  onDiscard,
}: {
  draft: Draft;
  onOpen: () => void;
  onDiscard: () => void;
}) {
  const subject = draft.subject.trim() || '(no subject)';
  const snippet = draft.bodyPlain.trim() || 'No body text';
  const updatedAt = formatDraftUpdatedAt(draft.updatedAt);
  const sendAt = formatDraftSendAt(draft.sendAt);
  const recipientLine = formatDraftRecipientLine(draft);
  const draftStatus = sendAt ? `Scheduled for ${sendAt}` : recipientLine;
  const draftAccessibilityLabel = [
    sendAt ? 'Scheduled draft' : 'Draft',
    `subject ${subject}`,
    draftStatus,
    updatedAt ? `last updated ${updatedAt}` : null,
    snippet ? `preview ${snippet}` : null,
  ].filter(Boolean).join(', ');

  return (
    <div
      role="listitem"
      className="dm-mail-row group flex w-full min-w-0 items-start gap-2 border-b border-[var(--border)] px-4 py-3 hover:bg-[var(--hover-row)]"
    >
      <button
        type="button"
        aria-label={`Open ${draftAccessibilityLabel}`}
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-start gap-3 text-left"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--raised-surface)] text-[var(--accent-ink)]">
          <FileText aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex min-w-0 items-center justify-between gap-3">
            <span className="truncate text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{subject}</span>
            {updatedAt && (
              <span className="shrink-0 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">{updatedAt}</span>
            )}
          </span>
          <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            {draftStatus}
          </span>
          <span className="line-clamp-2 text-[calc(11px*var(--font-scale))] leading-snug text-[var(--text-tertiary)]">{snippet}</span>
        </span>
      </button>
      <button
        type="button"
        title="Discard draft"
        aria-label={`Discard draft: ${subject}`}
        onClick={(event) => {
          event.stopPropagation();
          onDiscard();
        }}
        className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded text-[var(--text-tertiary)] opacity-0 transition-opacity hover:bg-[var(--border)] hover:text-[var(--danger-solid)] group-hover:opacity-100 focus:opacity-100"
      >
        <Trash2 aria-hidden="true" className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
