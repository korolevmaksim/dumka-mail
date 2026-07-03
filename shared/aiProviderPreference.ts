import { AIProviderPreference } from './types';

const AI_PROVIDER_PREFERENCES = new Set<AIProviderPreference>([
  'automatic',
  'openAI',
  'anthropic',
  'gemini',
  'openRouter',
  'deepSeek',
  'openAICompatible',
  'disabled',
]);

export function isAIProviderPreference(value: unknown): value is AIProviderPreference {
  return typeof value === 'string' && AI_PROVIDER_PREFERENCES.has(value as AIProviderPreference);
}

export function resolveAIProviderPreference(
  appSettingsProvider?: AIProviderPreference | null,
  envProvider?: string | null
): AIProviderPreference {
  if (isAIProviderPreference(appSettingsProvider)) return appSettingsProvider;
  if (isAIProviderPreference(envProvider)) return envProvider;
  return 'automatic';
}
