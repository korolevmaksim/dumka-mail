import { describe, expect, it } from 'vitest';
import { mayStartDraftRequest } from '../renderer/src/lib/agentDraftRequests';

describe('starting a reply-draft request from the reader', () => {
  it('starts one when nothing was asked for this conversation yet', () => {
    expect(mayStartDraftRequest(undefined, true)).toBe(true);
    expect(mayStartDraftRequest(undefined, false)).toBe(true);
  });

  it('does not start a second request while one is in flight or after one finished', () => {
    expect(mayStartDraftRequest({ requestId: 'req-1', skipped: false }, false)).toBe(false);
    expect(mayStartDraftRequest({ requestId: 'req-1', skipped: false }, true)).toBe(false);
    expect(mayStartDraftRequest({ requestId: null, skipped: false }, false)).toBe(false);
  });

  it('lets Draft a reply through after a draft in advance was declined', () => {
    // The background provider is not set up: the automatic request was skipped.
    expect(mayStartDraftRequest({ requestId: null, skipped: true }, false)).toBe(true);
  });

  it('does not repeat a declined draft in advance on its own', () => {
    expect(mayStartDraftRequest({ requestId: null, skipped: true }, true)).toBe(false);
  });
});
