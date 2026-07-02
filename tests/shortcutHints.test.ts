import { describe, it, expect } from 'vitest';
import {
  hintsForContext,
  resolveHintLayout,
  opensCommandPalette,
  ShortcutHint,
} from '../shared/shortcutHints';
import { ShortcutSettings } from '../shared/types';

// Default Swift defaults: superhuman mode, single-key on, palette on, vim off,
// compose/reminder shortcuts on.
const superhuman: ShortcutSettings = {
  mode: 'superhuman',
  singleKeyShortcuts: true,
  commandPaletteEnabled: true,
  vimNavigation: false,
  composeShortcutEnabled: true,
  reminderShortcutEnabled: true,
};

const appleMail: ShortcutSettings = {
  ...superhuman,
  mode: 'appleMail',
};

const gmail: ShortcutSettings = {
  ...superhuman,
  mode: 'gmail',
};

// Helper: collect "keys label" pairs for easy assertions.
const pairs = (hints: ShortcutHint[]) => hints.map((h) => `${h.keys} ${h.label}`);
const keysOf = (hints: ShortcutHint[]) => hints.map((h) => h.keys);

describe('hintsForContext — list', () => {
  it('uses single-key shortcuts in superhuman mode and includes vim + open + discovery', () => {
    const hints = hintsForContext('list', superhuman);
    expect(pairs(hints)).toEqual([
      'Z undo',
      'R reply',
      'A reply all',
      'F forward',
      'S summarize',
      'E done',
      'U read/unread',
      'C compose',
      '/ search',
      'G/⇧G mailbox',
      '⌘⇧P queue',
      '⌘J ask AI',
      'J/K move', // vim effective in superhuman mode
      '↩/O open', // list context (thread not open)
      '⌘K commands',
      '? shortcuts',
    ]);
  });

  it('uses combo shortcuts and no vim in appleMail mode', () => {
    const hints = hintsForContext('list', appleMail);
    expect(pairs(hints)).toEqual([
      '⌘Z undo',
      '⌘R reply',
      '⌘⇧R reply all',
      '⌘⇧F forward',
      '⌘⇧S summarize',
      '⌘⇧E done',
      '⌘⇧U read',
      '⌘N compose',
      '⌘F search',
      'G/⇧G mailbox',
      '⌘⇧P queue',
      '⌘J ask AI',
      // no J/K — vim is not effective when single-key shortcuts are disabled
      '↩ open',
      '⌘K commands',
    ]);
  });

  it('treats gmail mode as vim-effective even with vimNavigation off', () => {
    const hints = hintsForContext('list', gmail);
    expect(keysOf(hints)).toContain('J/K');
    expect(pairs(hints)).toContain('J/K move');
  });

  it('omits the commands hint when the command palette is disabled', () => {
    const hints = hintsForContext('list', { ...superhuman, commandPaletteEnabled: false });
    expect(keysOf(hints)).not.toContain('⌘K');
    expect(keysOf(hints)).toContain('?');
    expect(pairs(hints).some((p) => p.endsWith('commands'))).toBe(false);
  });

  it('falls back to ⌘N compose when the compose shortcut is disabled', () => {
    const hints = hintsForContext('list', { ...superhuman, composeShortcutEnabled: false });
    expect(pairs(hints)).toContain('⌘N compose');
    expect(pairs(hints)).not.toContain('C compose');
  });

  it('honors explicit vimNavigation in appleMail-with-singlekey-off (still off)', () => {
    // singleKeyShortcuts off => effectiveSingleKey false => vim never effective
    const hints = hintsForContext('list', {
      ...superhuman,
      singleKeyShortcuts: false,
      vimNavigation: true,
    });
    expect(keysOf(hints)).not.toContain('J/K');
  });
});

describe('hintsForContext — reader', () => {
  it('labels vim as next/prev and drops the open hint when a thread is open', () => {
    const hints = hintsForContext('reader', superhuman);
    expect(pairs(hints)).toContain('J/K next/prev');
    expect(pairs(hints)).not.toContain('J/K move');
    // open hint only appears in list (thread not open)
    expect(pairs(hints).some((p) => p.endsWith(' open'))).toBe(false);
  });
});

describe('hintsForContext — compose', () => {
  it('inserts the commands hint at index 3 (before discard)', () => {
    const hints = hintsForContext('compose', superhuman);
    expect(pairs(hints)).toEqual([
      '⌘↩/⌘⇧D send',
      '⌘⇧A attach',
      '⌘J ask AI',
      '⌘K commands',
      'esc discard',
    ]);
  });

  it('omits the commands hint when the palette is disabled', () => {
    const hints = hintsForContext('compose', { ...superhuman, commandPaletteEnabled: false });
    expect(pairs(hints)).toEqual([
      '⌘↩/⌘⇧D send',
      '⌘⇧A attach',
      '⌘J ask AI',
      'esc discard',
    ]);
  });
});

describe('hintsForContext — search', () => {
  it('produces single-key search hints in superhuman mode', () => {
    const hints = hintsForContext('search', superhuman);
    expect(pairs(hints)).toEqual([
      'esc close',
      '↩/O open',
      '⌘J ask AI',
      'J/K move',
      '⌘K commands',
      '? shortcuts',
    ]);
  });

  it('produces combo search hints in appleMail mode', () => {
    const hints = hintsForContext('search', appleMail);
    expect(pairs(hints)).toEqual([
      'esc close',
      '↩ open',
      '⌘J ask AI',
      '⌘K commands',
    ]);
  });
});

describe('resolveHintLayout', () => {
  it('returns all hints with no overflow when width is ample', () => {
    const hints = hintsForContext('list', superhuman);
    const layout = resolveHintLayout(hints, 100000);
    expect(layout.overflowCount).toBe(0);
    expect(layout.displayHints).toEqual(hints);
    expect(layout.displayHints.every((h) => !h.keys.startsWith('+'))).toBe(true);
  });

  it('never drops the protected command-palette hint and appends a +N more chip', () => {
    const hints = hintsForContext('list', superhuman);
    const layout = resolveHintLayout(hints, 0);
    // Only the priority-0 command-palette hint survives.
    expect(layout.displayHints).toHaveLength(2);
    const [survivor, overflow] = layout.displayHints;
    expect(survivor).toEqual({ keys: '⌘K', label: 'commands' });
    expect(overflow).toEqual({ keys: `+${hints.length - 1}`, label: 'more' });
    expect(layout.overflowCount).toBe(hints.length - 1);
  });

  it('drops the highest-priority hint first when one must be removed', () => {
    // Crafted hints with distinct priorities: command(0, protected),
    // mark done(100), reply(25). Full width ~272.7; at 250 exactly one drops.
    const hints: ShortcutHint[] = [
      { keys: '⌘K', label: 'command' },
      { keys: 'E', label: 'mark done' },
      { keys: 'R', label: 'reply' },
    ];
    const full = resolveHintLayout(hints, 100000);
    expect(full.overflowCount).toBe(0);

    const tight = resolveHintLayout(hints, 250);
    expect(tight.overflowCount).toBe(1);
    // 'mark done' (priority 100) is the one removed.
    const labels = tight.displayHints.map((h) => h.label);
    expect(labels).not.toContain('mark done');
    expect(tight.displayHints).toEqual([
      { keys: '⌘K', label: 'command' },
      { keys: 'R', label: 'reply' },
      { keys: '+1', label: 'more' },
    ]);
  });

  it('breaks priority ties by removing the highest index', () => {
    // Two wide default-priority (10) hints; protected command keeps the list
    // anchored. Width 300 sits in the window between the post-single-drop width
    // with the `+1 more` chip (~280.2) and the full width (~312.9), so exactly
    // one hint is removed and the tie-break (highest index) is observable.
    const hints: ShortcutHint[] = [
      { keys: '⌘K', label: 'command' },
      { keys: 'X', label: 'alphaaaaaa' },
      { keys: 'Y', label: 'betaaaaaaa' },
    ];
    const layout = resolveHintLayout(hints, 300);
    expect(layout.overflowCount).toBe(1);
    const remaining = layout.displayHints.map((h) => h.label);
    // The later one (index 2, 'betaaaaaaa') is removed per Swift's max(by:)
    // tie-break, which selects the highest index among equal priorities.
    expect(remaining).toContain('alphaaaaaa');
    expect(remaining).not.toContain('betaaaaaaa');
  });
});

describe('opensCommandPalette', () => {
  it('detects command-palette hints and the overflow chip', () => {
    expect(opensCommandPalette({ keys: '⌘K', label: 'command' })).toBe(true);
    expect(opensCommandPalette({ keys: '?', label: 'shortcuts' })).toBe(false);
    expect(opensCommandPalette({ keys: '⌘K', label: 'commands' })).toBe(true);
    expect(opensCommandPalette({ keys: '+3', label: 'more' })).toBe(true);
  });

  it('returns false for ordinary action hints', () => {
    expect(opensCommandPalette({ keys: 'R', label: 'reply' })).toBe(false);
    expect(opensCommandPalette({ keys: '⌘⇧P', label: 'queue' })).toBe(false);
  });
});
