import type { MailThread, SenderCleanupStat } from './types';

export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none';

/** Max archive items added to the review queue per "Archive old" click. */
export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25;

/** Threads with last activity older than this are eligible for "Archive old". */
export const CLEANUP_ARCHIVE_AGE_MS = 30 * 24 * 60 * 60 * 1000;

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
 *  2. hasUnsubscribeHeader AND recent30dCount >= 3        -> 'unsubscribe'
 *  3. archiveableOldCount > 0                             -> 'archiveOld'
 *  4. otherwise                                           -> 'none'
 *
 * archiveOld is gated on real archiveable count (not volume heuristics) so the
 * suggestion never promises an action the buttons cannot perform.
 */
export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction {
  if (stat.maxRiskLevel === 'high') return 'review';
  if (stat.hasUnsubscribeHeader && stat.recent30dCount >= 3) return 'unsubscribe';
  if (stat.archiveableOldCount > 0) return 'archiveOld';
  return 'none';
}
