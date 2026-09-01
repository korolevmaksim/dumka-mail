import type { Draft } from './types';

export const DRAFT_AUTOSAVE_DEBOUNCE_MS = 700;
export const DRAFT_DISCARD_UNDO_MS = 8000;
export const UNDO_SEND_WORKER_GRACE_SEC = 60;

export type DraftPersistReason = 'autosave' | 'explicit' | 'create' | 'send';
export type DraftSaveStatus = 'idle' | 'unsaved' | 'saving' | 'saved' | 'error';

export function shouldPersistDraftWrite(options: {
  keepDraftsAcrossLaunches: boolean;
  autoSaveDrafts: boolean;
  reason: DraftPersistReason;
}): boolean {
  if (options.reason === 'send') return true;
  if (!options.keepDraftsAcrossLaunches) return false;
  if (options.reason === 'autosave') return options.autoSaveDrafts;
  return true;
}

export function findReusableThreadDraft(
  drafts: readonly Draft[],
  accountId: string,
  threadId: string,
): Draft | null {
  const matches = drafts.filter(draft => (
    draft.accountId === accountId
    && draft.threadId === threadId
    && !draft.sendAt
  ));
  if (matches.length === 0) return null;
  return [...matches].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))[0];
}

export function visibleDrafts(drafts: readonly Draft[], discardedIds: ReadonlySet<string>): Draft[] {
  return drafts.filter(draft => !discardedIds.has(draft.id));
}

export function undoSendScheduledAt(delaySec: number, now = new Date()): string {
  return new Date(now.getTime() + Math.max(0, delaySec) * 1000).toISOString();
}

export function undoSendWorkerScheduledAt(delaySec: number, now = new Date()): string {
  return undoSendScheduledAt(delaySec + UNDO_SEND_WORKER_GRACE_SEC, now);
}

export function draftSaveStatusLabel(status: DraftSaveStatus): string | null {
  switch (status) {
    case 'idle':
      return null;
    case 'unsaved':
      return 'Not saved';
    case 'error':
      return 'Save failed';
    case 'saving':
      return 'Saving…';
    case 'saved':
      return 'Saved';
    default: {
      const _exhaustive: never = status;
      return _exhaustive;
    }
  }
}
