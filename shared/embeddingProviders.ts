import type { AIEmbeddingProvider, AIEmbeddingSettings } from './types';

export interface EmbeddingProviderConfig {
  id: AIEmbeddingProvider;
  displayName: string;
  optionLabel: string;
  apiKeyEnv?: string;
  defaultBaseUrl: string;
  transport: 'openai' | 'gemini' | 'ollama' | 'cohere' | 'voyage';
  supportsDimensions: boolean;
  requiresApiKey: boolean;
}

export const EMBEDDING_PROVIDER_ORDER = [
  'openAI',
  'gemini',
  'ollama',
  'mistral',
  'cohere',
  'voyage',
  'dashscope',
  'openAICompatible',
] as const satisfies readonly AIEmbeddingProvider[];

export const EMBEDDING_PROVIDER_CONFIGS: Record<AIEmbeddingProvider, EmbeddingProviderConfig> = {
  openAI: {
    id: 'openAI',
    displayName: 'OpenAI',
    optionLabel: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultBaseUrl: 'https://api.openai.com/v1',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    optionLabel: 'Google Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    transport: 'gemini',
    supportsDimensions: true,
    requiresApiKey: true,
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama Local',
    optionLabel: 'Ollama Local',
    defaultBaseUrl: 'http://localhost:11434',
    transport: 'ollama',
    supportsDimensions: true,
    requiresApiKey: false,
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral AI',
    optionLabel: 'Mistral',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    transport: 'openai',
    supportsDimensions: false,
    requiresApiKey: true,
  },
  cohere: {
    id: 'cohere',
    displayName: 'Cohere',
    optionLabel: 'Cohere',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    transport: 'cohere',
    supportsDimensions: true,
    requiresApiKey: true,
  },
  voyage: {
    id: 'voyage',
    displayName: 'Voyage AI',
    optionLabel: 'Voyage',
    apiKeyEnv: 'VOYAGE_API_KEY',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    transport: 'voyage',
    supportsDimensions: true,
    requiresApiKey: true,
  },
  dashscope: {
    id: 'dashscope',
    displayName: 'Alibaba DashScope / Qwen',
    optionLabel: 'DashScope / Qwen',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultBaseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: true,
  },
  openAICompatible: {
    id: 'openAICompatible',
    displayName: 'Custom OpenAI-Compatible',
    optionLabel: 'Custom Compatible',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    defaultBaseUrl: 'http://localhost:1234/v1',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: false,
  },
};

export function getEmbeddingProviderConfig(provider: AIEmbeddingProvider): EmbeddingProviderConfig {
  return EMBEDDING_PROVIDER_CONFIGS[provider];
}

/** No model is built in: the embedding model is the one the user enters in settings. */
export function getDefaultEmbeddingSettings(): AIEmbeddingSettings {
  const config = getEmbeddingProviderConfig('openAI');
  return {
    provider: config.id,
    model: '',
    baseURL: config.defaultBaseUrl,
    dimensions: null,
  };
}

export function normalizeEmbeddingSettings(input: Partial<AIEmbeddingSettings> | null | undefined): AIEmbeddingSettings {
  const fallback = getDefaultEmbeddingSettings();
  const provider = input?.provider && input.provider in EMBEDDING_PROVIDER_CONFIGS
    ? input.provider
    : fallback.provider;
  const providerConfig = getEmbeddingProviderConfig(provider);
  const model = typeof input?.model === 'string' ? input.model.trim() : '';
  const baseURL = typeof input?.baseURL === 'string' && input.baseURL.trim()
    ? input.baseURL.trim()
    : providerConfig.defaultBaseUrl;
  const rawDimensions = input?.dimensions;
  const dimensions = Number.isInteger(rawDimensions) && Number(rawDimensions) > 0
    ? Number(rawDimensions)
    : null;

  return { provider, model, baseURL, dimensions };
}

export function buildEmbeddingIndexKey(settings: AIEmbeddingSettings): string {
  const normalized = normalizeEmbeddingSettings(settings);
  const providerConfig = getEmbeddingProviderConfig(normalized.provider);
  const base = providerConfig.transport === 'ollama' || normalized.provider === 'openAICompatible' || normalized.provider === 'dashscope'
    ? normalized.baseURL.replace(/\/+$/, '')
    : providerConfig.defaultBaseUrl;
  const dim = normalized.dimensions ? `dim=${normalized.dimensions}` : 'dim=default';
  return `${normalized.provider}:${normalized.model}:${dim}:${base}`;
}
