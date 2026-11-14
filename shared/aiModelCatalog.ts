// How a provider's own model list is shown in the settings picker.
//
// No model id is built into the app: ids go stale within months. The models
// offered are the ones the provider returns for the user's key (`GET /models`),
// and the model in use is whatever the user chose and saved in settings.
// This module only filters and orders that list.

const NON_TEXT_MODEL = /(embed|whisper|tts|audio|speech|transcri|realtime|image|imagen|dall-e|sora|veo|video|moderation|computer-use|deep-research|robotics|aqa|guard|rerank|-live\b|search-preview)/i;

/** False for embedding, audio, image and other models that cannot sort or write mail. */
export function isTextModelId(id: string): boolean {
  const trimmed = id.trim();
  return trimmed.length > 0 && !NON_TEXT_MODEL.test(trimmed);
}

/** An alias is served when the list has it or a dated snapshot of it (`…-20261001`, `…-2026-10-01`). */
function catalogServes(catalog: readonly string[], model: string): boolean {
  const prefix = `${model}-`;
  return catalog.some(id => id === model || (id.startsWith(prefix) && /^(\d{6,8}|\d{4}-\d{2}-\d{2})$/.test(id.slice(prefix.length))));
}

/**
 * The version an id starts with: `name-6.1-x` → [6, 1], `name-5-5` → [5, 5],
 * `name-6-x` → [6]. Dates, snapshots and preview suffixes are not part of it
 * (`name-2.5-x-preview-05-20` → [2, 5], `name-5-2025-08-07` → [5]).
 */
function versionOf(id: string): number[] {
  const match = /(?<![\d.])(\d{1,2})(?:[.-](\d{1,2})(?!\d))?(?!\d)/.exec(id);
  if (!match) return [];
  return match[2] === undefined ? [Number(match[1])] : [Number(match[1]), Number(match[2])];
}

/** Newest version first, then by name. Ids without a version number go last. */
export function compareModelIdsNewestFirst(a: string, b: string): number {
  const left = versionOf(a);
  const right = versionOf(b);
  if (left.length === 0 || right.length === 0) {
    if (left.length !== right.length) return left.length === 0 ? 1 : -1;
    return a.localeCompare(b);
  }
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const difference = (right[index] ?? 0) - (left[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return a.localeCompare(b);
}

export interface ModelChoices {
  /** The provider's text models, newest first. */
  models: string[];
  /** True when the provider's list is loaded and does not contain `current`. */
  currentMissing: boolean;
}

/** What the model picker shows for a provider's (possibly empty) loaded list. */
export function buildModelChoices(catalog: readonly string[], current = ''): ModelChoices {
  const models = Array.from(new Set(catalog.map(id => id.trim()).filter(isTextModelId))).sort(compareModelIdsNewestFirst);
  const value = current.trim();
  const listed = !value || models.includes(value) || catalogServes(catalog, value);
  return { models, currentMissing: catalog.length > 0 && !listed };
}
