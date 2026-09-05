import { describe, expect, it } from 'vitest';
import { parseProductivityRecord, type Commitment, type ReviewCorrection, type SavedMailSearch } from '../shared/productivity';
import { linkCommitmentEvidence, suggestCommitments, suggestedDueDate } from '../shared/commitments';
import { applyReviewCorrections, canSuggestSenderRule, correctionMatches } from '../shared/reviewCorrections';
import { parseSearchQuery } from '../shared/search';
import { resolveSavedSearch, updateSearchFilters } from '../shared/searchFilters';
import { buildTodayAttention } from '../shared/todayAttention';
import type { AgentPlanItem, MailMessage, ReplyPipelineState } from '../shared/types';

const now = '2026-09-05T10:00:00.000Z';
const evidence = { threadId: 't1', messageId: 'm1', subject: 'Budget', sender: 'pat@example.com', quote: 'I will send the budget tomorrow', receivedAt: now };
const commitment: Commitment = { kind: 'commitment', id: 'c1', accountId: 'me@example.com', revision: 0, updatedAt: now,
  title: 'Send budget', owner: 'pat@example.com', direction: 'waiting', dueDate: '2026-09-06', status: 'confirmed', evidence: [evidence] };
const proposal: AgentPlanItem = { id: 'p1', accountId: commitment.accountId, threadId: 't1', subject: 'Budget', sender: 'Pat', action: 'draftReply', title: 'Reply to Pat', reason: 'Direct request',
  citation: { ...evidence, accountId: commitment.accountId, senderEmail: evidence.sender, snippet: evidence.quote, evidence: evidence.quote },
  riskLevel: 'low', confidence: .9, selectionPolicy: 'manualOnly', approvalState: 'proposed' };
const correction: ReviewCorrection = { kind: 'correction', id: 'r1', accountId: commitment.accountId, revision: 0, updatedAt: now,
  scope: 'source', threadId: 't1', messageId: 'm1', senderEmail: evidence.sender, reason: 'noReply', action: 'draftReply', subject: 'Budget' };
const reply: ReplyPipelineState = { accountId: commitment.accountId, threadId: 't1', sourceMessageId: 'm1', sourceReceivedAt: now, sourceKind: 'inbound', status: 'needsReply', resumeStatus: null,
  draftId: null, draftOrigin: null, hasPlaceholders: false, waitingSince: null, dueAt: null, snoozedUntil: null, reason: 'Reply needed', priority: 90, resolvedAt: null, createdAt: now, updatedAt: now };
const message: MailMessage = { id: 'm1', threadId: 't1', accountId: commitment.accountId, senderName: 'Pat', senderEmail: evidence.sender, subject: 'Budget', snippet: evidence.quote,
  receivedAt: now, labelIds: ['INBOX'], hasAttachments: false, isUnread: true, to: [], cc: [], bcc: [], attachments: [] };
const saved: SavedMailSearch = { kind: 'search', id: 's1', accountId: 'unified', revision: 0, updatedAt: now, name: 'Invoices', query: 'invoice has:attachment', period: 'lastMonth' };

describe('local productivity data', () => {
  it('validates records and rejects malformed dates, scope, and revision', () => {
    expect(parseProductivityRecord(commitment)).toEqual(commitment);
    for (const patch of [{ dueDate: '2026-02-30' }, { accountId: 'unified' }, { evidence: [] }, { revision: -1 }, { status: 'sent' }]) {
      expect(() => parseProductivityRecord({ ...commitment, ...patch })).toThrow();
    }
    expect(() => parseProductivityRecord({ ...saved, query: '' })).toThrow();
  });
  it('extracts an explicit promise with a source-relative date and never confirms it', () => {
    const [suggestion] = suggestCommitments(null, [message], []);
    expect(suggestion).toMatchObject({ title: evidence.quote, direction: 'waiting', dueDate: '2026-09-06', owner: evidence.sender });
    expect(suggestion).not.toHaveProperty('status');
    expect(suggestCommitments(null, [message], [{ ...commitment, status: 'completed' }])).toEqual([]);
    expect(suggestCommitments(null, [{ ...message, snippet: 'Thanks for the update' }], [])).toEqual([]);
    expect(suggestCommitments(null, [{ ...message, snippet: `> ${evidence.quote}` }], [])).toEqual([]);
  });
  it('distinguishes my promises and links other threads without closing a commitment', () => {
    expect(suggestCommitments(null, [{ ...message, senderEmail: commitment.accountId }], [])[0].direction).toBe('mine');
    const linked = linkCommitmentEvidence(commitment, commitment.accountId, { ...evidence, messageId: 'm2', threadId: 't2' });
    expect(linked.evidence).toHaveLength(2);
    expect(linked.status).toBe('confirmed');
    expect(linkCommitmentEvidence(linked, commitment.accountId, evidence)).toBe(linked);
    expect(() => linkCommitmentEvidence(commitment, 'other@example.com', evidence)).toThrow();
  });
  it('leaves ambiguous or invalid dates unset', () => {
    expect(suggestedDueDate('send it soon', now)).toBeNull();
    expect(suggestedDueDate('send by 2026-02-30', now)).toBeNull();
    expect(suggestedDueDate('send by Monday', now)).toBe('2026-09-07');
  });
});

describe('review correction semantics', () => {
  it('applies to the same message and action, never another account or a new reply', () => {
    expect(correctionMatches(proposal, correction)).toBe(true);
    expect(correctionMatches({ ...proposal, accountId: 'other@example.com' }, correction)).toBe(false);
    expect(correctionMatches({ ...proposal, citation: { ...proposal.citation, messageId: 'm2' } }, correction)).toBe(false);
    expect(correctionMatches({ ...proposal, action: 'archive' }, correction)).toBe(false);
  });
  it('suggests sender rules only after distinct repeated corrections; activation is explicit', () => {
    expect(canSuggestSenderRule(correction, [correction, { ...correction, id: 'r2' }])).toBe(false);
    expect(canSuggestSenderRule(correction, [correction, { ...correction, id: 'r2', messageId: 'm2' }])).toBe(true);
    const otherThread = { ...proposal, threadId: 't2', citation: { ...proposal.citation, messageId: 'm2' } };
    expect(correctionMatches(otherThread, correction)).toBe(false);
    expect(correctionMatches(otherThread, { ...correction, scope: 'sender' })).toBe(true);
  });
  it('keeps raw proposals intact for undo', () => {
    const plan = { id: 'p', title: 'Review', source: 'command' as const, sourceTitle: 'Test', generatedAt: now, accountId: commitment.accountId,
      items: [proposal], coverage: { sourceThreadCount: 1, proposedActionCount: 1, aiAssisted: false, privacyMode: 'localCache' as const, bodyContextIncluded: false, warnings: [] } };
    expect(applyReviewCorrections(plan, [correction])?.items).toEqual([]);
    expect(plan.items).toHaveLength(1);
    expect(applyReviewCorrections(plan, [])?.items).toEqual([proposal]);
  });
});

describe('search filters', () => {
  it('preserves text, quoted values, and other filters when changing one field', () => {
    const next = updateSearchFilters('from:"Pat Smith" label:"Project Alpha" invoice review has:attachment after:2026-09-01', { from: 'lee@example.com' });
    expect(parseSearchQuery(next)).toEqual({ from: 'lee@example.com', label: 'PROJECT ALPHA', textTerms: ['invoice review'], hasAttachment: true, after: '2026-09-01' });
    expect(parseSearchQuery(updateSearchFilters(next, { after: undefined })).after).toBeUndefined();
  });
  it('resolves rolling saved searches at open time and leaves fixed dates unchanged', () => {
    expect(parseSearchQuery(resolveSavedSearch(saved, new Date(2026, 8, 5)))).toMatchObject({ after: '2026-08-06', hasAttachment: true });
    expect(resolveSavedSearch({ ...saved, period: 'fixed' })).toBe(saved.query);
  });
});

describe('Today attention', () => {
  const input = { accountIds: [commitment.accountId], threads: [], replies: [reply], proposals: [proposal], briefing: [], commitments: [], snoozes: [], corrections: [], now: Date.parse(now) };
  it('deduplicates a thread across queues but preserves distinct commitments', () => {
    expect(buildTodayAttention(input)).toHaveLength(1);
    const result = buildTodayAttention({ ...input, commitments: [commitment, { ...commitment, id: 'c2', title: 'Another deliverable' }] });
    expect(result).toHaveLength(2);
    expect(result.every(item => item.source.kind === 'commitment')).toBe(true);
  });
  it('does not flash old-scope items while the account changes', () => {
    expect(buildTodayAttention({ ...input, accountIds: ['other@example.com'], commitments: [commitment] })).toEqual([]);
  });
  it('respects snoozes until they expire', () => {
    const snooze = { kind: 'snooze' as const, id: 'z', accountId: commitment.accountId, revision: 1, updatedAt: now, threadId: 't1', until: '2026-09-06T10:00:00Z' };
    expect(buildTodayAttention({ ...input, snoozes: [snooze] })).toEqual([]);
    expect(buildTodayAttention({ ...input, snoozes: [snooze], now: Date.parse('2026-09-07') })).toHaveLength(1);
  });
  it('places overdue commitments first and does not reopen completed outcomes on send', () => {
    const result = buildTodayAttention({ ...input, commitments: [{ ...commitment, dueDate: '2026-09-01' }] });
    expect(result[0].priority).toBe(200);
    expect(buildTodayAttention({ ...input, replies: [], proposals: [], commitments: [{ ...commitment, status: 'completed' }] })).toEqual([]);
  });
  it('does not surface a corrected draft again via the reply pipeline', () => {
    expect(buildTodayAttention({ ...input, proposals: [], corrections: [correction] })).toEqual([]);
  });
});
