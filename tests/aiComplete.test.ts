import { afterEach, describe, expect, it, vi } from 'vitest';

let mockDescriptor = {
  preference: 'anthropic',
  displayName: 'Anthropic',
  model: 'claude-sonnet-4-6',
  transport: 'messages',
  status: 'Configured',
  capabilities: { canTriage: true, canSummarize: true, canDraft: true },
};

let mockAIConfig: Record<string, string> = {
  ANTHROPIC_API_KEY: 'fixture-anthropic-key',
  ANTHROPIC_MODEL: 'claude-sonnet-4-6',
  ANTHROPIC_THINKING_EFFORT: 'high',
};

vi.mock('../main/aiConfig', () => ({
  loadAIConfig: vi.fn(),
  saveAIConfig: vi.fn(),
  getAIProviderDescriptor: vi.fn(async () => mockDescriptor),
  listProviderModels: vi.fn(),
  loadAIConfigAsync: vi.fn(async () => mockAIConfig),
  saveAIConfigAsync: vi.fn(),
  loadAIConfigForRenderer: vi.fn(),
}));

vi.mock('../main/mcpManager', () => ({
  MCPManager: {
    getActiveTools: vi.fn(() => []),
    executeTool: vi.fn(),
  },
}));

import { completeAI } from '../main/ai';

describe('completeAI Anthropic payload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mockDescriptor = {
      preference: 'anthropic',
      displayName: 'Anthropic',
      model: 'claude-sonnet-4-6',
      transport: 'messages',
      status: 'Configured',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true },
    };
    mockAIConfig = {
      ANTHROPIC_API_KEY: 'fixture-anthropic-key',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
      ANTHROPIC_THINKING_EFFORT: 'high',
    };
  });

  it('sends adaptive thinking effort through output_config, not inside thinking', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      content: [{ type: 'text', text: 'ok' }],
      stop_reason: 'end_turn',
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Reply with ok',
    }, 'anthropic');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.thinking).toEqual({ type: 'adaptive' });
    expect(body.output_config).toEqual({ effort: 'high' });
  });
});

describe('completeAI Gemini payload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('does not send thinkingLevel to pre-Gemini-3 generateContent models', async () => {
    mockDescriptor = {
      preference: 'gemini',
      displayName: 'Gemini',
      model: 'gemini-2.5-flash',
      transport: 'generateContent',
      status: 'Configured',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true },
    };
    mockAIConfig = {
      GEMINI_API_KEY: 'gemini-test-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
      GEMINI_THINKING_LEVEL: 'MEDIUM',
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      candidates: [
        { content: { parts: [{ text: 'ok' }] } }
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Reply with ok',
    }, 'gemini');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.generationConfig?.thinkingConfig).toBeUndefined();
  });
});

describe('completeAI OpenRouter payload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('sends OpenRouter reasoning effort when configured', async () => {
    mockDescriptor = {
      preference: 'openRouter',
      displayName: 'OpenRouter',
      model: 'openai/gpt-5',
      transport: 'chat.completions',
      status: 'Configured',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true },
    };
    mockAIConfig = {
      OPENROUTER_API_KEY: 'fixture-openrouter-key',
      OPENROUTER_MODEL: 'openai/gpt-5',
      OPENROUTER_REASONING_EFFORT: 'high',
    };
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: 'ok' } }
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Reply with ok',
    }, 'openRouter');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.reasoning).toEqual({ effort: 'high' });
  });
});
