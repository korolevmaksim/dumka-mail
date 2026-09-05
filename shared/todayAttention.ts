import type { AgentPlanItem, DailyBriefingItem, MailThread, ReplyPipelineState } from './types';
import type { AttentionSnooze, Commitment, ReviewCorrection } from './productivity';

export type AttentionSource = { kind: 'commitment'; item: Commitment }
  | { kind: 'reply'; item: ReplyPipelineState } | { kind: 'review'; item: AgentPlanItem }
  | { kind: 'briefing'; item: DailyBriefingItem };
export interface AttentionItem {
  id: string; accountId: string; threadId: string; title: string; reason: string;
  priority: number; dueDate: string | null; source: AttentionSource;
}

export function buildTodayAttention(input: {
  accountIds: string[]; threads: MailThread[]; replies: ReplyPipelineState[]; proposals: AgentPlanItem[];
  briefing: DailyBriefingItem[]; commitments: Commitment[]; snoozes: AttentionSnooze[];
  corrections: ReviewCorrection[]; now: number;
}): AttentionItem[] {
  const allowed = new Set(input.accountIds.map(id => id.toLowerCase()));
  const key = (accountId: string, threadId: string) => `${accountId.toLowerCase()}:${threadId}`;
  const hidden = new Set(input.snoozes.filter(item => Date.parse(item.until) > input.now).map(item => key(item.accountId, item.threadId)));
  for (const item of input.replies) if (item.status === 'snoozed' && item.snoozedUntil && Date.parse(item.snoozedUntil) > input.now) hidden.add(key(item.accountId, item.threadId));
  const result: AttentionItem[] = [];
  const claimed = new Set<string>();
  const add = (row: AttentionItem) => {
    const rowKey = key(row.accountId, row.threadId);
    if (!allowed.has(row.accountId.toLowerCase()) || hidden.has(rowKey) || claimed.has(rowKey)) return;
    claimed.add(rowKey); result.push(row);
  };
  for (const item of input.commitments.filter(item => item.status === 'confirmed' && allowed.has(item.accountId.toLowerCase()))) {
    const source = item.evidence[0];
    if (!source) continue;
    const overdue = item.dueDate ? Date.parse(`${item.dueDate}T23:59:59`) < input.now : false;
    const dueSoon = item.dueDate ? Date.parse(`${item.dueDate}T00:00:00`) <= input.now + 86400000 : false;
    const row: AttentionItem = { id: item.id, accountId: item.accountId, threadId: source.threadId,
      title: item.title, reason: `${item.direction === 'mine' ? 'I owe' : 'Waiting on'} · ${item.owner}`,
      priority: overdue ? 200 : dueSoon ? 140 : item.direction === 'mine' ? 80 : 40, dueDate: item.dueDate, source: { kind: 'commitment', item } };
    // Distinct confirmed outcomes stay distinct, even when they share a thread.
    if (!hidden.has(key(item.accountId, source.threadId))) result.push(row);
    for (const evidence of item.evidence) claimed.add(key(item.accountId, evidence.threadId));
  }
  const noReply = (accountId: string, threadId: string, messageId: string, senderEmail?: string) => input.corrections.some(correction =>
    correction.accountId.toLowerCase() === accountId.toLowerCase() && (correction.reason === 'noReply' || (correction.reason === 'alreadyDone' && correction.action === 'draftReply'))
      && (correction.scope === 'sender' ? Boolean(senderEmail) && correction.senderEmail === senderEmail?.toLowerCase()
        : correction.threadId === threadId && correction.messageId === messageId));
  for (const item of [...input.replies].sort((a, b) => b.priority - a.priority)) {
    if (!['needsReply', 'draftReady', 'due'].includes(item.status)) continue;
    const thread = input.threads.find(thread => thread.accountId === item.accountId && thread.id === item.threadId);
    if (noReply(item.accountId, item.threadId, item.sourceMessageId, thread?.senderEmail)) continue;
    add({ id: `reply:${item.accountId}:${item.threadId}`, accountId: item.accountId, threadId: item.threadId,
      title: thread?.subject || 'Reply to conversation', reason: item.reason, priority: item.status === 'due' ? 150 : 100 + item.priority / 100,
      dueDate: item.dueAt?.slice(0, 10) || null, source: { kind: 'reply', item } });
  }
  for (const item of input.proposals) add({ id: item.id, accountId: item.accountId, threadId: item.threadId,
    title: item.title, reason: item.reason, priority: item.action === 'draftReply' ? 100 : 60, dueDate: null, source: { kind: 'review', item } });
  for (const item of input.briefing.filter(item => item.category !== 'fyi' && item.category !== 'riskOrNoise')) {
    if (noReply(item.accountId, item.threadId, item.source.messageId, item.source.senderEmail)) continue;
    add({ id: item.id, accountId: item.accountId, threadId: item.threadId, title: item.title,
      reason: item.reason, priority: item.priority, dueDate: null, source: { kind: 'briefing', item } });
  }
  return result.sort((a, b) => b.priority - a.priority || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.id.localeCompare(b.id));
}
