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

export function sortingCacheKey(config: ReturnType<typeof sortingConfig>): string {
  return `${DECISIONS_CACHE_PREFIX}${config.minConfidence}:${config.model}`;
}

export function sortingCacheMatches(model: string | null, config: ReturnType<typeof sortingConfig>): boolean {
  if (config.engine === 'openAIDecisions') return model === sortingCacheKey(config);
  return !model?.startsWith(DECISIONS_CACHE_PREFIX);
}
