import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Plus, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { buildAutomationCandidatesFromAgentPlan, simulateMailRules } from '../../../../shared/mailRuleSimulator';
import type { AutomationRuleCandidate, MailAutomationRule } from '../../../../shared/types';

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function createUniqueRuleId(rule: MailAutomationRule, existing: MailAutomationRule[]): string {
  const ids = new Set(existing.map(existingRule => existingRule.id));
  if (!ids.has(rule.id)) return rule.id;
  let suffix = 2;
  let candidate = `${rule.id}-${suffix}`;
  while (ids.has(candidate)) {
    suffix += 1;
    candidate = `${rule.id}-${suffix}`;
  }
  return candidate;
}

export function RuleSimulatorPanel({ compact = false }: { compact?: boolean }) {
  const store = useAppStore();
  const [candidateAddedId, setCandidateAddedId] = useState<string | null>(null);
  const simulation = useMemo(() => simulateMailRules({
    settings: store.settings.mailRules,
    threads: store.threads,
    actionLogs: store.actionLog,
    labelDefinitions: store.labelDefinitions,
  }), [store.actionLog, store.labelDefinitions, store.settings.mailRules, store.threads]);
  const candidates = useMemo(() => buildAutomationCandidatesFromAgentPlan({
    plan: store.agentPlan,
    threads: store.threads,
    actionLogs: store.actionLog,
  }), [store.actionLog, store.agentPlan, store.threads]);
  const visibleSimulations = simulation.simulations.slice(0, compact ? 3 : 6);

  const addCandidate = async (candidate: AutomationRuleCandidate) => {
    await store.updateSettings(settings => {
      const nextRule = {
        ...candidate.rule,
        id: createUniqueRuleId(candidate.rule, settings.mailRules.rules),
        isEnabled: false,
      };
      settings.mailRules.rules = [...settings.mailRules.rules, nextRule];
    });
    setCandidateAddedId(candidate.id);
  };

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-[calc(11px*var(--font-scale))]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
            <FlaskConical className="h-3.5 w-3.5 text-[var(--accent)]" />
            Automation Simulator
          </div>
          <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            {simulation.ruleCount} rule{simulation.ruleCount === 1 ? '' : 's'} checked against {store.threads.length} cached thread{store.threads.length === 1 ? '' : 's'} at {formatGeneratedAt(simulation.generatedAt)}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-1 text-center text-[calc(9px*var(--font-scale))]">
          <span className="rounded bg-[var(--app-bg)] px-2 py-1 text-[var(--text-secondary)]">{simulation.matchedThreadCount} matches</span>
          <span className="rounded bg-[var(--app-bg)] px-2 py-1 text-[var(--text-secondary)]">{simulation.effectCount} effects</span>
          <span className="rounded bg-[var(--app-bg)] px-2 py-1 text-[var(--text-secondary)]">{simulation.previewOnlyCount} preview</span>
        </div>
      </div>

      {simulation.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-2 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>{simulation.warnings[0]}</span>
        </div>
      )}

      {visibleSimulations.length === 0 ? (
        <div className="rounded border border-dashed border-[var(--border)] bg-[var(--app-bg)] px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          No rules to simulate yet.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {visibleSimulations.map(result => (
            <article key={result.ruleId} className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] p-2.5">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-medium text-[var(--text-primary)]">{result.ruleTitle}</div>
                  <div className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                    {result.matchedThreadCount} match{result.matchedThreadCount === 1 ? '' : 'es'} · {result.effectCount} would apply · {result.alreadyAppliedCount} already applied
                  </div>
                </div>
                {result.previewOnlyCount > 0 ? (
                  <span className="rounded border border-[var(--warning)]/30 px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--warning)]">review</span>
                ) : (
                  <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
                )}
              </div>
              {result.samples[0]?.effects[0] && (
                <div className="mt-2 line-clamp-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  {result.samples[0].effects[0].summary} on {result.samples[0].subject || 'untitled thread'}
                </div>
              )}
            </article>
          ))}
        </div>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <div className="flex items-center gap-1.5 text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
            Candidate rules from approved work
          </div>
          {candidates.slice(0, compact ? 2 : 4).map(candidate => (
            <div key={candidate.id} className="flex items-center justify-between gap-3 rounded-md bg-[var(--app-bg)] px-2.5 py-2">
              <div className="min-w-0">
                <div className="truncate text-[var(--text-primary)]">{candidate.title}</div>
                <div className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{candidate.reason}</div>
              </div>
              <button
                type="button"
                onClick={() => void addCandidate(candidate)}
                disabled={candidateAddedId === candidate.id}
                className="flex shrink-0 items-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3 w-3" />
                {candidateAddedId === candidate.id ? 'Added' : 'Add disabled'}
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
