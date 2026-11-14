import { describe, expect, it } from 'vitest';
import { MAILBOX_VIEW_ORDER, nextMailboxView } from '../shared/mailboxNavigation';

describe('mailbox navigation', () => {
  it('keeps the mailbox switcher order stable', () => {
    expect(MAILBOX_VIEW_ORDER).toEqual(['inbox', 'later', 'waiting', 'drafts', 'sent', 'allMail', 'trash', 'spam', 'muted']);
  });

  it('cycles forward and backward through mailbox views', () => {
    expect(nextMailboxView('inbox')).toBe('later');
    expect(nextMailboxView('drafts')).toBe('sent');
    expect(nextMailboxView('sent')).toBe('allMail');
    expect(nextMailboxView('muted')).toBe('inbox');
    expect(nextMailboxView('inbox', -1)).toBe('muted');
    expect(nextMailboxView('trash', -1)).toBe('allMail');
  });
});
