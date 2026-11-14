// Settings → AI model → Background work (design-review/SPEC.md §5, §8).
//
// Off by default: nothing is sent to a model unless the user asks. Turning it
// on shows exactly which provider and model do the unattended work, so a
// cheaper (or local) model can sort mail while chat keeps its own.
import { useId } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { useProviderModels } from '../../hooks/useProviderModels';
import { ModelPicker } from './ModelPicker';
import { SortingEngineSettings } from './SortingEngineSettings';
import { SETTINGS_SELECT_CLASS, Toggle } from './SettingsControls';
import { backgroundProvider, defaultBackgroundProvider, effectiveBackgroundModel, seedBackgroundProvider } from '../../lib/backgroundModel';
import { resolveAccountSetting } from '../../../../shared/accountSettings';
import { ADD_MODEL_PROVIDERS, addModelProviderLabel, providerIsSetUp } from '../../../../shared/addModel';
import { getAIProviderConfig, isConfigurableAIProvider } from '../../../../shared/aiProviders';
import { DECISION_BATCH_SIZE, DRAFT_BATCH_SIZE } from '../../../../shared/agentPrompts';

/** Mirrors `INBOX_SCAN_LIMIT` in main/agentPrepCore.ts (the main process cannot be imported here). */
const NEWEST_THREADS_PER_ACCOUNT = 100;

const TITLE_CLASS = 'text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]';
const DESC_CLASS = 'text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]';
const LABEL_CLASS = 'text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]';

export function BackgroundWorkSection() {
  const store = useAppStore();
  const ai = store.settings.ai;
  const ids = {
    heading: useId(), sorting: useId(), sortingDesc: useId(), provider: useId(), model: useId(), modelDesc: useId(),
    drafts: useId(), draftsDesc: useId(),
  };

  const setUpProviders = ADD_MODEL_PROVIDERS.filter(candidate => providerIsSetUp(store.customEnv, candidate));
  const fallbackProvider = defaultBackgroundProvider(store.aiProviderDesc, store.customEnv);
  const provider = backgroundProvider(store.settings, store.aiProviderDesc, store.customEnv);
  const on = ai.backgroundSorting === true;
  // An account can turn sorting on while the app default is off: the model it uses is shown then too.
  const accountsOn = store.accounts.filter(account => resolveAccountSetting(store.settings, account.email, 'backgroundSorting').value);
  const inUse = on || accountsOn.length > 0;
  const { models, status, canLoad, refresh } = useProviderModels(inUse ? provider : null);

  const setSorting = (next: boolean) => {
    void store.updateSettings(settings => {
      settings.ai.backgroundSorting = next;
      // Turning it on always leaves an explicit provider on screen; the model is chosen below.
      if (next) seedBackgroundProvider(settings, fallbackProvider);
    });
  };

  const setProvider = (value: string) => {
    if (!isConfigurableAIProvider(value)) return;
    void store.updateSettings(settings => {
      settings.ai.automationProvider = value;
      // A model id belongs to one provider: the choice starts over.
      settings.ai.automationModel = '';
    });
  };

  const setModel = (model: string) => {
    void store.updateSettings(settings => {
      if (provider && !settings.ai.automationProvider) settings.ai.automationProvider = provider;
      settings.ai.automationModel = model;
    });
  };

  const providerOptions = provider && !setUpProviders.includes(provider) ? [provider, ...setUpProviders] : setUpProviders;
  const providerName = provider ? getAIProviderConfig(provider).displayName : '';
  const providerReady = provider ? providerIsSetUp(store.customEnv, provider) : false;
  // '' means "the model saved for this provider" (the one chat uses when it is the main provider).
  const savedProviderModel = provider ? (store.customEnv[getAIProviderConfig(provider).modelEnv] || '').trim() : '';
  const modelInUse = effectiveBackgroundModel(store.settings, provider, store.customEnv);

  return (
    <section
      aria-labelledby={ids.heading}
      data-settings-section="background-work"
      className="flex flex-col divide-y divide-[var(--border)] rounded-lg border border-[var(--border)] bg-[var(--rail-bg)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
          <h3 id={ids.heading} className={TITLE_CLASS}>Sort new mail with the model in the background</h3>
          <p id={ids.sortingDesc} className={DESC_CLASS}>
            {on
              ? `After each sync, new inbox mail is sent to the model to be sorted: the ${NEWEST_THREADS_PER_ACCOUNT} newest threads of each account, ${DECISION_BATCH_SIZE} per request, each thread once.`
              : accountsOn.length > 0
                ? `Off by default. On for ${accountsOn.length === 1 ? accountsOn[0].email : `${accountsOn.length} accounts`}, set on the account page: the ${NEWEST_THREADS_PER_ACCOUNT} newest inbox threads, ${DECISION_BATCH_SIZE} per request, each thread once.`
                : 'Off: mail is sorted by rules on this Mac, and the model works only when you ask: a summary of a long thread, a reply draft, Ask Dumka.'}
          </p>
          {!provider && <p className={DESC_CLASS}>Add a model above first.</p>}
        </div>
        <Toggle
          id={ids.sorting}
          checked={on}
          onChange={setSorting}
          disabled={!provider && !on}
          ariaLabelledBy={ids.heading}
          ariaDescribedBy={ids.sortingDesc}
        />
      </div>

      <SortingEngineSettings />

      {inUse && provider && (ai.sortingEngine !== 'openAIDecisions' || ai.proactiveDraftsEnabled) && (
        <div className="flex flex-col gap-3 px-4 py-3" data-background-model>
          {providerOptions.length > 1 ? (
            <div className="flex flex-col gap-1">
              <label htmlFor={ids.provider} className={LABEL_CLASS}>Provider for background work</label>
              <select
                id={ids.provider}
                value={provider}
                onChange={event => setProvider(event.target.value)}
                className={`${SETTINGS_SELECT_CLASS} w-full`}
              >
                {providerOptions.map(option => <option key={option} value={option}>{addModelProviderLabel(option)}</option>)}
              </select>
            </div>
          ) : null}
          <div className="flex flex-col gap-1">
            <label htmlFor={ids.model} className={LABEL_CLASS}>
              Model for {ai.sortingEngine === 'openAIDecisions' ? 'background reply drafts' : 'background work'}{providerOptions.length > 1 ? '' : ` (${providerName})`}
            </label>
            <ModelPicker
              id={ids.model}
              provider={provider}
              value={ai.automationModel}
              onChange={setModel}
              catalog={models}
              status={status}
              onRefresh={canLoad ? refresh : undefined}
              defaultLabel={savedProviderModel ? `Same as the model saved for ${providerName} (${savedProviderModel})` : undefined}
              describedBy={ids.modelDesc}
            />
            <p id={ids.modelDesc} className={DESC_CLASS}>
              {!providerReady
                ? `${providerName} is not set up yet. Add its key above, or choose another provider.`
                : modelInUse
                  ? 'Sorting is a simple task: a fast, low-cost model is enough.'
                  : 'No model is chosen, so nothing runs in the background yet. Choose one from the list.'}
            </p>
          </div>
        </div>
      )}

      {inUse && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 basis-[260px] flex-col gap-0.5">
            <span id={ids.drafts} className={TITLE_CLASS}>Prepare reply drafts in advance</span>
            <span id={ids.draftsDesc} className={DESC_CLASS}>
              {ai.proactiveDraftsEnabled
                ? `For mail that needs a reply, up to ${DRAFT_BATCH_SIZE} drafts per pass, with the background text model. Nothing is sent.`
                : 'Off: a draft is written only when you press Draft a reply in a thread.'}
            </span>
          </div>
          <Toggle
            checked={ai.proactiveDraftsEnabled === true}
            onChange={value => { void store.updateSettings(settings => { settings.ai.proactiveDraftsEnabled = value; }); }}
            ariaLabelledBy={ids.drafts}
            ariaDescribedBy={ids.draftsDesc}
          />
        </div>
      )}

      {on && store.accounts.length > 1 && (
        <p className={`${DESC_CLASS} px-4 py-3`}>
          This is the default for every account. An account can turn it off on its own page.
        </p>
      )}
    </section>
  );
}
