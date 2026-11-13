/**
 * Resolves which model override to pass into completeAI for a given purpose.
 *
 * Interactive covers chat, on-demand triage/summaries, and compose assist.
 * Automation covers background jobs such as proactive auto-drafting.
 *
 * Empty automation falls back to the interactive model (then provider env default
 * when both are empty — callers pass undefined as the completeAI override).
 */

import { isConfigurableAIProvider } from './aiProviders';
import type { AIProviderPreference } from './types';

export type AIModelPurpose = 'interactive' | 'automation';

export interface AIModelPurposeSettings {
  /** Settings-level interactive model (e.g. AISettings.globalDefaultModel). */
  interactiveModel?: string | null;
  /** Settings-level automation model (e.g. AISettings.automationModel). */
  automationModel?: string | null;
}

function trimModel(value: string | null | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Returns a non-empty model id to pass as completeAI's overrideModel, or
 * undefined so getAIProviderDescriptor falls through to the provider env default.
 */
export function resolveAIModelForPurpose(
  purpose: AIModelPurpose,
  settings: AIModelPurposeSettings,
  sessionInteractiveModel?: string | null,
): string | undefined {
  const interactive =
    trimModel(sessionInteractiveModel) ||
    trimModel(settings.interactiveModel) ||
    '';

  if (purpose === 'interactive') {
    return interactive || undefined;
  }

  const automation = trimModel(settings.automationModel);
  return automation || interactive || undefined;
}

/**
 * True when automation has its own non-empty model distinct from interactive resolution.
 * Useful for UI hints; resolution itself always uses resolveAIModelForPurpose.
 */
export function hasDedicatedAutomationModel(settings: AIModelPurposeSettings): boolean {
  return Boolean(trimModel(settings.automationModel));
}

export interface BackgroundModelRouteInput extends AIModelPurposeSettings {
  /** The provider preference used for everything else (`ai.provider`). */
  provider: AIProviderPreference;
  /** `ai.automationProvider`; anything that is not a configurable provider means "follow `provider`". */
  automationProvider?: unknown;
}

export interface BackgroundModelRoute {
  preference: AIProviderPreference;
  /** Undefined → the provider's own configured / default model. */
  overrideModel: string | undefined;
  /** True when background work runs on a provider chosen for it. */
  dedicated: boolean;
}

/**
 * Provider and model for unattended work (sorting, drafts in advance).
 * With a provider chosen for background work, only `automationModel` applies:
 * the interactive model id belongs to another provider and is never borrowed.
 */
export function resolveBackgroundModelRoute(input: BackgroundModelRouteInput): BackgroundModelRoute {
  const chosen = input.automationProvider;
  if (typeof chosen === 'string' && isConfigurableAIProvider(chosen)) {
    return { preference: chosen, overrideModel: trimModel(input.automationModel) || undefined, dedicated: true };
  }
  return { preference: input.provider, overrideModel: resolveAIModelForPurpose('automation', input), dedicated: false };
}
