import { afterEach, describe, expect, it, vi } from 'vitest';

let mockDescriptor = {
  preference: 'openAI',
  displayName: 'OpenAI',
  model: 'gpt-5.4-mini',
  transport: 'chat.completions',
  status: 'Configured',
  capabilities: { canTriage: true, canSummarize: true, canDraft: true },
};

const mcpMock = vi.hoisted(() => ({
  whenReady: vi.fn(async () => {}),
  getActiveTools: vi.fn(),
  executeTool: vi.fn(),
}));

vi.mock('../main/aiConfig', () => ({
  loadAIConfig: vi.fn(),
  saveAIConfig: vi.fn(),
  getAIProviderDescriptor: vi.fn(async () => mockDescriptor),
  listProviderModels: vi.fn(),
  loadAIConfigAsync: vi.fn(async () => ({
    OPENAI_API_KEY: 'fixture-openai-key',
  })),
  saveAIConfigAsync: vi.fn(),
  loadAIConfigForRenderer: vi.fn(),
}));

vi.mock('../main/mcpManager', () => ({
  MCPManager: mcpMock,
}));

import { completeAI } from '../main/ai';

describe('completeAI MCP tool policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mcpMock.getActiveTools.mockReset();
    mcpMock.executeTool.mockReset();
    mcpMock.whenReady.mockClear();
    mockDescriptor = {
      preference: 'openAI',
      displayName: 'OpenAI',
      model: 'gpt-5.4-mini',
      transport: 'chat.completions',
      status: 'Configured',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true },
    };
  });

  it('does not expose MCP tools to the provider unless the request explicitly enables them', async () => {
    mcpMock.getActiveTools.mockReturnValue([
      {
        name: 'external_search',
        description: 'Search the web',
        inputSchema: {
          type: 'object',
          properties: { query: { type: 'string' } },
          required: ['query'],
        },
      },
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: 'ok' } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'Private selected email body.',
      conversationHistory: [],
      userInstruction: 'Answer without external tools.',
    }, 'openAI');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.tools).toBeUndefined();
    expect(mcpMock.executeTool).not.toHaveBeenCalled();
  });

  it('filters exposed tools to the explicit allowlist when tools are enabled', async () => {
    mcpMock.getActiveTools.mockReturnValue([
      {
        name: 'allowed_lookup',
        description: 'Allowed lookup',
        inputSchema: { type: 'object' },
      },
      {
        name: 'blocked_lookup',
        description: 'Blocked lookup',
        inputSchema: { type: 'object' },
      },
    ]);
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      choices: [
        { message: { content: 'ok' } },
      ],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Use a lookup if needed.',
      toolPolicy: {
        enabled: true,
        allowedToolNames: ['allowed_lookup'],
      },
    }, 'openAI');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].function.name).toBe('allowed_lookup');
  });
});
