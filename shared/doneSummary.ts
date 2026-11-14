// "Inbox is clear" summary (design-review/SPEC.md §2): what the account did
// today, from the local action log. Pure.
import { parseMailActionPayload } from './mailActionFeedback';
import type { MailActionLog } from './types';

export interface DoneSummary {
  repliesSent: number;
  archived: number;
  movedToLater: number;
  unsubscribed: number;
}

const EFFECTIVE_STATUSES = new Set<MailActionLog['status']>(['completed', 'pending_sync', 'running', 'queued']);

function isSameLocalDay(iso: string, now: Date): boolean {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return false;
  const date = new Date(time);
  return date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate();
}

function threadKey(log: MailActionLog): string | null {
  return log.threadId ? `${log.accountId.trim().toLowerCase()}:${log.threadId}` : null;
}

/**
 * Today's totals for `accountIds` (every account when omitted). Archive and
 * Later are counted per thread by their last state today, so an undone
 * archive does not count. A scheduled send that has not gone out yet does
 * not count as sent.
 */
export function buildDoneSummary(
  logs: readonly MailActionLog[],
  options: { now?: Date; accountIds?: readonly string[] } = {},
): DoneSummary {
  const now = options.now || new Date();
  const accounts = options.accountIds ? new Set(options.accountIds.map(id => id.trim().toLowerCase())) : null;
  const todays = logs
    .filter(log => !accounts || accounts.has(log.accountId.trim().toLowerCase()))
    .filter(log => EFFECTIVE_STATUSES.has(log.status) && isSameLocalDay(log.createdAt, now))
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));

  let repliesSent = 0;
  const archiveState = new Map<string, boolean>();
  const laterState = new Map<string, boolean>();
  const unsubscribedSenders = new Set<string>();

  for (const log of todays) {
    const key = threadKey(log);
    switch (log.kind) {
      case 'send':
      case 'sendDraft': {
        const scheduled = log.scheduledAt ? Date.parse(log.scheduledAt) : NaN;
        if (Number.isFinite(scheduled) && scheduled > now.getTime() && log.status !== 'completed') break;
        repliesSent += 1;
        break;
      }
      case 'markDone':
        if (key) archiveState.set(key, true);
        break;
      case 'restoreInbox':
        if (key) archiveState.set(key, false);
        break;
      case 'setReminder':
        if (key) laterState.set(key, true);
        break;
      case 'autoMarkRead': {
        // Snooze is logged as autoMarkRead with a reminderAt payload.
        const payload = parseMailActionPayload(log.payloadJson);
        if (key && typeof payload.reminderAt === 'string') laterState.set(key, true);
        break;
      }
      case 'clearReminder':
        if (key) laterState.set(key, false);
        break;
      case 'unsubscribeSender': {
        if (log.status !== 'completed') break;
        const payload = parseMailActionPayload(log.payloadJson);
        const sender = typeof payload.senderEmail === 'string' && payload.senderEmail
          ? `${log.accountId.trim().toLowerCase()}:${payload.senderEmail.trim().toLowerCase()}`
          : key;
        if (sender) unsubscribedSenders.add(sender);
        break;
      }
      default:
        break;
    }
  }

  const countTrue = (map: Map<string, boolean>) => Array.from(map.values()).filter(Boolean).length;
  return {
    repliesSent,
    archived: countTrue(archiveState),
    movedToLater: countTrue(laterState),
    unsubscribed: unsubscribedSenders.size,
  };
}

export function hasDoneSummaryActivity(summary: DoneSummary): boolean {
  return summary.repliesSent + summary.archived + summary.movedToLater + summary.unsubscribed > 0;
}

export interface DoneSummaryLine {
  id: keyof DoneSummary;
  count: number;
  text: string;
}

/** Non-zero lines in display order. */
export function doneSummaryLines(summary: DoneSummary): DoneSummaryLine[] {
  const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
  const lines: DoneSummaryLine[] = [
    { id: 'repliesSent', count: summary.repliesSent, text: plural(summary.repliesSent, 'reply sent', 'replies sent') },
    { id: 'archived', count: summary.archived, text: plural(summary.archived, 'conversation archived', 'conversations archived') },
    { id: 'movedToLater', count: summary.movedToLater, text: 'moved to Later' },
    { id: 'unsubscribed', count: summary.unsubscribed, text: plural(summary.unsubscribed, 'sender unsubscribed', 'senders unsubscribed') },
  ];
  return lines.filter(line => line.count > 0);
}
