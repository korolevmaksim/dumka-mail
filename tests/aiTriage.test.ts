import { describe, expect, it } from 'vitest';
import {
  buildAITriageContext,
  buildAITriageInstruction,
  buildAITriagePlanFromResponse,
  parseAITriagePlanItems,
} from '../shared/aiTriage';
import type { MailThread } from '../shared/types';

const baseThread: MailThread = {
  id: 'thread-1',
  accountId: 'me@example.com',
  subject: 'Need approval',
  snippet: 'Can you approve the contract today?',
  lastMessageAt: '2026-07-02T09:00:00.000Z',
  senderNames: ['Ada'],
  senderEmail: 'ada@example.com',
  labelIds: ['INBOX', 'UNREAD'],
  hasAttachments: true,
  isUnread: true,
  reminderAt: null,
};

function thread(patch: Partial<MailThread> = {}): MailThread {
  return { ...baseThread, ...patch };
}

describe('AI triage helpers', () => {
  it('builds context with stable thread ids and metadata', () => {
    const context = buildAITriageContext([baseThread]);

    expect(context).toContain('threadId=thread-1');
    expect(context).toContain('subject=Need approval');
    expect(context).toContain('hasAttachments=true');
  });

  it('asks for JSON-only recommendations constrained to known recommendation values', () => {
    const instruction = buildAITriageInstruction('mailboxTriage');

    expect(instruction).toContain('Return JSON only');
    expect(instruction).toContain('reply|reviewAttachment|readNow|setReminder|markDoneCandidate');
  });

  it('parses fenced JSON, filters unknown threads and invalid recommendation kinds, and clamps priority', () => {
    const threads = [
      baseThread,
      thread({ id: 'thread-2', subject: 'Newsletter', senderNames: ['Digest'], senderEmail: 'digest@example.com', hasAttachments: false }),
    ];
    const items = parseAITriagePlanItems(`\`\`\`json
{
  "items": [
    { "threadId": "thread-unknown", "recommendation": "reply", "reason": "Ignore unknown", "priority": 99 },
    { "threadId": "thread-2", "recommendation": "deleteEverything", "reason": "Invalid action", "priority": 50 },
    { "threadId": "thread-1", "recommendation": "reviewAttachment", "reason": "Contract attached", "priority": 140 }
  ]
}
\`\`\``, threads);

    expect(items).toEqual([{
      threadId: 'thread-1',
      subject: 'Need approval',
      sender: 'Ada',
      recommendation: 'reviewAttachment',
      reason: 'Contract attached',
      priority: 100,
      automationRuleIds: [],
    }]);
  });

  it('builds a plan from a valid AI response', () => {
    const plan = buildAITriagePlanFromResponse({
      accountId: 'me@example.com',
      sourceTitle: 'important',
      generatedAt: '2026-07-02T10:00:00.000Z',
      sourceThreadCount: 1,
      intent: 'mailboxTriage',
      automationRulePreview: null,
      responseText: '{"items":[{"threadId":"thread-1","recommendation":"reply","reason":"Needs approval","priority":88}]}',
      threads: [baseThread],
    });

    expect(plan).toMatchObject({
      accountId: 'me@example.com',
      sourceTitle: 'important',
      sourceThreadCount: 1,
      intent: 'mailboxTriage',
      items: [{ threadId: 'thread-1', recommendation: 'reply', priority: 88 }],
    });
  });

  it('throws when the response has no usable recommendations', () => {
    expect(() => parseAITriagePlanItems('{"items":[{"threadId":"missing","recommendation":"reply"}]}', [baseThread]))
      .toThrow('valid thread recommendations');
  });
});
