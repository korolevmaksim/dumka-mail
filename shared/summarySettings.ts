import { isConfigurableAIProvider, type ConfigurableAIProvider } from './aiProviders';
import { isAIProviderPreference } from './aiProviderPreference';

export const SUMMARY_LANGUAGES = {
  auto: 'Same as the conversation', en: 'English', ru: 'Russian', pl: 'Polish', uk: 'Ukrainian',
  de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese',
  nl: 'Dutch', cs: 'Czech', ja: 'Japanese', ko: 'Korean', zh: 'Chinese',
} as const;
export type SummaryLanguage = keyof typeof SUMMARY_LANGUAGES;
export const SUMMARY_INSTRUCTIONS_MAX = 4000;

export interface SummarySettings {
  provider: ConfigurableAIProvider | '';
  model: string;
  language: SummaryLanguage;
  instructions: string;
}

export interface SummarySettingsSource {
  summary?: unknown;
  provider?: unknown;
  globalDefaultModel?: unknown;
}

export function isSummaryLanguage(value: string): value is SummaryLanguage {
  return Object.prototype.hasOwnProperty.call(SUMMARY_LANGUAGES, value);
}

export function summarySettings(ai: SummarySettingsSource | null | undefined): SummarySettings {
  const raw = ai?.summary;
  const value: Record<string, unknown> = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? Object.fromEntries(Object.entries(raw)) : {};
  return {
    provider: typeof value.provider === 'string' && isConfigurableAIProvider(value.provider) ? value.provider : '',
    model: typeof value.model === 'string' ? value.model.trim() : '',
    language: typeof value.language === 'string' && isSummaryLanguage(value.language) ? value.language : 'auto',
    instructions: typeof value.instructions === 'string' ? value.instructions.trim().slice(0, SUMMARY_INSTRUCTIONS_MAX) : '',
  };
}

export function summaryModelRoute(ai: SummarySettingsSource | null | undefined) {
  const config = summarySettings(ai);
  const main = typeof ai?.provider === 'string' && isAIProviderPreference(ai.provider) ? ai.provider : 'automatic';
  return {
    preference: config.provider || main,
    overrideModel: config.model || (!config.provider && typeof ai?.globalDefaultModel === 'string' ? ai.globalDefaultModel.trim() : '') || undefined,
    dedicated: Boolean(config.provider || config.model),
  };
}

/** Shared by settings, renderer memory caches and the main-process cache. */
export function summarySettingsFingerprint(ai: SummarySettingsSource | null | undefined): string {
  return JSON.stringify([summarySettings(ai), summaryModelRoute(ai)]);
}
