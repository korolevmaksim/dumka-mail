import { describe, expect, it } from 'vitest';
import {
  draftSaveStatusLabel,
  findReusableThreadDraft,
  shouldPersistDraftWrite,
  undoSendScheduledAt,
  undoSendWorkerScheduledAt,
  visibleDrafts,
} from '../shared/draftLifecycle';
import type { Draft } from '../shared/types';

function draft(partial: Partial<Draft> = {}): Draft {
  return {
    id: partial.id || 'd1',
    accountId: partial.accountId || 'me@example.com',
    threadId: partial.threadId === undefined ? 't1' : partial.threadId,
    to: [],
    cc: [],
    bcc: [],
    subject: 'Hello',
    bodyPlain: 'Hi',
    attachments: [],
    updatedAt: partial.updatedAt || '2026-09-01T10:00:00.000Z',
    sendAt: partial.sendAt,
    rfcMessageId: partial.rfcMessageId,
  };
}

describe('shouldPersistDraftWrite', () => {
  it('always persists send/schedule even when restore is off', () => {
    expect(shouldPersistDraftWrite({
      keepDraftsAcrossLaunches: false,
      autoSaveDrafts: false,
      reason: 'send',
    })).toBe(true);
  });

  it('honours Auto Save Drafts only for keystroke autosave', () => {
    expect(shouldPersistDraftWrite({
      keepDraftsAcrossLaunches: true,
      autoSaveDrafts: false,
      reason: 'autosave',
    })).toBe(false);
    expect(shouldPersistDraftWrite({
      keepDraftsAcrossLaunches: true,
      autoSaveDrafts: true,
      reason: 'autosave',
    })).toBe(true);
    expect(shouldPersistDraftWrite({
      keepDraftsAcrossLaunches: true,
      autoSaveDrafts: false,
      reason: 'explicit',
    })).toBe(true);
  });
});

describe('findReusableThreadDraft', () => {
  it('reuses the newest unsent draft for the same account and thread', () => {
    expect(findReusableThreadDraft([
      draft({ id: 'old', updatedAt: '2026-09-01T09:00:00.000Z' }),
      draft({ id: 'scheduled', sendAt: '2026-09-01T12:00:00.000Z', updatedAt: '2026-09-01T11:00:00.000Z' }),
      draft({ id: 'fresh', updatedAt: '2026-09-01T10:30:00.000Z' }),
      draft({ id: 'other', accountId: 'you@example.com', updatedAt: '2026-09-01T11:00:00.000Z' }),
    ], 'me@example.com', 't1')?.id).toBe('fresh');
  });

  it('returns null when only scheduled drafts exist', () => {
    expect(findReusableThreadDraft([
      draft({ sendAt: '2026-09-01T12:00:00.000Z' }),
    ], 'me@example.com', 't1')).toBeNull();
  });
});

describe('visibleDrafts and undo-send schedule', () => {
  it('hides discarded drafts from the list', () => {
    expect(visibleDrafts([draft({ id: 'keep' }), draft({ id: 'gone' })], new Set(['gone'])).map(item => item.id))
      .toEqual(['keep']);
  });

  it('schedules undo-send from now plus the configured delay', () => {
    expect(undoSendScheduledAt(10, new Date('2026-09-01T12:00:00.000Z'))).toBe('2026-09-01T12:00:10.000Z');
    expect(undoSendWorkerScheduledAt(10, new Date('2026-09-01T12:00:00.000Z'))).toBe('2026-09-01T12:01:10.000Z');
  });
});

describe('draftSaveStatusLabel', () => {
  it('labels each status for the composer', () => {
    expect(draftSaveStatusLabel('idle')).toBeNull();
    expect(draftSaveStatusLabel('unsaved')).toBe('Not saved');
    expect(draftSaveStatusLabel('saving')).toBe('Saving…');
    expect(draftSaveStatusLabel('saved')).toBe('Saved');
    expect(draftSaveStatusLabel('error')).toBe('Save failed');
  });
});
