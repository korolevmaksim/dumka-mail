import type { MailActionLog } from './types';

export function todayUnresolvedActionCount(actionLog: MailActionLog[]): number {
  return actionLog.filter(action => action.status === 'failed' || action.status === 'pending_sync').length;
}

export function todayRecentActions(actionLog: MailActionLog[], limit = 5): MailActionLog[] {
  return [...actionLog]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
    .slice(0, limit);
}

export function shouldShowTodaySection(hasItems: boolean): boolean {
  return hasItems;
}
