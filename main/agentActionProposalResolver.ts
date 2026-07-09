import { createHash } from 'node:crypto';
import { LabelsRepo, MessagesRepo, ThreadsRepo } from './database';
import {
  AGENT_ACTION_PROPOSAL_MAX_BODY_CHARS,
  AGENT_ACTION_PROPOSAL_MAX_LABEL_CHARS,
  type AgentActionProposalV1,
} from '../shared/agentActionProposal';
import type {
  AgentPlanItem,
  AgentPlanActionKind,
  AgentPlanRiskLevel,
  AgentPlanValidationResult,
  MailLabelDefinition,
  MailMessage,
  MailboxSearchSource,
  MailThread,
} from '../shared/types';

const MAX_REMINDER_DISTANCE_MS = 366 * 24 * 60 * 60 * 1000;
const EXPLICIT_TIME_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/;
const AI_PROPOSAL_ACTIONS = new Set(['draftReply', 'setReminder', 'archive', 'applyLabel']);

export interface AgentActionProposalRepositories {
  getThread: (accountId: string, threadId: string) => MailThread | null;
  listMessages: (accountId: string, threadId: string) => MailMessage[];
  listLabels: (accountId: string) => MailLabelDefinition[];
}

export interface ResolveAgentActionProposalsInput {
  proposals: AgentActionProposalV1[];
  sources: MailboxSearchSource[];
  requestId: string;
  proposedAt?: string;
}

export interface ResolveAgentActionProposalsResult {
  items: AgentPlanItem[];
  warnings: string[];
}

export type AgentActionProposalMutationAction = Extract<
  AgentPlanActionKind,
  'archive' | 'applyLabel' | 'setReminder'
>;

export interface ValidateAgentActionProposalMutationInput {
  item: AgentPlanItem;
  accountId: string;
  threadId: string;
  action: AgentActionProposalMutationAction;
  labelId?: string | null;
  reminderAt?: string | null;
  allowOptimisticState?: boolean;
}

interface AgentActionProposalValidationOptions {
  allowAlreadyAppliedAction?: AgentActionProposalMutationAction;
}

const defaultRepositories: AgentActionProposalRepositories = {
  getThread: (accountId, threadId) => ThreadsRepo.get(accountId, threadId),
  listMessages: (accountId, threadId) => MessagesRepo.listForThread(accountId, threadId),
  listLabels: accountId => LabelsRepo.list(accountId),
};

function normalizedAccountId(value: string): string {
  return value.trim().toLowerCase();
}

function sourceKey(accountId: string, threadId: string, messageId: string): string {
  return `${normalizedAccountId(accountId)}\n${threadId}\n${messageId}`;
}

function latestMessage(messages: MailMessage[]): MailMessage | null {
  return [...messages].sort((left, right) => {
    const byTime = Date.parse(left.receivedAt) - Date.parse(right.receivedAt);
    return byTime || left.id.localeCompare(right.id);
  }).at(-1) || null;
}

function boundedSnippet(value: string): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  return normalized.length > 320 ? `${normalized.slice(0, 319)}…` : normalized;
}

function stableItemId(
  proposal: AgentActionProposalV1,
  accountId: string,
  threadId: string,
  labelId: string | null,
): string {
  const material = `${normalizedAccountId(accountId)}\n${threadId}\n${proposal.action}\n${labelId || ''}`;
  return `agent:command:${proposal.action}:${createHash('sha256').update(material).digest('hex').slice(0, 24)}`;
}

function titleAndRisk(action: AgentActionProposalV1['action']): { title: string; riskLevel: AgentPlanRiskLevel } {
  if (action === 'draftReply') return { title: 'Review drafted reply', riskLevel: 'medium' };
  if (action === 'setReminder') return { title: 'Set reminder', riskLevel: 'low' };
  if (action === 'applyLabel') return { title: 'Apply label', riskLevel: 'medium' };
  return { title: 'Archive thread', riskLevel: 'medium' };
}

function matchingLabel(labels: MailLabelDefinition[], name: string): MailLabelDefinition | null {
  const normalizedName = name.trim().toLowerCase();
  const matches = labels.filter(label => (
    label.type === 'user'
    && label.name.trim().toLowerCase() === normalizedName
  ));
  return matches.length === 1 ? matches[0] : null;
}

function validReminderAt(value: unknown, now: Date): string | null {
  if (typeof value !== 'string' || !EXPLICIT_TIME_ZONE.test(value)) return null;
  const timestamp = Date.parse(value);
  const nowTime = now.getTime();
  if (!Number.isFinite(timestamp) || timestamp <= nowTime || timestamp - nowTime > MAX_REMINDER_DISTANCE_MS) return null;
  return new Date(timestamp).toISOString();
}

function failure(code: AgentPlanValidationResult['code'], message: string): AgentPlanValidationResult {
  return { valid: false, code, message };
}

export function resolveAgentActionProposals(
  input: ResolveAgentActionProposalsInput,
  repositories: AgentActionProposalRepositories = defaultRepositories,
): ResolveAgentActionProposalsResult {
  const sourceRegistry = new Map<string, MailboxSearchSource>();
  for (const source of input.sources) {
    if (!source.messageId) continue;
    sourceRegistry.set(sourceKey(source.accountId, source.threadId, source.messageId), source);
  }
  const proposedAt = input.proposedAt || new Date().toISOString();

  try {
    const items = input.proposals.map(proposal => {
      const source = sourceRegistry.get(sourceKey(
        proposal.citation.accountId,
        proposal.citation.threadId,
        proposal.citation.messageId,
      ));
      if (!source) throw new Error('A proposal cited a message that was not returned by searchMailbox in this request.');

      const accountId = source.accountId;
      const thread = repositories.getThread(accountId, source.threadId);
      if (!thread || normalizedAccountId(thread.accountId) !== normalizedAccountId(accountId)) {
        throw new Error('A proposal source thread is no longer available in the cited account.');
      }
      const messages = repositories.listMessages(accountId, thread.id);
      const citedMessage = messages.find(message => (
        message.id === source.messageId
        && message.threadId === thread.id
        && normalizedAccountId(message.accountId) === normalizedAccountId(accountId)
      ));
      const newestMessage = latestMessage(messages);
      if (!citedMessage || !newestMessage) throw new Error('A proposal source message is no longer available in the cited thread.');

      let label: MailLabelDefinition | null = null;
      if (proposal.action === 'applyLabel') {
        label = matchingLabel(repositories.listLabels(accountId), proposal.labelName);
        if (!label || normalizedAccountId(label.accountId) !== normalizedAccountId(accountId)) {
          throw new Error(`The label "${proposal.labelName}" does not uniquely match an existing label in the cited account.`);
        }
        if (thread.labelIds.includes(label.id)) throw new Error(`The label "${label.name}" is already applied to the cited thread.`);
      }
      if (proposal.action === 'archive' && !thread.labelIds.some(id => id.toUpperCase() === 'INBOX')) {
        throw new Error('The cited thread is already outside the Inbox.');
      }

      const actionMeta = titleAndRisk(proposal.action);
      const payload: NonNullable<AgentPlanItem['payload']> = {};
      if (proposal.action === 'draftReply') {
        payload.bodyPlain = proposal.bodyPlain;
        payload.sourceMessageId = newestMessage.id;
      } else if (proposal.action === 'setReminder') {
        payload.reminderAt = proposal.reminderAt;
      } else if (proposal.action === 'applyLabel' && label) {
        payload.labelId = label.id;
        payload.labelName = label.name;
      }

      return {
        id: stableItemId(proposal, accountId, thread.id, label?.id || null),
        accountId,
        threadId: thread.id,
        subject: thread.subject,
        sender: citedMessage.senderName || citedMessage.senderEmail,
        action: proposal.action,
        title: actionMeta.title,
        reason: proposal.reason,
        citation: {
          accountId,
          threadId: thread.id,
          messageId: citedMessage.id,
          subject: citedMessage.subject || thread.subject,
          sender: citedMessage.senderName || citedMessage.senderEmail,
          senderEmail: citedMessage.senderEmail,
          snippet: boundedSnippet(citedMessage.snippet || thread.snippet),
          evidence: proposal.reason,
          receivedAt: citedMessage.receivedAt,
        },
        riskLevel: actionMeta.riskLevel,
        confidence: proposal.confidence,
        selectionPolicy: 'manualOnly' as const,
        approvalState: 'proposed' as const,
        sourceItemId: `ai-assistant:${input.requestId}:${citedMessage.id}`,
        provenance: {
          origin: 'aiAssistant' as const,
          requestId: input.requestId,
          proposedAt,
        },
        sourceSnapshot: {
          accountId,
          threadId: thread.id,
          citedMessageId: citedMessage.id,
          latestMessageId: newestMessage.id,
          lastMessageAt: thread.lastMessageAt,
        },
        payload,
      } satisfies AgentPlanItem;
    });

    return { items, warnings: [] };
  } catch (error) {
    return {
      items: [],
      warnings: [error instanceof Error ? error.message : 'AI action proposals could not be resolved safely.'],
    };
  }
}

export function validateAgentActionProposalItem(
  item: AgentPlanItem,
  repositories: AgentActionProposalRepositories = defaultRepositories,
  now: Date = new Date(),
  options: AgentActionProposalValidationOptions = {},
): AgentPlanValidationResult {
  if (item.provenance?.origin !== 'aiAssistant'
    || !item.provenance.requestId
    || !item.sourceSnapshot
    || !AI_PROPOSAL_ACTIONS.has(item.action)) {
    return failure('invalidItem', 'This AI proposal is missing trusted provenance or uses an unsupported action.');
  }

  const snapshot = item.sourceSnapshot;
  const itemAccount = normalizedAccountId(item.accountId);
  if (!itemAccount
    || normalizedAccountId(item.citation.accountId) !== itemAccount
    || normalizedAccountId(snapshot.accountId) !== itemAccount
    || item.citation.threadId !== item.threadId
    || snapshot.threadId !== item.threadId
    || item.citation.messageId !== snapshot.citedMessageId) {
    return failure('accountMismatch', 'The proposal account, thread, or citation no longer matches its reviewed source.');
  }

  const thread = repositories.getThread(item.accountId, item.threadId);
  if (!thread || normalizedAccountId(thread.accountId) !== itemAccount) {
    return failure('threadMissing', 'The proposal source thread is no longer available in the cited account.');
  }
  const messages = repositories.listMessages(item.accountId, item.threadId);
  const citedMessage = messages.find(message => (
    message.id === snapshot.citedMessageId
    && message.threadId === item.threadId
    && normalizedAccountId(message.accountId) === itemAccount
  ));
  const newestMessage = latestMessage(messages);
  if (!citedMessage || !newestMessage) {
    return failure('sourceMissing', 'The proposal source message is no longer available in the cited thread.');
  }
  if (newestMessage.id !== snapshot.latestMessageId || thread.lastMessageAt !== snapshot.lastMessageAt) {
    return failure('staleSource', 'This thread changed after the AI proposal was prepared. Review it again before acting.');
  }

  if (item.action === 'draftReply') {
    const bodyPlain = item.payload?.bodyPlain;
    if (typeof bodyPlain !== 'string'
      || !bodyPlain.trim()
      || bodyPlain.length > AGENT_ACTION_PROPOSAL_MAX_BODY_CHARS
      || bodyPlain.includes('\0')
      || item.payload?.sourceMessageId !== newestMessage.id) {
      return failure('invalidItem', 'The proposed reply body or reply target is invalid.');
    }
  } else if (item.action === 'setReminder') {
    if (!validReminderAt(item.payload?.reminderAt, now)) {
      return failure('invalidItem', 'The proposed reminder time is no longer valid.');
    }
    if (thread.reminderAt === item.payload?.reminderAt) {
      return failure('alreadyApplied', 'This reminder is already set.');
    }
  } else if (item.action === 'archive') {
    if (!thread.labelIds.some(id => id.toUpperCase() === 'INBOX')
      && options.allowAlreadyAppliedAction !== 'archive') {
      return failure('alreadyApplied', 'This thread is already outside the Inbox.');
    }
  } else if (item.action === 'applyLabel') {
    const labelId = item.payload?.labelId;
    const labelName = item.payload?.labelName;
    if (typeof labelId !== 'string'
      || typeof labelName !== 'string'
      || !labelName.trim()
      || labelName.length > AGENT_ACTION_PROPOSAL_MAX_LABEL_CHARS) {
      return failure('labelMissing', 'The proposal does not contain a valid account-scoped label.');
    }
    const label = repositories.listLabels(item.accountId).find(candidate => (
      candidate.id === labelId
      && candidate.name === labelName
      && candidate.type === 'user'
      && normalizedAccountId(candidate.accountId) === itemAccount
    ));
    if (!label) return failure('labelMissing', 'The reviewed label no longer exists in the cited account.');
    if (thread.labelIds.includes(label.id)
      && options.allowAlreadyAppliedAction !== 'applyLabel') {
      return failure('alreadyApplied', 'This label is already applied.');
    }
  }

  return { valid: true, code: 'ready', message: 'Proposal source is current and ready for approval.' };
}

export function validateAgentActionProposalMutation(
  input: ValidateAgentActionProposalMutationInput,
  repositories: AgentActionProposalRepositories = defaultRepositories,
  now: Date = new Date(),
): AgentPlanValidationResult {
  const validation = validateAgentActionProposalItem(input.item, repositories, now, {
    allowAlreadyAppliedAction: input.allowOptimisticState ? input.action : undefined,
  });
  if (!validation.valid) return validation;

  if (normalizedAccountId(input.item.accountId) !== normalizedAccountId(input.accountId)
    || input.item.threadId !== input.threadId
    || input.item.action !== input.action) {
    return failure('accountMismatch', 'The reviewed proposal does not match this account, thread, or mutation.');
  }
  if (input.action === 'applyLabel' && input.item.payload?.labelId !== input.labelId) {
    return failure('labelMissing', 'The reviewed label does not match the requested label mutation.');
  }
  if (input.action === 'setReminder' && input.item.payload?.reminderAt !== input.reminderAt) {
    return failure('invalidItem', 'The reviewed reminder time does not match the requested reminder mutation.');
  }

  return { valid: true, code: 'ready', message: 'Proposal source is current at the mutation boundary.' };
}
