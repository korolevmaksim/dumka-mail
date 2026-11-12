// Linear building blocks for scanning raw, untrusted mail HTML.
//
// Whole-document regexes with an unbounded `[^>]*` / `[^>]+` (or two adjacent
// `\s*`) are quadratic on adversarial input such as `'<img '.repeat(n)`:
// every start position scans to the end of the document. The scanners in
// `shared/` and the renderer use these helpers instead, so each character is
// visited a bounded number of times. Pure: no DOM, Node or React.

/**
 * Mail HTML larger than this is not inspected by heuristics that only pick a
 * presentation (own canvas, remote-image banner, HTML vs. plain body). Each
 * caller documents its fail-safe answer beyond the cap. Transformations that
 * protect the user (tracking-pixel stripping) are linear and never skip.
 */
export const MAIL_HTML_SCAN_LIMIT = 200 * 1024;

/**
 * `from => first index >= from of needle` with a one-entry cache. Exact for
 * any query; amortised linear when queries move forward (the scanners only
 * ever ask with increasing positions, so no stretch is searched twice).
 */
export function createForwardFinder(source: string, needle: string): (from: number) => number {
  let queriedFrom = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from: number) => {
    if (from >= queriedFrom && (found === -1 || found >= from)) return found;
    queriedFrom = from;
    found = source.indexOf(needle, from);
    return found;
  };
}

/**
 * Same as `createForwardFinder` for a case-insensitive literal (e.g. `</style>`),
 * using a sticky-free global regex so indices refer to `source` itself (a
 * lower-cased copy can change length for some Unicode characters).
 */
export function createForwardRegexFinder(source: string, literal: string): (from: number) => number {
  const escaped = literal.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const pattern = new RegExp(escaped, 'gi');
  let queriedFrom = Number.POSITIVE_INFINITY;
  let found = -1;
  return (from: number) => {
    if (from >= queriedFrom && (found === -1 || found >= from)) return found;
    queriedFrom = from;
    pattern.lastIndex = from;
    const match = pattern.exec(source);
    found = match ? match.index : -1;
    return found;
  };
}

/** Index after the run of ASCII/Unicode whitespace (as `\s`) starting at `from`. */
export function skipWhitespace(source: string, from: number): number {
  let index = from;
  while (index < source.length && /\s/.test(source[index])) index += 1;
  return index;
}

/**
 * Replace every `<…>` tag (`/<[^>]+>/g` semantics: at least one character,
 * ending at the first `>`, `<` allowed inside) using `replacement`. Linear.
 */
export function replaceAngleTags(source: string, replacement: string): string {
  let out = '';
  let last = 0;
  let cursor = 0;
  while (cursor < source.length) {
    const open = source.indexOf('<', cursor);
    if (open === -1) break;
    const close = source.indexOf('>', open + 1);
    // No `>` after this `<`: no later `<` has one either.
    if (close === -1) break;
    if (close === open + 1) {
      // `<>`: `[^>]+` needs at least one character; try the next `<`.
      cursor = open + 1;
      continue;
    }
    out += source.slice(last, open) + replacement;
    last = close + 1;
    cursor = close + 1;
  }
  return last === 0 ? source : out + source.slice(last);
}
