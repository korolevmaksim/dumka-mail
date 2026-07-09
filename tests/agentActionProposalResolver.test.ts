import { describe, expect, it } from 'vitest';
import {
  resolveAgentActionProposals,
  validateAgentActionProposalItem,
  validateAgentActionProposalMutation,
  type AgentActionProposalRepositories,
} from '../main/agentActionProposalResolver';
import type {
  AgentPlanItem,
  MailLabelDefinition,
  MailMessage,
  MailboxSearchSource,
  MailThread,
} from '../shared/types';
import type { AgentActionProposalV1 } from '../shared/agentActionProposal';

const accountId = 'me@example.com';
const thread: MailThread = {
  id: 'thread-1',
  accountId,
  subject: 'Canonical project update',
  snippet: 'Canonical thread snippet',
  lastMessageAt: '2026-07-09T09:00:00.000Z',
  senderNames: ['Ada'],
  senderEmail: 'ada@example.com',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};
const message: MailMessage = {
  id: 'message-1',
  threadId: thread.id,
  accountId,
  senderName: 'Ada',
  senderEmail: 'ada@example.com',
  subject: 'Canonical message subject',
  snippet: 'Please confirm the revised launch date.',
  receivedAt: thread.lastMessageAt,
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  to: [],
  cc: [],
  bcc: [],
  bodyPlain: 'Please confirm the revised launch date.',
  bodyHtml: null,
  attachments: [],
};
const label: MailLabelDefinition = {
  id: 'Label_Customers',
  accountId,
  name: 'Customers',
  type: 'user',
};
const source: MailboxSearchSource = {
  accountId,
  threadId: thread.id,
  messageId: message.id,
  subject: 'Provider-controlled subject must not win',
  sender: 'Provider-controlled sender',
  snippet: 'Provider-controlled snippet',
  receivedAt: message.receivedAt,
  lastMessageAt: thread.lastMessageAt,
  sourceKind: 'fts',
};
const citation = { accountId, threadId: thread.id, messageId: message.id };

function repositories(overrides: {
  thread?: MailThread | null;
  messages?: MailMessage[];
  labels?: MailLabelDefinition[];
} = {}): AgentActionProposalRepositories {
  return {
    getThread: () => overrides.thread === undefined ? thread : overrides.thread,
    listMessages: () => overrides.messages || [message],
    listLabels: () => overrides.labels || [label],
  };
}

function proposals(): AgentActionProposalV1[] {
  return [
    { action: 'draftReply', citation, reason: 'Reply with the confirmed date.', confidence: 92, bodyPlain: 'Thanks, the revised launch date works for us.' },
    { action: 'setReminder', citation, reason: 'Check for a response tomorrow.', confidence: 81, reminderAt: '2026-07-10T09:00:00.000Z' },
    { action: 'archive', citation, reason: 'Archive after review.', confidence: 74 },
    { action: 'applyLabel', citation, reason: 'Track this customer thread.', confidence: 86, labelName: 'customers' },
  ];
}

describe('AI action proposal resolver', () => {
  it('builds canonical manual-only Review Queue items for the four supported actions', () => {
    const result = resolveAgentActionProposals({
      proposals: proposals(),
      sources: [source],
      requestId: 'request-1',
      proposedAt: '2026-07-09T10:00:00.000Z',
    }, repositories());

    expect(result.warnings).toEqual([]);
    expect(result.items).toHaveLength(4);
    expect(result.items.every(item => item.selectionPolicy === 'manualOnly')).toBe(true);
    expect(result.items.every(item => item.approvalState === 'proposed')).toBe(true);
    expect(result.items[0]).toMatchObject({
      subject: 'Canonical project update',
      sender: 'Ada',
      citation: {
        subject: 'Canonical message subject',
        snippet: 'Please confirm the revised launch date.',
      },
      payload: {
        bodyPlain: 'Thanks, the revised launch date works for us.',
        sourceMessageId: 'message-1',
      },
      provenance: { origin: 'aiAssistant', requestId: 'request-1' },
      sourceSnapshot: {
        accountId,
        threadId: 'thread-1',
        citedMessageId: 'message-1',
        latestMessageId: 'message-1',
      },
    });
    expect(result.items[3].payload).toMatchObject({ labelId: label.id, labelName: label.name });

    const repeated = resolveAgentActionProposals({
      proposals: proposals(),
      sources: [source],
      requestId: 'request-later',
      proposedAt: '2026-07-09T11:00:00.000Z',
    }, repositories());
    expect(repeated.items.map(item => item.id)).toEqual(result.items.map(item => item.id));
  });

  it('rejects the whole envelope when a citation was not returned in the same request', () => {
    const result = resolveAgentActionProposals({
      proposals: [{ ...proposals()[2], citation: { ...citation, accountId: 'other@example.com' } }],
      sources: [source],
      requestId: 'request-2',
    }, repositories());

    expect(result.items).toEqual([]);
    expect(result.warnings[0]).toContain('not returned by searchMailbox');
  });

  it('rejects missing and ambiguous account-scoped labels', () => {
    const proposal = proposals()[3];
    const missing = resolveAgentActionProposals({ proposals: [proposal], sources: [source], requestId: 'request-3' }, repositories({ labels: [] }));
    const ambiguous = resolveAgentActionProposals({ proposals: [proposal], sources: [source], requestId: 'request-4' }, repositories({ labels: [label, { ...label, id: 'Label_2' }] }));

    expect(missing.items).toEqual([]);
    expect(ambiguous.items).toEqual([]);
    expect(missing.warnings[0]).toContain('does not uniquely match');
  });

  it('rejects system labels so applyLabel cannot encode unsupported mailbox actions', () => {
    const proposal = { ...proposals()[3], labelName: 'TRASH' } as AgentActionProposalV1;
    const systemLabel: MailLabelDefinition = {
      id: 'TRASH',
      accountId,
      name: 'TRASH',
      type: 'system',
    };
    const resolved = resolveAgentActionProposals(
      { proposals: [proposal], sources: [source], requestId: 'request-system-label' },
      repositories({ labels: [systemLabel] }),
    );

    expect(resolved.items).toEqual([]);
    expect(resolved.warnings[0]).toContain('does not uniquely match');

    const reviewedItem = resolveAgentActionProposals({
      proposals: [proposals()[3]],
      sources: [source],
      requestId: 'request-user-label',
    }, repositories()).items[0];
    expect(validateAgentActionProposalItem(
      reviewedItem,
      repositories({ labels: [{ ...label, type: 'system' }] }),
      new Date('2026-07-09T10:00:00.000Z'),
    )).toMatchObject({ valid: false, code: 'labelMissing' });
  });

  it('blocks approval after the source changes or the item account is tampered with', () => {
    const item = resolveAgentActionProposals({
      proposals: [proposals()[0]],
      sources: [source],
      requestId: 'request-5',
    }, repositories()).items[0];
    const newerMessage: MailMessage = {
      ...message,
      id: 'message-2',
      receivedAt: '2026-07-09T09:30:00.000Z',
    };

    expect(validateAgentActionProposalItem(item, repositories(), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: true, code: 'ready' });
    expect(validateAgentActionProposalItem(item, repositories({ messages: [message, newerMessage] }), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: false, code: 'staleSource' });

    const tampered: AgentPlanItem = { ...item, accountId: 'other@example.com' };
    expect(validateAgentActionProposalItem(tampered, repositories(), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: false, code: 'accountMismatch' });
  });

  it('revalidates the exact account-scoped label at approval time', () => {
    const item = resolveAgentActionProposals({
      proposals: [proposals()[3]],
      sources: [source],
      requestId: 'request-6',
    }, repositories()).items[0];

    expect(validateAgentActionProposalItem(item, repositories({ labels: [] }), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({
      valid: false,
      code: 'labelMissing',
    });
  });

  it('revalidates the exact action payload again at the mutation boundary', () => {
    const reminderItem = resolveAgentActionProposals({
      proposals: [proposals()[1]],
      sources: [source],
      requestId: 'request-reminder-boundary',
    }, repositories()).items[0];
    const labelItem = resolveAgentActionProposals({
      proposals: [proposals()[3]],
      sources: [source],
      requestId: 'request-label-boundary',
    }, repositories()).items[0];

    expect(validateAgentActionProposalMutation({
      item: reminderItem,
      accountId,
      threadId: thread.id,
      action: 'setReminder',
      reminderAt: reminderItem.payload?.reminderAt,
    }, repositories(), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: true });
    expect(validateAgentActionProposalMutation({
      item: reminderItem,
      accountId,
      threadId: thread.id,
      action: 'setReminder',
      reminderAt: '2026-07-11T09:00:00.000Z',
    }, repositories(), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: false, code: 'invalidItem' });
    expect(validateAgentActionProposalMutation({
      item: labelItem,
      accountId,
      threadId: thread.id,
      action: 'applyLabel',
      labelId: 'Label_Other',
    }, repositories(), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({ valid: false, code: 'labelMissing' });
  });

  it('blocks a mailbox mutation when the source becomes stale after renderer approval', () => {
    const archiveItem = resolveAgentActionProposals({
      proposals: [proposals()[2]],
      sources: [source],
      requestId: 'request-archive-boundary',
    }, repositories()).items[0];
    const newerMessage: MailMessage = {
      ...message,
      id: 'message-2',
      receivedAt: '2026-07-09T09:30:00.000Z',
    };

    expect(validateAgentActionProposalMutation({
      item: archiveItem,
      accountId,
      threadId: thread.id,
      action: 'archive',
    }, repositories({ messages: [message, newerMessage] }), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({
      valid: false,
      code: 'staleSource',
    });
  });

  it('accepts the expected optimistic label state during an otherwise-current offline replay', () => {
    const archiveItem = resolveAgentActionProposals({
      proposals: [proposals()[2]],
      sources: [source],
      requestId: 'request-archive-replay',
    }, repositories()).items[0];
    const archivedThread = { ...thread, labelIds: [] };

    expect(validateAgentActionProposalMutation({
      item: archiveItem,
      accountId,
      threadId: thread.id,
      action: 'archive',
      allowOptimisticState: true,
    }, repositories({ thread: archivedThread }), new Date('2026-07-09T10:00:00.000Z'))).toMatchObject({
      valid: true,
      code: 'ready',
    });
  });
});
