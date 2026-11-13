import { useEffect, useId, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { useProviderModels } from '../../hooks/useProviderModels';
import { ADD_MODEL_PROVIDERS, addModelProviderLabel, providerIsSetUp } from '../../../../shared/addModel';
import { getAIProviderConfig, isConfigurableAIProvider } from '../../../../shared/aiProviders';
import { SUMMARY_INSTRUCTIONS_MAX, SUMMARY_LANGUAGES, isSummaryLanguage, summarySettings } from '../../../../shared/summarySettings';
import { ModelPicker } from './ModelPicker';
import { SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_SELECT_CLASS } from './SettingsControls';

export function SummarySettingsSection() {
  const store = useAppStore();
  const config = summarySettings(store.settings.ai);
  const headingId = useId(); const providerId = useId(); const modelId = useId();
  const languageId = useId(); const instructionsId = useId(); const helpId = useId();
  const primary = store.aiProviderDesc?.preference;
  const provider = config.provider || (primary && isConfigurableAIProvider(primary) ? primary : null);
  const { models, status, canLoad, refresh } = useProviderModels(provider);
  const [instructions, setInstructions] = useState(config.instructions);
  useEffect(() => setInstructions(config.instructions), [config.instructions]);
  const providers = ADD_MODEL_PROVIDERS.filter(value => value === config.provider || providerIsSetUp(store.customEnv, value));
  const inherited = provider ? (config.provider ? store.customEnv[getAIProviderConfig(provider).modelEnv] : store.settings.ai.globalDefaultModel?.trim() || store.aiProviderDesc?.model) : '';
  const update = (updater: (value: ReturnType<typeof summarySettings>) => void) => {
    void store.updateSettings(settings => {
      const next = summarySettings(settings.ai); updater(next); settings.ai.summary = next;
    });
  };
  return <section aria-labelledby={headingId} data-summary-settings className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--rail-bg)] p-4">
    <h3 id={headingId} className="text-sm font-semibold">Thread summaries</h3>
    <p className="text-xs text-[var(--text-secondary)]">Summaries use the main model unless you choose another provider or model here. These settings do not change chat, sorting or reply drafts.</p>
    <label htmlFor={providerId} className="text-sm font-medium">Provider for summaries</label>
    <select id={providerId} className={SETTINGS_SELECT_CLASS} value={config.provider} onChange={event => {
      const value = event.target.value;
      if (value === '' || isConfigurableAIProvider(value)) update(next => { next.provider = value; next.model = ''; });
    }}>
      <option value="">Same as main provider{store.aiProviderDesc?.displayName ? ` (${store.aiProviderDesc.displayName})` : ''}</option>
      {providers.map(value => <option key={value} value={value}>{addModelProviderLabel(value)}</option>)}
    </select>
    {provider ? <>
      <label htmlFor={modelId} className="text-sm font-medium">Model for summaries</label>
      <ModelPicker id={modelId} provider={provider} value={config.model} onChange={value => update(next => { next.model = value; })}
        catalog={models} status={status} onRefresh={canLoad ? refresh : undefined}
        defaultLabel={inherited ? `Same as ${config.provider ? 'saved provider model' : 'main model'} (${inherited})` : undefined} />
      {!canLoad && <p className="text-xs text-[var(--text-secondary)]">Add the provider key above before requesting summaries.</p>}
    </> : <p className="text-xs text-[var(--text-secondary)]">Configure the main model or choose a provider for summaries.</p>}
    <label htmlFor={languageId} className="text-sm font-medium">Summary language</label>
    <select id={languageId} className={SETTINGS_SELECT_CLASS} value={config.language} onChange={event => {
      const value = event.target.value;
      if (isSummaryLanguage(value)) update(next => { next.language = value; });
    }}>
      {Object.entries(SUMMARY_LANGUAGES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    <label htmlFor={instructionsId} className="text-sm font-medium">Summary instructions and context</label>
    <textarea id={instructionsId} rows={5} maxLength={SUMMARY_INSTRUCTIONS_MAX} value={instructions}
      onChange={event => setInstructions(event.target.value)} aria-describedby={helpId}
      placeholder="Describe your role, useful background, or what the summary should focus on."
      className={`${SETTINGS_INPUT_CLASS} resize-y`} />
    <p id={helpId} className="text-xs text-[var(--text-secondary)]">Added to the summary's system instructions. Useful for names, roles and priorities; it does not replace evidence in the conversation. {instructions.length}/{SUMMARY_INSTRUCTIONS_MAX} characters.</p>
    <button type="button" className={SETTINGS_BUTTON_CLASS} disabled={instructions.trim() === config.instructions}
      onClick={() => update(next => { next.instructions = instructions.trim(); })}>Save summary instructions</button>
    <p className="text-xs text-[var(--text-secondary)]">Changing the model, language or saved instructions regenerates summaries when you open a long conversation. Account mail-text permissions still apply.</p>
  </section>;
}
