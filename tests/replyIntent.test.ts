import { describe, expect, it } from 'vitest';
import { isExplicitColdPitch, REPLY_INTENT_POLICY, type ReplyIntentEvidence } from '../shared/replyIntent';
import { buildDecisionBatchPrompt, buildDecisionPromptItem, refineDecisionBatch, type DecisionPromptItem } from '../shared/agentPrompts';
import { buildOpenAIDecisionsRequest } from '../shared/openAIDecisions';
import { decideByRules, resolveThreadDecision } from '../shared/decision';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';
import { sortingCacheKey, sortingCacheMatches, sortingCompletionCacheKey, sortingConfig } from '../shared/sortingConfig';

const pitch: ReplyIntentEvidence = { subject: 'Re: PR idea for Example Ltd',
  excerpt: 'Our PR agency builds earned press coverage. Open to talking about your next business milestone?',
  accountHasReplied: false, senderIsInternal: false };

describe('reply intent', () => {
  it.each([
    pitch,
    { ...pitch, subject: 'SEO services', excerpt: 'We help teams improve rankings. Interested in a quick call?' },
    { ...pitch, subject: 'A proposal', excerpt: 'We provide software services. Respond with no and I will not follow up again.' },
    { ...pitch, excerpt: 'Open to talking through your next business milestone? Kindly respond with a no if this is not a priority.' },
  ])('vetoes a reply to explicit unsolicited commercial outreach: $subject', value => {
    expect(isExplicitColdPitch(value)).toBe(true);
  });

  it.each([
    { ...pitch, accountHasReplied: true },
    { ...pitch, accountHasReplied: undefined },
    { ...pitch, senderIsInternal: true },
    { ...pitch, subject: 'Support request', excerpt: 'Could you help me fix the billing error?' },
    { ...pitch, subject: 'PR services enquiry', excerpt: 'We need PR services. Can you send us a quote?' },
    { ...pitch, subject: 'Product demo', excerpt: 'Can I book a demo of your product?' },
    { ...pitch, subject: 'PR idea for our launch', excerpt: 'Could you review the brief you requested?' },
    { ...pitch, subject: 'Can we chat?', excerpt: 'Are you free for a call tomorrow?' },
  ])('does not infer cold outreach from unfamiliar senders, business terms or a call alone: $subject', value => {
    expect(isExplicitColdPitch(value)).toBe(false);
  });

  it('uses one reply policy in both provider prompts', () => {
    const item: DecisionPromptItem = { ...pitch, threadId: 'fixture-pitch', senderName: 'Fixture Sender',
      senderEmail: 'sender@example.com', date: '2026-11-13T12:00:00Z', ruleDecision: 'people', signals: [] };
    const now = new Date(item.date);
    expect(buildDecisionBatchPrompt([item], now).system).toContain(REPLY_INTENT_POLICY);
    expect(buildOpenAIDecisionsRequest([item], 'chosen-model', now).input[0].content).toContain(REPLY_INTENT_POLICY);
  });

  it('preserves human-thread protection and manual corrections when a confident model suggests replying to a pitch', () => {
    const fixture = WORK_INBOX[0];
    const messages = fixtureMessages(fixture);
    const original = buildMailThreadFromMessages(WORK_ACCOUNT.email, fixture.key, messages);
    if (!original) throw new Error('Missing fixture thread');
    const thread = { ...original, subject: pitch.subject, senderEmail: 'sender@external.example' };
    const rule = decideByRules(thread, { accountEmail: thread.accountId });
    const candidate = { thread, rule, lastMessageId: thread.signals?.lastMessageId || '' };
    const item = { ...buildDecisionPromptItem(candidate, messages.at(-1) || null, false), ...pitch };
    const records = refineDecisionBatch([candidate], [{ threadId: thread.id, decision: 'reply', reason: '99% confident', laterAt: null }], 'chosen-model', new Date(), [item]);
    expect(records[0]).toMatchObject({ decision: 'read', reason: 'Unsolicited outreach; no reply expected.' });
    const resolved = resolveThreadDecision(thread, { accountEmail: thread.accountId }, records[0]);
    expect(resolved).toMatchObject({ decision: 'read', protected: true });
    expect(resolveThreadDecision(thread, { accountEmail: thread.accountId }, { ...records[0], source: 'user', decision: 'reply' }))
      .toMatchObject({ decision: 'reply', source: 'user' });
  });

  it('expires old reply-policy caches for both engines, even with the same model, message and confidence', () => {
    const config = sortingConfig({ sortingEngine: 'openAIDecisions', decisionsModel: 'chosen-model' });
    expect(sortingCacheMatches('openAIDecisions:0.8:chosen-model', config)).toBe(false);
    expect(sortingCacheMatches('chosen-model', sortingConfig({}))).toBe(false);
    expect(sortingCacheMatches(sortingCacheKey(config), config)).toBe(true);
    expect(sortingCacheMatches(sortingCompletionCacheKey('chosen-model'), sortingConfig({}))).toBe(true);
    expect(sortingCacheMatches(sortingCompletionCacheKey('chosen-model'), config)).toBe(false);
  });
});
