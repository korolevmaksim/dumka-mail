import { useCallback, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { Check, AlertCircle, X } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import { emitToast } from '../../lib/toastBus';
import { SETTINGS_BUTTON_CLASS, SETTINGS_INPUT_CLASS, SETTINGS_SELECT_CLASS } from './SettingsControls';
import { getAIProviderConfig, isConfigurableAIProvider, type ConfigurableAIProvider } from '../../../../shared/aiProviders';
import { resolveAIProviderPreference } from '../../../../shared/aiProviderPreference';
import {
  ADD_MODEL_PROVIDERS,
  addModelConfigEntries,
  addModelProviderLabel,
  describeModelConnectionError,
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

function initialProvider(preference: string): ConfigurableAIProvider {
  return isConfigurableAIProvider(preference) ? preference : 'openAI';
}

/**
 * Provider, API key, optional model, `Test connection`, `Save`.
 * Keys go through the existing `saveAIConfig` path (OS keychain when enabled);
 * the typed key is kept only in this component's state and never logged.
 */
export function AddModelForm({ onSaved, initialFocusRef, onCancel }: AddModelFormProps) {
  const store = useAppStore();
  const preference = resolveAIProviderPreference(store.settings.ai.provider, store.customEnv.PMC_AI_PROVIDER);
  const [provider, setProvider] = useState<ConfigurableAIProvider>(() => initialProvider(preference));
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [test, setTest] = useState<TestState>({ status: 'idle' });
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const ids = { provider: useId(), key: useId(), keyHelp: useId(), model: useId(), modelList: useId(), baseUrl: useId(), status: useId() };

  const config = getAIProviderConfig(provider);
  const keyStored = hasStoredKey(store.customEnv, provider);
  const needsBaseUrl = providerNeedsBaseUrl(provider);
  const storedModel = store.customEnv[config.modelEnv] || '';
  const storedBaseUrl = store.customEnv[config.baseUrlEnv] || '';
  const knownModels = store.modelsCache[provider] || [];
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
    setModel('');
    setBaseUrl('');
    setTest({ status: 'idle' });
    setFormError(null);
  };

  const testConnection = async () => {
    const problem = validateAddModelInput(input, keyStored);
    setFormError(problem);
    if (problem) return;
    setTest({ status: 'testing' });
    try {
      const models = await store.verifyConnectionAndFetchModels(provider, keyForConnectionTest(input, keyStored), input.baseUrl.trim() || undefined);
      setTest({ status: 'success', modelCount: models.length });
    } catch (err) {
      // Log the shape only; provider errors can echo request details.
      console.error(`Add a model: connection test failed for ${provider}.`, err instanceof Error ? err.name : typeof err);
      setTest({ status: 'error', message: describeModelConnectionError(err, provider) });
    }
  };

  const save = async (event?: FormEvent) => {
    event?.preventDefault();
    const problem = validateAddModelInput(input, keyStored);
    setFormError(problem);
    if (problem) return;
    setSaving(true);
    try {
      await store.saveAIConfig(addModelConfigEntries(input));
      await store.updateSettings(settings => { settings.ai.provider = provider; });
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
          onChange={event => { setApiKey(event.target.value); setTest({ status: 'idle' }); }}
          placeholder={keyStored ? 'A key is stored. Type a new one to replace it.' : 'Paste your key'}
          aria-describedby={ids.keyHelp}
          autoComplete="off"
          spellCheck={false}
          className={SETTINGS_INPUT_CLASS}
        />
        <span id={ids.keyHelp} className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
          {store.settings.privacy.useKeychainForSecrets
            ? 'Stored in the system keychain on this Mac.'
            : 'Stored in the AI config file on this Mac (keychain storage is off in Privacy and data).'}
        </span>
      </div>

      <div className="flex flex-col gap-1">
        <label htmlFor={ids.model} className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Model (optional)</label>
        <input
          id={ids.model}
          type="text"
          value={model}
          onChange={event => setModel(event.target.value)}
          placeholder={storedModel || config.defaultModel}
          list={knownModels.length > 0 ? ids.modelList : undefined}
          autoComplete="off"
          spellCheck={false}
          className={SETTINGS_INPUT_CLASS}
        />
        {knownModels.length > 0 && (
          <datalist id={ids.modelList}>
            {knownModels.map(name => <option key={name} value={name} />)}
          </datalist>
        )}
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
          {test.status === 'testing' ? 'Testing…' : 'Test connection'}
        </button>
        <button
          type="submit"
          disabled={saving}
          className={`${SETTINGS_BUTTON_CLASS} border-[var(--accent)] bg-[var(--accent)] text-white hover:bg-[var(--accent)] hover:border-[var(--accent)] hover:opacity-90`}
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
              Summaries, sorting with reasons and drafts use this model.
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
