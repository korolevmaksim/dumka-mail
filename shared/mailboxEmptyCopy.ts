import { keymapShortcut } from './appKeymap';
import type { MailboxView, ShortcutSettings } from './types';

export interface MailboxEmptyCopy {
  title: string;
  body: string;
  action: 'none' | 'clearSearch';
  /** True while the first sync of an account in scope is still running. */
  busy?: boolean;
}

export const FETCHING_INBOX_EMPTY_COPY: MailboxEmptyCopy = {
  title: 'Fetching inbox…',
  body: 'Your newest conversations appear here as they arrive from Gmail.',
  action: 'none',
  busy: true,
};

const MAILBOX_EMPTY: Record<MailboxView, { title: string; body: string }> = {
  inbox: {
    title: 'Inbox is clear',
    body: 'New conversations appear here as they arrive.',
  },
  later: {
    title: 'Nothing in Later',
    body: 'Conversations you remind yourself about wait here until their time.',
  },
  waiting: {
    title: 'Nothing waiting',
    body: 'Conversations you answered and are waiting to hear back on appear here.',
  },
  drafts: {
    title: 'No saved drafts',
    body: 'Unsent compose drafts appear here when draft restore is enabled.',
  },
  sent: {
    title: 'No sent conversations',
    body: 'Recent sent mail appears here after sync.',
  },
  allMail: {
    title: 'No cached mail',
    body: 'Every conversation outside Trash and Spam appears here after sync.',
  },
  trash: {
    title: 'Trash is empty',
    body: 'Deleted conversations appear here while they are cached locally.',
  },
  spam: {
    title: 'Spam is empty',
    body: 'Reported spam appears here while it is cached locally.',
  },
  muted: {
    title: 'No muted conversations',
    body: 'Ignored threads appear here when they carry the Dumka muted label.',
  },
};

export function mailboxEmptyCopy(
  mailboxId: MailboxView,
  searchQuery: string,
  settings?: ShortcutSettings,
  options: { fetchingInbox?: boolean } = {},
): MailboxEmptyCopy {
  // Never claim an empty ("Inbox is clear") mailbox before the first sync.
  if (options.fetchingInbox && !searchQuery.trim()) {
    return { ...FETCHING_INBOX_EMPTY_COPY };
  }
  if (searchQuery.trim()) {
    return {
      title: 'No matching conversations',
      body: `Nothing in this mailbox matches “${searchQuery.trim()}”.`,
      action: 'clearSearch',
    };
  }
  const copy = MAILBOX_EMPTY[mailboxId];
  if (mailboxId !== 'inbox') {
    return { title: copy.title, body: copy.body, action: 'none' };
  }
  const composeKeys = settings ? keymapShortcut('compose', settings) : undefined;
  return {
    title: copy.title,
    body: composeKeys
      ? `New conversations appear here as they arrive. Press ${composeKeys} to compose.`
      : copy.body,
    action: 'none',
  };
}
