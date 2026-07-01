import { Toggle } from './SettingsControls';
import { useAppStore } from '../../stores/AppStore';
import type { AgentRulesSettings } from '../../../../shared/types';

function normalizeWords(value: number): number {
  if (!Number.isFinite(value)) return 6000;
  return Math.max(200, Math.min(20000, Math.round(value)));
}

export function AgentRulesPanel() {
  const store = useAppStore();
  const rules = store.settings.ai.agentRules;

  const updateRules = (patch: Partial<AgentRulesSettings>) => {
    store.updateSettings(settings => {
      settings.ai.agentRules = {
        ...settings.ai.agentRules,
        ...patch,
      };
    });
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
      <div className="flex flex-col gap-0.5">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Agent Rules</span>
        <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Controls for proactive background drafting decisions</span>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Draft Trigger</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Which inbound threads can receive a background draft</span>
        </div>
        <select
          value={rules.proactiveDraftTrigger}
          onChange={(event) => updateRules({ proactiveDraftTrigger: event.target.value as AgentRulesSettings['proactiveDraftTrigger'] })}
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
        >
          <option value="directOrActionRequest">Direct or action request</option>
          <option value="directOnly">Direct recipient only</option>
        </select>
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Block Bulk and Automated Senders</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Skips newsletters, promotions, list mail, noreply, and notification senders</span>
        </div>
        <Toggle
          checked={rules.blockBulkAndAutomated}
          onChange={(value) => updateRules({ blockBulkAndAutomated: value })}
        />
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Max Source Words</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Longer messages are skipped by proactive drafts</span>
        </div>
        <input
          type="number"
          min={200}
          max={20000}
          step={100}
          value={rules.maxDraftSourceWords}
          onChange={(event) => updateRules({ maxDraftSourceWords: normalizeWords(Number(event.target.value)) })}
          className="w-[100px] bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
        />
      </div>
    </div>
  );
}
