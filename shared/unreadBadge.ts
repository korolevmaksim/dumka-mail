// The number on the app icon: unread inbox conversations the account would
// notify about. It follows each account's notification setting, so the badge
// and the notifications never disagree:
//   people → unread mail from people, invitations and security notices
//            (sender sections count, as they do for notifications)
//   all    → every unread inbox conversation
//   none   → nothing
// Conversations postponed with Later are not in the inbox and are not counted.
// Pure and dependency-free.
import { decisionWarrantsNotification } from './accountNotifications';
import { getSenderSections, normalizeAccountId, resolveAccountSetting, type AccountSettingsSource } from './accountSettings';
import { decideWithSenderSections, type DecisionThread } from './decision';
import type { AccountNotificationMode } from './types';

/** Unread inbox conversations read per account for the badge; more than this shows as the limit. */
export const UNREAD_BADGE_SCAN_LIMIT = 500;

export type BadgeThread = DecisionThread & { isUnread: boolean };

export interface BadgeSettingsSource extends AccountSettingsSource {
  general?: { showUnreadBadge?: unknown } | null;
}

/** On unless switched off. */
export function unreadBadgeEnabled(settings: BadgeSettingsSource | null | undefined): boolean {
  return settings?.general?.showUnreadBadge !== false;
}

export function threadCountsTowardBadge(
  thread: BadgeThread,
  mode: AccountNotificationMode,
  context: { accountEmail: string; senderSections?: Parameters<typeof decideWithSenderSections>[1]['senderSections'] },
): boolean {
  if (!thread.isUnread || mode === 'none') return false;
  if (mode === 'all') return true;
  return decisionWarrantsNotification(mode, decideWithSenderSections(thread, context));
}

/** The badge number of one account, given its unread inbox conversations. */
export function accountBadgeCount(accountId: string, threads: readonly BadgeThread[], settings: BadgeSettingsSource): number {
  const accountEmail = normalizeAccountId(accountId);
  const mode = resolveAccountSetting(settings, accountEmail, 'notifications').value;
  if (mode === 'none') return 0;
  const context = { accountEmail, senderSections: getSenderSections(settings, accountEmail) };
  let count = 0;
  for (const thread of threads) {
    if (threadCountsTowardBadge(thread, mode, context)) count += 1;
  }
  return count;
}
