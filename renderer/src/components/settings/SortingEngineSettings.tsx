import { useId } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { useProviderModels } from '../../hooks/useProviderModels';
import { sortingConfig } from '../../../../shared/sortingConfig';
import { ModelPicker } from './ModelPicker';
import { SETTINGS_SELECT_CLASS } from './SettingsControls';

export function SortingEngineSettings() {
  const store = useAppStore();
  const config = sortingConfig(store.settings.ai);
  const engineId = useId();
  const modelId = useId();
  const confidenceId = useId();
  const helpId = useId();
  const { models, status, canLoad, refresh } = useProviderModels(config.engine === 'openAIDecisions' ? 'openAI' : null);
  return <div className="flex flex-col gap-3 px-4 py-3" data-sorting-engine-settings>
    <label htmlFor={engineId} className="text-sm font-medium">Sorting engine</label>
    <select id={engineId} className={SETTINGS_SELECT_CLASS} value={config.engine} onChange={event => {
      const engine = event.target.value;
      if (engine === 'completion' || engine === 'openAIDecisions') {
        void store.updateSettings(settings => { settings.ai.sortingEngine = engine; });
      }
    }}>
      <option value="completion">Background text model</option>
      <option value="openAIDecisions">OpenAI Decisions</option>
    </select>
    {config.engine === 'openAIDecisions' && <>
      <label htmlFor={modelId} className="text-sm font-medium">Model for OpenAI Decisions</label>
      <ModelPicker id={modelId} provider="openAI" value={config.model}
        onChange={value => { void store.updateSettings(settings => { settings.ai.decisionsModel = value; }); }}
        catalog={models} status={status} onRefresh={canLoad ? refresh : undefined} describedBy={helpId} />
      <p id={helpId} className="text-xs text-[var(--text-secondary)]">
        {canLoad ? 'Uses your saved OpenAI key. The list comes from OpenAI and includes models for other APIs: choose one that supports Decisions. Unsupported-model errors appear in System logs.'
          : 'Add an OpenAI key above to load its model list.'}
        {' '}No model is selected automatically. Summaries, chat and reply drafts keep their own models.
      </p>
      <label htmlFor={confidenceId} className="text-sm font-medium">Minimum decision confidence</label>
      <select id={confidenceId} className={SETTINGS_SELECT_CLASS}
        value={config.minConfidence} onChange={event => {
          const value = Number(event.target.value);
          if (Number.isFinite(value) && value >= 0 && value <= 1) {
            void store.updateSettings(settings => { settings.ai.decisionsMinConfidence = value; });
          }
        }}>
        {Array.from(new Set([0, 0.5, 0.6, 0.7, 0.8, 0.9, 0.95, 1, config.minConfidence])).sort((a, b) => a - b)
          .map(value => <option key={value} value={value}>{Math.round(value * 100)}%</option>)}
      </select>
      <p className="text-xs text-[var(--text-secondary)]">Below this threshold, local rules keep the thread in its current category. Confidence is a model estimate; adjust it against reviewed examples. Background sorting must be enabled above or on the account page.</p>
    </>}
  </div>;
}
