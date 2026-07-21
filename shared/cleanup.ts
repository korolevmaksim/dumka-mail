import type { MailActionLog, MailThread, SenderCleanupStat } from './types';

export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none';

/** Max archive items added to the review queue per "Archive old" click. */
export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25;

/** Threads with last activity older than this are eligible for "Archive old". */
export const CLEANUP_ARCHIVE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Grace period after a successful unsubscribe before counting new mail as
 * "still sending". Grounded in product norms:
 *  - Gmail: "may take a few days"
 *  - Leave Me Alone: up to ~72h processing
 *  - CAN-SPAM: 10 business days legal outer bound (~14 calendar days)
 *
 * 7 calendar days sits past processing delays without waiting the full legal
 * window (cleanup should re-surface non-compliant volume sooner than that).
 * Keep in sync with the julianday('+N days') filter in MessagesRepo.senderCleanupStats.
 */
export const UNSUBSCRIBE_GRACE_PERIOD_DAYS = 7;
export const UNSUBSCRIBE_GRACE_PERIOD_MS = UNSUBSCRIBE_GRACE_PERIOD_DAYS * 24 * 60 * 60 * 1000;

/**
 * Minimum messages received after the grace period that re-surface a previously
 * unsubscribed sender in Cleanup. One queued campaign email is ignored.
 */
export const UNSUBSCRIBE_RESURFACE_MIN_MESSAGES = 2;

/**
 * Stable signal for completed actions that can change Cleanup sender stats.
 * Archiving removes an old thread from the INBOX eligibility count, while a
 * successful unsubscribe suppresses the sender until it qualifies to resurface.
 */
export function completedCleanupMutationKey(actionLog: readonly MailActionLog[]): string {
  return actionLog
    .filter(log => (
      log.status === 'completed'
      && (log.kind === 'markDone' || log.kind === 'unsubscribeSender')
    ))
    .map(log => `${log.id}:${log.completedAt || ''}`)
    .sort()
    .join('|');
}

/**
 * Whether a previously unsubscribed sender should reappear in Cleanup after
 * more mail arrives (non-compliant / multi-list / sold-list cases).
 */
export function shouldResurfaceUnsubscribedSender(options: {
  unsubscribedAt: string;
  /** Messages with received_at strictly after unsubscribedAt + grace. */
  postGraceMessageCount: number;
  now?: number;
}): boolean {
  const unsubscribedMs = Date.parse(options.unsubscribedAt);
  if (!Number.isFinite(unsubscribedMs)) return false;
  const now = options.now ?? Date.now();
  // Still inside the grace window: do not resurface even if mail arrived
  // (senders may have already-queued campaigns).
  if (now < unsubscribedMs + UNSUBSCRIBE_GRACE_PERIOD_MS) return false;
  return options.postGraceMessageCount >= UNSUBSCRIBE_RESURFACE_MIN_MESSAGES;
}

/**
 * Whether a cleanup-center row is worth showing at all.
 *
 * The panel is a cleanup tool, not a leaderboard: senders with no archiveable
 * Inbox mail and no List-Unsubscribe path are pure noise.
 */
export function isCleanupSenderActionable(
  stat: Pick<SenderCleanupStat, 'hasUnsubscribeHeader' | 'archiveableOldCount'>,
): boolean {
  return stat.hasUnsubscribeHeader || stat.archiveableOldCount > 0;
}

/**
 * Select threads that "Archive old" can actually propose.
 *
 * Criteria (must all hold):
 *  - still in INBOX
 *  - last activity older than 30 days
 *
 * Unread is allowed: ignored bulk mail is exactly what cleanup should surface.
 * The review queue remains the dry-run safety gate.
 */
export function selectArchiveOldCandidates(
  threads: readonly MailThread[],
  options?: { now?: number; limit?: number },
): MailThread[] {
  const now = options?.now ?? Date.now();
  const limit = options?.limit ?? CLEANUP_ARCHIVE_BATCH_LIMIT;
  const cutoff = now - CLEANUP_ARCHIVE_AGE_MS;

  return threads
    .filter(thread =>
      thread.labelIds.some(label => label.toUpperCase() === 'INBOX') &&
      Number.isFinite(Date.parse(thread.lastMessageAt)) &&
      Date.parse(thread.lastMessageAt) < cutoff
    )
    .sort((a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt))
    .slice(0, Math.max(0, limit));
}

/**
 * Deterministic suggested action for a sender row, evaluated in this exact
 * precedence order:
 *  1. maxRiskLevel === 'high'                             -> 'review'
 *  2. previouslyUnsubscribed AND hasUnsubscribeHeader     -> 'unsubscribe'
 *     (re-surfaced non-compliant senders; skip volume gate)
 *  3. hasUnsubscribeHeader AND recent30dCount >= 3        -> 'unsubscribe'
 *  4. archiveableOldCount > 0                             -> 'archiveOld'
 *  5. otherwise                                           -> 'none'
 *
 * archiveOld is gated on real archiveable count (not volume heuristics) so the
 * suggestion never promises an action the buttons cannot perform.
 */
export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction {
  if (stat.maxRiskLevel === 'high') return 'review';
  if (stat.previouslyUnsubscribed && stat.hasUnsubscribeHeader) return 'unsubscribe';
  if (stat.hasUnsubscribeHeader && stat.recent30dCount >= 3) return 'unsubscribe';
  if (stat.archiveableOldCount > 0) return 'archiveOld';
  return 'none';
}
