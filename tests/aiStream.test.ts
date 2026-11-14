import { describe, expect, it } from 'vitest';
import { SseDecoder, StreamTextParser, anthropicStreamDelta, geminiStreamDelta, openAIStreamDelta } from '../shared/aiStream';

const encoder = new TextEncoder();

/** Splits the encoded stream at the given byte offsets. */
function chunksAt(text: string, offsets: number[]): Uint8Array[] {
  const bytes = encoder.encode(text);
  const chunks: Uint8Array[] = [];
  let start = 0;
  for (const offset of [...offsets, bytes.length]) {
    chunks.push(bytes.slice(start, offset));
    start = offset;
  }
  return chunks;
}

function feed(parser: StreamTextParser, chunks: (Uint8Array | string)[]): { deltas: string[]; done: boolean; error?: string } {
  const deltas: string[] = [];
  let done = false;
  let error: string | undefined;
  for (const chunk of chunks) {
    const result = parser.push(chunk);
    deltas.push(...result.deltas);
    done = result.done;
    error = result.error || error;
    if (done) break;
  }
  if (!done) {
    const result = parser.end();
    deltas.push(...result.deltas);
    error = result.error || error;
  }
  return { deltas, done: parser.done, error };
}

function byteOffsetOf(text: string, needle: string, within = 0): number {
  return encoder.encode(text.slice(0, text.indexOf(needle))).length + within;
}

describe('SseDecoder', () => {
  it('buffers a line split across chunks and handles CRLF and comments', () => {
    const decoder = new SseDecoder();
    expect(decoder.push(': keep-alive\r\nevent: ping\r\ndata: {"a"')).toEqual([]);
    expect(decoder.push(':1}\r')).toEqual([]);
    expect(decoder.push('\n\r\ndata: second\n\n')).toEqual([
      { event: 'ping', data: '{"a":1}' },
      { event: null, data: 'second' },
    ]);
  });

  it('emits a trailing event without a blank line at the end', () => {
    const decoder = new SseDecoder();
    expect(decoder.push('data: last')).toEqual([]);
    expect(decoder.end()).toEqual([{ event: null, data: 'last' }]);
  });
});

describe('OpenAI-compatible stream', () => {
  const stream = [
    'data: {"id":"c1","choices":[{"index":0,"delta":{"role":"assistant","content":""}}]}',
    'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Привет, "}}]}',
    'data: {"id":"c1","choices":[{"index":0,"delta":{"content":"Priya — the 24th works 👍"}}]}',
    'data: {"id":"c1","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}',
    'data: [DONE]',
    'data: {"choices":[{"delta":{"content":"after done"}}]}',
    '',
  ].join('\n\n');

  it('joins deltas across a split JSON line and a split multi-byte character', () => {
    const splitJson = byteOffsetOf(stream, '"content":"Priya', 5);
    const splitCyrillic = byteOffsetOf(stream, 'ривет') + 1; // inside the 2-byte "р"
    const splitEmoji = byteOffsetOf(stream, '👍') + 2; // inside the 4-byte emoji
    const parser = new StreamTextParser('openai');
    const result = feed(parser, chunksAt(stream, [splitCyrillic, splitJson, splitEmoji].sort((a, b) => a - b)));
    expect(result.deltas.join('')).toBe('Привет, Priya — the 24th works 👍');
    expect(result.done).toBe(true);
    expect(parser.text).toBe('Привет, Priya — the 24th works 👍');
  });

  it('parses single-newline separated events from lenient servers', () => {
    const parser = new StreamTextParser('openai');
    const result = feed(parser, ['data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"choices":[{"delta":{"content":"b"}}]}\n\ndata: [DONE]\n\n']);
    expect(result.deltas).toEqual(['a', 'b']);
  });

  it('reports an error payload', () => {
    expect(openAIStreamDelta('{"error":{"message":"Rate limited"}}')).toEqual({ text: '', done: true, error: 'Rate limited' });
    expect(openAIStreamDelta('not json')).toEqual({ text: '', done: false });
  });
});

describe('Anthropic stream', () => {
  const stream = [
    'event: message_start\ndata: {"type":"message_start","message":{"id":"m1","content":[]}}',
    'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"hidden"}}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"- Pilot moved to the 24th "}}',
    'event: ping\ndata: {"type":"ping"}',
    'event: content_block_delta\ndata: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"✅\\n- Legal open"}}',
    'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}',
    'event: message_stop\ndata: {"type":"message_stop"}',
    '',
  ].join('\n\n');

  it('keeps text deltas only and stops at message_stop', () => {
    const splitCheck = byteOffsetOf(stream, '✅') + 1;
    const splitJson = byteOffsetOf(stream, '"text":"- Pilot', 3);
    const result = feed(new StreamTextParser('anthropic'), chunksAt(stream, [splitJson, splitCheck]));
    expect(result.deltas.join('')).toBe('- Pilot moved to the 24th ✅\n- Legal open');
    expect(result.done).toBe(true);
  });

  it('reports a stream error event', () => {
    expect(anthropicStreamDelta('{"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}'))
      .toEqual({ text: '', done: true, error: 'Overloaded' });
  });
});

describe('Gemini stream', () => {
  const stream = [
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"thinking…","thought":true}]}}]}',
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hi Priya, "}]}}]}',
    'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"the 24th works — günstig."}]},"finishReason":"STOP"}]}',
    '',
  ].join('\r\n\r\n');

  it('skips thought parts and ends with the stream', () => {
    const splitUmlaut = byteOffsetOf(stream, 'ünstig') + 1;
    const splitJson = byteOffsetOf(stream, '"text":"Hi', 4);
    const result = feed(new StreamTextParser('gemini'), chunksAt(stream, [splitJson, splitUmlaut]));
    expect(result.deltas.join('')).toBe('Hi Priya, the 24th works — günstig.');
    expect(result.done).toBe(true);
  });

  it('reads an error payload', () => {
    expect(geminiStreamDelta('{"error":{"code":429,"message":"Quota"}}')).toEqual({ text: '', done: true, error: 'Quota' });
  });
});
