import { describe, expect, it } from 'vitest';
import { shouldShowTodaySection, todayRecentActions, todayUnresolvedActionCount } from '../shared/todayHomeState';
import type { MailActionLog } from '../shared/types';

function log(partial: Partial<MailActionLog>): MailActionLog {
  return {
    id: partial.id || '1',
    accountId: 'a@example.com',
    threadId: 't1',
    draftId: null,
    kind: 'markDone',
    status: 'completed',
    payloadJson: null,
    createdAt: '2026-09-01T10:00:00.000Z',
    ...partial,
  };
}

describe('todayHomeState', () => {
  it('counts unresolved actions instead of the latest five rows', () => {
    const logs = [
      log({ id: '1', status: 'completed' }),
      log({ id: '2', status: 'failed' }),
      log({ id: '3', status: 'pending_sync' }),
      log({ id: '4', status: 'completed' }),
      log({ id: '5', status: 'completed' }),
      log({ id: '6', status: 'completed' }),
    ];
    expect(todayUnresolvedActionCount(logs)).toBe(2);
    expect(todayRecentActions(logs, 5)).toHaveLength(5);
  });

  it('hides empty Today sections', () => {
    expect(shouldShowTodaySection(false)).toBe(false);
    expect(shouldShowTodaySection(true)).toBe(true);
  });
});
