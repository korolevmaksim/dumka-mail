import { useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Check, RefreshCw } from 'lucide-react';
import { Toggle } from './SettingsControls';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { AIEmbeddingProvider, AIEmbeddingSettings, AI_SECRET_STORED_PLACEHOLDER } from '../../../../shared/types';
import {
  EMBEDDING_PROVIDER_ORDER,
  getEmbeddingModelPresets,
  getEmbeddingProviderConfig,
  normalizeEmbeddingSettings,
} from '../../../../shared/embeddingProviders';

type FormKeys = Record<string, string>;

interface EmbeddingSettingsPanelProps {
  formKeys: FormKeys;
  setFormKeys: Dispatch<SetStateAction<FormKeys>>;
  onSecretBlur: (key: string, value: string) => Promise<void>;
}

type TestStatus =
  | { status: 'idle' }
  | { status: 'testing' }
  | { status: 'success'; message: string }
  | { status: 'error'; message: string };

function isStoredSecretPlaceholder(value?: string): boolean {
  return value === AI_SECRET_STORED_PLACEHOLDER;
}

export function EmbeddingSettingsPanel({ formKeys, setFormKeys, onSecretBlur }: EmbeddingSettingsPanelProps) {
  const store = useAppStore();
  const [testStatus, setTestStatus] = useState<TestStatus>({ status: 'idle' });
  const embeddingSettings = normalizeEmbeddingSettings(store.settings.ai.embeddings);
  const providerConfig = getEmbeddingProviderConfig(embeddingSettings.provider);
  const presets = getEmbeddingModelPresets(embeddingSettings.provider);
  const selectedPreset = presets.find(preset => preset.id === embeddingSettings.model);
  const dimensionOptions = useMemo(() => {
    const values = new Set<number>();
    for (const preset of presets) {
      for (const value of preset.dimensions || []) values.add(value);
    }
    return [...values].sort((a, b) => b - a);
  }, [presets]);
  const dimensionIsPreset = embeddingSettings.dimensions === null || dimensionOptions.includes(embeddingSettings.dimensions);
  const modelIsPreset = presets.some(preset => preset.id === embeddingSettings.model);
  const keyName = providerConfig.apiKeyEnv;
  const keyValue = keyName ? formKeys[keyName] || '' : '';

  const updateEmbeddings = (patch: Partial<AIEmbeddingSettings>) => {
    store.updateSettings(settings => {
      settings.ai.embeddings = normalizeEmbeddingSettings({
        ...settings.ai.embeddings,
        ...patch,
      });
    });
    setTestStatus({ status: 'idle' });
  };

  const updateProvider = (provider: AIEmbeddingProvider) => {
    const nextConfig = getEmbeddingProviderConfig(provider);
    updateEmbeddings({
      provider,
      model: nextConfig.defaultModel,
      baseURL: nextConfig.defaultBaseUrl,
      dimensions: null,
    });
  };

  const handleTest = async () => {
    if (keyName && providerConfig.requiresApiKey && !keyValue) {
      emitToast({ type: 'warning', message: `Enter a ${providerConfig.displayName} API key first.` });
      return;
    }

    if (keyName && keyValue && !isStoredSecretPlaceholder(keyValue)) {
      await onSecretBlur(keyName, keyValue);
    }

    setTestStatus({ status: 'testing' });
    try {
      const result = await window.electronAPI.testEmbeddingConfig(embeddingSettings);
      setTestStatus({
        status: 'success',
        message: `${result.provider} returned ${result.dimensions} dimensions`,
      });
    } catch (err: any) {
      setTestStatus({ status: 'error', message: err?.message || String(err) });
    }
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Semantic Search Embeddings</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">Provider, model, dimensions, and local endpoint for semantic indexing</span>
        </div>
        <Toggle
          checked={store.settings.ai.semanticSearchEnabled}
          onChange={(value) => store.updateSettings(settings => { settings.ai.semanticSearchEnabled = value; })}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Embedding Provider</span>
        <select
          value={embeddingSettings.provider}
          onChange={(event) => updateProvider(event.target.value as AIEmbeddingProvider)}
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
        >
          {EMBEDDING_PROVIDER_ORDER.map(provider => {
            const config = getEmbeddingProviderConfig(provider);
            return <option key={provider} value={provider}>{config.optionLabel}</option>;
          })}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {keyName && (
          <input
            type="password"
            placeholder={providerConfig.requiresApiKey ? 'API Key' : 'API Key (optional)'}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={keyValue}
            onFocus={(event) => {
              if (isStoredSecretPlaceholder(keyValue)) event.currentTarget.select();
            }}
            onBlur={(event) => void onSecretBlur(keyName, event.currentTarget.value)}
            onChange={(event) => setFormKeys(prev => ({ ...prev, [keyName]: event.target.value }))}
          />
        )}
        <input
          type="text"
          placeholder="Base URL"
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
          value={embeddingSettings.baseURL}
          onChange={(event) => updateEmbeddings({ baseURL: event.target.value })}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={modelIsPreset ? embeddingSettings.model : '__custom__'}
          onChange={(event) => {
            if (event.target.value === '__custom__') return;
            updateEmbeddings({ model: event.target.value, dimensions: null });
          }}
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
        >
          {presets.map(preset => <option key={preset.id} value={preset.id}>{preset.label}</option>)}
          <option value="__custom__">Custom model</option>
        </select>
        <input
          type="text"
          placeholder="Custom model id"
          className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
          value={embeddingSettings.model}
          onChange={(event) => updateEmbeddings({ model: event.target.value })}
        />
      </div>

      {providerConfig.supportsDimensions && (
        <div className="grid grid-cols-2 gap-2">
          <select
            value={dimensionIsPreset ? String(embeddingSettings.dimensions || '') : '__custom__'}
            onChange={(event) => {
              if (event.target.value === '__custom__') return;
              updateEmbeddings({ dimensions: event.target.value ? Number(event.target.value) : null });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="">Default dimensions{selectedPreset?.dimensions?.[0] ? ` (${selectedPreset.dimensions[0]})` : ''}</option>
            {dimensionOptions.map(value => <option key={value} value={value}>{value}</option>)}
            <option value="__custom__">Custom dimensions</option>
          </select>
          <input
            type="number"
            min={1}
            step={1}
            placeholder="Custom dimensions"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={embeddingSettings.dimensions || ''}
            onChange={(event) => updateEmbeddings({ dimensions: event.target.value ? Number(event.target.value) : null })}
          />
        </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleTest}
          disabled={testStatus.status === 'testing'}
          className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:translate-y-px"
        >
          <RefreshCw className={`w-3 h-3 ${testStatus.status === 'testing' ? 'animate-spin' : ''}`} />
          {testStatus.status === 'testing' ? 'Testing…' : 'Test Embeddings'}
        </button>
        {testStatus.status === 'success' && (
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--success)] font-medium flex items-center gap-1">
            <Check className="w-3.5 h-3.5" /> {testStatus.message}
          </span>
        )}
        {testStatus.status === 'error' && (
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--danger)] font-medium flex items-start gap-1 min-w-0">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="truncate">{testStatus.message}</span>
          </span>
        )}
      </div>
    </div>
  );
}
