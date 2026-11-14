// The provider's own model list for the settings pickers.
//
// The list is cached (it survives restarts), so it is refreshed once per app
// session for every provider that is set up: model ids change often, and a
// picker fed from an old cache would offer models the provider has retired.
//
// Load state lives outside React, keyed by provider and server address: two
// pickers for the same provider share one request and one status, and a
// component that mounts while a load is in flight sees it as loading.
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';
import { useAppStore } from '../stores/AppStore';
import { getAIProviderConfig, type ConfigurableAIProvider } from '../../../shared/aiProviders';
import { providerIsSetUp } from '../../../shared/addModel';
import { AI_SECRET_STORED_PLACEHOLDER } from '../../../shared/types';

export type ProviderModelsStatus = 'idle' | 'loading' | 'ready' | 'error';

export interface ProviderModels {
  /** The cached or freshly loaded list; empty when nothing was loaded yet. */
  models: string[];
  status: ProviderModelsStatus;
  /** False when the provider has no stored key (or server address): nothing can be loaded. */
  canLoad: boolean;
  refresh: () => void;
}

type FetchModels = (provider: string, apiKey: string, baseUrl?: string) => Promise<string[]>;

const NO_MODELS: string[] = [];
/** `provider|server address` → the state of this session's load; absent until one was started. */
const loadStatus = new Map<string, Exclude<ProviderModelsStatus, 'idle'>>();
const listeners = new Set<() => void>();
let version = 0;

function setLoadStatus(key: string, status: Exclude<ProviderModelsStatus, 'idle'>) {
  loadStatus.set(key, status);
  version += 1;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function loadModels(key: string, provider: ConfigurableAIProvider, baseUrl: string, fetchModels: FetchModels) {
  if (loadStatus.get(key) === 'loading') return;
  setLoadStatus(key, 'loading');
  // The stored key is resolved in the main process; it never reaches this window.
  fetchModels(provider, AI_SECRET_STORED_PLACEHOLDER, baseUrl || undefined)
    .then(() => setLoadStatus(key, 'ready'))
    .catch(error => {
      // The shape only: provider errors can echo request details.
      console.warn(`Could not load the model list for ${provider}.`, error instanceof Error ? error.name : typeof error);
      setLoadStatus(key, 'error');
    });
}

export function useProviderModels(provider: ConfigurableAIProvider | null): ProviderModels {
  const store = useAppStore();
  const fetchRef = useRef<FetchModels>(store.verifyConnectionAndFetchModels);
  fetchRef.current = store.verifyConnectionAndFetchModels;
  useSyncExternalStore(subscribe, () => version, () => version);

  const config = provider ? getAIProviderConfig(provider) : null;
  const baseUrl = config?.requiresBaseUrlForModels ? (store.customEnv[config.baseUrlEnv] || '').trim() : '';
  const canLoad = Boolean(provider && providerIsSetUp(store.customEnv, provider));
  const models = (provider && store.modelsCache[provider]) || NO_MODELS;
  const key = provider ? `${provider}|${baseUrl}` : '';

  // Once per session for each provider that is set up; a failed load waits for `Refresh list`.
  useEffect(() => {
    if (!provider || !canLoad || loadStatus.has(key)) return;
    loadModels(key, provider, baseUrl, (...args) => fetchRef.current(...args));
  }, [baseUrl, canLoad, key, provider]);

  const refresh = useCallback(() => {
    if (provider && canLoad) loadModels(key, provider, baseUrl, (...args) => fetchRef.current(...args));
  }, [baseUrl, canLoad, key, provider]);

  const status: ProviderModelsStatus = (provider && canLoad && loadStatus.get(key)) || (models.length > 0 ? 'ready' : 'idle');
  return { models, status, canLoad, refresh };
}
