import { describe, expect, it } from 'vitest';
import { mailboxEmptyCopy } from '../shared/mailboxEmptyCopy';
import type { ShortcutSettings } from '../shared/types';

const superhuman: ShortcutSettings = {
  mode: 'superhuman',
  singleKeyShortcuts: true,
  commandPaletteEnabled: true,
  vimNavigation: false,
  composeShortcutEnabled: true,
  reminderShortcutEnabled: true,
};

describe('mailboxEmptyCopy', () => {
  it('keeps mailbox-specific copy when there is no search', () => {
    expect(mailboxEmptyCopy('inbox', '')).toMatchObject({
      title: 'Clear inbox split',
      action: 'none',
    });
    expect(mailboxEmptyCopy('drafts', '   ')).toMatchObject({
      title: 'No saved drafts',
      action: 'none',
    });
  });

  it('advertises the bound compose shortcut for an empty inbox', () => {
    expect(mailboxEmptyCopy('inbox', '', superhuman).body).toBe(
      'Jump to other splits or press ⌘N / C to compose.',
    );
    expect(mailboxEmptyCopy('inbox', '', { ...superhuman, mode: 'appleMail' }).body).toBe(
      'Jump to other splits or press ⌘N to compose.',
    );
  });

  it('uses a search empty state with a clear-search action', () => {
    expect(mailboxEmptyCopy('inbox', 'from:ada')).toEqual({
      title: 'No matching conversations',
      body: 'Nothing in this mailbox matches “from:ada”.',
      action: 'clearSearch',
    });
  });
});
