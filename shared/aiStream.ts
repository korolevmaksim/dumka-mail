// Streaming wire formats for model responses (design-review/SPEC.md §5).
//
// Pure and dependency-free (TextDecoder is a global in Node and browsers), so
// the main process can parse provider streams and the tests can feed recorded
// synthetic chunks. Three formats:
//   - 'openai'    OpenAI Chat Completions and compatible servers (OpenRouter,
//                 DeepSeek, local): `data: {"choices":[{"delta":{"content":…}}]}` … `data: [DONE]`
//   - 'anthropic' Anthropic Messages: `event: content_block_delta` +
//                 `data: {"type":"content_block_delta","delta":{"type":"text_delta","text":…}}` … `message_stop`
//   - 'gemini'    Gemini `streamGenerateContent?alt=sse`: `data: {"candidates":[{"content":{"parts":[{"text":…}]}}]}`

export type StreamWireFormat = 'openai' | 'anthropic' | 'gemini';

export interface SseEvent {
  event: string | null;
  data: string;
}

/**
 * Incremental Server-Sent Events decoder. Accepts raw bytes (a multi-byte
 * UTF-8 character may be split across chunks) or already-decoded text, and
 * returns complete events. A line split across chunks is buffered.
 */
export class SseDecoder {
  private readonly decoder = new TextDecoder('utf-8');
  private buffer = '';
  private dataLines: string[] = [];
  private eventName: string | null = null;

  push(chunk: Uint8Array | string): SseEvent[] {
    this.buffer += typeof chunk === 'string' ? chunk : this.decoder.decode(chunk, { stream: true });
    return this.drain(false);
  }

  /** Flushes the remaining buffer; a final event without a trailing blank line is still emitted. */
  end(): SseEvent[] {
    this.buffer += this.decoder.decode();
    return this.drain(true);
  }

  private drain(final: boolean): SseEvent[] {
    const events: SseEvent[] = [];
    for (;;) {
      const index = this.buffer.search(/\r\n|\r|\n/);
      if (index < 0) break;
      // A lone '\r' at the end may be the first half of '\r\n'; wait for more input.
      if (!final && this.buffer[index] === '\r' && index === this.buffer.length - 1) break;
      const separatorLength = this.buffer[index] === '\r' && this.buffer[index + 1] === '\n' ? 2 : 1;
      const line = this.buffer.slice(0, index);
      this.buffer = this.buffer.slice(index + separatorLength);
      this.processLine(line, events);
    }
    if (final) {
      if (this.buffer) this.processLine(this.buffer, events);
      this.buffer = '';
      this.dispatch(events);
    }
    return events;
  }

  private processLine(line: string, events: SseEvent[]) {
    if (line === '') {
      this.dispatch(events);
      return;
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') this.dataLines.push(value);
    else if (field === 'event') this.eventName = value;
  }

  private dispatch(events: SseEvent[]) {
    if (this.dataLines.length > 0) events.push({ event: this.eventName, data: this.dataLines.join('\n') });
    this.dataLines = [];
    this.eventName = null;
  }
}

export interface StreamDelta {
  text: string;
  done: boolean;
  error?: string;
}

const NOTHING: StreamDelta = { text: '', done: false };

function parseJson(data: string): unknown {
  try {
    return JSON.parse(data);
  } catch {
    return undefined;
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function errorMessage(value: unknown): string {
  const record = asRecord(value);
  if (record && typeof record.message === 'string') return record.message;
  if (typeof value === 'string') return value;
  return 'Stream error';
}

export function openAIStreamDelta(data: string): StreamDelta {
  if (data.trim() === '[DONE]') return { text: '', done: true };
  const json = asRecord(parseJson(data));
  if (!json) return NOTHING;
  if (json.error) return { text: '', done: true, error: errorMessage(json.error) };
  const choice = asRecord(Array.isArray(json.choices) ? json.choices[0] : null);
  if (!choice) return NOTHING;
  const delta = asRecord(choice.delta) || asRecord(choice.message);
  const content = delta?.content;
  return { text: typeof content === 'string' ? content : '', done: false };
}

export function anthropicStreamDelta(data: string): StreamDelta {
  const json = asRecord(parseJson(data));
  if (!json) return NOTHING;
  if (json.type === 'error') return { text: '', done: true, error: errorMessage(json.error) };
  if (json.type === 'message_stop') return { text: '', done: true };
  if (json.type !== 'content_block_delta') return NOTHING;
  const delta = asRecord(json.delta);
  if (delta?.type !== 'text_delta' || typeof delta.text !== 'string') return NOTHING;
  return { text: delta.text, done: false };
}

export function geminiStreamDelta(data: string): StreamDelta {
  const json = asRecord(parseJson(data));
  if (!json) return NOTHING;
  if (json.error) return { text: '', done: true, error: errorMessage(json.error) };
  const candidate = asRecord(Array.isArray(json.candidates) ? json.candidates[0] : null);
  const content = asRecord(candidate?.content);
  const parts = Array.isArray(content?.parts) ? content.parts : [];
  const text = parts
    .map(part => asRecord(part))
    // Thought summaries are not part of the answer.
    .filter((part): part is Record<string, unknown> => Boolean(part) && part?.thought !== true)
    .map(part => (typeof part.text === 'string' ? part.text : ''))
    .join('');
  return { text, done: false };
}

function deltaForEvent(format: StreamWireFormat, data: string): StreamDelta {
  if (format === 'anthropic') return anthropicStreamDelta(data);
  if (format === 'gemini') return geminiStreamDelta(data);
  return openAIStreamDelta(data);
}

/**
 * Some OpenAI-compatible servers separate events with a single newline, which
 * SSE joins into one multi-line `data`. Parse each line on its own when the
 * joined payload is not valid JSON.
 */
function eventPayloads(event: SseEvent): string[] {
  if (!event.data.includes('\n') || parseJson(event.data) !== undefined) return [event.data];
  return event.data.split('\n').filter(line => line.trim() !== '');
}

export interface StreamParseResult {
  deltas: string[];
  done: boolean;
  error?: string;
}

/** Turns raw provider stream bytes into text deltas for one wire format. */
export class StreamTextParser {
  private readonly sse = new SseDecoder();
  private finished = false;
  private failure: string | undefined;
  private collected = '';

  constructor(private readonly format: StreamWireFormat) {}

  get done(): boolean {
    return this.finished;
  }

  get error(): string | undefined {
    return this.failure;
  }

  /** All text received so far. */
  get text(): string {
    return this.collected;
  }

  push(chunk: Uint8Array | string): StreamParseResult {
    return this.consume(this.sse.push(chunk));
  }

  end(): StreamParseResult {
    const result = this.consume(this.sse.end());
    this.finished = true;
    return { ...result, done: true };
  }

  private consume(events: SseEvent[]): StreamParseResult {
    const deltas: string[] = [];
    for (const event of events) {
      if (this.finished) break;
      for (const payload of eventPayloads(event)) {
        const delta = deltaForEvent(this.format, payload);
        if (delta.text) {
          deltas.push(delta.text);
          this.collected += delta.text;
        }
        if (delta.error) this.failure = delta.error;
        if (delta.done) {
          this.finished = true;
          break;
        }
      }
    }
    return { deltas, done: this.finished, ...(this.failure ? { error: this.failure } : {}) };
  }
}
