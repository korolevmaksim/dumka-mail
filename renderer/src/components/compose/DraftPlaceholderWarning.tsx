import { AlertTriangle } from 'lucide-react';
import { detectReplyDraftPlaceholders } from '../../../../shared/replyPipeline';

export function DraftPlaceholderWarning({ bodyPlain, bodyHtml }: { bodyPlain: string; bodyHtml?: string | null }) {
  const placeholders = detectReplyDraftPlaceholders(bodyPlain, bodyHtml);
  if (placeholders.length === 0) return null;

  const visible = placeholders.slice(0, 3).join(', ');
  const remaining = placeholders.length - 3;
  return (
    <div role="alert" className="flex items-start gap-2 border-t border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>
        Replace {visible}{remaining > 0 ? ` and ${remaining} more` : ''} before sending. Drafts with placeholders cannot be sent.
      </span>
    </div>
  );
}
