// Plain-text model requests with optional streaming (design-review/SPEC.md §5).
//
// `completeText` sends one system + user prompt (no tools) to the configured
// provider. With `stream: true` it uses the provider's streaming endpoint
// (Chat Completions SSE, Anthropic Messages SSE, Gemini streamGenerateContent)
// and reports deltas. It falls back to the non-streaming call only when the
// endpoint did not stream (rejected the streaming request as unsupported, or
// sent nothing readable) or the connection failed before any text arrived;
// auth, rate-limit, server errors and timeouts are returned as they are.
// Every request is abortable, and no delta is delivered after a cancel. The tool-calling loop in
// `main/ai.ts` (`completeAI`) is unchanged and stays non-streaming.
import type { AIProviderDescriptor, AIProviderPreference } from '../shared/types';
import { geminiSupportsThinkingLevel, getAIProviderConfig } from '../shared/aiProviders';
import { isAIProviderUnavailable, truncateProviderText } from '../shared/aiErrors';
import { AI_CHAT_REQUEST_TIMEOUT_MS } from '../shared/aiRequest';
import { StreamTextParser, type StreamWireFormat } from '../shared/aiStream';
import type { TextPrompt } from '../shared/agentPrompts';
import { getAIProviderDescriptor, loadAIConfigAsync } from './aiConfig';

import { abortError, describeModelError, isAbortError, ModelRequestError, type ModelErrorKind } from './modelErrors';

export { describeModelError, isAbortError, ModelRequestError, type ModelErrorKind };

export interface TextCompletionOptions {
  preference: AIProviderPreference;
  overrideModel?: string;
  stream?: boolean;
  onDelta?: (delta: string) => void;
  signal?: AbortSignal;
  /** Time allowed before the first byte, and between stream chunks. */
  timeoutMs?: number;
  maxTokens?: number;
}

export interface TextCompletionResult {
  text: string;
  model: string;
  provider: AIProviderPreference;
  streamed: boolean;
}

interface WireRequest {
  label: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, unknown>;
  /** Null when this endpoint has no streaming variant. */
  format: StreamWireFormat | null;
  parseJson: (data: unknown) => string;
}

function buildChatCompletionsUrl(endpoint: string): string {
  const trimmed = endpoint.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions') || trimmed.endsWith('/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function record(value: unknown): Record<string, any> {
  return value && typeof value === 'object' ? value as Record<string, any> : {};
}

function chatCompletionText(data: unknown): string {
  const content = record(record(data).choices?.[0]).message?.content;
  return typeof content === 'string' ? content : '';
}

function anthropicText(data: unknown): string {
  const content = record(data).content;
  return Array.isArray(content) ? content.map((block: any) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('') : '';
}

function geminiText(data: unknown): string {
  const parts = record(record(record(data).candidates?.[0]).content).parts;
  return Array.isArray(parts) ? parts.filter((part: any) => part?.thought !== true).map((part: any) => (typeof part?.text === 'string' ? part.text : '')).join('') : '';
}

function responsesText(data: unknown): string {
  const json = record(data);
  if (typeof json.output_text === 'string') return json.output_text;
  if (Array.isArray(json.output)) {
    return json.output.flatMap((item: any) => item?.content || []).map((part: any) => part?.text || '').join('\n');
  }
  return '';
}

function buildWireRequest(
  descriptor: AIProviderDescriptor,
  env: Record<string, string>,
  prompt: TextPrompt,
  stream: boolean,
  maxTokens: number | undefined,
): WireRequest {
  const model = descriptor.model;
  const messages = [
    { role: 'system', content: prompt.system },
    { role: 'user', content: prompt.user },
  ];
  switch (descriptor.preference) {
    case 'openAI': {
      const apiKey = env['OPENAI_API_KEY'];
      if (!apiKey) throw new ModelRequestError('config', 'openAI', 'OpenAI API key missing.');
      const endpoint = env['OPENAI_RESPONSES_URL'] || env['OPENAI_BASE_URL'] || 'https://api.openai.com/v1/chat/completions';
      const headers = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      if (endpoint.includes('/responses')) {
        return {
          label: 'OpenAI',
          url: endpoint,
          headers,
          body: { model, input: `${prompt.system}\n\n${prompt.user}` },
          format: null,
          parseJson: responsesText,
        };
      }
      const body: Record<string, unknown> = { model, messages, stream };
      const effort = env['OPENAI_REASONING_EFFORT'];
      if (effort && effort !== 'disabled') body.reasoning_effort = effort;
      return { label: 'OpenAI', url: endpoint, headers, body, format: 'openai', parseJson: chatCompletionText };
    }
    case 'anthropic': {
      const apiKey = env['ANTHROPIC_API_KEY'];
      if (!apiKey) throw new ModelRequestError('config', 'anthropic', 'Anthropic API key missing.');
      const body: Record<string, unknown> = {
        model,
        max_tokens: maxTokens ?? parseInt(env['ANTHROPIC_MAX_TOKENS'] || '4096', 10),
        system: prompt.system,
        messages: [{ role: 'user', content: prompt.user }],
        ...(stream ? { stream: true } : {}),
      };
      const effort = env['ANTHROPIC_THINKING_EFFORT'];
      if (effort && effort !== 'disabled') {
        body.thinking = { type: 'adaptive' };
        body.output_config = { effort: effort === 'max' ? 'xhigh' : effort };
      }
      return {
        label: 'Anthropic',
        url: env['ANTHROPIC_BASE_URL'] || 'https://api.anthropic.com/v1/messages',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': env['ANTHROPIC_VERSION'] || '2023-06-01',
          'Content-Type': 'application/json',
        },
        body,
        format: 'anthropic',
        parseJson: anthropicText,
      };
    }
    case 'gemini': {
      const apiKey = env['GEMINI_API_KEY'];
      if (!apiKey) throw new ModelRequestError('config', 'gemini', 'Gemini API key missing.');
      const baseURL = (env['GEMINI_BASE_URL'] || 'https://generativelanguage.googleapis.com/v1beta').replace(/\/+$/, '');
      const modelName = model.startsWith('models/') ? model.slice(7) : model;
      const method = stream ? 'streamGenerateContent?alt=sse&' : 'generateContent?';
      const body: Record<string, unknown> = {
        system_instruction: { parts: [{ text: prompt.system }] },
        contents: [{ role: 'user', parts: [{ text: prompt.user }] }],
      };
      const level = env['GEMINI_THINKING_LEVEL'];
      if (level && level !== 'disabled' && geminiSupportsThinkingLevel(model)) {
        body.generationConfig = { thinkingConfig: { thinkingLevel: level } };
      }
      return {
        label: 'Gemini',
        url: `${baseURL}/models/${modelName}:${method}key=${encodeURIComponent(apiKey)}`,
        headers: { 'Content-Type': 'application/json' },
        body,
        format: 'gemini',
        parseJson: geminiText,
      };
    }
    case 'openRouter':
    case 'deepSeek':
    case 'openAICompatible': {
      const preference = descriptor.preference;
      const config = getAIProviderConfig(preference);
      const apiKey = preference === 'deepSeek'
        ? env['DEEPSEEK_API_KEY']
        : preference === 'openRouter' ? env['OPENROUTER_API_KEY'] : env['OPENAI_COMPATIBLE_API_KEY'];
      const defaultEndpoint = preference === 'deepSeek'
        ? 'https://api.deepseek.com/chat/completions'
        : preference === 'openRouter' ? `${getAIProviderConfig('openRouter').defaultBaseUrl}/chat/completions` : '';
      const endpoint = env[config.baseUrlEnv] || defaultEndpoint;
      if (!apiKey) throw new ModelRequestError('config', preference, `${config.displayName} API key missing.`);
      if (!endpoint) throw new ModelRequestError('config', preference, `${config.displayName} endpoint URL missing.`);
      const body: Record<string, unknown> = { model, messages, stream };
      if (preference === 'deepSeek') {
        const thinking = env['DEEPSEEK_THINKING'] || 'disabled';
        if (thinking !== 'disabled') {
          body.thinking = { type: thinking };
          if (env['DEEPSEEK_REASONING_EFFORT']) body.reasoning_effort = env['DEEPSEEK_REASONING_EFFORT'];
        }
      } else if (preference === 'openRouter') {
        const effort = env['OPENROUTER_REASONING_EFFORT'];
        if (effort && effort !== 'disabled') body.reasoning = { effort };
      }
      const headers: Record<string, string> = { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
      if (preference === 'openRouter') {
        if (env['OPENROUTER_REFERER']) headers['HTTP-Referer'] = env['OPENROUTER_REFERER'];
        headers['X-OpenRouter-Title'] = env['OPENROUTER_APP_TITLE'] || 'Dumka Mail';
      }
      return {
        label: config.displayName,
        url: buildChatCompletionsUrl(endpoint),
        headers,
        body,
        format: 'openai',
        parseJson: chatCompletionText,
      };
    }
    default:
      throw new ModelRequestError('config', String(descriptor.preference), 'No AI provider is configured.');
  }
}

/**
 * An AbortController that follows the caller's signal and an inactivity timer
 * (`touch()` restarts it). Reports whether an abort came from the caller.
 */
function linkedController(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  const touch = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, timeoutMs);
  };
  touch();
  return {
    signal: controller.signal,
    touch,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

function translateFetchError(error: unknown, wire: WireRequest, provider: string, link: { timedOut: boolean }, callerSignal?: AbortSignal): Error {
  if (error instanceof ModelRequestError) return error;
  if (callerSignal?.aborted) return abortError();
  if (link.timedOut) return new ModelRequestError('timeout', provider, `${wire.label} request timed out.`);
  if (isAbortError(error)) return abortError();
  const message = error instanceof Error ? error.message : String(error);
  return new ModelRequestError('network', provider, `${wire.label} request failed: ${message}`);
}

async function httpError(res: Response, wire: WireRequest, provider: string): Promise<ModelRequestError> {
  let detail = '';
  try {
    detail = truncateProviderText(await res.text());
  } catch {
    detail = '';
  }
  return new ModelRequestError('http', provider, `${wire.label} HTTP ${res.status}: ${detail}`, res.status);
}

/** Calls `onDelta` only while the caller has not cancelled. */
function deliverer(options: TextCompletionOptions): (delta: string) => void {
  return delta => {
    if (options.signal?.aborted || !delta) return;
    options.onDelta?.(delta);
  };
}

/** HTTP statuses with which an endpoint says it does not take the streaming variant of the request. */
const STREAM_UNSUPPORTED_STATUSES: ReadonlySet<number> = new Set([400, 404, 405, 406, 415, 422]);

/**
 * A failed stream may be retried without streaming only when the endpoint did
 * not stream or the connection failed before any text: never after a cancel,
 * after text was shown, on timeouts, or on 401 / 403 / 429 / 5xx.
 */
export function shouldFallBackToNonStreaming(cause: Error, receivedText: boolean): boolean {
  if (receivedText || isAbortError(cause)) return false;
  if (!(cause instanceof ModelRequestError)) return false;
  switch (cause.kind) {
    case 'network':
    case 'empty':
    case 'invalid':
      return true;
    case 'http':
      return cause.status !== null && STREAM_UNSUPPORTED_STATUSES.has(cause.status);
    default:
      return false;
  }
}

async function requestOnce(wire: WireRequest, provider: string, options: TextCompletionOptions): Promise<string> {
  const link = linkedController(options.signal, options.timeoutMs ?? AI_CHAT_REQUEST_TIMEOUT_MS);
  try {
    const res = await fetch(wire.url, { method: 'POST', headers: wire.headers, body: JSON.stringify(wire.body), signal: link.signal });
    if (!res.ok) throw await httpError(res, wire, provider);
    const data = await res.json().catch(() => {
      throw new ModelRequestError('invalid', provider, `${wire.label} returned a response that is not JSON.`, res.status);
    });
    const text = wire.parseJson(data);
    if (!text.trim()) throw new ModelRequestError('empty', provider, `Empty response from ${wire.label}.`, res.status);
    return text;
  } catch (error) {
    throw translateFetchError(error, wire, provider, link, options.signal);
  } finally {
    link.dispose();
  }
}

class StreamFailure extends Error {
  constructor(readonly cause: Error, readonly receivedText: boolean) {
    super(cause.message);
  }
}

async function requestStream(wire: WireRequest, format: StreamWireFormat, provider: string, options: TextCompletionOptions): Promise<string> {
  const link = linkedController(options.signal, options.timeoutMs ?? AI_CHAT_REQUEST_TIMEOUT_MS);
  const deliver = deliverer(options);
  let received = false;
  try {
    const res = await fetch(wire.url, {
      method: 'POST',
      headers: { ...wire.headers, Accept: 'text/event-stream' },
      body: JSON.stringify(wire.body),
      signal: link.signal,
    });
    if (!res.ok) throw await httpError(res, wire, provider);
    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/event-stream') || !res.body) {
      // The endpoint ignored `stream`: read the whole answer.
      const data = await res.json().catch(() => {
        throw new ModelRequestError('invalid', provider, `${wire.label} returned a response that is not JSON.`, res.status);
      });
      const text = wire.parseJson(data);
      if (!text.trim()) throw new ModelRequestError('empty', provider, `Empty response from ${wire.label}.`, res.status);
      received = true;
      deliver(text);
      return text;
    }
    const parser = new StreamTextParser(format);
    const reader = res.body.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        link.touch();
        const result = done ? parser.end() : parser.push(value);
        for (const delta of result.deltas) {
          received = true;
          deliver(delta);
        }
        // Cancelled mid-stream: stop reading now instead of waiting for the next chunk.
        if (options.signal?.aborted) throw abortError();
        if (result.error) throw new ModelRequestError('http', provider, `${wire.label} stream error: ${truncateProviderText(result.error)}`);
        if (done || result.done) break;
      }
    } finally {
      reader.cancel().catch(() => undefined);
    }
    if (!parser.text.trim()) throw new ModelRequestError('empty', provider, `Empty stream from ${wire.label}.`);
    return parser.text;
  } catch (error) {
    throw new StreamFailure(translateFetchError(error, wire, provider, link, options.signal), received);
  } finally {
    link.dispose();
  }
}

export async function resolveTextProvider(preference: AIProviderPreference, overrideModel?: string): Promise<AIProviderDescriptor | null> {
  const descriptor = await getAIProviderDescriptor(preference, overrideModel);
  return isAIProviderUnavailable(descriptor) ? null : descriptor;
}

export async function completeText(prompt: TextPrompt, options: TextCompletionOptions): Promise<TextCompletionResult> {
  const descriptor = await resolveTextProvider(options.preference, options.overrideModel);
  if (!descriptor) throw new ModelRequestError('config', String(options.preference), 'No AI provider is configured.');
  if (options.signal?.aborted) throw abortError();
  const env = await loadAIConfigAsync();
  const provider = descriptor.preference;

  if (options.stream) {
    const wire = buildWireRequest(descriptor, env, prompt, true, options.maxTokens);
    if (wire.format) {
      try {
        const text = await requestStream(wire, wire.format, provider, options);
        return { text, model: descriptor.model, provider, streamed: true };
      } catch (error) {
        const failure = error instanceof StreamFailure ? error : new StreamFailure(error as Error, false);
        if (!shouldFallBackToNonStreaming(failure.cause, failure.receivedText)) throw failure.cause;
        if (options.signal?.aborted) throw abortError();
      }
    }
  }

  const wire = buildWireRequest(descriptor, env, prompt, false, options.maxTokens);
  const text = await requestOnce(wire, provider, options);
  if (options.signal?.aborted) throw abortError();
  deliverer(options)(text);
  return { text, model: descriptor.model, provider, streamed: false };
}
