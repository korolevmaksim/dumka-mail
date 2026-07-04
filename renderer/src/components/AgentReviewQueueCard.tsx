import { AlertCircle, CheckCircle2, ExternalLink, FileText, MailCheck, MailMinus, MailPlus, ShieldAlert, Tag, X } from 'lucide-react';
import type { AgentPlanActionKind, AgentPlanItem, AgentPlanRiskLevel } from '../../../shared/types';
import { useAppStore } from '../stores/AppStore';

const ACTION_LABEL: Record<AgentPlanActionKind, string> = {
  openThread: 'Open',
  markRead: 'Mark read',
  archive: 'Archive',
  draftReply: 'Draft',
  setReminder: 'Remind',
  applyLabel: 'Label',
  unsubscribe: 'Unsubscribe',
};

const ACTION_ICON = {
  openThread: ExternalLink,
  markRead: MailCheck,
  archive: CheckCircle2,
  draftReply: MailPlus,
  setReminder: FileText,
  applyLabel: Tag,
  unsubscribe: MailMinus,
};

const RISK_TONE: Record<AgentPlanRiskLevel, string> = {
  low: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
  medium: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]',
  high: 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]',
};

function actionDescription(item: AgentPlanItem): string {
  if (item.action === 'draftReply') return 'Opens a local reply draft. It will not send anything.';
  if (item.action === 'archive') return 'Removes Inbox locally first, then syncs to Gmail.';
  if (item.action === 'markRead') return 'Marks the thread read locally first, then syncs to Gmail.';
  if (item.action === 'setReminder') return 'Creates a local reminder for tomorrow morning.';
  if (item.action === 'applyLabel') return 'Applies the selected Gmail label.';
  if (item.action === 'unsubscribe') return "Send the sender's unsubscribe request.";
  return 'Opens the source thread for manual review.';
}

function formatTime(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function AgentReviewQueueCard() {
  const store = useAppStore();
  const plan = store.agentPlan;
  const readiness = store.agentPlanQueueReadiness;

  if (!plan) return null;

  const allSelected = plan.items.length > 0 && plan.items
    .filter(item => item.action !== 'openThread')
    .every(item => store.selectedAgentPlanItemIds.has(item.id));

  const toggleAll = () => {
    if (allSelected) {
      store.clearAgentPlanSelection();
    } else {
      store.selectAllApplicableAgentPlanItems();
    }
  };

  return (
    <div className="mb-4 flex flex-col gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--rail-bg)] p-3 text-[calc(11px*var(--font-scale))] shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-1 font-semibold text-[var(--ai-accent)]">
            <ShieldAlert className="h-3.5 w-3.5" /> Agent Review Queue
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            {plan.items.length} proposed action{plan.items.length === 1 ? '' : 's'} from {plan.sourceTitle}
          </span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
            {plan.coverage.privacyMode === 'localCache' ? 'local cache' : 'AI assisted'} · {plan.coverage.sourceThreadCount} source thread{plan.coverage.sourceThreadCount === 1 ? '' : 's'} · {formatTime(plan.generatedAt)}
          </span>
        </div>
        <button
          type="button"
          onClick={() => store.setAgentPlan(null)}
          title="Close review queue"
          className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      {readiness?.level === 'warning' && (
        <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
          <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{readiness.summary}</span>
        </div>
      )}

      <div className="flex items-center justify-between border-b border-[var(--border)] pb-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
        <span>Selected: {store.selectedAgentPlanItemIds.size} of {plan.items.length}</span>
        {readiness && (
          <span className="rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(9px*var(--font-scale))]">
            {readiness.summary}
          </span>
        )}
      </div>

      <div className="flex max-h-[320px] flex-col gap-2 overflow-y-auto pr-1">
        {plan.items.map(item => {
          const preview = store.agentPlanActionPreview(item);
          const Icon = ACTION_ICON[item.action];
          const disabled = preview.eligibility !== 'ready' && preview.eligibility !== 'focusOnly';

          return (
            <article
              key={item.id}
              className={`rounded-lg border p-2.5 transition-colors ${
                preview.isSelected
                  ? 'border-[var(--ai-accent)]/35 bg-[var(--ai-accent)]/8'
                  : 'border-[var(--border)] bg-[var(--panel-bg)]'
              }`}
            >
              <div className="flex items-start gap-2">
                <input
                  type="checkbox"
                  checked={preview.isSelected}
                  disabled={item.action === 'openThread'}
                  onChange={() => store.toggleAgentPlanItemSelection(item.id)}
                  className="mt-0.5 h-3.5 w-3.5 cursor-pointer accent-[var(--ai-accent)] disabled:cursor-not-allowed disabled:opacity-30"
                />

                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1.5">
                      <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
                      <span className="truncate font-semibold text-[var(--text-primary)]">{item.title}</span>
                    </div>
                    <div className="flex shrink-0 items-center gap-1">
                      <span className={`rounded border px-1.5 py-0.5 text-[calc(8px*var(--font-scale))] font-semibold uppercase ${RISK_TONE[item.riskLevel]}`}>
                        {item.riskLevel}
                      </span>
                      <span className="rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(8px*var(--font-scale))] text-[var(--text-secondary)]">
                        {item.confidence}
                      </span>
                    </div>
                  </div>

                  <div className="mt-1 min-w-0">
                    <p className="truncate text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                      {item.sender}
                    </p>
                    <p className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                      {item.subject}
                    </p>
                  </div>

                  <div className="mt-1.5 rounded-md border border-[var(--border)]/60 bg-[var(--app-bg)] p-1.5 text-[calc(9px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
                    <p className="text-[var(--text-primary)]">{item.reason}</p>
                    {item.citation.snippet && (
                      <p className="mt-0.5 line-clamp-2">{item.citation.snippet}</p>
                    )}
                    <p className="mt-0.5 text-[var(--text-tertiary)]">{actionDescription(item)}</p>
                  </div>

                  {preview.eligibility !== 'ready' && preview.eligibility !== 'focusOnly' && (
                    <div className="mt-1.5 flex items-center gap-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--danger)]">
                      <AlertCircle className="h-3 w-3" />
                      <span>
                        {preview.eligibility === 'requiresReconnect'
                          ? 'Reconnect Gmail before approval'
                          : preview.eligibility === 'labelMissing'
                            ? 'Label is missing'
                            : 'Source thread is missing'}
                      </span>
                    </div>
                  )}

                  <div className="mt-2 flex items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => void store.applyAgentPlanItem(item)}
                      disabled={disabled}
                      className="flex-1 rounded bg-[var(--ai-accent)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-bold text-white transition-colors hover:bg-[var(--ai-accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
                    >
                      Approve {ACTION_LABEL[item.action]}
                    </button>
                    <button
                      type="button"
                      onClick={() => store.rejectAgentPlanItem(item.id)}
                      className="rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            </article>
          );
        })}

        {plan.items.length === 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            No proposed actions in the queue.
          </div>
        )}
      </div>

      <div className="flex gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          type="button"
          onClick={toggleAll}
          className="flex-1 rounded border border-[var(--border)] py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        <button
          type="button"
          onClick={() => store.clearAgentPlanSelection()}
          className="rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => void store.applySelectedAgentPlanItems()}
          disabled={!readiness?.canApplySelected}
          className="flex-1 rounded bg-[var(--ai-accent)] py-1 text-[calc(9px*var(--font-scale))] font-bold text-white transition-colors hover:bg-[var(--ai-accent)]/90 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {readiness?.applyButtonTitle || 'Approve 0'}
        </button>
      </div>
    </div>
  );
}
