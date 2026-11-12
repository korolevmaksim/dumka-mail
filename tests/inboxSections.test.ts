import { describe, expect, it } from 'vitest';
import { decideByRules, groupThreadsByDecision, type DecisionEntry } from '../shared/decision';
import {
  buildUserCorrection,
  defaultLaterTime,
  formatLaterChip,
  hasDecisionModel,
  indexDecisionRecords,
  laterSectionActionLabel,
  laterTimeFor,
  normalizeUserDecisionRecord,
  planClearBatch,
  planLaterBatch,
  preparedLines,
  resolveInboxDecision,
  selectGroupBatch,
  selectUnsubscribeBatch,
  summarizeSenders,
  threadEntryKey,
} from '../shared/inboxSections';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailThread, ThreadDecision, ThreadDecisionRecord } from '../shared/types';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;
const context = { accountEmail };

function buildThread(key: string): MailThread {
  const spec = WORK_INBOX.find(thread => thread.key === key);
  if (!spec) throw new Error(`Unknown fixture thread ${key}`);
  const thread = buildMailThreadFromMessages(accountEmail, spec.key, fixtureMessages(spec));
  if (!thread) throw new Error(`Fixture thread ${key} has no messages`);
  return thread;
}

const threads = WORK_INBOX.map(spec => buildThread(spec.key));
const byId = new Map(threads.map(thread => [thread.id, thread]));
const entries: DecisionEntry[] = threads.map(thread => ({ thread, decision: decideByRules(thread, context) }));

function record(thread: MailThread, overrides: Partial<ThreadDecisionRecord>): ThreadDecisionRecord {
  return {
    accountId: thread.accountId,
    threadId: thread.id,
    lastMessageId: thread.signals?.lastMessageId || null,
    decision: 'clear',
    reason: '',
    source: 'user',
    laterAt: null,
    model: null,
    createdAt: '2026-11-12T08:00:00.000Z',
    ...overrides,
  };
}

function entry(thread: MailThread, decision: Partial<ThreadDecision>): DecisionEntry {
  return { thread, decision: { decision: 'clear', reason: '', source: 'rule', protected: false, laterAt: null, ...decision } };
}

describe('hasDecisionModel', () => {
  it('is true only for a configured provider', () => {
    expect(hasDecisionModel(null)).toBe(false);
    expect(hasDecisionModel({ preference: 'disabled', status: 'AI disabled in settings' })).toBe(false);
    expect(hasDecisionModel({ preference: 'openAI', status: 'Missing API Key' })).toBe(false);
    expect(hasDecisionModel({ preference: 'automatic', status: 'No AI keys configured' })).toBe(false);
    expect(hasDecisionModel({ preference: 'openAI', status: 'Configured' })).toBe(true);
  });
});

describe('resolveInboxDecision', () => {
  const pilot = byId.get('pilot-date')!;
  const dispatch = byId.get('dispatch-212')!;

  it('falls back to the rules without records', () => {
    expect(resolveInboxDecision(pilot, context, undefined)).toMatchObject({ decision: 'people', source: 'rule', protected: true });
  });

  it('lets a current user correction win over a model record', () => {
    const stored = {
      model: record(dispatch, { source: 'model', decision: 'read', reason: 'Product notes' }),
      user: record(dispatch, { source: 'user', decision: 'people' }),
    };
    expect(resolveInboxDecision(dispatch, context, stored)).toMatchObject({ decision: 'people', source: 'user' });
  });

  it('ignores a stale user correction and uses the current model record', () => {
    const stored = {
      model: record(dispatch, { source: 'model', decision: 'read', reason: 'Product notes' }),
      user: record(dispatch, { source: 'user', decision: 'people', lastMessageId: 'older-message' }),
    };
    expect(resolveInboxDecision(dispatch, context, stored)).toMatchObject({ decision: 'read', source: 'model' });
  });

  it('keeps protected when a person thread is moved to Clear, so it never joins a batch', () => {
    const moved = resolveInboxDecision(pilot, context, { user: record(pilot, { decision: 'clear' }) });
    expect(moved).toMatchObject({ decision: 'clear', source: 'user', protected: true });
    const batch = selectGroupBatch({ entries: [{ thread: pilot, decision: moved }], frozenKeys: null });
    expect(batch).toEqual([]);
  });

  it('applies a correction made on a thread that has no last message id yet', () => {
    const bare = { ...dispatch, signals: undefined };
    const stored = { user: record(bare, { decision: 'read', lastMessageId: null }) };
    expect(resolveInboxDecision(bare, context, stored)).toMatchObject({ decision: 'read', source: 'user' });
  });
});

describe('indexDecisionRecords', () => {
  it('splits rows by source per thread and skips rule rows', () => {
    const dispatch = byId.get('dispatch-212')!;
    const indexed = indexDecisionRecords([
      record(dispatch, { source: 'model', decision: 'later' }),
      record(byId.get('receipt')!, { source: 'user', decision: 'read' }),
      record(byId.get('parcel')!, { source: 'rule' }),
    ]);
    expect(Object.keys(indexed).sort()).toEqual(['dispatch-212', 'receipt']);
    expect(indexed['dispatch-212'].model?.decision).toBe('later');
    expect(indexed.receipt.user?.decision).toBe('read');
  });
});

describe('later time', () => {
  const now = new Date(2026, 10, 12, 16, 30);

  it('defaults to tomorrow 09:00 local time', () => {
    const at = defaultLaterTime(now);
    expect([at.getFullYear(), at.getMonth(), at.getDate(), at.getHours(), at.getMinutes()]).toEqual([2026, 10, 13, 9, 0]);
  });

  it('rolls over month ends', () => {
    const at = defaultLaterTime(new Date(2026, 10, 30, 23, 0));
    expect([at.getMonth(), at.getDate(), at.getHours()]).toEqual([11, 1, 9]);
  });

  it('uses a valid future suggestion and ignores past or invalid ones', () => {
    const future = new Date(2026, 10, 18, 17, 0).toISOString();
    expect(laterTimeFor({ laterAt: future }, now).toISOString()).toBe(future);
    expect(laterTimeFor({ laterAt: new Date(2026, 10, 1).toISOString() }, now).getDate()).toBe(13);
    expect(laterTimeFor({ laterAt: 'not a date' }, now).getHours()).toBe(9);
    expect(laterTimeFor({ laterAt: null }, now).getDate()).toBe(13);
  });

  it('formats chips relative to today', () => {
    expect(formatLaterChip(new Date(2026, 10, 13, 9, 0), now)).toBe('Tomorrow 09:00');
    expect(formatLaterChip(new Date(2026, 10, 12, 18, 5), now)).toBe('Today 18:05');
    expect(formatLaterChip(new Date(2026, 10, 18, 17, 0), now)).toBe('Wed 17:00');
  });

  it('labels the Later section action', () => {
    const later = ['pr-482', 'nw-1432'].map(key => entry(byId.get(key)!, { decision: 'later' }));
    expect(laterSectionActionLabel(later, now)).toBe('All to tomorrow 09:00');
    const mixed = [...later, entry(byId.get('doc-comment')!, { decision: 'later', laterAt: new Date(2026, 10, 18, 17).toISOString() })];
    expect(laterSectionActionLabel(mixed, now)).toBe('All to their suggested times');
  });
});

describe('group batches', () => {
  const clearSection = groupThreadsByDecision(entries, false).find(section => section.decision === 'clear')!;
  const keys = clearSection.entries.map(item => threadEntryKey(item.thread));

  it('archives every Clear row when the group is not frozen', () => {
    expect(planClearBatch({ entries: clearSection.entries, frozenKeys: null }).map(thread => thread.id).sort())
      .toEqual(['dispatch-212', 'linkedin-requests', 'product-weekly']);
  });

  it('leaves out rows that arrived after the group was opened and unchecked rows', () => {
    const frozenKeys = new Set(keys.filter(key => !key.endsWith(':product-weekly')));
    const excludedKeys = new Set([threadEntryKey(byId.get('linkedin-requests')!)]);
    expect(planClearBatch({ entries: clearSection.entries, frozenKeys, excludedKeys }).map(thread => thread.id))
      .toEqual(['dispatch-212']);
  });

  it('never includes protected or non-batchable decisions, whatever the input', () => {
    const mixed = [
      entry(byId.get('pilot-date')!, { decision: 'clear', protected: true }),
      entry(byId.get('sso-signin')!, { decision: 'clear', protected: true }),
      entry(byId.get('receipt')!, { decision: 'automated' }),
      entry(byId.get('dispatch-212')!, { decision: 'clear' }),
    ];
    expect(selectGroupBatch({ entries: mixed, frozenKeys: null }).map(item => item.thread.id)).toEqual(['dispatch-212']);
  });

  it('plans Later reminders with each row’s suggested time', () => {
    const now = new Date(2026, 10, 12, 10, 0);
    const suggestion = new Date(2026, 10, 18, 17, 0).toISOString();
    const later = [
      entry(byId.get('pr-482')!, { decision: 'later' }),
      entry(byId.get('doc-comment')!, { decision: 'later', laterAt: suggestion }),
      entry(byId.get('pilot-date')!, { decision: 'later', protected: true }),
    ];
    const plan = planLaterBatch({ entries: later, frozenKeys: null }, now);
    expect(plan.map(item => item.thread.id)).toEqual(['pr-482', 'doc-comment']);
    expect(plan[0].at.getDate()).toBe(13);
    expect(plan[0].at.getHours()).toBe(9);
    expect(plan[1].at.toISOString()).toBe(suggestion);
  });

  it('selects unsubscribe senders but never protected threads', () => {
    const list = [
      entry(byId.get('fieldnote-promo')!, { decision: 'unsubscribe' }),
      entry(byId.get('loft-promo')!, { decision: 'unsubscribe', protected: true }),
      entry(byId.get('devconf-cfp')!, { decision: 'unsubscribe' }),
    ];
    const excludedKeys = new Set([threadEntryKey(byId.get('devconf-cfp')!)]);
    expect(selectUnsubscribeBatch({ entries: list, frozenKeys: null, excludedKeys }).map(item => item.thread.id)).toEqual(['fieldnote-promo']);
  });
});

describe('summarizeSenders', () => {
  it('lists distinct senders in order with counts', () => {
    const summary = summarizeSenders([
      { senderNames: ['CodeForge'], senderEmail: 'a@codeforge.example' },
      { senderNames: ['Trackline'], senderEmail: 'b@trackline.example' },
      { senderNames: ['CodeForge'], senderEmail: 'a@codeforge.example' },
      { senderNames: [], senderEmail: 'news@paper.example' },
    ]);
    expect(summary).toBe('CodeForge 2, Trackline, news@paper.example');
  });
});

describe('preparedLines', () => {
  it('describes the no-model section set without claiming drafts or summaries', () => {
    const sections = groupThreadsByDecision(entries, false);
    const lines = preparedLines(sections, new Date(2026, 10, 12, 10));
    expect(lines.map(line => line.decision)).toEqual(['people', 'read', 'event', 'automated', 'clear', 'unsubscribe']);
    expect(lines.find(line => line.decision === 'people')).toMatchObject({ count: 8, keys: ['↩'] });
    expect(lines.find(line => line.decision === 'clear')).toMatchObject({ count: 3, keys: ['⇧', 'E'] });
    expect(lines.find(line => line.decision === 'unsubscribe')).toMatchObject({ count: 3, keys: [] });
    const text = lines.map(line => line.text).join(' ');
    expect(text).not.toMatch(/draft|summar/i);
  });

  it('adds the Later line with its key once Later exists', () => {
    const later = [entry(byId.get('pr-482')!, { decision: 'later' })];
    const lines = preparedLines([{ decision: 'later', entries: later }], new Date(2026, 10, 12, 10));
    expect(lines[0]).toMatchObject({ decision: 'later', count: 1, keys: ['⇧', 'H'] });
    expect(lines[0].text).toContain('tomorrow 09:00');
  });
});

describe('user corrections over IPC', () => {
  const thread = byId.get('receipt')!;

  it('builds a user row tied to the last message', () => {
    const now = new Date(2026, 10, 12, 10);
    const row = buildUserCorrection(thread, 'later', { now });
    expect(row).toMatchObject({ accountId: accountEmail, threadId: 'receipt', source: 'user', decision: 'later', model: null });
    expect(row.lastMessageId).toBe(thread.signals?.lastMessageId || null);
    expect(new Date(row.laterAt!).getHours()).toBe(9);
    expect(buildUserCorrection(thread, 'read', { now }).laterAt).toBeNull();
  });

  it('accepts only well-formed user rows', () => {
    const row = buildUserCorrection(thread, 'read');
    expect(normalizeUserDecisionRecord(row)).toMatchObject({ source: 'user', decision: 'read', threadId: 'receipt' });
    expect(normalizeUserDecisionRecord({ ...row, source: 'model' })).toBeNull();
    expect(normalizeUserDecisionRecord({ ...row, decision: 'delete' })).toBeNull();
    expect(normalizeUserDecisionRecord({ ...row, threadId: '' })).toBeNull();
    expect(normalizeUserDecisionRecord('row')).toBeNull();
    expect(normalizeUserDecisionRecord({ ...row, reason: 'x'.repeat(400) })!.reason.length).toBeLessThanOrEqual(120);
    expect(normalizeUserDecisionRecord({ ...row, model: 'gpt' })!.model).toBeNull();
  });
});
