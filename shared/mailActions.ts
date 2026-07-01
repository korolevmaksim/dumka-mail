import type { ActionKind } from './types';

export function reverseMailActionKind(kind: ActionKind): ActionKind | null {
  switch (kind) {
    case 'markDone':
      return 'restoreInbox';
    case 'restoreInbox':
      return 'markDone';
    case 'moveToTrash':
      return 'restoreFromTrash';
    case 'restoreFromTrash':
      return 'moveToTrash';
    case 'reportSpam':
      return 'restoreFromSpam';
    case 'restoreFromSpam':
      return 'reportSpam';
    case 'muteThread':
      return 'unmuteThread';
    case 'unmuteThread':
      return 'muteThread';
    case 'applyLabel':
      return 'removeLabel';
    case 'removeLabel':
      return 'applyLabel';
    case 'markRead':
      return 'markUnread';
    case 'markUnread':
      return 'markRead';
    default:
      return null;
  }
}

export function isReversibleMailActionKind(kind: ActionKind): boolean {
  return reverseMailActionKind(kind) !== null;
}
