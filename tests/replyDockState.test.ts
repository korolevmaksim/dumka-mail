import { describe, expect, it } from 'vitest';
import { agentDraftApplies, createBoundedIdSet, resolveReplyDockMode, shouldOfferPreparedDraft, type ReplyDockInput } from '../renderer/src/lib/replyDockState';

const idleDraft = { status: 'idle' as const, bodyPlain: '' };
const readyDraft = { status: 'ready' as const, bodyPlain: 'Hi Priya,\n\nThursday the 24th works.' };
const base: ReplyDockInput = {
  hasMessages: true,
  inlineDraftActive: false,
  floatingDraftActive: false,
  savedDraft: false,
  modelStatus: 'ok',
  decision: 'reply',
  agentDraft: idleDraft,
};

describe('resolveReplyDockMode', () => {
  it('shows nothing agent-related without a model', () => {
    expect(resolveReplyDockMode({ ...base, modelStatus: 'none', agentDraft: readyDraft })).toBe('idle');
    expect(agentDraftApplies('none', 'reply')).toBe(false);
  });

  it('walks through preparing, prepared and unavailable', () => {
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'loading', bodyPlain: '' } })).toBe('preparing');
    expect(resolveReplyDockMode({ ...base, agentDraft: readyDraft })).toBe('prepared');
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'error', bodyPlain: '' } })).toBe('unavailable');
    expect(resolveReplyDockMode({ ...base, modelStatus: 'unreachable', decision: 'people' })).toBe('unavailable');
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'ready', bodyPlain: '  ' } })).toBe('idle');
  });

  it('only prepares drafts for threads that need a reply', () => {
    expect(resolveReplyDockMode({ ...base, decision: 'read', agentDraft: readyDraft })).toBe('idle');
  });

  it('the user’s own draft wins over the prepared one', () => {
    expect(resolveReplyDockMode({ ...base, inlineDraftActive: true, agentDraft: readyDraft })).toBe('editing');
    expect(resolveReplyDockMode({ ...base, savedDraft: true, agentDraft: readyDraft })).toBe('saved');
    expect(resolveReplyDockMode({ ...base, floatingDraftActive: true })).toBe('floating');
    expect(resolveReplyDockMode({ ...base, hasMessages: false })).toBe('hidden');
  });
});

describe('shouldOfferPreparedDraft', () => {
  it('offers a late draft instead of overwriting the editor', () => {
    const input = { mode: 'editing' as const, modelStatus: 'ok' as const, decision: 'reply' as const, agentDraft: readyDraft, draftCameFromAgent: false };
    expect(shouldOfferPreparedDraft(input)).toBe(true);
    expect(shouldOfferPreparedDraft({ ...input, draftCameFromAgent: true })).toBe(false);
    expect(shouldOfferPreparedDraft({ ...input, mode: 'prepared' })).toBe(false);
    expect(shouldOfferPreparedDraft({ ...input, agentDraft: { status: 'loading', bodyPlain: '' } })).toBe(false);
  });
});

describe('createBoundedIdSet', () => {
  it('keeps only the most recent ids', () => {
    const ids = createBoundedIdSet(3);
    for (const id of ['a', 'b', 'c', 'd']) ids.add(id);
    expect(ids.size).toBe(3);
    expect(ids.has('a')).toBe(false);
    expect(ids.has('d')).toBe(true);
  });

  it('refreshes recency when an id is added again', () => {
    const ids = createBoundedIdSet(2);
    ids.add('a');
    ids.add('b');
    ids.add('a');
    ids.add('c');
    expect(ids.has('a')).toBe(true);
    expect(ids.has('b')).toBe(false);
  });

  it('stays bounded over many drafts', () => {
    const ids = createBoundedIdSet(50);
    for (let index = 0; index < 10_000; index += 1) ids.add(`draft-${index}`);
    expect(ids.size).toBe(50);
    expect(ids.has('draft-9999')).toBe(true);
  });
});
