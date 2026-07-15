import { Check, MailMinus, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import type { MailSecurityWarning } from '../../../shared/types';

function severityClass(severity: MailSecurityWarning['severity']): string {
  if (severity === 'danger') return 'border-[var(--danger)]/35 bg-[var(--danger)]/10 text-[var(--danger)]';
  if (severity === 'warning') return 'border-[var(--warning)]/35 bg-[var(--warning)]/10 text-[var(--warning)]';
  return 'border-[var(--border)] bg-[var(--raised-surface)] text-[var(--text-secondary)]';
}

export function AgenticThreadPanel() {
  const store = useAppStore();
  const insights = store.threadAgentInsights;
  const draft = insights?.draftSuggestion || null;
  const unsubscribe = insights?.unsubscribeCandidate || null;
  const warnings = (insights?.securityInsights || [])
    .flatMap(insight => insight.warnings.map(warning => ({ ...warning, messageId: insight.messageId })))
    .slice(0, 4);

  if (!draft && !unsubscribe?.canOneClick && warnings.length === 0 && !store.agentInsightsLoading) {
    return null;
  }

  const latestMessage = store.openedThreadMessages[store.openedThreadMessages.length - 1] || null;

  const applyDraft = async () => {
    if (!draft || !latestMessage) return;
    store.startReplyWithBody(latestMessage, draft.bodyPlain);
    await store.markAgentDraftSuggestionApplied(draft.id);
    emitToast({ type: 'success', message: 'AI draft inserted.' });
  };

  const dismissDraft = async () => {
    if (!draft) return;
    await store.dismissAgentDraftSuggestion(draft.id);
  };

  const unsubscribeThread = async () => {
    if (!store.openedThread) return;
    await store.unsubscribeThread(store.openedThread.id);
  };

  return (
    <div className="mb-4 flex flex-col gap-2 select-none">
      {draft && (
        <div className="dm-inset rounded-[6px] border border-[var(--accent)]/25 bg-[var(--accent)]/10 px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <Sparkles className="h-4 w-4 shrink-0 text-[var(--accent)]" />
              <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
                Draft ready
              </span>
              <span className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">
                {draft.model}
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                onClick={applyDraft}
                title="Insert draft"
                className="flex items-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[calc(11px*var(--font-scale))] font-semibold text-white hover:opacity-90"
              >
                <Check className="h-3.5 w-3.5" />
                Insert
              </button>
              <button
                type="button"
                onClick={dismissDraft}
                title="Dismiss draft"
                className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[calc(11px*var(--font-scale))] leading-relaxed text-[var(--text-secondary)]">
            {draft.bodyPlain}
          </p>
        </div>
      )}

      {(unsubscribe?.canOneClick || warnings.length > 0) && (
        <div className="dm-inset flex flex-col gap-1.5 rounded-[6px] border border-[var(--border)] bg-[var(--raised-surface)] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              <ShieldAlert className="h-4 w-4 text-[var(--warning)]" />
              Mail safety
            </div>
            {unsubscribe?.canOneClick && (
              <button
                type="button"
                onClick={unsubscribeThread}
                title="Unsubscribe and archive"
                className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)]"
              >
                <MailMinus className="h-3.5 w-3.5 text-[var(--accent)]" />
                Unsubscribe
              </button>
            )}
          </div>
          {warnings.length > 0 && (
            <div className="mt-1 grid gap-1.5">
              {warnings.map((warning, index) => (
                <div
                  key={`${warning.messageId}:${warning.kind}:${index}`}
                  className={`rounded border px-2 py-1.5 text-[calc(10px*var(--font-scale))] ${severityClass(warning.severity)}`}
                >
                  <span className="font-semibold">{warning.title}</span>
                  <span className="text-[var(--text-secondary)]"> · {warning.detail}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
