import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildOpenAIDecisionsRequest, parseOpenAIDecisionsResponse } from '../shared/openAIDecisions';
import { sortingCacheKey, sortingCacheMatches, sortingConfig } from '../shared/sortingConfig';
import type { DecisionPromptItem } from '../shared/agentPrompts';

vi.mock('../main/aiConfig', () => ({ loadAIConfigAsync: vi.fn(async () => ({ OPENAI_API_KEY: 'fixture-key' })) }));
import { completeOpenAIDecisions, openAIDecisionsUrl } from '../main/openAIDecisions';

const NOW = new Date('2026-11-13T12:00:00Z');
const item: DecisionPromptItem = { threadId: 't1', senderName: 'Alice', senderEmail: 'alice@example.com',
  subject: 'Please review', date: NOW.toISOString(), ruleDecision: 'people', signals: [], excerpt: 'Can you review this?' };
const options = { model: 'provider-selected-model', minConfidence: 0.8 };
const answer = (overrides: Record<string, unknown> = {}) => ({ type: 'choice', name: 't1', choice: 'reply', confidence: 0.95, ...overrides });
const payload = (...answers: unknown[]) => ({ answers });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('Decisions request and answer mapping', () => {
  it('uses the supplied model and bounded choices for each thread, with mail kept as untrusted data', () => {
    const request = buildOpenAIDecisionsRequest([item], options.model, NOW);
    expect(request.model).toBe(options.model);
    expect(request.questions[0].choices.map(choice => choice.value)).toEqual(['reply', 'read']);
    expect(request.input[0].content).toContain('untrusted');
    expect(request.input[1].content).toEqual([{ type: 'input_json', data: { threads: [item] } }]);
    expect(() => buildOpenAIDecisionsRequest([{ ...item, ruleDecision: 'event' }], options.model, NOW)).toThrow('refinable');
  });

  it('maps a confident category without inventing a deadline or free-form explanation', () => {
    expect(parseOpenAIDecisionsResponse(payload(answer()), [item], 0.8)).toMatchObject({ valid: true,
      items: [{ threadId: 't1', decision: 'reply', laterAt: null }] });
  });

  it('keeps uncertain and refused threads under local rules', () => {
    expect(parseOpenAIDecisionsResponse(payload(answer({ confidence: 0.7 })), [item], 0.8)).toEqual({ valid: true, items: [] });
    expect(parseOpenAIDecisionsResponse(payload({ name: 't1', type: 'refusal' }), [item], 0.8)).toEqual({ valid: true, items: [] });
  });

  it.each([
    payload(), payload(answer(), answer()), payload(answer({ name: 'unknown' })),
    payload(answer({ choice: 'clear' })), payload(answer({ confidence: -1 })), payload(answer({ confidence: 1.1 })),
    payload(answer({ confidence: '0.95' })), { output_text: 'reply' },
  ])('rejects malformed, incomplete or disallowed classifications: %j', value => {
    expect(parseOpenAIDecisionsResponse(value, [item], 0.8).valid).toBe(false);
  });
});

describe('Decisions transport', () => {
  it('calls the Decisions endpoint with the selected model and saved key', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload(answer()))));
    vi.stubGlobal('fetch', fetchMock);
    await expect(completeOpenAIDecisions([item], NOW, options)).resolves.toMatchObject({ valid: true, model: options.model });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/decisions');
    expect(JSON.parse(String(init.body)).model).toBe(options.model);
    expect(init.redirect).toBe('error');
  });

  it('does not issue a request without an explicit model or when already cancelled', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(completeOpenAIDecisions([item], NOW, { ...options, model: '' })).rejects.toMatchObject({ kind: 'config' });
    await expect(completeOpenAIDecisions([item], NOW, { ...options, signal: AbortSignal.abort() })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports unsupported models without leaking provider response bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('private mail and credentials', { status: 400 })));
    const error = await completeOpenAIDecisions([item], NOW, options).catch((error: unknown) => error);
    expect(error).toMatchObject({ kind: 'http', status: 400 });
    expect(String(error)).toContain('selected model supports Decisions');
    expect(String(error)).not.toContain('private mail');
  });

  it('keeps response-body reading cancellable', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => {
      controller.abort(); return payload(answer());
    } })));
    await expect(completeOpenAIDecisions([item], NOW, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('times out a stalled request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
    })));
    const pending = expect(completeOpenAIDecisions([item], NOW, options)).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(30_000); await pending;
  });

  it('derives endpoints without model-name assumptions', () => {
    expect(openAIDecisionsUrl('https://api.example/v1/chat/completions')).toBe('https://api.example/v1/decisions');
    expect(openAIDecisionsUrl('https://api.example/v1/responses')).toBe('https://api.example/v1/decisions');
  });
});

describe('sorting configuration and cache identity', () => {
  it('has no built-in model and does not reuse another engine, model or threshold', () => {
    expect(sortingConfig({})).toEqual({ engine: 'completion', model: '', minConfidence: 0.8 });
    const config = sortingConfig({ sortingEngine: 'openAIDecisions', decisionsModel: options.model });
    const key = sortingCacheKey(config);
    expect(sortingCacheMatches(key, config)).toBe(true);
    expect(sortingCacheMatches(key, { ...config, model: 'different-model' })).toBe(false);
    expect(sortingCacheMatches(key, { ...config, minConfidence: 0.9 })).toBe(false);
    expect(sortingCacheMatches(key, sortingConfig({}))).toBe(false);
    expect(sortingCacheMatches('legacy-model', config)).toBe(false);
  });
});
