import type { AppSettings } from '../shared/types';

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(stableValue);
  }
  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, entryValue]) => entryValue !== undefined)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entryValue]) => [key, stableValue(entryValue)]),
  );
}

function runtimeSettingsFragment(settings: Partial<AppSettings> | null | undefined) {
  return {
    mcpServers: settings?.mcpServers || [],
    searchProviders: settings?.searchProviders || {},
  };
}

export function parseStoredAppSettings(value: string | null | undefined): Partial<AppSettings> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Partial<AppSettings> : null;
  } catch {
    return null;
  }
}

export function settingsAffectMCPRuntime(
  previous: Partial<AppSettings> | null | undefined,
  next: Partial<AppSettings> | null | undefined,
): boolean {
  if (!previous) return true;
  return JSON.stringify(stableValue(runtimeSettingsFragment(previous)))
    !== JSON.stringify(stableValue(runtimeSettingsFragment(next)));
}

function includeBodiesInSearchIndex(settings: Partial<AppSettings> | null | undefined): boolean {
  return settings?.privacy?.includeBodiesInSearchIndex !== false;
}

export function settingsAffectSearchBodyIndexing(
  previous: Partial<AppSettings> | null | undefined,
  next: Partial<AppSettings> | null | undefined,
): boolean {
  if (!previous) return true;
  return includeBodiesInSearchIndex(previous) !== includeBodiesInSearchIndex(next);
}
