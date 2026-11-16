import { describe, expect, it } from 'vitest';
import { describeLoginItem, LOGIN_ITEM_DESCRIPTION } from '../shared/loginItem';
import {
  HELD_SCHEDULED_SENDS_MAX,
  LATE_SCHEDULED_SEND_GRACE_MS,
  heldScheduledSendFailure,
  heldScheduledSendMessage,
  holdsLateScheduledSends,
  lateScheduledSendAt,
  normalizeHeldScheduledSends,
} from '../shared/scheduledSend';

const NOW = new Date('2026-11-17T14:00:00.000Z');

describe('a scheduled message that is late', () => {
  it('is late only once it is past the grace period', () => {
    expect(lateScheduledSendAt({ sendAt: '2026-11-17T09:00:00.000Z' }, NOW)).toBe('2026-11-17T09:00:00.000Z');
    expect(lateScheduledSendAt({ sendAt: '2026-11-17T13:45:00.000Z' }, NOW)).toBeNull();
    const edge = new Date(NOW.getTime() - LATE_SCHEDULED_SEND_GRACE_MS).toISOString();
    expect(lateScheduledSendAt({ sendAt: edge }, NOW)).toBeNull();
    expect(lateScheduledSendAt({ sendAt: new Date(NOW.getTime() - LATE_SCHEDULED_SEND_GRACE_MS - 1).toISOString() }, NOW)).not.toBeNull();
    // Not due yet.
    expect(lateScheduledSendAt({ sendAt: '2026-11-18T09:00:00.000Z' }, NOW)).toBeNull();
  });

  it('never applies to the undo-send window, to a send without a time, or to junk', () => {
    expect(lateScheduledSendAt({ sendAt: '2026-11-17T09:00:00.000Z', undoSend: true }, NOW)).toBeNull();
    for (const payload of [{}, { sendAt: 5 }, { sendAt: 'yesterday' }, null, 'text', [], undefined]) {
      expect(lateScheduledSendAt(payload, NOW)).toBeNull();
    }
  });

  it('is held unless the setting is switched off', () => {
    expect(holdsLateScheduledSends(null)).toBe(true);
    expect(holdsLateScheduledSends({})).toBe(true);
    expect(holdsLateScheduledSends({ compose: {} })).toBe(true);
    expect(holdsLateScheduledSends({ compose: { holdLateScheduledSends: true } })).toBe(true);
    expect(holdsLateScheduledSends({ compose: { holdLateScheduledSends: false } })).toBe(false);
  });

  it('says what happened without blaming a cause it does not know', () => {
    expect(heldScheduledSendFailure('2026-11-17T09:00:00.000Z')).toContain('could not be sent then');
    expect(heldScheduledSendMessage('Quarterly numbers', 'Today, 09:00'))
      .toBe('“Quarterly numbers” was scheduled for Today, 09:00 and could not be sent then. It is in Drafts: send it or change the time.');
    expect(heldScheduledSendMessage('  ', 'Today, 09:00')).toMatch(/^A message was scheduled/);
  });

  it('validates the stored list of held messages', () => {
    const good = { actionId: 'a1', accountId: 'me@x.example', draftId: 'd1', subject: 'Hi', sendAt: '2026-11-17T09:00:00.000Z', heldAt: '2026-11-17T14:00:00.000Z' };
    expect(normalizeHeldScheduledSends([good, good, null, 'x', { ...good, actionId: 'a2', sendAt: 'never' }, { ...good, actionId: '', }, { ...good, actionId: 'a3', draftId: '' }]))
      .toEqual([good]);
    expect(normalizeHeldScheduledSends({})).toEqual([]);
    expect(normalizeHeldScheduledSends(undefined)).toEqual([]);
    const many = Array.from({ length: HELD_SCHEDULED_SENDS_MAX + 5 }, (_, index) => ({ ...good, actionId: `a${index}` }));
    const kept = normalizeHeldScheduledSends(many);
    expect(kept).toHaveLength(HELD_SCHEDULED_SENDS_MAX);
    expect(kept[kept.length - 1].actionId).toBe(`a${HELD_SCHEDULED_SENDS_MAX + 4}`);
    // A missing heldAt falls back to the chosen time; a long subject is bounded.
    const loose = normalizeHeldScheduledSends([{ ...good, heldAt: undefined, subject: 'x'.repeat(900) }])[0];
    expect(loose.heldAt).toBe(good.sendAt);
    expect(loose.subject).toHaveLength(300);
  });
});

describe('open at login', () => {
  it('is unavailable outside the installed app', () => {
    expect(describeLoginItem({ supported: false })).toEqual({ supported: false, enabled: false, needsApproval: false, note: 'Available in the installed app.' });
  });

  it('reports what the system says', () => {
    expect(describeLoginItem({ supported: true, openAtLogin: false, status: 'not-registered' })).toMatchObject({ enabled: false, needsApproval: false, note: LOGIN_ITEM_DESCRIPTION });
    expect(describeLoginItem({ supported: true, openAtLogin: true, status: 'enabled' })).toMatchObject({ enabled: true, needsApproval: false });
    // Windows reports no status.
    expect(describeLoginItem({ supported: true, openAtLogin: true })).toMatchObject({ enabled: true });
    expect(describeLoginItem({ supported: true, openAtLogin: false })).toMatchObject({ enabled: false });
  });

  it('asks for approval instead of claiming it is on', () => {
    const state = describeLoginItem({ supported: true, openAtLogin: true, status: 'requires-approval' });
    expect(state).toMatchObject({ enabled: false, needsApproval: true });
    expect(state.note).toContain('Login Items');
  });

  it('shows a refusal from the system', () => {
    const state = describeLoginItem({ supported: true, error: 'Operation not permitted' });
    expect(state).toMatchObject({ enabled: false, needsApproval: false });
    expect(state.note).toContain('Operation not permitted');
  });
});
