import { describe, expect, it } from 'vitest';
import {
  aggregateMailActionResults,
  buildUndoMailActionPayload,
  isUndoableMailActionLog,
  mailActionBatchId,
  mailActionPayloadFields,
  parseMailActionPayload,
  resolveMailActionFeedback,
} from '../shared/mailActionFeedback';

describe('parseMailActionPayload', () => {
  it('reads flags from a valid payload object', () => {
    expect(parseMailActionPayload('{"auto":true,"batchId":"b1"}')).toEqual({ auto: true, batchId: 'b1' });
    expect(mailActionPayloadFields('{"auto":true,"silent":true,"undo":true,"batchId":"b1","accountId":"a@x","labelId":"L"}')).toEqual({
      auto: true,
      silent: true,
      undo: true,
      batchId: 'b1',
      accountId: 'a@x',
      labelId: 'L',
    });
    expect(mailActionBatchId('{"batchId":"batch-9"}')).toBe('batch-9');
  });

  it('treats missing, invalid, and empty payloads as empty objects', () => {
    expect(parseMailActionPayload(null)).toEqual({});
    expect(parseMailActionPayload('not-json')).toEqual({});
    expect(parseMailActionPayload('[]')).toEqual({});
    expect(mailActionPayloadFields(undefined)).toEqual({
      auto: false,
      silent: false,
      undo: false,
      batchId: null,
      accountId: null,
      labelId: null,
    });
  });
});

describe('resolveMailActionFeedback', () => {
  it('stays silent for auto mark-read and explicitly silent callers', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: false },
      kind: 'markRead',
      auto: true,
    }).silent).toBe(true);

    expect(resolveMailActionFeedback({
      result: { accepted: false, offline: false, errorMessage: 'hidden' },
      kind: 'markDone',
      silent: true,
    })).toEqual({ silent: true, tone: 'info', message: '', action: null });
  });

  it('announces success with Undo for reversible kinds and omits Undo for send', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: false },
      kind: 'markDone',
    })).toEqual({
      silent: false,
      tone: 'success',
      message: 'Archived.',
      action: 'undo',
    });

    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: false },
      kind: 'send',
    })).toEqual({
      silent: false,
      tone: 'success',
      message: 'Message sent.',
      action: null,
    });
  });

  it('announces a queued action instead of pretending it completed remotely', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: true },
      kind: 'moveToTrash',
    })).toEqual({
      silent: false,
      tone: 'info',
      message: 'Moved to Trash. Queued — will sync when Gmail is reachable.',
      action: 'undo',
    });

    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: true },
      kind: 'send',
    }).message).toBe('Message queued — will send when Gmail is reachable.');
  });

  it('surfaces the remote error and offers retry', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: false, offline: false, errorMessage: 'HTTP 403 — forbidden' },
      kind: 'markDone',
    })).toEqual({
      silent: false,
      tone: 'error',
      message: 'HTTP 403 — forbidden',
      action: 'retry',
    });
  });

  it('does not attach Undo to an undo result', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: false },
      kind: 'restoreInbox',
      undo: true,
    })).toEqual({
      silent: false,
      tone: 'success',
      message: 'Moved to Inbox.',
      action: null,
    });
  });

  it('summarizes batch success, partial failure, and total failure', () => {
    expect(resolveMailActionFeedback({
      result: { accepted: true, offline: false },
      kind: 'markDone',
      count: 12,
      succeeded: 12,
      failed: 0,
    })).toEqual({
      silent: false,
      tone: 'success',
      message: 'Archived · 12 conversations.',
      action: 'undo',
    });

    expect(resolveMailActionFeedback({
      result: { accepted: false, offline: false },
      kind: 'markDone',
      count: 12,
      succeeded: 9,
      failed: 3,
    })).toEqual({
      silent: false,
      tone: 'warning',
      message: 'Archived 9 of 12, 3 failed.',
      action: 'retry',
    });

    expect(resolveMailActionFeedback({
      result: { accepted: false, offline: false, errorMessage: 'Gmail rejected the label change.' },
      kind: 'moveToTrash',
      count: 3,
      succeeded: 0,
      failed: 3,
    }).tone).toBe('error');
  });
});

describe('aggregateMailActionResults', () => {
  it('counts successes and preserves the first error', () => {
    const aggregated = aggregateMailActionResults([
      { accepted: true, offline: true, actionId: 'a' },
      { accepted: false, offline: false, errorMessage: 'boom' },
      { accepted: true, offline: false },
    ]);
    expect(aggregated).toMatchObject({
      accepted: false,
      offline: true,
      errorMessage: 'boom',
      succeeded: 2,
      failed: 1,
    });
  });
});

describe('buildUndoMailActionPayload', () => {
  it('strips the original batchId so a second undo does not re-reverse the first batch', () => {
    expect(buildUndoMailActionPayload('{"batchId":"old","labelId":"L"}')).toEqual({
      labelId: 'L',
      auto: false,
      undo: true,
    });
  });

  it('accepts a replacement batchId for the reverse pass', () => {
    expect(buildUndoMailActionPayload('{"batchId":"old","labelId":"L"}', { batchId: 'redo', silent: true })).toEqual({
      labelId: 'L',
      auto: false,
      undo: true,
      batchId: 'redo',
      silent: true,
    });
  });
});

describe('isUndoableMailActionLog', () => {
  it('skips auto mark-read and irreversible kinds, keeps queued offline work', () => {
    expect(isUndoableMailActionLog({
      kind: 'markRead',
      status: 'completed',
      payloadJson: '{"auto":true}',
    })).toBe(false);

    expect(isUndoableMailActionLog({
      kind: 'send',
      status: 'completed',
      payloadJson: null,
    })).toBe(false);

    expect(isUndoableMailActionLog({
      kind: 'markDone',
      status: 'pending_sync',
      payloadJson: '{"batchId":"b"}',
    })).toBe(true);

    expect(isUndoableMailActionLog({
      kind: 'markDone',
      status: 'running',
      payloadJson: '{"batchId":"b"}',
    })).toBe(false);
  });
});
