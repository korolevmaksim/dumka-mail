import type { SenderCleanupStat } from './types';

export type CleanupSuggestedAction = 'review' | 'unsubscribe' | 'archiveOld' | 'none';

/** Max archive items added to the review queue per "Archive old" click. */
export const CLEANUP_ARCHIVE_BATCH_LIMIT = 25;

/**
 * Deterministic suggested action for a sender row, evaluated in this exact
 * precedence order (spec C5):
 *  1. maxRiskLevel === 'high'                             -> 'review'
 *  2. hasUnsubscribeHeader AND recent30dCount >= 3        -> 'unsubscribe'
 *  3. recent30dCount >= 10
 *     OR (threadCount >= 10 AND unread ratio >= 0.7)      -> 'archiveOld'
 *  4. otherwise                                           -> 'none'
 */
export function suggestCleanupAction(stat: SenderCleanupStat): CleanupSuggestedAction {
  if (stat.maxRiskLevel === 'high') return 'review';
  if (stat.hasUnsubscribeHeader && stat.recent30dCount >= 3) return 'unsubscribe';
  const unreadRatio = stat.messageCount > 0 ? stat.unreadCount / stat.messageCount : 0;
  if (stat.recent30dCount >= 10 || (stat.threadCount >= 10 && unreadRatio >= 0.7)) return 'archiveOld';
  return 'none';
}
