export type SortingEngine = 'completion' | 'openAIDecisions';

export interface SortingSettingsSource {
  sortingEngine?: unknown;
  decisionsModel?: unknown;
  decisionsMinConfidence?: unknown;
}

export function sortingConfig(ai: SortingSettingsSource | null | undefined) {
  return {
    engine: ai?.sortingEngine === 'openAIDecisions' ? 'openAIDecisions' as const : 'completion' as const,
    model: typeof ai?.decisionsModel === 'string' ? ai.decisionsModel.trim() : '',
    minConfidence: typeof ai?.decisionsMinConfidence === 'number' && Number.isFinite(ai.decisionsMinConfidence)
      && ai.decisionsMinConfidence >= 0 && ai.decisionsMinConfidence <= 1 ? ai.decisionsMinConfidence : 0.8,
  };
}

const DECISIONS_CACHE_PREFIX = 'openAIDecisions:';
const SORTING_POLICY_VERSION = 'reply-intent-v2';
const COMPLETION_CACHE_PREFIX = `completion:${SORTING_POLICY_VERSION}:`;

export function sortingCompletionCacheKey(model: string): string {
  return `${COMPLETION_CACHE_PREFIX}${model}`;
}

export function sortingCacheKey(config: ReturnType<typeof sortingConfig>): string {
  return `${DECISIONS_CACHE_PREFIX}${SORTING_POLICY_VERSION}:${config.minConfidence}:${config.model}`;
}

export function sortingCacheMatches(model: string | null, config: ReturnType<typeof sortingConfig>): boolean {
  if (config.engine === 'openAIDecisions') return model === sortingCacheKey(config);
  return Boolean(model?.startsWith(COMPLETION_CACHE_PREFIX));
}
