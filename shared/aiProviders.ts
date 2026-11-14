import { AIProviderPreference } from './types';

export type ConfigurableAIProvider = Exclude<AIProviderPreference, 'automatic' | 'disabled'>;

export interface AIProviderConfig {
  id: ConfigurableAIProvider;
  displayName: string;
  settingsTitle: string;
  optionLabel: string;
  apiKeyEnv: string;
  baseUrlEnv: string;
  /** Where the chosen model id is stored. There is no built-in model: it always comes from settings. */
  modelEnv: string;
  defaultBaseUrl: string;
  transport: string;
  modelSelectionMode: 'catalog' | 'custom';
  requiresBaseUrlForModels: boolean;
  requiresApiKeyForModels: boolean;
}

export const CONFIGURABLE_AI_PROVIDERS = [
  'openAI',
  'anthropic',
  'gemini',
  'openRouter',
  'deepSeek',
  'openAICompatible',
] as const satisfies readonly ConfigurableAIProvider[];

export const AI_PROVIDER_CONFIGS: Record<ConfigurableAIProvider, AIProviderConfig> = {
  openAI: {
    id: 'openAI',
    displayName: 'OpenAI',
    settingsTitle: 'OpenAI',
    optionLabel: 'OpenAI',
    apiKeyEnv: 'OPENAI_API_KEY',
    baseUrlEnv: 'OPENAI_BASE_URL',
    modelEnv: 'OPENAI_MODEL',
    defaultBaseUrl: '',
    transport: 'responses',
    modelSelectionMode: 'catalog',
    requiresBaseUrlForModels: false,
    requiresApiKeyForModels: true,
  },
  anthropic: {
    id: 'anthropic',
    displayName: 'Anthropic',
    settingsTitle: 'Anthropic',
    optionLabel: 'Anthropic',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    baseUrlEnv: 'ANTHROPIC_BASE_URL',
    modelEnv: 'ANTHROPIC_MODEL',
    defaultBaseUrl: '',
    transport: 'messages',
    modelSelectionMode: 'catalog',
    requiresBaseUrlForModels: false,
    requiresApiKeyForModels: true,
  },
  gemini: {
    id: 'gemini',
    displayName: 'Gemini',
    settingsTitle: 'Google Gemini',
    optionLabel: 'Gemini',
    apiKeyEnv: 'GEMINI_API_KEY',
    baseUrlEnv: 'GEMINI_BASE_URL',
    modelEnv: 'GEMINI_MODEL',
    defaultBaseUrl: '',
    transport: 'generateContent',
    modelSelectionMode: 'catalog',
    requiresBaseUrlForModels: false,
    requiresApiKeyForModels: true,
  },
  openRouter: {
    id: 'openRouter',
    displayName: 'OpenRouter',
    settingsTitle: 'OpenRouter',
    optionLabel: 'OpenRouter',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    baseUrlEnv: 'OPENROUTER_BASE_URL',
    modelEnv: 'OPENROUTER_MODEL',
    defaultBaseUrl: 'https://openrouter.ai/api/v1',
    transport: 'chat.completions',
    modelSelectionMode: 'catalog',
    requiresBaseUrlForModels: false,
    requiresApiKeyForModels: true,
  },
  deepSeek: {
    id: 'deepSeek',
    displayName: 'DeepSeek',
    settingsTitle: 'DeepSeek',
    optionLabel: 'DeepSeek',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    baseUrlEnv: 'DEEPSEEK_BASE_URL',
    modelEnv: 'DEEPSEEK_MODEL',
    defaultBaseUrl: 'https://api.deepseek.com',
    transport: 'chat.completions',
    modelSelectionMode: 'catalog',
    requiresBaseUrlForModels: false,
    requiresApiKeyForModels: true,
  },
  openAICompatible: {
    id: 'openAICompatible',
    displayName: 'Local Model',
    settingsTitle: 'OpenAI-Compatible (Local Ollama / LM Studio)',
    optionLabel: 'Local Compatible',
    apiKeyEnv: 'OPENAI_COMPATIBLE_API_KEY',
    baseUrlEnv: 'OPENAI_COMPATIBLE_BASE_URL',
    modelEnv: 'OPENAI_COMPATIBLE_MODEL',
    defaultBaseUrl: '',
    transport: 'chat.completions',
    modelSelectionMode: 'custom',
    requiresBaseUrlForModels: true,
    requiresApiKeyForModels: false,
  },
};

export function isConfigurableAIProvider(provider: string): provider is ConfigurableAIProvider {
  return CONFIGURABLE_AI_PROVIDERS.includes(provider as ConfigurableAIProvider);
}

export function getAIProviderConfig(provider: ConfigurableAIProvider): AIProviderConfig {
  return AI_PROVIDER_CONFIGS[provider];
}

export function getAIProviderConfigFields(provider: ConfigurableAIProvider): {
  apiKey: string;
  baseUrl: string;
  model: string;
} {
  const config = getAIProviderConfig(provider);
  return {
    apiKey: config.apiKeyEnv,
    baseUrl: config.baseUrlEnv,
    model: config.modelEnv,
  };
}

export function resolveConfiguredProviderModel(
  provider: ConfigurableAIProvider,
  env: Record<string, string | undefined>
): string {
  const config = getAIProviderConfig(provider);
  return env[config.modelEnv]?.trim() || '';
}

// --- Request formats that depend on the model generation -----------------------
// These read the generation number from whatever model the user chose; no model
// id is listed, so a newer generation keeps working without a code change.

function geminiGeneration(model: string, family: RegExp): number | null {
  const match = family.exec(model.replace(/^models\//, ''));
  return match ? Number(match[1]) : null;
}

/** Gemini text models from generation 3 on take `thinkingLevel`; older ones do not. */
export function geminiSupportsThinkingLevel(model: string): boolean {
  const generation = geminiGeneration(model, /^gemini-(\d+)(?:[.-]|$)/);
  return generation !== null && generation >= 3;
}

/**
 * Gemini embedding models from generation 2 on take the retrieval instruction
 * in the text itself; `…-001` style models take a `taskType` instead.
 */
export function geminiEmbeddingUsesInlineInstruction(model: string): boolean {
  const generation = geminiGeneration(model, /^gemini-embedding-(\d+)(?:[.-]|$)/);
  return generation !== null && generation >= 2;
}
