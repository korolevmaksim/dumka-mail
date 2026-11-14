import { describe, expect, it } from 'vitest';
import {
  canDraftOnRequest,
  createBoundedIdSet,
  draftPreparedInAdvance,
  resolveReplyDockMode,
  shouldOfferPreparedDraft,
  type ReplyDockInput,
} from '../renderer/src/lib/replyDockState';

const idleDraft = { status: 'idle' as const, bodyPlain: '' };
const readyDraft = { status: 'ready' as const, bodyPlain: 'Hi Priya,\n\nThursday the 24th works.' };
/** The default setup: a model is connected, nothing is prepared in advance. */
const base: ReplyDockInput = {
  hasMessages: true,
  inlineDraftActive: false,
  floatingDraftActive: false,
  savedDraft: false,
  modelStatus: 'ok',
  decision: 'reply',
  agentDraft: idleDraft,
  draftsInAdvance: false,
};

describe('resolveReplyDockMode', () => {
  it('shows nothing from the model without a model', () => {
    expect(resolveReplyDockMode({ ...base, modelStatus: 'none', agentDraft: readyDraft })).toBe('idle');
    expect(resolveReplyDockMode({ ...base, modelStatus: 'none', draftsInAdvance: true, agentDraft: readyDraft })).toBe('idle');
  });

  it('stays a plain reply strip until a draft is asked for', () => {
    expect(resolveReplyDockMode(base)).toBe('idle');
    expect(resolveReplyDockMode({ ...base, decision: 'people' })).toBe('idle');
    // A model that failed elsewhere (chat) does not turn every thread into "Draft unavailable".
    expect(resolveReplyDockMode({ ...base, modelStatus: 'unreachable' })).toBe('idle');
    expect(resolveReplyDockMode({ ...base, modelStatus: 'unreachable', decision: 'people' })).toBe('idle');
  });

  it('walks through writing, written and unavailable once a draft was asked for', () => {
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'loading', bodyPlain: '' } })).toBe('preparing');
    expect(resolveReplyDockMode({ ...base, agentDraft: readyDraft })).toBe('prepared');
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'error', bodyPlain: '' } })).toBe('unavailable');
    expect(resolveReplyDockMode({ ...base, agentDraft: { status: 'ready', bodyPlain: '  ' } })).toBe('idle');
  });

  it('a draft asked for on any thread is shown, whatever its section', () => {
    expect(resolveReplyDockMode({ ...base, decision: 'read', agentDraft: readyDraft })).toBe('prepared');
    expect(resolveReplyDockMode({ ...base, decision: null, agentDraft: { status: 'loading', bodyPlain: '' } })).toBe('preparing');
    // Asked for while the model status still says unreachable: the new request is what shows.
    expect(resolveReplyDockMode({ ...base, modelStatus: 'unreachable', agentDraft: { status: 'loading', bodyPlain: '' } })).toBe('preparing');
  });

  it('with drafts in advance, an unreachable model is reported on threads that need a reply', () => {
    const advance = { ...base, draftsInAdvance: true };
    expect(resolveReplyDockMode({ ...advance, modelStatus: 'unreachable' })).toBe('unavailable');
    expect(resolveReplyDockMode({ ...advance, modelStatus: 'unreachable', decision: 'people' })).toBe('unavailable');
    expect(resolveReplyDockMode({ ...advance, modelStatus: 'unreachable', decision: 'read' })).toBe('idle');
    expect(resolveReplyDockMode(advance)).toBe('idle');
  });

  it('the user’s own draft wins over the model’s', () => {
    expect(resolveReplyDockMode({ ...base, inlineDraftActive: true, agentDraft: readyDraft })).toBe('editing');
    expect(resolveReplyDockMode({ ...base, savedDraft: true, agentDraft: readyDraft })).toBe('saved');
    expect(resolveReplyDockMode({ ...base, floatingDraftActive: true })).toBe('floating');
    expect(resolveReplyDockMode({ ...base, hasMessages: false })).toBe('hidden');
  });
});

describe('draftPreparedInAdvance', () => {
  it('is off unless the account turned drafts in advance on', () => {
    expect(draftPreparedInAdvance('ok', 'reply', false)).toBe(false);
    expect(draftPreparedInAdvance('ok', 'reply', true)).toBe(true);
    expect(draftPreparedInAdvance('none', 'reply', true)).toBe(false);
    expect(draftPreparedInAdvance('ok', 'read', true)).toBe(false);
    expect(draftPreparedInAdvance('unreachable', 'people', true)).toBe(true);
  });
});

describe('canDraftOnRequest', () => {
  it('needs a model and an account that lets mail text reach it', () => {
    expect(canDraftOnRequest('ok', true)).toBe(true);
    expect(canDraftOnRequest('unreachable', true)).toBe(true);
    expect(canDraftOnRequest('none', true)).toBe(false);
    expect(canDraftOnRequest('ok', false)).toBe(false);
  });
});

describe('shouldOfferPreparedDraft', () => {
  it('offers a late draft instead of overwriting the editor', () => {
    const input = { mode: 'editing' as const, modelStatus: 'ok' as const, agentDraft: readyDraft, draftCameFromAgent: false };
    expect(shouldOfferPreparedDraft(input)).toBe(true);
    expect(shouldOfferPreparedDraft({ ...input, draftCameFromAgent: true })).toBe(false);
    expect(shouldOfferPreparedDraft({ ...input, mode: 'prepared' })).toBe(false);
    expect(shouldOfferPreparedDraft({ ...input, agentDraft: { status: 'loading', bodyPlain: '' } })).toBe(false);
    expect(shouldOfferPreparedDraft({ ...input, modelStatus: 'none' })).toBe(false);
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
