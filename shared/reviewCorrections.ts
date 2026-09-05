import type { AgentPlan, AgentPlanItem } from './types';
import type { ReviewCorrection, CorrectionReason } from './productivity';

export const CORRECTION_LABELS: Record<CorrectionReason, string> = {
  noReply: 'No reply needed', alreadyDone: 'Already handled', importantSender: 'Keep this sender in my inbox',
};

export function correctionMatches(item: AgentPlanItem, correction: ReviewCorrection): boolean {
  if (item.accountId.toLowerCase() !== correction.accountId.toLowerCase()) return false;
  if (correction.scope === 'sender') {
    if (!correction.senderEmail || item.citation.senderEmail?.toLowerCase() !== correction.senderEmail) return false;
  } else if (item.threadId !== correction.threadId || !correction.messageId
    || item.citation.messageId !== correction.messageId) return false;
  if (correction.reason === 'importantSender') return item.action === 'archive';
  if (correction.reason === 'noReply') return item.action === 'draftReply';
  return item.action === correction.action;
}

export function applyReviewCorrections(plan: AgentPlan | null, corrections: ReviewCorrection[]): AgentPlan | null {
  if (!plan) return null;
  const items = plan.items.filter(item => !corrections.some(correction => correctionMatches(item, correction)));
  return items.length === plan.items.length ? plan : { ...plan, items, coverage: { ...plan.coverage, proposedActionCount: items.length } };
}

export function canSuggestSenderRule(correction: ReviewCorrection, corrections: ReviewCorrection[]): boolean {
  if (correction.scope !== 'source' || !correction.senderEmail || correction.reason === 'alreadyDone') return false;
  const matching = corrections.filter(item => item.accountId === correction.accountId
    && item.senderEmail === correction.senderEmail && item.reason === correction.reason);
  return !matching.some(item => item.scope === 'sender') && new Set(matching.map(item => item.messageId)).size >= 2;
}
