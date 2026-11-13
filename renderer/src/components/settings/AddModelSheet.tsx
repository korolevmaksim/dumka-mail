import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { emitToast } from '../../lib/toastBus';
import { useProviderModels } from '../../hooks/useProviderModels';
import { ModelPicker } from './ModelPicker';
import { SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_PRIMARY_BUTTON_CLASS, SETTINGS_SELECT_CLASS } from './SettingsControls';
import { getAIProviderConfig, isConfigurableAIProvider, type ConfigurableAIProvider } from '../../../../shared/aiProviders';
import { isAIProviderUnavailable } from '../../../../shared/aiErrors';
import { resolveAIProviderPreference } from '../../../../shared/aiProviderPreference';
import {
  ADD_MODEL_PROVIDERS,
  CHOOSE_MODEL_MESSAGE,
  addModelConfigEntries,
  addModelProviderLabel,
  describeModelConnectionError,
  hasModelChoice,
  hasStoredKey,
  keyForConnectionTest,
  providerNeedsBaseUrl,
  validateAddModelInput,
} from '../../../../shared/addModel';

type TestState =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; modelCount: number }
  | { status: 'error'; message: string };

interface AddModelFormProps {
  /** Called after the provider was saved. */
  onSaved?: () => void;
  /** Focus the provider select on mount (used by the sheet). */
  initialFocusRef?: React.RefObject<HTMLSelectElement | null>;
  /** Renders a Cancel button next to Save. */
  onCancel?: () => void;
}

/** The provider in use (also when the preference is `Automatic`), else the first in the list. */
function initialProvider(preference: string, activeProvider?: string | null): ConfigurableAIProvider {
  if (isConfigurableAIProvider(preference)) return preference;
  return activeProvider && isConfigurableAIProvider(activeProvider) ? activeProvider : 'openAI';
}

/**
 * Provider, API key, model (from the provider's own list), `Test connection`, `Save`.
 * Keys go through the existing `saveAIConfig` path (OS keychain when enabled);
 * the typed key is kept only in this component's state and never logged.
 */
export function AddModelForm({ onSaved, initialFocusRef, onCancel }: AddModelFormProps) {
  const store = useAppStore();
  const preference = resolveAIProviderPreference(store.settings.ai.provider, store.customEnv.PMC_AI_PROVIDER);
  const activeProvider = store.aiProviderDesc && !isAIProviderUnavailable(store.aiProviderDesc) ? store.aiProviderDesc.preference : null;
  const [provider, setProvider] = useState<ConfigurableAIProvider>(() => initialProvider(preference, activeProvider));
  const [apiKey, setApiKey] = useState('');
  /** The model already saved for a provider; otherwise empty until the user chooses one (nothing is built in). */
  const startingModel = (target: ConfigurableAIProvider) => (store.customEnv[getAIProviderConfig(target).modelEnv] || '').trim();
  const [model, setModel] = useState(() => startingModel(provider));
  const [baseUrl, setBaseUrl] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { provider: useId(), key: useId(), keyHelp: useId(), model: useId(), modelHelp: useId(), baseUrl: useId(), status: useId() };

  const config = getAIProviderConfig(provider);
  const keyStored = hasStoredKey(store.customEnv, provider);
  const needsBaseUrl = providerNeedsBaseUrl(provider);
  const storedBaseUrl = store.customEnv[config.baseUrlEnv] || '';
  const providerModels = useProviderModels(provider);
  const input = useMemo(() => ({
    provider,
    apiKey,
    model,
    baseUrl: baseUrl || (needsBaseUrl ? storedBaseUrl : ''),
  }), [apiKey, baseUrl, model, needsBaseUrl, provider, storedBaseUrl]);

  const changeProvider = (value: string) => {
    if (!isConfigurableAIProvider(value)) return;
    setProvider(value);
    setApiKey('');
    setModel(startingModel(value));
    setBaseUrl('');
    setTest({ status: 'idle' });
    setFormError(null);
  };

  /** Checks the key and loads the provider's model list. Resolves true when the provider answered. */
  const testConnection = async (): Promise<boolean> => {
    const problem = validateAddModelInput(input, keyStored);
    setFormError(problem);
    if (problem) return false;
    setTest({ status: 'testing' });
    try {
      const models = await store.verifyConnectionAndFetchModels(provider, keyForConnectionTest(input, keyStored), input.baseUrl.trim() || undefined);
      setTest({ status: 'success', modelCount: models.length });
      return true;
    } catch (err) {
      // Log the shape only; provider errors can echo request details.
      console.error(`Add a model: connection test failed for ${provider}.`, err instanceof Error ? err.name : typeof err);
      setTest({ status: 'error', message: describeModelConnectionError(err, provider) });
      return false;
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const problem = validateAddModelInput(input, keyStored);
    setFormError(problem);
    if (problem) return;
    if (!hasModelChoice(input, store.customEnv)) {
      // No model yet: load the provider's list so there is something to choose from.
      const connected = providerModels.models.length > 0 || await testConnection();
      if (connected) setFormError(CHOOSE_MODEL_MESSAGE);
      return;
    }
    setSaving(true);
    const modelChanges = Boolean(input.model.trim()) && input.model.trim() !== (store.customEnv[config.modelEnv] || '').trim();
    try {
      await store.saveAIConfig(addModelConfigEntries(input));
      await store.updateSettings(settings => {
        // A model or provider that changes here must take effect: the app-wide
        // override (More options → Interactive Model) would otherwise silently
        // win over it, or be sent to a provider it does not belong to.
        if (modelChanges || settings.ai.provider !== provider) settings.ai.globalDefaultModel = '';
        settings.ai.provider = provider;
      });
      store.setAiProvider(provider);
      setApiKey('');
      emitToast({ type: 'success', message: `${config.displayName} is set up.` });
      onSaved?.();
    } catch (err) {
      console.error(`Add a model: saving ${provider} failed.`, err instanceof Error ? err.name : typeof err);
      setFormError('Could not save the model settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const statusLine = formError
    ? { tone: 'error' as const, text: formError }
    : test.status === 'error'
      ? { tone: 'error' as const, text: test.message }
      : test.status === 'success'
        ? { tone: 'success' as const, text: test.modelCount === 1 ? 'Connected. 1 model available.' : `Connected. ${test.modelCount} models available.` }
        : test.status === 'testing'
          ? { tone: 'info' as const, text: 'Testing connection…' }
          : null;

  return (
    <form data-add-model-form onSubmit={event => void save(event)} className="flex flex-col gap-3" noValidate>
      <div className="flex flex-col gap-1">
        <label htmlFor={ids.provider} className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Provider</label>
        <select
          id={ids.provider}
          ref={initialFocusRef}
          value={provider}
          onChange={event => changeProvider(event.target.value)}
          className={`${SETTINGS_SELECT_CLASS} w-full`}
        >
          {ADD_MODEL_PROVIDERS.map(option => (
            <option key={option} value={option}>{addModelProviderLabel(option)}</option>
          ))}
        </select>
      </div>

      {needsBaseUrl && (
        <div className="flex flex-col gap-1">
          <label htmlFor={ids.baseUrl} className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Server address</label>
          <input
            id={ids.baseUrl}
            type="url"
            value={baseUrl}
            onChange={event => { setBaseUrl(event.target.value); setTest({ status: 'idle' }); }}
            placeholder={storedBaseUrl || 'http://localhost:11434/v1'}
            autoComplete="off"
            spellCheck={false}
            className={SETTINGS_INPUT_CLASS}
          />
        </div>
      )}

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.key} className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">
          API key{config.requiresApiKeyForModels ? '' : ' (optional)'}
        </label>
        <input
          id={ids.key}
          type="password"
          value={apiKey}
          onChange={event => { setApiKey(event.target.value); setTest({ status: 'idle' }); setFormError(null); }}
          placeholder={keyStored ? 'A key is stored. Type a new one to replace it.' : 'Paste your key'}
          aria-describedby={ids.keyHelp}
          autoComplete="off"
          spellCheck={false}
          className={SETTINGS_INPUT_CLASS}
        />
        <span id={ids.keyHelp} className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          {store.settings.privacy.useKeychainForSecrets
            ? 'Stored in the system keychain on this Mac.'
            : 'Stored in the AI config file on this Mac (keychain storage is off in Privacy and data).'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.model} className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Model</label>
        <ModelPicker
          id={ids.model}
          provider={provider}
          value={model}
          onChange={next => { setModel(next); setFormError(null); }}
          catalog={providerModels.models}
          status={providerModels.status}
          onRefresh={providerModels.canLoad ? providerModels.refresh : undefined}
          describedBy={ids.modelHelp}
        />
        <span id={ids.modelHelp} className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          Used when you ask: summaries, reply drafts and Ask Dumka.
        </span>
      </div>

      <div id={ids.status} role="status" aria-live="polite" className="min-h-[18px] text-[calc(11px*var(--font-scale))]">
        {statusLine && (
          <span
            data-add-model-status={statusLine.tone}
            className={`inline-flex items-start gap-1.5 ${statusLine.tone === 'error' ? 'text-[var(--danger-solid)]' : 'text-[var(--text-primary)]'}`}
          >
            {statusLine.tone === 'error' && <AlertCircle aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            {statusLine.tone === 'success' && <Check aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[var(--success-solid)]" />}
            {statusLine.text}
          </span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        {onCancel && (
          <button type="button" onClick={onCancel} className={SETTINGS_BUTTON_CLASS}>Cancel</button>
        )}
        <button
          type="button"
          onClick={() => void testConnection()}
          disabled={test.status === 'testing' || saving}
          className={SETTINGS_BUTTON_CLASS}
        >
          {test.status === 'testing' ? 'Loading…' : 'Test and load models'}
        </button>
        <button
          type="submit"
          disabled={saving}
          className={SETTINGS_PRIMARY_BUTTON_CLASS}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>
    </form>
  );
}

interface AddModelSheetProps {
  onClose: () => void;
}

/**
 * Modal "Add a model" sheet any screen can open:
 * `{open && <AddModelSheet onClose={() => setOpen(false)} />}`.
 * `Esc` closes, focus stays inside and returns to the opener.
 */
export function AddModelSheet({ onClose }: AddModelSheetProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const providerRef = useRef<HTMLSelectElement>(null);
  const titleId = useId();
  const descId = useId();
  const close = useCallback(() => onClose(), [onClose]);
  useDialogFocus(dialogRef, providerRef, close);

  // Keep mail shortcuts from firing behind the sheet.
  const stopShortcuts = (event: KeyboardEvent<HTMLElement>) => event.stopPropagation();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
      role="presentation"
      onMouseDown={event => { if (event.target === event.currentTarget) close(); }}
    >
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-add-model-sheet
        onKeyDown={stopShortcuts}
        className="dm-overlay flex max-h-[85vh] w-[min(440px,92vw)] flex-col overflow-y-auto rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="flex flex-col gap-0.5">
            <h2 id={titleId} className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Add a model</h2>
            <p id={descId} className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
              Used when you ask: summaries, reply drafts and Ask Dumka.
            </p>
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="Close"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <X aria-hidden="true" className="h-4 w-4" />
          </button>
        </header>
        <div className="px-4 py-3">
          <AddModelForm initialFocusRef={providerRef} onSaved={close} onCancel={close} />
        </div>
      </section>
    </div>
  );
}
