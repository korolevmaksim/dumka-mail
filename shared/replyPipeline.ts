import type {
  AccountID,
  DraftID,
  ReplyPipelineActiveStatus,
  ReplyPipelineCandidate,
  ReplyPipelineDraftOrigin,
  ReplyPipelineState,
  ReplyPipelineStatus,
  ThreadID,
} from './types';
import { htmlFragmentToPlainText } from './draftHtml';

export type ReplyPipelineTime = Date | string;

export interface ReplyPipelineInboundEvent {
  accountId: AccountID;
  threadId: ThreadID;
  receivedAt: string;
}

const RESUMABLE_STATUSES = new Set([
  'needsReply',
  'draftReady',
  'waitingOnThem',
  'due',
] as const);

const SQUARE_PLACEHOLDER = /\[(?:add|insert|write|replace|customize|edit|your|recipient(?:'s)?|sender(?:'s)?|name|company|date|time|details?|reply|response|availability|meeting\s+link|todo|tbd)\b[^\]\r\n]{0,100}\]/gi;
const MUSTACHE_PLACEHOLDER = /\{\{\s*[a-z][a-z0-9_. -]{0,80}\s*\}\}/gi;
const ANGLE_PLACEHOLDER = /<<\s*[a-z][a-z0-9_. -]{0,80}\s*>>/gi;
const QUOTED_REPLY_START = /\n{2,}On [^\n]{1,500} wrote:\n(?=>)/i;
const QUOTED_REPLY_HTML_START = /<(?:div|blockquote)\b[^>]*data-dumka-quoted-reply\s*=\s*["']true["'][^>]*>/i;

function isActiveStatus(status: ReplyPipelineStatus): status is ReplyPipelineActiveStatus {
  return RESUMABLE_STATUSES.has(status as ReplyPipelineActiveStatus);
}

export function canPrepareReplyPipelineDraft(state: ReplyPipelineState): boolean {
  return state.status === 'needsReply' || state.status === 'due' || state.status === 'draftReady';
}

export function canPrepareReplyPipelineCandidateDraft(
  state: ReplyPipelineState | null,
  candidate: ReplyPipelineCandidate,
): boolean {
  return Boolean(
    state
    && state.accountId === candidate.accountId
    && state.threadId === candidate.threadId
    && state.sourceMessageId === candidate.sourceMessageId
    && state.sourceKind === candidate.sourceKind
    && canPrepareReplyPipelineDraft(state)
  );
}

function timestamp(value: ReplyPipelineTime): number {
  const parsed = value instanceof Date ? value.getTime() : Date.parse(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Invalid reply pipeline timestamp: ${String(value)}`);
  return parsed;
}

function iso(value: ReplyPipelineTime): string {
  return new Date(timestamp(value)).toISOString();
}

function createReplyPipelineState(
  candidate: ReplyPipelineCandidate,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  const changedAt = iso(now);
  const sourceReceivedAt = iso(candidate.sourceReceivedAt);
  return {
    accountId: candidate.accountId,
    threadId: candidate.threadId,
    sourceMessageId: candidate.sourceMessageId,
    sourceReceivedAt,
    sourceKind: candidate.sourceKind,
    status: candidate.status,
    resumeStatus: null,
    draftId: null,
    draftOrigin: null,
    hasPlaceholders: false,
    waitingSince: candidate.status === 'due' && candidate.sourceKind === 'outbound'
      ? sourceReceivedAt
      : null,
    dueAt: null,
    snoozedUntil: null,
    reason: candidate.reason,
    priority: candidate.priority,
    resolvedAt: null,
    createdAt: changedAt,
    updatedAt: changedAt,
  };
}

function belongsToSameRow(state: ReplyPipelineState, candidate: ReplyPipelineCandidate): boolean {
  return state.accountId === candidate.accountId && state.threadId === candidate.threadId;
}

function hasSameSource(state: ReplyPipelineState, candidate: ReplyPipelineCandidate): boolean {
  return state.sourceMessageId === candidate.sourceMessageId && state.sourceKind === candidate.sourceKind;
}

/**
 * Reconciles the latest deterministic candidate into the single current row for a thread.
 * Refreshes never downgrade the same source. A different source reopens the row only when
 * its received timestamp is strictly newer than the current source timestamp.
 */
export function reconcileReplyPipelineCandidate(
  current: ReplyPipelineState | null,
  candidate: ReplyPipelineCandidate,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  if (!current || !belongsToSameRow(current, candidate)) {
    return createReplyPipelineState(candidate, now);
  }

  const advanced = advanceReplyPipelineState(current, now);
  if (!hasSameSource(advanced, candidate)) {
    if (timestamp(candidate.sourceReceivedAt) <= timestamp(advanced.sourceReceivedAt)) return advanced;
    return createReplyPipelineState(candidate, now);
  }

  if (advanced.reason === candidate.reason && advanced.priority === candidate.priority) return advanced;
  return {
    ...advanced,
    reason: candidate.reason,
    priority: candidate.priority,
    updatedAt: iso(now),
  };
}

export function markReplyPipelineDraftReady(
  state: ReplyPipelineState,
  draftId: DraftID,
  draftOrigin: ReplyPipelineDraftOrigin,
  hasPlaceholders: boolean,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  if (!['needsReply', 'due', 'draftReady'].includes(state.status)) {
    throw new Error(`Cannot prepare a reply draft from ${state.status}.`);
  }
  if (!draftId.trim()) throw new Error('Reply pipeline draft id is required.');

  return {
    ...state,
    status: 'draftReady',
    resumeStatus: null,
    draftId,
    draftOrigin,
    hasPlaceholders,
    snoozedUntil: null,
    resolvedAt: null,
    updatedAt: iso(now),
  };
}

export function markReplyPipelineSent(
  state: ReplyPipelineState,
  sentAt: ReplyPipelineTime,
  dueAt: ReplyPipelineTime,
  now: ReplyPipelineTime = sentAt,
): ReplyPipelineState {
  const sentAtIso = iso(sentAt);
  const dueAtIso = iso(dueAt);
  if (timestamp(dueAtIso) <= timestamp(sentAtIso)) {
    throw new RangeError('Reply pipeline due time must be after the sent time.');
  }

  return {
    ...state,
    sourceMessageId: state.draftId ? `pending-send:${state.draftId}` : state.sourceMessageId,
    sourceKind: 'outbound',
    sourceReceivedAt: sentAtIso,
    status: 'waitingOnThem',
    resumeStatus: null,
    draftId: null,
    draftOrigin: null,
    hasPlaceholders: false,
    waitingSince: sentAtIso,
    dueAt: dueAtIso,
    snoozedUntil: null,
    resolvedAt: null,
    updatedAt: iso(now),
  };
}

export function snoozeReplyPipelineState(
  state: ReplyPipelineState,
  snoozedUntil: ReplyPipelineTime,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  const changedAt = iso(now);
  const until = iso(snoozedUntil);
  if (timestamp(until) <= timestamp(changedAt)) {
    throw new RangeError('Reply pipeline snooze time must be in the future.');
  }

  const resumeStatus = state.status === 'snoozed'
    ? state.resumeStatus
    : isActiveStatus(state.status) ? state.status : null;
  if (!resumeStatus) {
    throw new Error(`Cannot snooze reply pipeline state ${state.status}.`);
  }

  return {
    ...state,
    status: 'snoozed',
    resumeStatus,
    snoozedUntil: until,
    updatedAt: changedAt,
  };
}

export function resumeReplyPipelineState(
  state: ReplyPipelineState,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  if (state.status !== 'snoozed') return state;
  if (!state.resumeStatus) throw new Error('Snoozed reply pipeline state has no resume status.');
  return {
    ...state,
    status: state.resumeStatus,
    resumeStatus: null,
    snoozedUntil: null,
    updatedAt: iso(now),
  };
}

/** Restores expired snoozes, then advances waiting rows whose follow-up time has arrived. */
export function advanceReplyPipelineState(
  state: ReplyPipelineState,
  now: ReplyPipelineTime,
): ReplyPipelineState {
  const nowMs = timestamp(now);
  let next = state;

  if (next.status === 'snoozed' && next.snoozedUntil && timestamp(next.snoozedUntil) <= nowMs) {
    next = resumeReplyPipelineState(next, now);
  }
  if (next.status === 'waitingOnThem' && next.dueAt && timestamp(next.dueAt) <= nowMs) {
    next = {
      ...next,
      status: 'due',
      updatedAt: iso(now),
    };
  }

  return next;
}

/**
 * Marks a waiting cycle resolved when a later inbound message arrives. The original source
 * stays anchored so reconciling that inbound message as actionable can open a new cycle.
 */
export function resolveReplyPipelineForInbound(
  state: ReplyPipelineState,
  inbound: ReplyPipelineInboundEvent,
  now?: ReplyPipelineTime,
): ReplyPipelineState;
export function resolveReplyPipelineForInbound(
  state: null,
  inbound: ReplyPipelineInboundEvent,
  now?: ReplyPipelineTime,
): null;
export function resolveReplyPipelineForInbound(
  state: ReplyPipelineState | null,
  inbound: ReplyPipelineInboundEvent,
  now: ReplyPipelineTime = inbound.receivedAt,
): ReplyPipelineState | null {
  if (!state || state.accountId !== inbound.accountId || state.threadId !== inbound.threadId) return state;
  const waitingStatus = state.status === 'waitingOnThem'
    || state.status === 'due'
    || (state.status === 'snoozed'
      && (state.resumeStatus === 'waitingOnThem' || state.resumeStatus === 'due'));
  if (!waitingStatus || !state.waitingSince) return state;

  const receivedAt = iso(inbound.receivedAt);
  if (timestamp(receivedAt) <= timestamp(state.waitingSince)) return state;

  return {
    ...state,
    status: 'resolved',
    resumeStatus: null,
    draftId: null,
    draftOrigin: null,
    hasPlaceholders: false,
    dueAt: null,
    snoozedUntil: null,
    resolvedAt: receivedAt,
    updatedAt: iso(now),
  };
}

export function detectReplyDraftPlaceholders(body: string, bodyHtml?: string | null): string[] {
  if (!body && !bodyHtml) return [];
  const htmlQuoteStart = bodyHtml?.search(QUOTED_REPLY_HTML_START) ?? -1;
  const normalized = htmlQuoteStart >= 0 && bodyHtml
    ? htmlFragmentToPlainText(bodyHtml.slice(0, htmlQuoteStart))
    : body.replace(/\r\n?/g, '\n');
  const quoteStart = normalized.search(QUOTED_REPLY_START);
  const editableBody = quoteStart >= 0 ? normalized.slice(0, quoteStart) : normalized;
  const matches = [
    ...(editableBody.match(SQUARE_PLACEHOLDER) || []),
    ...(editableBody.match(MUSTACHE_PLACEHOLDER) || []),
    ...(editableBody.match(ANGLE_PLACEHOLDER) || []),
  ];
  return [...new Set(matches.map(value => value.trim()))];
}

export function hasReplyDraftPlaceholder(body: string, bodyHtml?: string | null): boolean {
  return detectReplyDraftPlaceholders(body, bodyHtml).length > 0;
}

export function replyDraftPlaceholderValidationMessage(body: string, bodyHtml?: string | null): string | null {
  const [placeholder] = detectReplyDraftPlaceholders(body, bodyHtml);
  return placeholder ? `Replace draft placeholder before sending: ${placeholder}` : null;
}

export const advanceReplyPipelineForTime = advanceReplyPipelineState;
export const detectDraftPlaceholders = detectReplyDraftPlaceholders;
