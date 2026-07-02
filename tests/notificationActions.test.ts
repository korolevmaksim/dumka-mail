import { describe, expect, it } from 'vitest';
import {
  nextMorningIso,
  notificationActionAt,
  notificationActionsFor,
} from '../shared/notificationActions';

describe('notification actions', () => {
  it('maps new mail notification button positions to mailbox actions', () => {
    expect(notificationActionsFor('newMail').map(action => action.id)).toEqual([
      'archive',
      'markRead',
      'open',
    ]);
    expect(notificationActionAt('newMail', 0)?.title).toBe('Done');
    expect(notificationActionAt('newMail', 1)?.id).toBe('markRead');
    expect(notificationActionAt('newMail', 2)?.id).toBe('open');
  });

  it('maps reminder notification button positions to reminder actions', () => {
    expect(notificationActionsFor('reminder').map(action => action.id)).toEqual([
      'snoozeTomorrow',
      'clearReminder',
      'open',
    ]);
    expect(notificationActionAt('reminder', 0)?.title).toBe('Tomorrow');
    expect(notificationActionAt('reminder', 1)?.id).toBe('clearReminder');
    expect(notificationActionAt('reminder', 2)?.id).toBe('open');
  });

  it('ignores unknown notification button indexes', () => {
    expect(notificationActionAt('newMail', -1)).toBeNull();
    expect(notificationActionAt('newMail', 99)).toBeNull();
  });

  it('sets reminder snooze to the next local morning', () => {
    const now = new Date(2026, 6, 2, 15, 30, 0, 0);
    const snoozedAt = new Date(nextMorningIso(now));

    expect(snoozedAt.getFullYear()).toBe(2026);
    expect(snoozedAt.getMonth()).toBe(6);
    expect(snoozedAt.getDate()).toBe(3);
    expect(snoozedAt.getHours()).toBe(9);
    expect(snoozedAt.getMinutes()).toBe(0);
    expect(snoozedAt.getSeconds()).toBe(0);
  });
});
