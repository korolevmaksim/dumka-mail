// Pure pieces of the unsubscribe confirmation sheet (SPEC §6). Unsubscribing is
// an external, irreversible action: it only runs after explicit confirmation,
// and the toast's Undo only reverses the optional archive.

import type { MailThread, UnsubscribeCandidate, UnsubscribeMethod } from './types';

export interface UnsubscribeTarget {
  accountId: string;
  /** Thread whose message carries the reviewed List-Unsubscribe header. */
  threadId: string;
  /** The reviewed message; main re-parses exactly this one (no re-resolution). */
  sourceMessageId: string | null;
  senderName: string;
  senderEmail: string;
  method: UnsubscribeMethod;
}

export const UNSUBSCRIBE_IRREVERSIBLE_NOTICE = 'This sends a request to each sender and cannot be undone from Dumka Mail.';

export function unsubscribeTargetFromCandidate(candidate: UnsubscribeCandidate | null | undefined): UnsubscribeTarget | null {
  if (!candidate?.recommendedMethod) return null;
  return {
    accountId: candidate.accountId,
    threadId: candidate.threadId,
    sourceMessageId: candidate.messageId || null,
    senderName: candidate.senderName,
    senderEmail: candidate.senderEmail,
    method: candidate.recommendedMethod,
  };
}

export function describeUnsubscribeMethod(method: UnsubscribeMethod): string {
  if (method.kind === 'mailto') {
    return method.email ? `Email to ${method.email}` : 'Email request (mailto)';
  }
  if (method.isOneClick) return 'One-click';
  return 'Web link';
}

export function unsubscribeSheetTitle(targets: readonly UnsubscribeTarget[]): string {
  if (targets.length === 1) return `Unsubscribe from ${targets[0].senderName || targets[0].senderEmail}?`;
  return `Unsubscribe from ${targets.length} senders?`;
}

export function senderKey(accountId: string, senderEmail: string): string {
  return `${accountId.trim().toLowerCase()}:${senderEmail.trim().toLowerCase()}`;
}

/**
 * Inbox threads to archive for "Also archive their messages": every cached
 * inbox thread from an unsubscribed sender (same account), plus the source
 * threads themselves when they are still in the inbox.
 */
export function selectThreadsToArchiveAfterUnsubscribe(
  threads: readonly MailThread[],
  unsubscribed: readonly UnsubscribeTarget[],
): MailThread[] {
  const senders = new Set(unsubscribed.map(target => senderKey(target.accountId, target.senderEmail)));
  const sourceThreads = new Set(unsubscribed.map(target => `${target.accountId.trim().toLowerCase()}:${target.threadId}`));
  const seen = new Set<string>();
  const selected: MailThread[] = [];
  for (const thread of threads) {
    if (!thread.labelIds.some(label => label.toUpperCase() === 'INBOX')) continue;
    const key = `${thread.accountId.trim().toLowerCase()}:${thread.id}`;
    if (seen.has(key)) continue;
    if (!senders.has(senderKey(thread.accountId, thread.senderEmail)) && !sourceThreads.has(key)) continue;
    seen.add(key);
    selected.push(thread);
  }
  return selected;
}

function senderLabel(target: UnsubscribeTarget): string {
  return target.senderName || target.senderEmail;
}

function conversations(count: number): string {
  return `${count} conversation${count === 1 ? '' : 's'}`;
}

export interface UnsubscribeOutcomeFeedback {
  tone: 'success' | 'warning' | 'error';
  message: string;
  /** Undo is offered only when something was archived; it restores only that. */
  offerUndo: boolean;
}

export function unsubscribeOutcomeFeedback(input: {
  succeeded: readonly UnsubscribeTarget[];
  failed: readonly UnsubscribeTarget[];
  archivedCount: number;
}): UnsubscribeOutcomeFeedback {
  const { succeeded, failed, archivedCount } = input;
  if (succeeded.length === 0) {
    return {
      tone: 'error',
      message: failed.length === 1
        ? `Could not unsubscribe from ${senderLabel(failed[0])}.`
        : `Could not unsubscribe from ${failed.length} senders.`,
      offerUndo: false,
    };
  }
  const who = succeeded.length === 1 ? senderLabel(succeeded[0]) : `${succeeded.length} senders`;
  const archived = archivedCount > 0 ? ` ${conversations(archivedCount)} archived.` : '';
  const failedText = failed.length > 0
    ? ` Could not unsubscribe from ${failed.length === 1 ? senderLabel(failed[0]) : `${failed.length} senders`}.`
    : '';
  return {
    tone: failed.length > 0 ? 'warning' : 'success',
    message: `Unsubscribed from ${who}.${archived}${failedText}`,
    offerUndo: archivedCount > 0,
  };
}
