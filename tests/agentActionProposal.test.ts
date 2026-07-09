import { describe, expect, it } from 'vitest';
import {
  AGENT_ACTION_PROPOSAL_END,
  AGENT_ACTION_PROPOSAL_START,
  parseAgentActionProposalResponse,
} from '../shared/agentActionProposal';

const now = new Date('2026-07-09T10:00:00.000Z');
const citation = { accountId: 'me@example.com', threadId: 'thread-1', messageId: 'message-1' };

function responseWith(proposals: unknown[], visibleText = 'I prepared the requested changes.'): string {
  return `${visibleText}\n${AGENT_ACTION_PROPOSAL_START}\n${JSON.stringify({ version: 1, proposals })}\n${AGENT_ACTION_PROPOSAL_END}`;
}

describe('agent action proposal envelope', () => {
  it('parses the four supported actions and removes the machine envelope from visible text', () => {
    const parsed = parseAgentActionProposalResponse(responseWith([
      { action: 'draftReply', citation, reason: 'A reply is due.', confidence: 91, bodyPlain: 'Thanks — I will send the revised document tomorrow.' },
      { action: 'setReminder', citation, reason: 'Follow up tomorrow.', confidence: 82, reminderAt: '2026-07-10T09:00:00+02:00' },
      { action: 'archive', citation, reason: 'The thread is resolved.', confidence: 88 },
      { action: 'applyLabel', citation, reason: 'This belongs to the customer project.', confidence: 78, labelName: 'Customers' },
    ]), now);

    expect(parsed.warning).toBeUndefined();
    expect(parsed.visibleText).toBe('I prepared the requested changes.');
    expect(parsed.proposals.map(proposal => proposal.action)).toEqual([
      'draftReply',
      'setReminder',
      'archive',
      'applyLabel',
    ]);
    expect(parsed.proposals[1]).toMatchObject({ reminderAt: '2026-07-10T07:00:00.000Z' });
  });

  it.each([
    { action: 'send', citation, reason: 'Send now.', confidence: 99 },
    { action: 'unsubscribe', citation, reason: 'Remove sender.', confidence: 80 },
    { action: 'archive', citation, reason: 'Done.', confidence: 80, recipient: 'other@example.com' },
    { action: 'draftReply', citation, reason: 'Reply.', confidence: 80, bodyHtml: '<b>Unsafe</b>' },
    { action: 'setReminder', citation, reason: 'Later.', confidence: 80, reminderAt: '2026-07-10T09:00:00' },
  ])('rejects unsupported or action-inappropriate data atomically', invalidProposal => {
    const parsed = parseAgentActionProposalResponse(responseWith([
      { action: 'archive', citation, reason: 'Valid item.', confidence: 80 },
      invalidProposal,
    ]), now);

    expect(parsed.proposals).toEqual([]);
    expect(parsed.warning).toContain('at least one item was invalid');
  });

  it('rejects duplicate proposals and multiple envelopes', () => {
    const proposal = { action: 'archive', citation, reason: 'Done.', confidence: 80 };
    expect(parseAgentActionProposalResponse(responseWith([proposal, proposal]), now).warning).toContain('duplicate');

    const doubled = `${responseWith([proposal])}\n${responseWith([proposal], '')}`;
    expect(parseAgentActionProposalResponse(doubled, now).warning).toContain('invalid envelope');
  });

  it('leaves ordinary provider text unchanged when no envelope is present', () => {
    expect(parseAgentActionProposalResponse('No mailbox action is needed.', now)).toEqual({
      visibleText: 'No mailbox action is needed.',
      proposals: [],
    });
  });
});
