// The unread number on the app icon follows each account's notification
// setting, and the service that shows it never overlaps its own refreshes.
import { describe, expect, it } from 'vitest';
import { createUnreadBadgeService, type UnreadBadgeDeps } from '../main/unreadBadge';
import { setAccountOverride, setSenderSections } from '../shared/accountSettings';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { accountBadgeCount, threadCountsTowardBadge, unreadBadgeEnabled, type BadgeSettingsSource } from '../shared/unreadBadge';
import type { MailThread } from '../shared/types';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;

function thread(key: string, isUnread = true): MailThread {
  const spec = WORK_INBOX.find(candidate => candidate.key === key);
  if (!spec) throw new Error(key);
  return { ...buildMailThreadFromMessages(accountEmail, key, fixtureMessages(spec))!, isUnread };
}

const person = thread('pilot-date');
const invite = thread('invite-weekly');
const security = thread('sso-signin');
const robot = thread('pr-482');
const newsletter = thread('dispatch-212');
const announcement = thread('deploy-freeze');
const all = [person, invite, security, robot, newsletter, announcement];

describe('what the badge counts', () => {
  const base: BadgeSettingsSource = { accountOverrides: {} };

  it('counts unread mail from people, invitations and security notices by default', () => {
    expect(accountBadgeCount(accountEmail, all, base)).toBe(3);
    const context = { accountEmail };
    expect(threadCountsTowardBadge(person, 'people', context)).toBe(true);
    expect(threadCountsTowardBadge(robot, 'people', context)).toBe(false);
    expect(threadCountsTowardBadge(newsletter, 'people', context)).toBe(false);
    expect(threadCountsTowardBadge(announcement, 'people', context)).toBe(false);
  });

  it('never counts read mail', () => {
    expect(accountBadgeCount(accountEmail, all.map(item => ({ ...item, isUnread: false })), base)).toBe(0);
    expect(threadCountsTowardBadge({ ...person, isUnread: false }, 'all', { accountEmail })).toBe(false);
  });

  it('follows the account\'s notification setting', () => {
    expect(accountBadgeCount(accountEmail, all, setAccountOverride(base, accountEmail, 'notifications', 'all'))).toBe(6);
    expect(accountBadgeCount(accountEmail, all, setAccountOverride(base, accountEmail, 'notifications', 'none'))).toBe(0);
    expect(accountBadgeCount(accountEmail.toUpperCase(), all, { accountDefaults: { notifications: 'all' } })).toBe(6);
  });

  it('counts a sender marked as a person, and not a person-like sender sorted elsewhere', () => {
    const marked = setSenderSections(base, accountEmail, [
      { id: 's1', senderEmail: robot.senderEmail, section: 'people', createdAt: '2026-10-01T00:00:00.000Z' },
      { id: 's2', senderEmail: person.senderEmail, section: 'clear', createdAt: '2026-10-01T00:00:00.000Z' },
    ]);
    // +robot, -person; the invitation from the same sender as `person` still counts.
    expect(accountBadgeCount(accountEmail, all, marked)).toBe(3);
    expect(accountBadgeCount(accountEmail, [robot], marked)).toBe(1);
    expect(accountBadgeCount(accountEmail, [person], marked)).toBe(0);
    expect(accountBadgeCount(accountEmail, [invite], marked)).toBe(1);
  });

  it('is on unless switched off', () => {
    expect(unreadBadgeEnabled(null)).toBe(true);
    expect(unreadBadgeEnabled({ general: {} })).toBe(true);
    expect(unreadBadgeEnabled({ general: { showUnreadBadge: false } })).toBe(false);
  });
});

describe('unread badge service', () => {
  function harness(partial: Partial<UnreadBadgeDeps> = {}) {
    const shown: number[] = [];
    const errors: string[] = [];
    const timers: Array<{ fn: () => void; cancelled: boolean }> = [];
    let settings: BadgeSettingsSource = { accountOverrides: {} };
    let threads: Record<string, MailThread[]> = { [accountEmail]: all, 'home@x.example': [{ ...person, accountId: 'home@x.example' }] };
    const reads: string[] = [];
    const service = createUnreadBadgeService({
      listAccountIds: () => Object.keys(threads),
      readSettings: () => settings,
      unreadInboxThreads: async accountId => { reads.push(accountId); return threads[accountId] || []; },
      setBadge: count => { shown.push(count); },
      logError: message => { errors.push(message); },
      now: () => new Date('2026-11-17T10:00:00.000Z'),
      setTimer: fn => { const timer = { fn, cancelled: false }; timers.push(timer); return timer; },
      clearTimer: handle => { (handle as { cancelled: boolean }).cancelled = true; },
      ...partial,
    });
    return {
      service, shown, errors, reads, timers,
      setSettings: (next: BadgeSettingsSource) => { settings = next; },
      setThreads: (next: Record<string, MailThread[]>) => { threads = next; },
      fire: () => { for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn(); },
    };
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 0));

  it('adds up the accounts and shows the number', async () => {
    const h = harness();
    await h.service.refresh();
    expect(h.shown).toEqual([4]);
    expect(h.service.shownCount()).toBe(4);
  });

  it('does not touch the icon when the number is unchanged', async () => {
    const h = harness();
    await h.service.refresh();
    await h.service.refresh();
    expect(h.shown).toEqual([4]);
    h.setThreads({ [accountEmail]: [person] });
    await h.service.refresh();
    expect(h.shown).toEqual([4, 1]);
  });

  it('clears the badge and reads nothing when switched off', async () => {
    const h = harness();
    await h.service.refresh();
    h.reads.length = 0;
    h.setSettings({ general: { showUnreadBadge: false } });
    await h.service.refresh();
    expect(h.shown).toEqual([4, 0]);
    expect(h.reads).toEqual([]);
  });

  it('collapses a burst of changes into one count', async () => {
    const h = harness();
    h.service.schedule();
    h.service.schedule();
    h.service.schedule();
    expect(h.timers.filter(timer => !timer.cancelled)).toHaveLength(1);
    h.fire();
    await settle();
    expect(h.shown).toEqual([4]);
    expect(h.reads).toHaveLength(2);
  });

  it('counts once more when a change arrives while it is counting', async () => {
    let release: (() => void) | null = null;
    let calls = 0;
    const h = harness({
      listAccountIds: () => [accountEmail],
      unreadInboxThreads: () => {
        calls += 1;
        if (calls === 1) return new Promise<MailThread[]>(resolve => { release = () => resolve(all); });
        return Promise.resolve([person]);
      },
    });
    const first = h.service.refresh();
    await settle();
    // Mail was read while the first count was in flight.
    const second = h.service.refresh();
    release!();
    await Promise.all([first, second]);
    expect(calls).toBe(2);
    expect(h.shown).toEqual([3, 1]);
  });

  it('keeps the last number and reports when counting fails, then recovers', async () => {
    let fail = true;
    const h = harness({
      listAccountIds: () => [accountEmail],
      unreadInboxThreads: async () => { if (fail) throw new Error('worker gone'); return all; },
    });
    await h.service.refresh();
    expect(h.shown).toEqual([]);
    expect(h.errors).toHaveLength(1);
    fail = false;
    await h.service.refresh();
    expect(h.shown).toEqual([3]);
  });

  it('tries again after the system refused the badge', async () => {
    let refuse = true;
    const shown: number[] = [];
    const h = harness({
      listAccountIds: () => [accountEmail],
      setBadge: count => { if (refuse) throw new Error('no dock'); shown.push(count); },
    });
    await h.service.refresh();
    expect(h.errors).toHaveLength(1);
    refuse = false;
    await h.service.refresh();
    expect(shown).toEqual([3]);
  });

  it('dispose cancels a scheduled refresh', async () => {
    const h = harness();
    h.service.schedule();
    h.service.dispose();
    h.fire();
    await settle();
    expect(h.shown).toEqual([]);
  });
});
