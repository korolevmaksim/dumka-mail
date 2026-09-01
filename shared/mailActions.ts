import { mailActionPayloadFields } from './mailActionFeedback';
import type { ActionKind, MailActionLog, MailThread } from './types';

function withoutLabel(labels: string[], labelId: string): string[] {
  return labels.filter(label => label.toUpperCase() !== labelId.toUpperCase());
}

function withLabel(labels: string[], labelId: string): string[] {
  return Array.from(new Set([...withoutLabel(labels, labelId), labelId]));
}

export function applyOptimisticThreadReminder(
  threads: MailThread[],
  accountId: string,
  threadId: string,
  reminderAt: string | null,
): MailThread[] {
  return threads.map(thread => (
    thread.accountId === accountId && thread.id === threadId
      ? { ...thread, reminderAt }
      : thread
  ));
}

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

export function applyPendingLabelAction(thread: MailThread, action: MailActionLog): MailThread {
  if (action.accountId !== thread.accountId || action.threadId !== thread.id) return thread;
  if (action.status !== 'pending_sync' && action.status !== 'queued' && action.status !== 'running') return thread;

  const { labelId } = mailActionPayloadFields(action.payloadJson);
  const labels = thread.labelIds;

  switch (action.kind) {
    case 'markDone':
    case 'unsubscribeSender':
      return { ...thread, labelIds: withoutLabel(labels, 'INBOX') };
    case 'restoreInbox':
      return { ...thread, labelIds: withLabel(labels, 'INBOX') };
    case 'markRead':
      return { ...thread, isUnread: false, labelIds: withoutLabel(labels, 'UNREAD') };
    case 'markUnread':
      return { ...thread, isUnread: true, labelIds: withLabel(labels, 'UNREAD') };
    case 'moveToTrash':
      return { ...thread, labelIds: withLabel(withoutLabel(labels, 'INBOX'), 'TRASH') };
    case 'restoreFromTrash':
      return { ...thread, labelIds: withLabel(withoutLabel(labels, 'TRASH'), 'INBOX') };
    case 'reportSpam':
      return { ...thread, labelIds: withLabel(withoutLabel(labels, 'INBOX'), 'SPAM') };
    case 'restoreFromSpam':
      return { ...thread, labelIds: withLabel(withoutLabel(labels, 'SPAM'), 'INBOX') };
    case 'muteThread':
      return {
        ...thread,
        labelIds: labelId
          ? withLabel(withoutLabel(labels, 'INBOX'), labelId)
          : withoutLabel(labels, 'INBOX'),
      };
    case 'unmuteThread':
      return {
        ...thread,
        labelIds: labelId
          ? withLabel(withoutLabel(labels, labelId), 'INBOX')
          : withLabel(labels, 'INBOX'),
      };
    case 'applyLabel':
      return labelId ? { ...thread, labelIds: withLabel(labels, labelId) } : thread;
    case 'removeLabel':
      return labelId ? { ...thread, labelIds: withoutLabel(labels, labelId) } : thread;
    case 'moveToLabel':
      return labelId
        ? { ...thread, labelIds: withLabel(withoutLabel(labels, 'INBOX'), labelId) }
        : thread;
    case 'autoMarkRead':
    case 'send':
    case 'sendDraft':
    case 'setReminder':
    case 'clearReminder':
    case 'calendarRSVP':
    case 'addCalendarEvent':
    case 'createCalendarEvent':
    case 'updateCalendarEvent':
    case 'deleteCalendarEvent':
    case 'applyAIDraftPreview':
    case 'insertSnippet':
    case 'forwardThread':
    case 'autoReply':
    case 'ruleShadowMatch':
      return thread;
    default: {
      const _exhaustive: never = action.kind;
      void _exhaustive;
      return thread;
    }
  }
}

export function applyPendingLabelDeltas(thread: MailThread, actions: MailActionLog[]): MailThread {
  return actions.reduce(applyPendingLabelAction, thread);
}
