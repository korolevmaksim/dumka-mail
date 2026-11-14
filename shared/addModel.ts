// Pure helpers for the "Add a model" sheet (SPEC §5: provider, key, check).
import { AI_PROVIDER_CONFIGS, CONFIGURABLE_AI_PROVIDERS, type ConfigurableAIProvider } from './aiProviders';
import { AI_SECRET_STORED_PLACEHOLDER } from './types';

export interface AddModelInput {
  provider: ConfigurableAIProvider;
  /** Empty keeps a key that is already stored. */
  apiKey: string;
  model: string;
  baseUrl: string;
}

export const ADD_MODEL_PROVIDERS: readonly ConfigurableAIProvider[] = CONFIGURABLE_AI_PROVIDERS;

/** Plain provider names for the select (the local endpoint reads better spelled out). */
export function addModelProviderLabel(provider: ConfigurableAIProvider): string {
  return provider === 'openAICompatible' ? 'Local or OpenAI-compatible' : AI_PROVIDER_CONFIGS[provider].displayName;
}

export function providerNeedsBaseUrl(provider: ConfigurableAIProvider): boolean {
  return AI_PROVIDER_CONFIGS[provider].requiresBaseUrlForModels;
}

export function hasStoredKey(env: Record<string, string>, provider: ConfigurableAIProvider): boolean {
  const value = env[AI_PROVIDER_CONFIGS[provider].apiKeyEnv];
  return Boolean(value && value.trim());
}

/** True when the provider can be called: a key is stored, or (local endpoints) a server address is. */
export function providerIsSetUp(env: Record<string, string>, provider: ConfigurableAIProvider): boolean {
  const config = AI_PROVIDER_CONFIGS[provider];
  if (config.requiresApiKeyForModels && !hasStoredKey(env, provider)) return false;
  if (config.requiresBaseUrlForModels && !(env[config.baseUrlEnv] || '').trim()) return false;
  return true;
}

/** Returns a sentence for the first missing field, or null when the input can be tested or saved. */
export function validateAddModelInput(input: AddModelInput, keyAlreadyStored: boolean): string | null {
  const config = AI_PROVIDER_CONFIGS[input.provider];
  if (config.requiresApiKeyForModels && !input.apiKey.trim() && !keyAlreadyStored) {
    return `Enter your ${config.displayName} API key.`;
  }
  if (config.requiresBaseUrlForModels) {
    const url = input.baseUrl.trim();
    if (!url) return 'Enter the address of the model server, for example http://localhost:11434/v1.';
    if (!/^https?:\/\/\S+$/i.test(url)) return 'The server address must start with http:// or https://.';
  }
  return null;
}

/** Shown when Save is pressed without a model: nothing is built in, so one has to be chosen. */
export const CHOOSE_MODEL_MESSAGE = 'Choose a model from the list, then press Save.';

/** True when the form names a model to save (or one is already saved for the provider). */
export function hasModelChoice(input: AddModelInput, env: Record<string, string>): boolean {
  return Boolean(input.model.trim() || (env[AI_PROVIDER_CONFIGS[input.provider].modelEnv] || '').trim());
}

/** The key to send to the provider check: a typed key, else the stored-key placeholder main resolves itself. */
export function keyForConnectionTest(input: AddModelInput, keyAlreadyStored: boolean): string {
  const typed = input.apiKey.trim();
  if (typed) return typed;
  return keyAlreadyStored ? AI_SECRET_STORED_PLACEHOLDER : '';
}

/**
 * The AI config entries to save through the existing secure path
 * (`saveAIConfig` → OS keychain for keys). Blank fields are left untouched.
 */
export function addModelConfigEntries(input: AddModelInput): Record<string, string> {
  const config = AI_PROVIDER_CONFIGS[input.provider];
  const entries: Record<string, string> = { PMC_AI_PROVIDER: input.provider };
  const key = input.apiKey.trim();
  if (key && key !== AI_SECRET_STORED_PLACEHOLDER) entries[config.apiKeyEnv] = key;
  if (input.model.trim()) entries[config.modelEnv] = input.model.trim();
  if (input.baseUrl.trim()) entries[config.baseUrlEnv] = input.baseUrl.trim();
  return entries;
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : '';
}

/** A human-readable sentence for a failed connection test; never echoes the raw error (it may carry a key). */
export function describeModelConnectionError(error: unknown, provider: ConfigurableAIProvider): string {
  const name = AI_PROVIDER_CONFIGS[provider].displayName;
  const text = errorText(error).toLowerCase();
  if (/\b(401|403)\b|unauthori[sz]ed|forbidden|invalid[ _-]?(api[ _-]?)?key|incorrect api key|authentication|permission/.test(text)) {
    return `${name} did not accept this key. Check that it is correct and still active.`;
  }
  if (/\b429\b|rate limit|quota|insufficient|billing|credit/.test(text)) {
    return `${name} refused the request because of a usage limit or billing. Check your account with ${name}.`;
  }
  if (/no models returned/.test(text)) {
    return `Connected, but ${name} returned no models. Check that the key has model access.`;
  }
  if (/api key is required/.test(text)) {
    return `Enter your ${name} API key.`;
  }
  if (/enotfound|econnrefused|etimedout|network|fetch failed|failed to fetch|timed? ?out|getaddrinfo|socket/.test(text)) {
    return provider === 'openAICompatible'
      ? 'Could not reach the model server. Check the address and that the server is running.'
      : `Could not reach ${name}. Check your internet connection and try again.`;
  }
  if (/\b404\b|not found/.test(text)) {
    return `${name} answered, but the address or model was not found. Check the model name and server address.`;
  }
  return `Could not connect to ${name}. Check the key and try again.`;
}
