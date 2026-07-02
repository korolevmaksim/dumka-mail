// Pure, dependency-free command-palette fuzzy matcher.
//
// Ported from the macOS Swift original
// (`UI/CommandPalette/CommandPaletteController.swift`). The Swift version uses a
// "lowest-score-wins" scheme (0 == best match). This TypeScript port keeps the
// exact same match tiers (exact > prefix > word-prefix > ordered multi-word
// prefix > contains > subsequence) and field set (title, shortcut, subtitle,
// id, plus keywords) but inverts the scale so callers can rank with a simple
// "higher is better, <= 0 means no match" contract.
//
// It also preserves the Russian physical-keyboard remap: a user typing on a
// Cyrillic layout still matches Latin command text, because each Cyrillic
// character is translated to the US-QWERTY key in the same physical position.

export interface PaletteCommand {
  id: string;
  title: string;
  subtitle?: string;
  shortcut?: string;
  group: string;
  keywords?: string[];
}

export type RankedCommand<T extends PaletteCommand = PaletteCommand> = T & {
  score: number;
}

// Match tiers (higher == stronger match). Title prefix must outrank a
// word-prefix, which must outrank a loose subsequence — see the signature
// contract for `fuzzyScore`.
const TIER = {
  exact: 100,
  prefix: 80,
  wordPrefix: 60,
  contains: 40,
  subsequence: 20,
} as const;

// Per-field weights. Title is authoritative; keywords are nearly as strong;
// subtitle/shortcut/id are progressively weaker hints. Mirrors the Swift field
// ordering (title strongest, id weakest), expressed as multipliers instead of
// additive penalties.
const FIELD = {
  title: 1,
  keywords: 0.9,
  subtitle: 0.6,
  shortcut: 0.45,
  id: 0.4,
} as const;

// 33-entry Cyrillic -> Latin physical-key map, identical to
// `russianPhysicalKeyMap` in the Swift controller. Keys are lowercase Cyrillic
// scalars; values are the Latin character on the same US-QWERTY physical key.
const RUSSIAN_PHYSICAL_KEY_MAP: Record<string, string> = {
  'й': 'q', 'ц': 'w', 'у': 'e', 'к': 'r', 'е': 't',
  'н': 'y', 'г': 'u', 'ш': 'i', 'щ': 'o', 'з': 'p',
  'ф': 'a', 'ы': 's', 'в': 'd', 'а': 'f', 'п': 'g',
  'р': 'h', 'о': 'j', 'л': 'k', 'д': 'l', 'я': 'z',
  'ч': 'x', 'с': 'c', 'м': 'v', 'и': 'b', 'т': 'n',
  'ь': 'm', 'ё': '`', 'х': '[', 'ъ': ']', 'ж': ';',
  'э': "'", 'б': ',', 'ю': '.',
};

/**
 * Translate Cyrillic-layout characters to their QWERTY-equivalent Latin
 * characters, so a query typed on a Russian keyboard layout still matches
 * Latin command text. Characters with no mapping are passed through unchanged.
 * Casing is preserved for letters (an uppercase Cyrillic char maps to the
 * uppercase Latin equivalent).
 */
export function remapCyrillicToLatin(s: string): string {
  let output = '';
  for (const character of s) {
    const lower = character.toLowerCase();
    const mapped = RUSSIAN_PHYSICAL_KEY_MAP[lower];
    if (mapped !== undefined) {
      output += character === lower ? mapped : mapped.toUpperCase();
    } else {
      output += character;
    }
  }
  return output;
}

/**
 * Score how well `query` matches `command`. Higher is a better match; a value
 * `<= 0` means no match at all. An empty (or whitespace-only) query returns 0.
 *
 * Weighting honors: title prefix > title word-prefix > title subsequence, and
 * the command's `keywords` participate in matching. Both the raw query and its
 * Cyrillic->Latin remap are considered, and the best (highest) score wins.
 */
export function fuzzyScore(query: string, command: PaletteCommand): number {
  const normalized = query.trim().toLowerCase();
  if (normalized.length === 0) {
    return 0;
  }
  let best = 0;
  for (const variant of queryVariants(normalized)) {
    best = Math.max(best, scoreForVariant(variant, command));
  }
  return best;
}

/**
 * Rank `commands` against `query`. Commands with a positive score are kept and
 * sorted by descending score; ties preserve the original input order (stable).
 * An empty (or whitespace-only) query keeps the original order unfiltered, with
 * every command assigned a score of 0.
 */
export function rankCommands<T extends PaletteCommand>(query: string, commands: T[]): RankedCommand<T>[] {
  if (query.trim().length === 0) {
    return commands.map((command) => ({ ...command, score: 0 }));
  }
  return commands
    .map((command, index) => ({ command, index, score: fuzzyScore(query, command) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map((entry) => ({ ...entry.command, score: entry.score }));
}

// --- internal helpers -------------------------------------------------------

function queryVariants(normalizedQuery: string): string[] {
  const variants = [normalizedQuery];
  const remapped = remapCyrillicToLatin(normalizedQuery);
  if (remapped !== normalizedQuery) {
    variants.push(remapped);
  }
  return variants;
}

function scoreForVariant(query: string, command: PaletteCommand): number {
  let best = 0;
  best = Math.max(best, fieldTier(command.title, query) * FIELD.title);
  if (command.keywords) {
    for (const keyword of command.keywords) {
      best = Math.max(best, fieldTier(keyword, query) * FIELD.keywords);
    }
  }
  if (command.subtitle) {
    best = Math.max(best, fieldTier(command.subtitle, query) * FIELD.subtitle);
  }
  if (command.shortcut) {
    best = Math.max(best, fieldTier(command.shortcut, query) * FIELD.shortcut);
  }
  best = Math.max(best, fieldTier(command.id, query) * FIELD.id);
  return best;
}

// Best match tier of `query` against a single field's text. Returns 0 when the
// text does not match at all.
function fieldTier(rawText: string, query: string): number {
  const text = rawText.toLowerCase();
  if (text.length === 0) {
    return 0;
  }
  if (text === query) {
    return TIER.exact;
  }
  if (text.startsWith(query)) {
    return TIER.prefix;
  }
  if (matchesWordPrefix(text, query)) {
    return TIER.wordPrefix;
  }
  if (text.includes(query)) {
    return TIER.contains;
  }
  if (isSubsequence(query, text)) {
    return TIER.subsequence;
  }
  return 0;
}

function matchesWordPrefix(text: string, query: string): boolean {
  const textWords = words(text);
  if (textWords.some((word) => word.startsWith(query))) {
    return true;
  }
  // Ordered multi-word prefixes, e.g. "ma do" matches "Mark Done".
  if (query.includes(' ')) {
    return containsOrderedWordPrefixes(words(query), textWords);
  }
  return false;
}

function containsOrderedWordPrefixes(queryWords: string[], textWords: string[]): boolean {
  if (queryWords.length === 0) {
    return false;
  }
  let textIndex = 0;
  for (const queryWord of queryWords) {
    let matched = -1;
    for (let i = textIndex; i < textWords.length; i += 1) {
      if (textWords[i].startsWith(queryWord)) {
        matched = i;
        break;
      }
    }
    if (matched === -1) {
      return false;
    }
    textIndex = matched + 1;
  }
  return true;
}

// Split on any non-alphanumeric character, dropping empties — mirrors the
// Swift `words(in:)` helper (alphanumerics-inverted separator set).
function words(text: string): string[] {
  return text.split(/[^a-z0-9]+/i).filter((word) => word.length > 0);
}

// True when every character of `query` appears in `text` in order (a loose
// fuzzy subsequence). Whitespace in the query is ignored.
function isSubsequence(query: string, text: string): boolean {
  let queryIndex = 0;
  const compact = query.replace(/\s+/g, '');
  if (compact.length === 0) {
    return false;
  }
  for (let i = 0; i < text.length && queryIndex < compact.length; i += 1) {
    if (text[i] === compact[queryIndex]) {
      queryIndex += 1;
    }
  }
  return queryIndex === compact.length;
}
