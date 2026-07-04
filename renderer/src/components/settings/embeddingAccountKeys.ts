/**
 * Pure helpers for per-account embedding settings keyed by account email.
 * Stored maps may contain legacy key variants (mixed case, stray whitespace);
 * these helpers keep the panel's read/write semantics aligned with the
 * main-process resolution in readAgentSettings (main/agentic.ts).
 */

/** Canonical form of an account key: trimmed and lowercased. */
export function normalizeAccountKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Finds a per-account entry under any key variant: the exact normalized key
 * first, then a trim().toLowerCase() scan of existing keys. Mirrors the
 * read-side semantics of readAgentSettings in main/agentic.ts so the panel
 * displays what the main process resolves.
 */
export function resolveAccountEntry<T>(map: Record<string, T> | undefined, accountKey: string): T | undefined {
  if (!map || !accountKey) return undefined;
  if (accountKey in map) return map[accountKey];
  const variant = Object.keys(map).find(key => normalizeAccountKey(key) === accountKey);
  return variant === undefined ? undefined : map[variant];
}

/**
 * Removes stale key variants that normalize to the same account key so
 * stored settings converge on the canonical (trimmed, lowercased) key.
 * Without this, main's insertion-order key scan would keep resolving an
 * old variant entry and shadow newly written canonical values.
 */
export function pruneAccountKeyVariants<T>(map: Record<string, T>, accountKey: string): void {
  for (const key of Object.keys(map)) {
    if (key !== accountKey && normalizeAccountKey(key) === accountKey) {
      delete map[key];
    }
  }
}
