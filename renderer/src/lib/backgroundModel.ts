// Which provider and model do the background work. The provider is written to
// the settings the moment background sorting is switched on (app-wide or for
// one account), so the settings page shows exactly what runs unattended. The
// model always comes from settings: there is no built-in model to fall back to.
import { ADD_MODEL_PROVIDERS, providerIsSetUp } from '../../../shared/addModel';
import { isAIProviderUnavailable } from '../../../shared/aiErrors';
import { getAIProviderConfig, isConfigurableAIProvider, type ConfigurableAIProvider } from '../../../shared/aiProviders';
import type { AIProviderDescriptor, AppSettings } from '../../../shared/types';

/** The provider in use for everything else, else the first one that is set up. */
export function defaultBackgroundProvider(
  descriptor: AIProviderDescriptor | null | undefined,
  env: Record<string, string>,
): ConfigurableAIProvider | null {
  if (descriptor && !isAIProviderUnavailable(descriptor) && isConfigurableAIProvider(descriptor.preference)) return descriptor.preference;
  return ADD_MODEL_PROVIDERS.find(candidate => providerIsSetUp(env, candidate)) || null;
}

/** The provider chosen for background work, else the default one. */
export function backgroundProvider(
  settings: Pick<AppSettings, 'ai'>,
  descriptor: AIProviderDescriptor | null | undefined,
  env: Record<string, string>,
): ConfigurableAIProvider | null {
  const chosen = settings.ai.automationProvider;
  return chosen && isConfigurableAIProvider(chosen) ? chosen : defaultBackgroundProvider(descriptor, env);
}

/**
 * Makes the provider for background work explicit the moment sorting is
 * switched on. Mutates `settings` (meant for `updateSettings`). The model is
 * never guessed: an empty `automationModel` means the model saved for that
 * provider, and the settings page asks for a choice when there is none.
 */
export function seedBackgroundProvider(settings: Pick<AppSettings, 'ai'>, fallbackProvider: ConfigurableAIProvider | null): void {
  const current = settings.ai.automationProvider;
  if (current && isConfigurableAIProvider(current)) return;
  if (fallbackProvider) settings.ai.automationProvider = fallbackProvider;
}

/** The model background work will actually use for a provider, or '' when none is chosen anywhere. */
export function effectiveBackgroundModel(settings: Pick<AppSettings, 'ai'>, provider: ConfigurableAIProvider | null, env: Record<string, string>): string {
  const chosen = (settings.ai.automationModel || '').trim();
  if (chosen || !provider) return chosen;
  return (env[getAIProviderConfig(provider).modelEnv] || '').trim();
}
