import { keymapShortcut } from './appKeymap';
import type { MailboxView, ShortcutSettings } from './types';

export interface MailboxEmptyCopy {
  title: string;
  body: string;
  action: 'none' | 'clearSearch';
}

const MAILBOX_EMPTY: Record<MailboxView, { title: string; body: string }> = {
  inbox: {
    title: 'Clear inbox split',
    body: 'Jump to other splits or compose a message.',
  },
  drafts: {
    title: 'No saved drafts',
    body: 'Unsent compose drafts appear here when draft restore is enabled.',
  },
  sent: {
    title: 'No sent conversations',
    body: 'Recent sent mail appears here after sync.',
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
): MailboxEmptyCopy {
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
      ? `Jump to other splits or press ${composeKeys} to compose.`
      : copy.body,
    action: 'none',
  };
}
