import { describe, expect, it } from 'vitest';
import { mailboxFocusAfterListUpdate, mailboxListScopeKey } from '../renderer/src/lib/mailboxFocus';
import { buildSectionListItems, itemIndexForThread, navigationThreads } from '../renderer/src/lib/inboxListItems';
import { decideByRules, groupThreadsByDecision } from '../shared/decision';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

describe('mailbox opening and focus', () => {
  it('does not scroll to the newest newsletter at the bottom of a sectioned inbox', () => {
    const threads = ['dispatch-212', 'pilot-date'].map(key => {
      const spec = WORK_INBOX.find(value => value.key === key);
      if (!spec) throw new Error('Missing fixture');
      const thread = buildMailThreadFromMessages(WORK_ACCOUNT.email, key, fixtureMessages(spec));
      if (!thread) throw new Error('Missing thread');
      return thread;
    });
    // The raw mailbox is chronological, but People precedes collapsed Clear.
    threads[0].lastMessageAt = '2026-11-14T12:00:00Z';
    threads[1].lastMessageAt = '2026-11-13T12:00:00Z';
    const entries = threads.map(thread => ({ thread, decision: decideByRules(thread, { accountEmail: WORK_ACCOUNT.email }) }));
    const items = buildSectionListItems(groupThreadsByDecision(entries, false));
    const visualOrder = navigationThreads(items);
    expect(threads[0].id).toBe('dispatch-212');
    expect(visualOrder[0].id).toBe('pilot-date');
    expect(itemIndexForThread(items, threads[0].id)).toBeGreaterThan(itemIndexForThread(items, visualOrder[0].id));
    // The section hook assigns visualOrder[0]; the mail store must leave it unset.
    expect(mailboxFocusAfterListUpdate(null, threads, 'inbox', '')).toBeNull();
    expect(mailboxFocusAfterListUpdate('previous-account-thread', threads, 'inbox', '')).toBeNull();
  });

  it('retains an explicitly focused row through sync and model reordering', () => {
    const threads = [{ id: 'new-mail' }, { id: 'focused' }, { id: 'older-mail' }];
    expect(mailboxFocusAfterListUpdate('focused', threads, 'inbox', '')).toBe('focused');
    expect(mailboxFocusAfterListUpdate('focused', threads.toReversed(), 'inbox', '')).toBe('focused');
  });

  it('keeps first-result keyboard navigation in flat mailboxes and search', () => {
    const threads = [{ id: 'first' }, { id: 'second' }];
    expect(mailboxFocusAfterListUpdate(null, threads, 'sent', '')).toBe('first');
    expect(mailboxFocusAfterListUpdate(null, threads, 'inbox', 'from:someone')).toBe('first');
    expect(mailboxFocusAfterListUpdate('removed', [], 'sent', '')).toBeNull();
  });

  it('gives accounts and folders separate viewports, without resetting for data updates', () => {
    const original = mailboxListScopeKey('personal', 'inbox');
    expect(mailboxListScopeKey('work', 'inbox')).not.toBe(original);
    expect(mailboxListScopeKey('personal', 'allMail')).not.toBe(original);
    expect(mailboxListScopeKey('personal', 'inbox')).toBe(original);
  });
});
