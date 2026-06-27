import { describe, it, expect } from 'vitest';
import {
  fuzzyScore,
  rankCommands,
  remapCyrillicToLatin,
  PaletteCommand,
} from '../shared/commandPalette';

function cmd(partial: Partial<PaletteCommand> & { id: string; title: string }): PaletteCommand {
  return { group: 'general', ...partial };
}

const compose = cmd({ id: 'compose', title: 'Compose', subtitle: 'Start a new draft', shortcut: '⌘N / C' });
const search = cmd({ id: 'search', title: 'Search', subtitle: 'Filter current account', shortcut: '⌘F / /' });
const markDone = cmd({ id: 'done', title: 'Mark Done', subtitle: 'Archive selected thread', shortcut: '⌘⇧E / E' });
const markRead = cmd({ id: 'read', title: 'Mark Read', subtitle: 'Remove unread state', shortcut: '⌘⇧U' });
const replyAll = cmd({ id: 'reply-all', title: 'Reply All', subtitle: 'Reply to the thread recipients', shortcut: '⌘⇧R / A' });
const settings = cmd({ id: 'settings', title: 'Settings', subtitle: 'Open app settings', shortcut: '⌘,', keywords: ['preferences', 'config'] });

const catalog = [compose, search, markDone, markRead, replyAll, settings];

describe('remapCyrillicToLatin', () => {
  it('maps Cyrillic-layout chars to QWERTY-equivalent Latin', () => {
    // Typing "search" physically on a RU layout produces "ыуфкср".
    expect(remapCyrillicToLatin('ыуфкср')).toBe('search');
    // "settings" -> "ыуеештпы"
    expect(remapCyrillicToLatin('ыуеештпы')).toBe('settings');
  });

  it('preserves non-mapped characters unchanged', () => {
    expect(remapCyrillicToLatin('hello world')).toBe('hello world');
    expect(remapCyrillicToLatin('compose-123')).toBe('compose-123');
  });

  it('preserves casing for letters', () => {
    expect(remapCyrillicToLatin('Й')).toBe('Q');
    expect(remapCyrillicToLatin('й')).toBe('q');
  });

  it('maps the symbol-producing keys', () => {
    expect(remapCyrillicToLatin('ё')).toBe('`');
    expect(remapCyrillicToLatin('х')).toBe('[');
    expect(remapCyrillicToLatin('ъ')).toBe(']');
    expect(remapCyrillicToLatin('ж')).toBe(';');
    expect(remapCyrillicToLatin('э')).toBe("'");
    expect(remapCyrillicToLatin('б')).toBe(',');
    expect(remapCyrillicToLatin('ю')).toBe('.');
  });
});

describe('fuzzyScore', () => {
  it('returns 0 for an empty or whitespace query', () => {
    expect(fuzzyScore('', compose)).toBe(0);
    expect(fuzzyScore('   ', compose)).toBe(0);
  });

  it('returns a positive score for a matching query', () => {
    expect(fuzzyScore('comp', compose)).toBeGreaterThan(0);
  });

  it('returns 0 (no match) when nothing matches', () => {
    const c = cmd({ id: 'compose', title: 'Compose', subtitle: 'Start' });
    expect(fuzzyScore('zzzqqq', c)).toBe(0);
  });

  it('is case-insensitive', () => {
    expect(fuzzyScore('COMP', compose)).toBe(fuzzyScore('comp', compose));
  });

  it('scores an exact title match higher than a prefix match', () => {
    const exact = fuzzyScore('compose', compose);
    const prefix = fuzzyScore('comp', compose);
    expect(exact).toBeGreaterThan(prefix);
  });

  it('scores a title prefix higher than a word-prefix', () => {
    // "done" is a prefix of the second word of "Mark Done" (word-prefix),
    // while "mark" is a prefix of the whole title.
    const titlePrefix = fuzzyScore('mark', markDone);
    const wordPrefix = fuzzyScore('done', markDone);
    expect(titlePrefix).toBeGreaterThan(wordPrefix);
  });

  it('scores a word-prefix higher than a loose subsequence', () => {
    // "rec" is a word-prefix of "recipients" in the subtitle... use title-level
    // comparison instead: "all" is a word-prefix of "Reply All".
    const wordPrefix = fuzzyScore('all', replyAll);
    // "rpyl" is a subsequence of "reply all" but not a prefix/word-prefix.
    const subseq = fuzzyScore('rpyl', replyAll);
    expect(wordPrefix).toBeGreaterThan(subseq);
    expect(subseq).toBeGreaterThan(0);
  });

  it('matches ordered multi-word prefixes ("ma do" -> "Mark Done")', () => {
    expect(fuzzyScore('ma do', markDone)).toBeGreaterThan(0);
    // Reversed order should not match as ordered word prefixes.
    expect(fuzzyScore('do ma', markDone)).toBe(0);
  });

  it('matches via keywords', () => {
    expect(fuzzyScore('preferences', settings)).toBeGreaterThan(0);
    expect(fuzzyScore('config', settings)).toBeGreaterThan(0);
  });

  it('weights a title match above a subtitle-only match', () => {
    // "search" matches the title of `search` and the subtitle of nothing here;
    // craft a command whose subtitle contains the query but title does not.
    const subtitleOnly = cmd({ id: 'x', title: 'Compose', subtitle: 'search the archive' });
    expect(fuzzyScore('compose', compose)).toBeGreaterThan(fuzzyScore('search', subtitleOnly));
  });

  it('matches via a Cyrillic-layout query', () => {
    // "ыуфкср" is "search" typed on a RU physical layout.
    expect(fuzzyScore('ыуфкср', search)).toBeGreaterThan(0);
    expect(fuzzyScore('ыуфкср', search)).toBe(fuzzyScore('search', search));
  });
});

describe('rankCommands', () => {
  it('keeps the original order for an empty query', () => {
    const ranked = rankCommands('', catalog);
    expect(ranked.map((c) => c.id)).toEqual(catalog.map((c) => c.id));
    expect(ranked.every((c) => c.score === 0)).toBe(true);
  });

  it('keeps the original order for a whitespace-only query', () => {
    const ranked = rankCommands('   ', catalog);
    expect(ranked.map((c) => c.id)).toEqual(catalog.map((c) => c.id));
  });

  it('filters out commands with no match', () => {
    const ranked = rankCommands('compose', catalog);
    expect(ranked.map((c) => c.id)).toContain('compose');
    expect(ranked.every((c) => c.score > 0)).toBe(true);
  });

  it('sorts by descending score', () => {
    const ranked = rankCommands('mark', catalog);
    for (let i = 1; i < ranked.length; i += 1) {
      expect(ranked[i - 1].score).toBeGreaterThanOrEqual(ranked[i].score);
    }
  });

  it('ranks an exact/prefix title match first', () => {
    const ranked = rankCommands('comp', catalog);
    expect(ranked[0].id).toBe('compose');
  });

  it('breaks score ties by original input order (stable)', () => {
    // Both "Mark Done" and "Mark Read" prefix-match "mark" with equal title
    // weight; `done` precedes `read` in the catalog, so it must come first.
    const ranked = rankCommands('mark', catalog);
    const markIds = ranked.filter((c) => c.id === 'done' || c.id === 'read').map((c) => c.id);
    expect(markIds).toEqual(['done', 'read']);
  });

  it('returns empty for a query that matches nothing', () => {
    expect(rankCommands('zzqqxx', catalog)).toEqual([]);
  });

  it('attaches the score to each ranked command', () => {
    const ranked = rankCommands('search', catalog);
    expect(ranked[0]).toMatchObject({ id: 'search' });
    expect(typeof ranked[0].score).toBe('number');
  });
});
