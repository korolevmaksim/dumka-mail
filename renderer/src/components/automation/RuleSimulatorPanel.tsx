import { useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, FlaskConical, Plus, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { buildAutomationCandidatesFromAgentPlan, buildMailRuleMonitoring, simulateMailRules } from '../../../../shared/mailRuleSimulator';
import type { AutomationRuleCandidate, MailAutomationRule } from '../../../../shared/types';

function formatGeneratedAt(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function formatLastObserved(iso: string | null): string {
  if (!iso) return 'No observed runs yet';
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return 'No observed runs yet';
  return `Last ${date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}`;
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

function MetricCell({ value, label, emphasize = false }: { value: number; label: string; emphasize?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-0.5 px-1 py-1.5">
      <span
        className={`tabular-nums text-[calc(13px*var(--font-scale))] font-semibold leading-none ${
          emphasize ? 'text-[var(--warning)]' : 'text-[var(--text-primary)]'
        }`}
      >
        {formatCount(value)}
      </span>
      <span className="truncate text-[calc(9px*var(--font-scale))] leading-none text-[var(--text-tertiary)]">
        {label}
      </span>
    </div>
  );
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
  const monitoringByRule = useMemo(() => new Map(
    buildMailRuleMonitoring(store.settings.mailRules, store.actionLog)
      .map(item => [item.ruleId, item] as const),
  ), [store.actionLog, store.settings.mailRules]);
  const existingRuleIds = useMemo(
    () => new Set(store.settings.mailRules.rules.map(rule => rule.id)),
    [store.settings.mailRules.rules],
  );
  const visibleSimulations = simulation.simulations.slice(0, compact ? 3 : 6);
  const generatedAt = formatGeneratedAt(simulation.generatedAt);
  const hasRules = simulation.ruleCount > 0;

  const addCandidate = async (candidate: AutomationRuleCandidate) => {
    await store.updateSettings(settings => {
      const nextRule = {
        ...candidate.rule,
        id: createUniqueRuleId(candidate.rule, settings.mailRules.rules),
        isEnabled: false,
        mode: 'shadow' as const,
      };
      settings.mailRules.enabled = true;
      settings.mailRules.rules = [...settings.mailRules.rules, nextRule];
    });
    setCandidateAddedId(candidate.id);
  };

  return (
    <section className="flex flex-col gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-[calc(11px*var(--font-scale))]">
      {/* Header: title + time only — never compete with stats for width */}
      <header className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <FlaskConical className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" aria-hidden="true" />
          <h3 className="truncate font-semibold text-[var(--text-primary)]">
            Automation monitor
          </h3>
        </div>
        {generatedAt ? (
          <time
            dateTime={simulation.generatedAt}
            className="shrink-0 text-[calc(10px*var(--font-scale))] tabular-nums text-[var(--text-tertiary)]"
            title={`Simulated at ${generatedAt}`}
          >
            {generatedAt}
          </time>
        ) : null}
      </header>

      {/* Quiet meta — one line, no run-on sentence */}
      <p className="text-[calc(10px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
        {hasRules
          ? `${formatCount(simulation.ruleCount)} rule${simulation.ruleCount === 1 ? '' : 's'} · ${formatCount(store.threads.length)} threads`
          : `${formatCount(store.threads.length)} threads cached`}
      </p>

      {/* Metrics: full-width strip so labels never clip */}
      {hasRules && (
        <div
          className="grid grid-cols-3 divide-x divide-[var(--border)] rounded-md border border-[var(--border)] bg-[var(--app-bg)]"
          role="group"
          aria-label="Simulation summary"
        >
          <MetricCell value={simulation.matchedThreadCount} label="Matches" />
          <MetricCell value={simulation.effectCount} label="Effects" />
          <MetricCell
            value={simulation.previewOnlyCount}
            label="Review"
            emphasize={simulation.previewOnlyCount > 0}
          />
        </div>
      )}

      {simulation.warnings.length > 0 && (
        <div className="flex items-start gap-2 rounded-md border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2.5 py-2 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="min-w-0 leading-snug">{simulation.warnings[0]}</span>
        </div>
      )}

      {visibleSimulations.length === 0 ? (
        <div className="px-0.5 py-1 text-[calc(10px*var(--font-scale))] leading-snug text-[var(--text-tertiary)]">
          {hasRules
            ? 'No matches against the local cache.'
            : 'No rules yet. Add one in Settings → Mail Rules to preview impact.'}
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5" aria-label="Rule simulation results">
          {visibleSimulations.map(result => {
            const monitoring = monitoringByRule.get(result.ruleId);
            const mode = monitoring?.mode || 'disabled';
            return (
              <li
                key={result.ruleId}
                className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-2"
              >
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium text-[var(--text-primary)]">
                      {result.ruleTitle}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                      <span className="tabular-nums">{formatCount(result.matchedThreadCount)} match{result.matchedThreadCount === 1 ? '' : 'es'}</span>
                      <span aria-hidden="true">·</span>
                      <span className="tabular-nums">{formatCount(result.effectCount)} apply</span>
                      {result.alreadyAppliedCount > 0 && (
                        <>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">{formatCount(result.alreadyAppliedCount)} done</span>
                        </>
                      )}
                    </div>
                  </div>
                  <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] font-medium ${
                    mode === 'active'
                      ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600'
                      : mode === 'shadow'
                        ? 'border-[var(--ai-accent)]/30 bg-[var(--ai-accent)]/10 text-[var(--ai-accent)]'
                        : 'border-[var(--border)] bg-[var(--rail-bg)] text-[var(--text-secondary)]'
                  }`}>
                    {mode}
                  </span>
                  {result.previewOnlyCount > 0 ? (
                    <span className="shrink-0 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] font-medium text-[var(--warning)]">
                      review
                    </span>
                  ) : (
                    <ShieldCheck className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" aria-label="Safe to apply" />
                  )}
                </div>
                {result.samples[0]?.effects[0] && (
                  <p className="mt-1.5 line-clamp-2 text-[calc(10px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
                    {result.samples[0].effects[0].summary}
                    <span className="text-[var(--text-tertiary)]">
                      {' · '}
                      {result.samples[0].subject || 'untitled thread'}
                    </span>
                  </p>
                )}
                {monitoring && (
                  <p className="mt-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                    {monitoring.shadowMatchCount} shadow · {monitoring.appliedCount} applied · {monitoring.failedCount} failed
                    {monitoring.pendingCount > 0 ? ` · ${monitoring.pendingCount} pending` : ''}
                    {' · '}{formatLastObserved(monitoring.lastObservedAt)}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {candidates.length > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-[var(--border)] pt-2.5">
          <div className="flex items-center gap-1.5 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)]">
            <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" aria-hidden="true" />
            From approved work
          </div>
          {candidates.slice(0, compact ? 2 : 4).map(candidate => {
            const isAdded = candidateAddedId === candidate.id || existingRuleIds.has(candidate.rule.id);
            return (
              <div
                key={candidate.id}
                className="flex items-center justify-between gap-2 rounded-md bg-[var(--app-bg)] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <div className="truncate text-[var(--text-primary)]">{candidate.title}</div>
                  <div className="truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
                    {candidate.reason}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void addCandidate(candidate)}
                  disabled={isAdded}
                  title={isAdded ? 'Already added in shadow mode' : 'Add in shadow mode without changing mail'}
                  className="flex shrink-0 items-center gap-1 rounded-md bg-[var(--accent)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Plus className="h-3 w-3" aria-hidden="true" />
                  {isAdded ? 'Shadow added' : 'Add shadow'}
                </button>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
