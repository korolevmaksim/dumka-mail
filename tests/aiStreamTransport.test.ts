import { afterEach, describe, expect, it, vi } from 'vitest';

let mockDescriptor = {
  preference: 'openAICompatible',
  displayName: 'Local Model',
  model: 'local-mail-model',
  transport: 'chat.completions',
  status: 'Configured',
  capabilities: { canTriage: true, canSummarize: true, canDraft: true },
};

let mockAIConfig: Record<string, string> = {
  OPENAI_COMPATIBLE_API_KEY: 'fixture-key',
  OPENAI_COMPATIBLE_BASE_URL: 'http://fake-model.example/v1',
};

vi.mock('../main/aiConfig', () => ({
  getAIProviderDescriptor: vi.fn(async () => mockDescriptor),
  loadAIConfigAsync: vi.fn(async () => mockAIConfig),
}));

import { completeText, isAbortError, ModelRequestError, shouldFallBackToNonStreaming } from '../main/aiStream';

const prompt = { system: 'DUMKA_TASK: thread-summary\nSystem', user: 'User' };

function sseResponse(events: string[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
}

afterEach(() => {
  vi.unstubAllGlobals();
  mockDescriptor = { ...mockDescriptor, preference: 'openAICompatible', model: 'local-mail-model', status: 'Configured' };
  mockAIConfig = { OPENAI_COMPATIBLE_API_KEY: 'fixture-key', OPENAI_COMPATIBLE_BASE_URL: 'http://fake-model.example/v1' };
});

describe('completeText', () => {
  it('streams Chat Completions deltas with stream: true', async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => sseResponse([
      JSON.stringify({ choices: [{ delta: { content: '- One' } }] }),
      JSON.stringify({ choices: [{ delta: { content: '\n- Two' } }] }),
      '[DONE]',
    ]));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const result = await completeText(prompt, { preference: 'automatic', stream: true, onDelta: delta => deltas.push(delta) });
    expect(result).toMatchObject({ text: '- One\n- Two', streamed: true, model: 'local-mail-model' });
    expect(deltas).toEqual(['- One', '\n- Two']);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('http://fake-model.example/v1/chat/completions');
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: 'local-mail-model', stream: true });
    expect(body.messages[0]).toEqual({ role: 'system', content: prompt.system });
  });

  it('falls back to a non-streaming call when the stream fails before the first chunk', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response('stream not supported', { status: 400 }))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Whole answer' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const deltas: string[] = [];
    const result = await completeText(prompt, { preference: 'automatic', stream: true, onDelta: delta => deltas.push(delta) });
    expect(result).toMatchObject({ text: 'Whole answer', streamed: false });
    expect(deltas).toEqual(['Whole answer']);
    expect(JSON.parse(String(fetchMock.mock.calls[1][1].body)).stream).toBe(false);
  });

  it('reads a JSON answer from a server that ignores stream', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ choices: [{ message: { content: 'Plain' } }] })));
    const result = await completeText(prompt, { preference: 'automatic', stream: true });
    expect(result.text).toBe('Plain');
  });

  it('streams Anthropic and Gemini wire formats', async () => {
    mockDescriptor = { ...mockDescriptor, preference: 'anthropic', model: 'claude-test' };
    mockAIConfig = { ANTHROPIC_API_KEY: 'fixture-key' };
    vi.stubGlobal('fetch', vi.fn(async () => sseResponse([
      JSON.stringify({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hi' } }),
      JSON.stringify({ type: 'message_stop' }),
    ])));
    expect((await completeText(prompt, { preference: 'anthropic', stream: true })).text).toBe('Hi');

    mockDescriptor = { ...mockDescriptor, preference: 'gemini', model: 'gemini-test' };
    mockAIConfig = { GEMINI_API_KEY: 'fixture-key' };
    const geminiFetch = vi.fn(async (_url: string) => sseResponse([
      JSON.stringify({ candidates: [{ content: { parts: [{ text: 'Hallo' }] } }] }),
    ]));
    vi.stubGlobal('fetch', geminiFetch);
    expect((await completeText(prompt, { preference: 'gemini', stream: true })).text).toBe('Hallo');
    expect(geminiFetch.mock.calls[0][0]).toContain(':streamGenerateContent?alt=sse&key=');
  });

  it('raises a typed HTTP error after both attempts fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('down', { status: 503 })));
    const error = await completeText(prompt, { preference: 'automatic', stream: true }).catch(caught => caught);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect(error).toMatchObject({ kind: 'http', status: 503 });
  });

  it('aborts without a fallback request', async () => {
    const controller = new AbortController();
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const pending = completeText(prompt, { preference: 'automatic', stream: true, signal: controller.signal });
    await new Promise(resolve => setTimeout(resolve, 0));
    controller.abort();
    const error = await pending.catch(caught => caught);
    expect(isAbortError(error)).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('reports a missing provider as a config error', async () => {
    mockDescriptor = { ...mockDescriptor, preference: 'disabled', status: 'No AI keys found' };
    await expect(completeText(prompt, { preference: 'automatic' })).rejects.toMatchObject({ kind: 'config' });
  });

  it.each([401, 403, 429, 500, 503])('returns HTTP %i from the stream without a second request', async status => {
    const fetchMock = vi.fn(async () => new Response('{"error":"nope"}', { status }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await completeText(prompt, { preference: 'automatic', stream: true }).catch(caught => caught);
    expect(error).toMatchObject({ kind: 'http', status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falls back after a network failure before the first chunk', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError('fetch failed'))
      .mockResolvedValueOnce(jsonResponse({ choices: [{ message: { content: 'Recovered' } }] }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await completeText(prompt, { preference: 'automatic', stream: true });
    expect(result).toMatchObject({ text: 'Recovered', streamed: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not fall back on a timeout', async () => {
    const fetchMock = vi.fn((_url: string, init: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init.signal?.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }));
    vi.stubGlobal('fetch', fetchMock);
    const error = await completeText(prompt, { preference: 'automatic', stream: true, timeoutMs: 5 }).catch(caught => caught);
    expect(error).toMatchObject({ kind: 'timeout' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('delivers no chunk after a cancel', async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    let push: ((text: string) => void) | null = null;
    const body = new ReadableStream<Uint8Array>({
      start(stream) {
        push = text => stream.enqueue(encoder.encode(`data: ${text}\n\n`));
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const deltas: string[] = [];
    const pending = completeText(prompt, {
      preference: 'automatic',
      stream: true,
      signal: controller.signal,
      onDelta: delta => {
        deltas.push(delta);
        // Cancel from inside the first delivery; the same read may carry more.
        controller.abort();
      },
    }).catch(caught => caught);
    await new Promise(resolve => setTimeout(resolve, 0));
    push!(`${JSON.stringify({ choices: [{ delta: { content: 'one' } }] })}\n\ndata: ${JSON.stringify({ choices: [{ delta: { content: 'two' } }] })}`);
    const error = await pending;
    expect(isAbortError(error)).toBe(true);
    expect(deltas).toEqual(['one']);
  });

  it('classifies which stream failures may retry without streaming', () => {
    const http = (status: number) => new ModelRequestError('http', 'openAI', 'x', status);
    expect(shouldFallBackToNonStreaming(http(400), false)).toBe(true);
    expect(shouldFallBackToNonStreaming(http(404), false)).toBe(true);
    for (const status of [401, 403, 429, 500, 502, 503]) expect(shouldFallBackToNonStreaming(http(status), false)).toBe(false);
    expect(shouldFallBackToNonStreaming(new ModelRequestError('network', 'openAI', 'x'), false)).toBe(true);
    expect(shouldFallBackToNonStreaming(new ModelRequestError('network', 'openAI', 'x'), true)).toBe(false);
    expect(shouldFallBackToNonStreaming(new ModelRequestError('timeout', 'openAI', 'x'), false)).toBe(false);
    const abort = Object.assign(new Error('cancelled'), { name: 'AbortError' });
    expect(shouldFallBackToNonStreaming(abort, false)).toBe(false);
  });

  it('keeps provider error text bounded', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('x'.repeat(5000), { status: 401 })));
    const error = await completeText(prompt, { preference: 'automatic', stream: true }).catch(caught => caught);
    expect(error).toBeInstanceOf(ModelRequestError);
    expect((error as Error).message.length).toBeLessThan(400);
  });
});
