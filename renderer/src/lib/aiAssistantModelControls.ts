import type { AIProviderDescriptor, AIProviderPreference } from '../../../shared/types';
import { isConfigurableAIProvider } from '../../../shared/aiProviders';
import type { ConfigurableAIProvider } from '../../../shared/aiProviders';

export function resolveAssistantModelProvider(
  aiProvider: AIProviderPreference,
  providerDesc: AIProviderDescriptor | null,
): ConfigurableAIProvider | null {
  const effectiveProvider = aiProvider === 'automatic' ? providerDesc?.preference : aiProvider;
  return effectiveProvider && isConfigurableAIProvider(effectiveProvider) ? effectiveProvider : null;
}

export function resolveAssistantModelSummary(
  modelProvider: ConfigurableAIProvider | null,
  configuredModel: string,
  providerDesc: AIProviderDescriptor | null,
): string {
  if (!modelProvider) return providerDesc?.model || '';
  // No built-in model: what is shown is what the user chose (or what the provider descriptor resolved).
  return configuredModel || providerDesc?.model || '';
}

export function shouldFetchAssistantModelCatalog(input: {
  controlsOpen: boolean;
  modelProvider: ConfigurableAIProvider | null;
  cachedModels?: string[];
}): boolean {
  if (!input.modelProvider) return false;
  if (input.cachedModels && input.cachedModels.length > 0) return false;
  return input.controlsOpen;
}
