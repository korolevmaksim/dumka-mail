/**
 * Resolves which model override to pass into completeAI for a given purpose.
 *
 * Interactive covers chat, on-demand triage/summaries, and compose assist.
 * Automation covers background jobs such as proactive auto-drafting.
 *
 * Empty automation falls back to the interactive model (then provider env default
 * when both are empty — callers pass undefined as the completeAI override).
 */

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
