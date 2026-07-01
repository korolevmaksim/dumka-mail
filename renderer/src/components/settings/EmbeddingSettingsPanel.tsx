import { useCallback, useEffect, useMemo, useState, type Dispatch, type SetStateAction } from 'react';
import { AlertCircle, Check, RefreshCw, RotateCcw, Trash2, XCircle } from 'lucide-react';
import { Toggle } from './SettingsControls';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import {
  AI_SECRET_STORED_PLACEHOLDER,
  type AIEmbeddingProvider,
  type AIEmbeddingSettings,
  type EmbeddingIndexReindexOptions,
  type EmbeddingIndexStatus,
} from '../../../../shared/types';
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

type IndexAction = 'refresh' | 'reindex' | 'rebuild' | 'deleteCurrent' | 'deleteOld' | 'cancel';

function isStoredSecretPlaceholder(value?: string): boolean {
  return value === AI_SECRET_STORED_PLACEHOLDER;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(value);
}

function compactModelKey(model: string): string {
  if (model.length <= 68) return model;
  return `${model.slice(0, 38)}...${model.slice(-22)}`;
}

export function EmbeddingSettingsPanel({ formKeys, setFormKeys, onSecretBlur }: EmbeddingSettingsPanelProps) {
  const store = useAppStore();
  const [testStatus, setTestStatus] = useState<TestStatus>({ status: 'idle' });
  const [indexStatus, setIndexStatus] = useState<EmbeddingIndexStatus | null>(null);
  const [indexError, setIndexError] = useState<string | null>(null);
  const [indexBusy, setIndexBusy] = useState<IndexAction | null>(null);
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
  const targetAccountId = useMemo(() => {
    if (store.activeAccount && store.activeAccount.id !== 'unified') return store.activeAccount.email;
    return store.accounts[0]?.email || '';
  }, [store.activeAccount, store.accounts]);
  const currentModelStats = indexStatus?.models.find(model => model.isCurrent) || null;
  const isIndexRunning = indexStatus?.job?.state === 'running';
  const jobProgress = indexStatus?.job && indexStatus.job.total > 0
    ? Math.min(100, Math.round((indexStatus.job.processed / indexStatus.job.total) * 100))
    : null;
  const coverageProgress = indexStatus && indexStatus.totalMessages > 0
    ? Math.min(100, Math.round((indexStatus.indexedMessages / indexStatus.totalMessages) * 100))
    : 0;

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

  const ensureProviderReady = async (): Promise<boolean> => {
    if (keyName && providerConfig.requiresApiKey && !keyValue) {
      emitToast({ type: 'warning', message: `Enter a ${providerConfig.displayName} API key first.` });
      return false;
    }

    if (keyName && keyValue && !isStoredSecretPlaceholder(keyValue)) {
      await onSecretBlur(keyName, keyValue);
    }

    return true;
  };

  const refreshIndexStatus = useCallback(async () => {
    if (!targetAccountId) {
      setIndexStatus(null);
      return;
    }

    setIndexError(null);
    try {
      setIndexStatus(await window.electronAPI.getEmbeddingIndexStatus(targetAccountId));
    } catch (err: any) {
      setIndexError(err?.message || String(err));
    }
  }, [targetAccountId]);

  useEffect(() => {
    void refreshIndexStatus();
  }, [
    refreshIndexStatus,
    embeddingSettings.provider,
    embeddingSettings.model,
    embeddingSettings.baseURL,
    embeddingSettings.dimensions,
    store.settings.ai.semanticSearchEnabled,
  ]);

  useEffect(() => {
    if (!isIndexRunning) return undefined;
    const timer = window.setInterval(() => {
      void refreshIndexStatus();
    }, 2000);
    return () => window.clearInterval(timer);
  }, [isIndexRunning, refreshIndexStatus]);

  const runIndexAction = async (action: IndexAction, options?: EmbeddingIndexReindexOptions) => {
    if (!targetAccountId) {
      emitToast({ type: 'warning', message: 'Connect a mail account before indexing.' });
      return;
    }

    setIndexBusy(action);
    setIndexError(null);
    try {
      if (action === 'refresh') {
        await refreshIndexStatus();
        return;
      }

      if (action === 'cancel') {
        setIndexStatus(await window.electronAPI.cancelEmbeddingReindex(targetAccountId));
        return;
      }

      if (action === 'deleteCurrent') {
        const currentModel = indexStatus?.currentModel;
        if (!currentModel) return;
        const result = await window.electronAPI.deleteEmbeddingIndex(targetAccountId, currentModel);
        setIndexStatus(result.status);
        emitToast({ type: 'success', message: `Deleted ${formatCount(result.deleted)} current index rows.` });
        return;
      }

      if (action === 'deleteOld') {
        const result = await window.electronAPI.deleteOtherEmbeddingIndexes(targetAccountId);
        setIndexStatus(result.status);
        emitToast({ type: 'success', message: `Deleted ${formatCount(result.deleted)} old index rows.` });
        return;
      }

      if (!(await ensureProviderReady())) return;
      setIndexStatus(await window.electronAPI.startEmbeddingReindex(targetAccountId, options));
    } catch (err: any) {
      const message = err?.message || String(err);
      setIndexError(message);
      emitToast({ type: 'error', message });
    } finally {
      setIndexBusy(null);
    }
  };

  const handleTest = async () => {
    if (!(await ensureProviderReady())) return;

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

  const semanticSearchDisabled = !store.settings.ai.semanticSearchEnabled;
  const controlsDisabled = !targetAccountId || Boolean(indexBusy) || isIndexRunning || semanticSearchDisabled;
  const currentIndexRows = currentModelStats?.count || 0;

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
            <option value="">Provider default{selectedPreset?.dimensions?.[0] ? ` (${selectedPreset.dimensions[0]} if provider uses max)` : ''}</option>
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

      <div className="border-t border-[var(--border)] pt-3 flex flex-col gap-2">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex flex-col gap-0.5">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Embedding Index</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] truncate" title={indexStatus?.currentModel || ''}>
              {targetAccountId ? `Account: ${targetAccountId}` : 'No account selected'}
              {indexStatus?.currentModel ? ` • ${compactModelKey(indexStatus.currentModel)}` : ''}
            </span>
          </div>
          <button
            type="button"
            onClick={() => void runIndexAction('refresh')}
            disabled={!targetAccountId || Boolean(indexBusy)}
            className="flex items-center gap-1 px-2 py-1 border border-[var(--border)] text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            <RefreshCw className={`w-3 h-3 ${indexBusy === 'refresh' ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        <div className="h-1.5 rounded-full bg-[var(--app-bg)] overflow-hidden border border-[var(--border)]">
          <div
            className={`h-full ${isIndexRunning ? 'bg-[var(--accent)]' : 'bg-[var(--success)]'} transition-all`}
            style={{ width: `${isIndexRunning && jobProgress !== null ? jobProgress : coverageProgress}%` }}
          />
        </div>

        <div className="grid grid-cols-4 gap-2 text-[calc(9px*var(--font-scale))]">
          <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded p-2">
            <div className="text-[var(--text-secondary)]">Indexed</div>
            <div className="text-[var(--text-primary)] font-semibold">{formatCount(indexStatus?.indexedMessages || 0)}</div>
          </div>
          <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded p-2">
            <div className="text-[var(--text-secondary)]">Pending</div>
            <div className="text-[var(--text-primary)] font-semibold">{formatCount(indexStatus?.pendingMessages || 0)}</div>
          </div>
          <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded p-2">
            <div className="text-[var(--text-secondary)]">Stale</div>
            <div className="text-[var(--text-primary)] font-semibold">{formatCount(indexStatus?.staleMessages || 0)}</div>
          </div>
          <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded p-2">
            <div className="text-[var(--text-secondary)]">Old Rows</div>
            <div className="text-[var(--text-primary)] font-semibold">{formatCount(indexStatus?.otherIndexedMessages || 0)}</div>
          </div>
        </div>

        {indexStatus?.job && indexStatus.job.state !== 'completed' && (
          <div className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
            Job {indexStatus.job.state}: {formatCount(indexStatus.job.processed)} / {formatCount(indexStatus.job.total)}
            {indexStatus.job.failed > 0 ? ` • ${formatCount(indexStatus.job.failed)} failed` : ''}
            {indexStatus.job.error ? ` • ${indexStatus.job.error}` : ''}
          </div>
        )}

        {semanticSearchDisabled && (
          <div className="text-[calc(9px*var(--font-scale))] text-[var(--warning)]">
            Semantic search is off. Indexing controls are disabled until you enable it.
          </div>
        )}
        {indexError && (
          <div className="text-[calc(9px*var(--font-scale))] text-[var(--danger)] flex items-start gap-1 min-w-0">
            <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
            <span className="truncate">{indexError}</span>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {isIndexRunning ? (
            <button
              type="button"
              onClick={() => void runIndexAction('cancel')}
              disabled={indexBusy === 'cancel'}
              className="flex items-center gap-1 px-2.5 py-1 border border-[var(--danger)] text-[calc(9px*var(--font-scale))] text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <XCircle className="w-3 h-3" />
              Cancel
            </button>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void runIndexAction('reindex')}
                disabled={controlsDisabled}
                className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <RefreshCw className={`w-3 h-3 ${indexBusy === 'reindex' ? 'animate-spin' : ''}`} />
                Reindex Missing
              </button>
              <button
                type="button"
                onClick={() => void runIndexAction('rebuild', { clearCurrent: true })}
                disabled={controlsDisabled}
                className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <RotateCcw className={`w-3 h-3 ${indexBusy === 'rebuild' ? 'animate-spin' : ''}`} />
                Rebuild Current
              </button>
              <button
                type="button"
                onClick={() => void runIndexAction('deleteCurrent')}
                disabled={!targetAccountId || Boolean(indexBusy) || currentIndexRows === 0}
                className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <Trash2 className="w-3 h-3" />
                Delete Current
              </button>
              <button
                type="button"
                onClick={() => void runIndexAction('deleteOld')}
                disabled={!targetAccountId || Boolean(indexBusy) || (indexStatus?.otherIndexedMessages || 0) === 0}
                className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--danger)] hover:text-[var(--danger)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
              >
                <Trash2 className="w-3 h-3" />
                Delete Old
              </button>
            </>
          )}
        </div>

        {indexStatus?.models.length ? (
          <div className="flex flex-col gap-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
            {indexStatus.models.slice(0, 4).map(model => (
              <div key={model.model} className="flex items-center justify-between gap-2 min-w-0">
                <span className="truncate" title={model.model}>{model.isCurrent ? 'Current' : 'Old'}: {compactModelKey(model.model)}</span>
                <span className="shrink-0 text-[var(--text-primary)]">{formatCount(model.count)}</span>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
