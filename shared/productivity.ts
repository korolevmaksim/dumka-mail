import type { AgentPlanActionKind } from './types';

interface LocalRecord {
  id: string;
  accountId: string;
  revision: number;
  updatedAt: string;
}

export interface CommitmentEvidence {
  threadId: string;
  messageId: string;
  subject: string;
  sender: string;
  quote: string;
  receivedAt: string;
}

export interface Commitment extends LocalRecord {
  kind: 'commitment';
  title: string;
  direction: 'mine' | 'waiting';
  owner: string;
  dueDate: string | null;
  status: 'confirmed' | 'completed' | 'dismissed';
  evidence: CommitmentEvidence[];
}

export type CorrectionReason = 'noReply' | 'alreadyDone' | 'importantSender';
export interface ReviewCorrection extends LocalRecord {
  kind: 'correction';
  reason: CorrectionReason;
  scope: 'source' | 'sender';
  threadId: string;
  messageId: string;
  senderEmail: string;
  action: AgentPlanActionKind;
  subject: string;
}

export interface SavedMailSearch extends LocalRecord {
  kind: 'search';
  name: string;
  query: string;
  period: 'fixed' | 'lastMonth';
}

export interface AttentionSnooze extends LocalRecord {
  kind: 'snooze';
  threadId: string;
  until: string;
}
export type ProductivityRecord = Commitment | ReviewCorrection | SavedMailSearch | AttentionSnooze;

function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid local record.');
  return value as Record<string, unknown>;
}
function string(value: unknown, max = 2000, empty = false): string {
  if (typeof value !== 'string' || (!empty && !value.trim()) || value.length > max) throw new Error('Invalid local record text.');
  return value.trim();
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== 'string' || !choices.includes(value as T)) throw new Error('Invalid local record option.');
  return value as T;
}
function timestamp(value: unknown): string {
  const result = string(value, 50);
  if (!Number.isFinite(Date.parse(result))) throw new Error('Invalid date.');
  return result;
}

export function validDateOnly(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value))
    && new Date(value).toISOString().slice(0, 10) === value;
}

/** Validate IPC input and persisted JSON instead of trusting renderer types. */
export function parseProductivityRecord(value: unknown): ProductivityRecord {
  const row = object(value);
  if (!Number.isSafeInteger(row.revision) || Number(row.revision) < 0) throw new Error('Invalid record revision.');
  const base = {
    id: string(row.id, 500), accountId: string(row.accountId, 320).toLowerCase(),
    revision: Number(row.revision), updatedAt: timestamp(row.updatedAt),
  };
  if (row.kind === 'search') return {
    ...base, kind: 'search', name: string(row.name, 120), query: string(row.query, 2000),
    period: choice(row.period, ['fixed', 'lastMonth']),
  };
  if (base.accountId === 'unified') throw new Error('Choose a mail account for this record.');
  if (row.kind === 'snooze') return { ...base, kind: 'snooze', threadId: string(row.threadId, 300), until: timestamp(row.until) };
  if (row.kind === 'correction') return {
    ...base, kind: 'correction', reason: choice(row.reason, ['noReply', 'alreadyDone', 'importantSender']),
    scope: choice(row.scope, ['source', 'sender']), threadId: string(row.threadId, 300),
    messageId: string(row.messageId, 300), senderEmail: string(row.senderEmail, 320, true).toLowerCase(),
    action: choice(row.action, ['openThread', 'markRead', 'archive', 'draftReply', 'setReminder', 'applyLabel', 'unsubscribe']),
    subject: string(row.subject, 1000, true),
  };
  if (row.kind !== 'commitment') throw new Error('Unknown local record kind.');
  if (row.dueDate !== null && (typeof row.dueDate !== 'string' || !validDateOnly(row.dueDate))) throw new Error('Choose a valid due date.');
  if (!Array.isArray(row.evidence) || row.evidence.length === 0 || row.evidence.length > 50) throw new Error('Link between one and 50 source messages.');
  const evidence = row.evidence.map(value => {
    const item = object(value);
    return {
      threadId: string(item.threadId, 300), messageId: string(item.messageId, 300),
      subject: string(item.subject, 1000, true), sender: string(item.sender, 320, true),
      quote: string(item.quote, 4000), receivedAt: timestamp(item.receivedAt),
    };
  });
  return {
    ...base, kind: 'commitment', title: string(row.title, 500), owner: string(row.owner, 320),
    direction: choice(row.direction, ['mine', 'waiting']), dueDate: row.dueDate,
    status: choice(row.status, ['confirmed', 'completed', 'dismissed']), evidence,
  };
}
