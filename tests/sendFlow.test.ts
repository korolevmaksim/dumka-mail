import { describe, expect, it, vi } from 'vitest';
import {
  normalizeComposeAfterSend,
  resolveAfterSend,
  sendButtonLabel,
  shouldArchiveOnSend,
  shouldCloseReaderAfterSend,
  deliverThenRecord,
  deliveryEvent,
  restoredDraftPlacement,
  restoredSendMessage,
  stepPendingSend,
  type PendingSendEvent,
  type PendingSendPhase,
  type PendingSendStep,
} from '../shared/sendFlow';

describe('send flow', () => {
  it('defaults "After sending a reply" to archive and repairs unknown stored values', () => {
    expect(normalizeComposeAfterSend(undefined)).toBe('archive');
    expect(normalizeComposeAfterSend('later')).toBe('archive');
    expect(normalizeComposeAfterSend('keep')).toBe('keep');
  });

  it('uses the setting for ⌘↩ and the opposite for ⌘⇧↩', () => {
    expect(resolveAfterSend('archive', 'default')).toBe('archive');
    expect(resolveAfterSend('archive', 'alternate')).toBe('keep');
    expect(resolveAfterSend('keep', 'default')).toBe('keep');
    expect(resolveAfterSend('keep', 'alternate')).toBe('archive');
    expect(resolveAfterSend(undefined)).toBe('archive');
  });

  it('archives only replies whose thread is still in the inbox', () => {
    expect(shouldArchiveOnSend({ afterSend: 'archive', threadId: 't1', threadLabelIds: ['INBOX', 'UNREAD'] })).toBe(true);
    expect(shouldArchiveOnSend({ afterSend: 'keep', threadId: 't1', threadLabelIds: ['INBOX'] })).toBe(false);
    expect(shouldArchiveOnSend({ afterSend: 'archive', threadId: 't1', threadLabelIds: ['SENT'] })).toBe(false);
    expect(shouldArchiveOnSend({ afterSend: 'archive', threadId: 't1', threadLabelIds: null })).toBe(false);
  });

  it('never archives anything for a brand-new message', () => {
    expect(shouldArchiveOnSend({ afterSend: 'archive', threadId: null, threadLabelIds: ['INBOX'] })).toBe(false);
    expect(shouldArchiveOnSend({ afterSend: 'archive', threadId: undefined, threadLabelIds: ['INBOX'] })).toBe(false);
  });

  it('closes the reader only when the sent thread is still the open one', () => {
    const sent = { accountId: 'alex.morgan@northwind.example', threadId: 'thread-a' };
    expect(shouldCloseReaderAfterSend({ sent, opened: { accountId: sent.accountId, id: 'thread-a' }, archived: false })).toBe(true);
    // The user moved on to another thread during the undo window.
    expect(shouldCloseReaderAfterSend({ sent, opened: { accountId: sent.accountId, id: 'thread-b' }, archived: false })).toBe(false);
    // Same thread id in another account is a different conversation.
    expect(shouldCloseReaderAfterSend({ sent, opened: { accountId: 'alex@morgan-family.example', id: 'thread-a' }, archived: false })).toBe(false);
    expect(shouldCloseReaderAfterSend({ sent, opened: null, archived: false })).toBe(false);
    expect(shouldCloseReaderAfterSend({ sent: { ...sent, threadId: null }, opened: { accountId: sent.accountId, id: 'thread-a' }, archived: false })).toBe(false);
  });

  it('does not close anything after Send and archive (the reader already moved on)', () => {
    const sent = { accountId: 'alex.morgan@northwind.example', threadId: 'thread-a' };
    expect(shouldCloseReaderAfterSend({ sent, opened: { accountId: sent.accountId, id: 'thread-a' }, archived: true })).toBe(false);
  });

  it('labels the reply button by the setting', () => {
    expect(sendButtonLabel('archive', true)).toBe('Send and archive');
    expect(sendButtonLabel('keep', true)).toBe('Send');
    expect(sendButtonLabel('archive', false)).toBe('Send');
  });
});

/** Runs events in order the way useDraftsState does: phase is updated by each step. */
function run(events: PendingSendEvent[], start: PendingSendPhase = 'waiting'): { phase: PendingSendPhase; effects: PendingSendStep[] } {
  let phase = start;
  const effects: PendingSendStep[] = [];
  for (const event of events) {
    const step = stepPendingSend(phase, event);
    phase = step.phase;
    if (step.effect !== 'none') effects.push(step);
  }
  return { phase, effects };
}

describe('pending send lifecycle', () => {
  it('delivers when the undo window ends', () => {
    const { phase, effects } = run(['timerFired', 'sendSucceeded']);
    expect(phase).toBe('sent');
    expect(effects.map(step => step.effect)).toEqual(['deliver', 'notifySent']);
  });

  it('Undo first: a timer that fires while the cancel is in flight does nothing, and the draft is restored once', () => {
    const { phase, effects } = run(['cancelRequested', 'timerFired', 'commitNow', 'cancelSucceeded', 'timerFired']);
    expect(phase).toBe('restored');
    expect(effects).toEqual([{ phase: 'restored', effect: 'restore', restoreCause: 'cancelled' }]);
  });

  it('timer first: a late Undo does not restore the draft; the send decides', () => {
    const { phase, effects } = run(['timerFired', 'cancelRequested', 'sendSucceeded']);
    expect(phase).toBe('sent');
    expect(effects.map(step => step.effect)).toEqual(['deliver', 'notifySent']);
  });

  it('a cancel that cannot reach the parked action resumes delivery instead of dropping the message', () => {
    const { phase, effects } = run(['cancelRequested', 'timerFired', 'cancelFailed', 'sendSucceeded']);
    expect(phase).toBe('sent');
    expect(effects.map(step => step.effect)).toEqual(['deliver', 'notifySent']);
  });

  it('a failed write restores the draft, whatever else was in flight', () => {
    expect(run(['persistFailed']).effects).toEqual([{ phase: 'restored', effect: 'restore', restoreCause: 'notSaved' }]);
    // Committed early by a newer send while still being written.
    expect(run(['commitNow', 'persistFailed']).effects.map(step => step.restoreCause ?? step.effect))
      .toEqual(['deliver', 'notSaved']);
    // Undo pressed while the write was failing.
    expect(run(['cancelRequested', 'persistFailed', 'cancelSucceeded']).effects)
      .toEqual([{ phase: 'restored', effect: 'restore', restoreCause: 'notSaved' }]);
  });

  it('a failed delivery restores the draft exactly once and never reports it as sent', () => {
    const { phase, effects } = run(['timerFired', 'sendFailed', 'sendSucceeded', 'cancelSucceeded']);
    expect(phase).toBe('restored');
    expect(effects).toEqual([
      { phase: 'sending', effect: 'deliver' },
      { phase: 'restored', effect: 'restore', restoreCause: 'failed' },
    ]);
  });

  it('an action handled elsewhere ends as sent without positive evidence (no reminder)', () => {
    const { phase, effects } = run(['timerFired', 'sendUnconfirmed']);
    expect(phase).toBe('sent');
    expect(effects.map(step => step.effect)).toEqual(['deliver']);
  });

  it('every event sequence ends in at most one of sent / restored, and deliver runs at most once', () => {
    const events: PendingSendEvent[] = [
      'timerFired', 'commitNow', 'cancelRequested', 'cancelSucceeded', 'cancelFailed',
      'persistFailed', 'sendSucceeded', 'sendUnconfirmed', 'sendFailed',
    ];
    const sequences: PendingSendEvent[][] = [[]];
    for (let length = 0; length < 4; length += 1) {
      for (const sequence of [...sequences]) {
        if (sequence.length !== length) continue;
        for (const event of events) sequences.push([...sequence, event]);
      }
    }
    for (const sequence of sequences) {
      const { effects } = run(sequence);
      const kinds = effects.map(step => step.effect);
      expect(kinds.filter(kind => kind === 'restore').length + kinds.filter(kind => kind === 'notifySent').length).toBeLessThanOrEqual(1);
      expect(kinds.filter(kind => kind === 'deliver').length).toBeLessThanOrEqual(1);
    }
  });
});

describe('restored draft placement', () => {
  it('goes back into the editor only when it is free', () => {
    expect(restoredDraftPlacement({ activeDraftId: null, draftId: 'a' })).toBe('editor');
    expect(restoredDraftPlacement({ activeDraftId: 'a', draftId: 'a' })).toBe('alreadyOpen');
    expect(restoredDraftPlacement({ activeDraftId: 'b', draftId: 'a' })).toBe('drafts');
  });

  it('says where the draft is', () => {
    expect(restoredSendMessage('cancelled', 'editor')).toBeNull();
    expect(restoredSendMessage('cancelled', 'drafts')).toBe("Send cancelled. It's saved in Drafts.");
    expect(restoredSendMessage('failed', 'drafts')).toBe("Message not sent. It's saved in Drafts.");
    expect(restoredSendMessage('failed', 'editor')).toBe("Message not sent. It's back in the editor.");
    expect(restoredSendMessage('notSaved', 'editor')).toContain("wasn't sent");
  });
});

describe('delivery vs bookkeeping', () => {
  it('a failed send is a failed delivery', async () => {
    const record = vi.fn();
    const outcome = await deliverThenRecord(async () => { throw new Error('network'); }, record);
    expect(outcome.delivered).toBe(false);
    expect(record).not.toHaveBeenCalled();
    expect(deliveryEvent({ delivered: outcome.delivered })).toBe('sendFailed');
  });

  it('a bookkeeping failure after the send resolved is still a delivered send', async () => {
    const outcome = await deliverThenRecord(
      async () => ({ offline: false }),
      async () => { throw new Error('deleteDraft / saveActionLog failed'); },
    );
    expect(outcome.delivered).toBe(true);
    if (outcome.delivered) {
      expect(outcome.result).toEqual({ offline: false });
      expect(outcome.bookkeepingError).toBeInstanceOf(Error);
    }
    expect(deliveryEvent({ delivered: outcome.delivered })).toBe('sendSucceeded');
  });

  it('a clean send reports no bookkeeping error and passes the result to record', async () => {
    const record = vi.fn();
    const outcome = await deliverThenRecord(async () => 'sent', record);
    expect(record).toHaveBeenCalledWith('sent');
    expect(outcome).toEqual({ delivered: true, result: 'sent', bookkeepingError: null });
  });

  it('once delivered, a later error or an unaccepted result never becomes sendFailed (no restore, no second send)', () => {
    expect(deliveryEvent({ delivered: true, accepted: false })).toBe('sendSucceeded');
    expect(deliveryEvent({ delivered: false, accepted: true })).toBe('sendSucceeded');
    expect(deliveryEvent({ delivered: false, accepted: false })).toBe('sendFailed');
    // And the lifecycle then ignores any late failure.
    let phase: PendingSendPhase = 'sending';
    phase = stepPendingSend(phase, deliveryEvent({ delivered: true })).phase;
    const late = stepPendingSend(phase, 'sendFailed');
    expect(late).toEqual({ phase: 'sent', effect: 'none' });
  });
});
