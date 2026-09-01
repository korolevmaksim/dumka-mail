import type { MailActionLog } from '../../../shared/types';

export async function cancelPendingMailAction(
  item: Pick<MailActionLog, 'id' | 'accountId'> & Partial<MailActionLog>,
): Promise<boolean> {
  try {
    const latest = (await window.electronAPI.listActionLog(item.accountId)).find(log => log.id === item.id) || item;
    if (latest.status !== 'pending_sync' && latest.status !== 'queued') return false;
    await window.electronAPI.saveActionLog({
      id: latest.id,
      accountId: latest.accountId,
      threadId: latest.threadId,
      draftId: latest.draftId,
      kind: latest.kind || 'markDone',
      status: 'failed',
      createdAt: latest.createdAt || new Date().toISOString(),
      scheduledAt: latest.scheduledAt,
      completedAt: new Date().toISOString(),
      failureMessage: 'Undone before sync',
      payloadJson: latest.payloadJson,
    });
    return true;
  } catch (error) {
    console.error('Failed to cancel pending action before undo:', error);
    return false;
  }
}
