import type { AIEmbeddingProvider, AIEmbeddingSettings } from './types';

export interface EmbeddingModelPreset {
  id: string;
  label: string;
  dimensions?: number[];
}

export interface EmbeddingProviderConfig {
  id: AIEmbeddingProvider;
  displayName: string;
  optionLabel: string;
  apiKeyEnv?: string;
  defaultBaseUrl: string;
  defaultModel: string;
  transport: 'openai' | 'gemini' | 'ollama' | 'cohere' | 'voyage';
  supportsDimensions: boolean;
  requiresApiKey: boolean;
  models: EmbeddingModelPreset[];
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
    defaultModel: 'text-embedding-3-small',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: true,
    models: [
      { id: 'text-embedding-3-small', label: 'text-embedding-3-small', dimensions: [1536, 1024, 512, 256] },
      { id: 'text-embedding-3-large', label: 'text-embedding-3-large', dimensions: [3072, 2048, 1536, 1024, 512, 256] },
      { id: 'text-embedding-ada-002', label: 'text-embedding-ada-002' },
    ],
  },
  gemini: {
    id: 'gemini',
    displayName: 'Google Gemini',
    optionLabel: 'Google Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-embedding-001',
    transport: 'gemini',
    supportsDimensions: true,
    requiresApiKey: true,
    models: [
      { id: 'gemini-embedding-001', label: 'gemini-embedding-001', dimensions: [2048, 1536, 768, 512, 256, 128] },
      { id: 'gemini-embedding-2', label: 'gemini-embedding-2', dimensions: [2048, 1536, 768, 512, 256, 128] },
    ],
  },
  ollama: {
    id: 'ollama',
    displayName: 'Ollama Local',
    optionLabel: 'Ollama Local',
    defaultBaseUrl: 'http://localhost:11434',
    defaultModel: 'embeddinggemma',
    transport: 'ollama',
    supportsDimensions: true,
    requiresApiKey: false,
    models: [
      { id: 'embeddinggemma', label: 'embeddinggemma' },
      { id: 'qwen3-embedding', label: 'qwen3-embedding' },
      { id: 'nomic-embed-text', label: 'nomic-embed-text' },
      { id: 'bge-m3', label: 'bge-m3' },
      { id: 'all-minilm', label: 'all-minilm' },
    ],
  },
  mistral: {
    id: 'mistral',
    displayName: 'Mistral AI',
    optionLabel: 'Mistral',
    apiKeyEnv: 'MISTRAL_API_KEY',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-embed',
    transport: 'openai',
    supportsDimensions: false,
    requiresApiKey: true,
    models: [{ id: 'mistral-embed', label: 'mistral-embed' }],
  },
  cohere: {
    id: 'cohere',
    displayName: 'Cohere',
    optionLabel: 'Cohere',
    apiKeyEnv: 'COHERE_API_KEY',
    defaultBaseUrl: 'https://api.cohere.com/v2',
    defaultModel: 'embed-v4.0',
    transport: 'cohere',
    supportsDimensions: true,
    requiresApiKey: true,
    models: [
      { id: 'embed-v4.0', label: 'embed-v4.0', dimensions: [1536, 1024, 512, 256] },
      { id: 'embed-english-v3.0', label: 'embed-english-v3.0' },
      { id: 'embed-multilingual-v3.0', label: 'embed-multilingual-v3.0' },
      { id: 'embed-english-light-v3.0', label: 'embed-english-light-v3.0' },
      { id: 'embed-multilingual-light-v3.0', label: 'embed-multilingual-light-v3.0' },
    ],
  },
  voyage: {
    id: 'voyage',
    displayName: 'Voyage AI',
    optionLabel: 'Voyage',
    apiKeyEnv: 'VOYAGE_API_KEY',
    defaultBaseUrl: 'https://api.voyageai.com/v1',
    defaultModel: 'voyage-3.5',
    transport: 'voyage',
    supportsDimensions: true,
    requiresApiKey: true,
    models: [
      { id: 'voyage-3.5', label: 'voyage-3.5' },
      { id: 'voyage-3.5-lite', label: 'voyage-3.5-lite' },
      { id: 'voyage-code-3', label: 'voyage-code-3' },
    ],
  },
  dashscope: {
    id: 'dashscope',
    displayName: 'Alibaba DashScope / Qwen',
    optionLabel: 'DashScope / Qwen',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultBaseUrl: 'https://{WorkspaceId}.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1',
    defaultModel: 'text-embedding-v4',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: true,
    models: [
      { id: 'text-embedding-v4', label: 'text-embedding-v4', dimensions: [2048, 1536, 1024, 768, 512, 256, 128, 64] },
      { id: 'text-embedding-v3', label: 'text-embedding-v3', dimensions: [1024, 768, 512] },
    ],
  },
  openAICompatible: {
    id: 'openAICompatible',
    displayName: 'Custom OpenAI-Compatible',
    optionLabel: 'Custom Compatible',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    defaultBaseUrl: 'http://localhost:1234/v1',
    defaultModel: 'text-embedding-3-small',
    transport: 'openai',
    supportsDimensions: true,
    requiresApiKey: false,
    models: [
      { id: 'text-embedding-3-small', label: 'text-embedding-3-small' },
      { id: 'nomic-embed-text', label: 'nomic-embed-text' },
      { id: 'qwen3-embedding', label: 'qwen3-embedding' },
    ],
  },
};

export function getEmbeddingProviderConfig(provider: AIEmbeddingProvider): EmbeddingProviderConfig {
  return EMBEDDING_PROVIDER_CONFIGS[provider];
}

export function getDefaultEmbeddingSettings(): AIEmbeddingSettings {
  const config = getEmbeddingProviderConfig('openAI');
  return {
    provider: config.id,
    model: config.defaultModel,
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
  const model = typeof input?.model === 'string' && input.model.trim()
    ? input.model.trim()
    : providerConfig.defaultModel;
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

export function getEmbeddingModelPresets(provider: AIEmbeddingProvider): EmbeddingModelPreset[] {
  return getEmbeddingProviderConfig(provider).models;
}
