import { useAppStore } from '../stores/AppStore';
import { Sparkles, X, AlertCircle, Award } from 'lucide-react';
import { emitToast } from '../lib/toastBus';

export function AITriagePlanCard() {
  const store = useAppStore();
  if (!store.triagePlan) return null;

  const plan = store.triagePlan;
  const items = plan.items;
  const readiness = store.triageQueueReadiness;
  const rulePreview = plan.automationRulePreview;

  const handleToggleSelectAll = () => {
    const allSelected = items.every(item => store.selectedTriageThreadIds.has(item.threadId));
    if (allSelected) {
      store.clearTriagePlanSelection();
    } else {
      store.selectAllApplicableTriagePlanItems();
    }
  };

  const allSelected = items.length > 0 && items.every(item => store.selectedTriageThreadIds.has(item.threadId));

  return (
    <div className="bg-[var(--rail-bg)] border border-[var(--border)] rounded-xl p-3 flex flex-col gap-2.5 shadow-md relative select-text mb-4 text-[calc(11px*var(--font-scale))]">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="flex items-center gap-1 font-semibold text-[var(--ai-accent)]">
            <Sparkles className="w-3.5 h-3.5" /> AI Triage Plan
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Split: <strong>{plan.sourceTitle}</strong> ({plan.sourceThreadCount} threads)
          </span>
        </div>
        <button
          type="button"
          onClick={() => store.setTriagePlan(null)}
          className="p-1 hover:bg-[var(--border)] rounded text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Warning/Reconnect banner */}
      {readiness && readiness.level === 'warning' && (
        <div className="flex items-start gap-2 bg-[var(--danger)]/10 border border-[var(--danger)]/20 rounded-lg p-2 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
          <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
          <div className="flex flex-col gap-1">
            <span className="font-semibold">Remote Action Blocked</span>
            <span>Gmail connection issue. Re-authentication required for remote archiving or read marking.</span>
            <button
              type="button"
              onClick={() => store.onboardAccount(store.activeAccount?.email || '')}
              className="mt-1 w-fit px-2 py-0.5 bg-[var(--danger)] text-white font-medium rounded hover:bg-[var(--danger)]/90 transition-colors cursor-pointer"
            >
              Reconnect
            </button>
          </div>
        </div>
      )}

      {/* Actions Summary */}
      <div className="flex items-center justify-between text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] border-b border-[var(--border)] pb-2">
        <span>Selected: {store.selectedTriageThreadIds.size} of {items.length}</span>
        {readiness && (
          <span className="font-mono text-[calc(9px*var(--font-scale))] bg-[var(--border)] px-1.5 py-0.5 rounded">
            {readiness.summary}
          </span>
        )}
      </div>

      {/* Triage Items List */}
      <div className="flex flex-col gap-2 max-h-[180px] overflow-y-auto pr-1">
        {items.map((item) => {
          const preview = store.triageActionPreview(item);
          const isSelected = preview.isSelected;
          
          return (
            <div
              key={item.threadId}
              className={`flex items-start gap-2 p-2 rounded-lg border transition-colors ${
                isSelected 
                  ? 'bg-[var(--accent)]/5 border-[var(--accent)]/30' 
                  : 'bg-[var(--panel-bg)] border-[var(--border)] hover:border-[var(--strong-border)]'
              }`}
            >
              <input
                type="checkbox"
                checked={isSelected}
                onChange={() => store.toggleTriagePlanItemSelection(item.threadId)}
                className="w-3.5 h-3.5 mt-0.5 text-[var(--accent)] bg-[var(--app-bg)] border border-[var(--border)] rounded cursor-pointer accent-[var(--accent)]"
              />

              <div className="flex-1 flex flex-col gap-0.5 min-w-0">
                <div className="flex justify-between items-center text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                  <span className="truncate mr-1">{item.sender}</span>
                  <span className={`text-[calc(8px*var(--font-scale))] px-1 py-0.2 rounded font-mono shrink-0 uppercase ${
                    item.recommendation === 'reply' ? 'bg-[var(--accent)]/15 text-[var(--accent)]' :
                    item.recommendation === 'reviewAttachment' ? 'bg-cyan-500/15 text-cyan-600' :
                    item.recommendation === 'setReminder' ? 'bg-[var(--warning)]/15 text-[var(--warning)]' :
                    item.recommendation === 'markDoneCandidate' ? 'bg-emerald-500/15 text-emerald-600' :
                    'bg-[var(--border)] text-[var(--text-secondary)]'
                  }`}>
                    {item.recommendation}
                  </span>
                </div>
                <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] truncate">{item.subject}</span>
                <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] italic leading-tight">{item.reason}</span>

                <div className="flex items-center justify-between mt-1.5 pt-1.5 border-t border-[var(--border)]/30">
                  {preview.eligibility === 'requiresReconnect' ? (
                    <span className="text-[calc(8px*var(--font-scale))] text-[var(--danger)] flex items-center gap-1 font-semibold">
                      <AlertCircle className="w-2.5 h-2.5" /> Reconnect needed
                    </span>
                  ) : (
                    <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)] uppercase font-mono">
                      {preview.scope} action
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => store.applyTriagePlanItem(item)}
                    disabled={preview.eligibility === 'requiresReconnect' && preview.scope !== 'local'}
                    className="px-2 py-0.5 bg-[var(--accent)]/10 text-[var(--accent)] hover:bg-[var(--accent)]/20 rounded text-[calc(9px*var(--font-scale))] font-medium transition-colors cursor-pointer disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    Apply
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Batch Operations */}
      <div className="flex gap-1.5 border-t border-[var(--border)] pt-2.5">
        <button
          type="button"
          onClick={handleToggleSelectAll}
          className="flex-1 py-1 border border-[var(--border)] hover:border-[var(--strong-border)] rounded text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
        >
          {allSelected ? 'Deselect All' : 'Select All'}
        </button>
        
        <button
          type="button"
          onClick={() => store.clearTriagePlanSelection()}
          className="py-1 px-2 border border-[var(--border)] hover:border-[var(--strong-border)] rounded text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer transition-colors"
        >
          Clear
        </button>

        <button
          type="button"
          onClick={() => store.applySelectedTriagePlanItems()}
          disabled={!readiness || !readiness.canApplySelected}
          className="flex-1 py-1 bg-[var(--ai-accent)] hover:bg-[var(--ai-accent)]/90 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded text-[calc(9px*var(--font-scale))] font-bold cursor-pointer transition-colors"
        >
          {readiness?.applyButtonTitle || 'Apply Selected'}
        </button>
      </div>

      {/* Automation Rules Previews */}
      {rulePreview && rulePreview.rules.length > 0 && (
        <div className="border-t border-[var(--border)]/60 pt-2 flex flex-col gap-1.5">
          <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)] flex items-center gap-1">
            <Award className="w-3.5 h-3.5 text-[var(--ai-accent)]" /> Suggested Automations
          </span>
          <div className="flex flex-col gap-1">
            {rulePreview.rules.map((rule) => (
              <div key={rule.id} className="flex justify-between items-center bg-[var(--panel-bg)] border border-[var(--border)] rounded p-1.5 text-[calc(9px*var(--font-scale))]">
                <div className="flex flex-col gap-0.5 min-w-0 flex-1 mr-2">
                  <span className="font-semibold text-[var(--text-primary)] truncate">{rule.title} ({rule.matchCount} match{rule.matchCount === 1 ? '' : 'es'})</span>
                  <span className="text-[var(--text-secondary)] truncate">{rule.criteria}</span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    store.addCustomClassifierRule({
                      field: 'subject',
                      condition: 'contains',
                      value: rule.title.toLowerCase(),
                      targetCategory: 'automation',
                      active: true
                    });
                    emitToast({ type: 'success', message: 'Created a rule for the Automation tab.' });
                  }}
                  className="px-1.5 py-0.5 border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded font-medium cursor-pointer shrink-0"
                >
                  Create Rule
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
