import { describe, it, expect } from 'vitest';
import { makeActivityItems } from '../shared/activityTimeline';
import { ACTION_KIND_META, MailActionLog } from '../shared/types';

// Helper to build a MailActionLog with sensible defaults. `logs` passed to
// makeActivityItems must be newest-first, so tests order the array that way.
let seq = 0;
function log(overrides: Partial<MailActionLog> = {}): MailActionLog {
  seq += 1;
  return {
    id: `log-${seq}`,
    accountId: 'me@gmail.com',
    threadId: 't1',
    draftId: null,
    kind: 'markDone',
    status: 'completed',
    createdAt: '2026-06-26T10:00:00.000Z',
    completedAt: '2026-06-26T10:00:00.500Z',
    failureMessage: null,
    ...overrides,
  };
}

describe('makeActivityItems', () => {
  it('maps human title and icon name via ACTION_KIND_META', () => {
    const items = makeActivityItems([log({ kind: 'markDone', id: 'a' })]);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe(ACTION_KIND_META.markDone.title);
    expect(items[0].iconName).toBe(ACTION_KIND_META.markDone.icon);
    expect(items[0].id).toBe('a');
    expect(items[0].repeatCount).toBe(1);
  });

  it('returns empty for max <= 0', () => {
    expect(makeActivityItems([log()], 0)).toEqual([]);
    expect(makeActivityItems([log()], -3)).toEqual([]);
  });

  it('defaults to a cap of 8 entries', () => {
    const logs = Array.from({ length: 20 }, (_, i) =>
      log({ id: `x${i}`, threadId: `t${i}`, status: 'completed' })
    );
    expect(makeActivityItems(logs)).toHaveLength(8);
  });

  it('honors an explicit max', () => {
    const logs = Array.from({ length: 5 }, (_, i) =>
      log({ id: `x${i}`, threadId: `t${i}` })
    );
    expect(makeActivityItems(logs, 3)).toHaveLength(3);
  });

  it('computes durationMs clamped to >= 0', () => {
    const ms = makeActivityItems([
      log({
        createdAt: '2026-06-26T10:00:00.000Z',
        completedAt: '2026-06-26T10:00:01.300Z',
      }),
    ]);
    expect(ms[0].durationMs).toBe(1300);

    // completedAt before createdAt clamps to 0
    const clamped = makeActivityItems([
      log({
        createdAt: '2026-06-26T10:00:05.000Z',
        completedAt: '2026-06-26T10:00:04.000Z',
      }),
    ]);
    expect(clamped[0].durationMs).toBe(0);
  });

  it('leaves durationMs null when not yet completed', () => {
    const items = makeActivityItems([log({ status: 'running', completedAt: null })]);
    expect(items[0].durationMs).toBeNull();
  });

  it('drops a failure that a later (newer) success of the same target resolves', () => {
    // newest-first: success comes first in array, failure later
    const logs = [
      log({ id: 'ok', kind: 'markDone', status: 'completed', threadId: 't1' }),
      log({ id: 'fail', kind: 'markDone', status: 'failed', threadId: 't1' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['ok']);
  });

  it('keeps a failure when no success resolves it', () => {
    const logs = [
      log({ id: 'fail', kind: 'markDone', status: 'failed', threadId: 't1', failureMessage: 'boom' }),
    ];
    const items = makeActivityItems(logs);
    expect(items).toHaveLength(1);
    expect(items[0].status).toBe('failed');
    expect(items[0].failureMessage).toBe('boom');
  });

  it('does not let a success resolve a failure on a different thread', () => {
    const logs = [
      log({ id: 'ok', kind: 'markDone', status: 'completed', threadId: 't1' }),
      log({ id: 'fail', kind: 'markDone', status: 'failed', threadId: 't2' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['ok', 'fail']);
  });

  it('folds markRead and autoMarkRead into one resolution family', () => {
    // A completed autoMarkRead should resolve a failed markRead of same target.
    const logs = [
      log({ id: 'auto', kind: 'autoMarkRead', status: 'completed', threadId: 't1' }),
      log({ id: 'fail', kind: 'markRead', status: 'failed', threadId: 't1' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['auto']);
  });

  it('folds send and sendDraft into one resolution family', () => {
    const logs = [
      log({ id: 'sent', kind: 'sendDraft', status: 'completed', threadId: 't1', draftId: 'd1' }),
      log({ id: 'fail', kind: 'send', status: 'failed', threadId: 't1', draftId: 'd1' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['sent']);
  });

  it('groups consecutive same-kind/target failures into repeatCount', () => {
    const logs = [
      log({ id: 'f1', kind: 'markDone', status: 'failed', threadId: 't1' }),
      log({ id: 'f2', kind: 'markDone', status: 'failed', threadId: 't1' }),
      log({ id: 'f3', kind: 'markDone', status: 'failed', threadId: 't1' }),
    ];
    const items = makeActivityItems(logs);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe('f1'); // first occurrence is the surviving row
    expect(items[0].repeatCount).toBe(3);
  });

  it('groups failures by kind, not by family', () => {
    // markRead and autoMarkRead share a resolution family but are distinct
    // failure-group kinds, so they stay as two separate rows.
    const logs = [
      log({ id: 'fa', kind: 'markRead', status: 'failed', threadId: 't1' }),
      log({ id: 'fb', kind: 'autoMarkRead', status: 'failed', threadId: 't1' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['fa', 'fb']);
    expect(items.every((i) => i.repeatCount === 1)).toBe(true);
  });

  it('groups failures by draftId when present', () => {
    const logs = [
      log({ id: 'd1a', kind: 'sendDraft', status: 'failed', threadId: null, draftId: 'd1' }),
      log({ id: 'd1b', kind: 'sendDraft', status: 'failed', threadId: null, draftId: 'd1' }),
      log({ id: 'd2', kind: 'sendDraft', status: 'failed', threadId: null, draftId: 'd2' }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['d1a', 'd2']);
    expect(items[0].repeatCount).toBe(2);
    expect(items[1].repeatCount).toBe(1);
  });

  it('counts repeats toward the cap as a single row', () => {
    const failures = Array.from({ length: 10 }, (_, i) =>
      log({ id: `f${i}`, kind: 'markDone', status: 'failed', threadId: 't1' })
    );
    const items = makeActivityItems(failures, 8);
    expect(items).toHaveLength(1);
    expect(items[0].repeatCount).toBe(10);
  });

  it('preserves newest-first ordering of surviving rows', () => {
    const logs = [
      log({ id: 'a', threadId: 't1', status: 'completed' }),
      log({ id: 'b', threadId: 't2', status: 'completed' }),
      log({ id: 'c', threadId: 't3', status: 'completed' }),
    ];
    expect(makeActivityItems(logs).map((i) => i.id)).toEqual(['a', 'b', 'c']);
  });

  it('returns an empty list for empty input', () => {
    expect(makeActivityItems([])).toEqual([]);
  });

  it('does not drop a pending_sync failure-like entry (only completed resolves)', () => {
    // pending_sync is a Target-only status; it is neither completed nor failed,
    // so it always surfaces as its own row.
    const logs = [
      log({ id: 'ok', kind: 'markDone', status: 'completed', threadId: 't1' }),
      log({ id: 'pend', kind: 'markDone', status: 'pending_sync', threadId: 't1', completedAt: null }),
    ];
    const items = makeActivityItems(logs);
    expect(items.map((i) => i.id)).toEqual(['ok', 'pend']);
  });
});
