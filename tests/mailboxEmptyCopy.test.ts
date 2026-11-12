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
      title: 'Inbox is clear',
      action: 'none',
    });
    expect(mailboxEmptyCopy('drafts', '   ')).toMatchObject({
      title: 'No saved drafts',
      action: 'none',
    });
  });

  it('advertises the bound compose shortcut for an empty inbox', () => {
    expect(mailboxEmptyCopy('inbox', '', superhuman).body).toBe(
      'New conversations appear here as they arrive. Press ⌘N / C to compose.',
    );
    expect(mailboxEmptyCopy('inbox', '', { ...superhuman, mode: 'appleMail' }).body).toBe(
      'New conversations appear here as they arrive. Press ⌘N to compose.',
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

describe('mailboxEmptyCopy while the first sync runs', () => {
  it('shows Fetching inbox… instead of an empty-inbox message', () => {
    const copy = mailboxEmptyCopy('inbox', '', undefined, { fetchingInbox: true });
    expect(copy.title).toBe('Fetching inbox…');
    expect(copy.busy).toBe(true);
    expect(copy.title).not.toBe('Inbox is clear');
  });

  it('keeps the normal copy once the first sync completed, and search copy always', () => {
    expect(mailboxEmptyCopy('inbox', '', undefined, { fetchingInbox: false }).title).toBe('Inbox is clear');
    expect(mailboxEmptyCopy('inbox', 'invoice', undefined, { fetchingInbox: true }).action).toBe('clearSearch');
  });
});
