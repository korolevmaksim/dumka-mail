import { afterEach, describe, expect, it, vi } from 'vitest';

let mockDescriptor = {
  preference: 'openAI',
  displayName: 'OpenAI',
  model: 'gpt-5.4-mini',
  transport: 'chat.completions',
  status: 'Configured',
  capabilities: { canTriage: true, canSummarize: true, canDraft: true },
};
let mockAIConfig: Record<string, string> = {
  OPENAI_API_KEY: 'fixture-openai-key',
};

const mcpMock = vi.hoisted(() => ({
  whenReady: vi.fn(async () => {}),
  getActiveTools: vi.fn(),
  executeTool: vi.fn(),
}));

const proposalResolverMock = vi.hoisted(() => vi.fn());

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
  MCPManager: mcpMock,
}));

vi.mock('../main/agentActionProposalResolver', () => ({
  resolveAgentActionProposals: proposalResolverMock,
}));

import { completeAI } from '../main/ai';

describe('completeAI MCP tool policy', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    mcpMock.getActiveTools.mockReset();
    mcpMock.executeTool.mockReset();
    mcpMock.whenReady.mockClear();
    proposalResolverMock.mockReset();
    mockDescriptor = {
      preference: 'openAI',
      displayName: 'OpenAI',
      model: 'gpt-5.4-mini',
      transport: 'chat.completions',
      status: 'Configured',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true },
    };
    mockAIConfig = { OPENAI_API_KEY: 'fixture-openai-key' };
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

  it('parses explicitly granted action proposals and binds them to sources returned in the same request', async () => {
    const source = {
      accountId: 'me@example.com',
      threadId: 'thread-1',
      messageId: 'message-1',
      subject: 'Project update',
      sender: 'Ada',
      snippet: 'Please confirm the launch date.',
      sourceKind: 'fts',
    };
    mcpMock.getActiveTools.mockReturnValue([{
      name: 'searchMailbox',
      description: 'Search local mailbox',
      inputSchema: { type: 'object' },
      source: 'mailbox',
    }]);
    mcpMock.executeTool.mockResolvedValue({ sources: [source] });
    proposalResolverMock.mockReturnValue({
      items: [{ id: 'proposal-item-1', action: 'archive' }],
      warnings: [],
    });
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return new Response(JSON.stringify({
          choices: [{
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [{
                id: 'tool-1',
                type: 'function',
                function: { name: 'searchMailbox', arguments: '{"query":"launch date"}' },
              }],
            },
          }],
        }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }
      return new Response(JSON.stringify({
        choices: [{
          message: {
            content: `One archive action is ready for review.\n<DUMKA_REVIEW_QUEUE_V1>\n{"version":1,"proposals":[{"action":"archive","citation":{"accountId":"me@example.com","threadId":"thread-1","messageId":"message-1"},"reason":"The update is resolved.","confidence":88}]}\n</DUMKA_REVIEW_QUEUE_V1>`,
          },
        }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    const response = await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Find the resolved update and archive it.',
      toolPolicy: {
        enabled: false,
        allowMailboxSearch: true,
        allowActionProposals: true,
        mailboxAccountIds: ['me@example.com'],
      },
    }, 'openAI');

    expect(response.text).toBe('One archive action is ready for review.');
    expect(response.proposedActions).toEqual([{ id: 'proposal-item-1', action: 'archive' }]);
    expect(mcpMock.executeTool).toHaveBeenCalledWith('searchMailbox', {
      query: 'launch date',
      accountId: 'me@example.com',
    });
    expect(proposalResolverMock).toHaveBeenCalledWith(expect.objectContaining({
      sources: [source],
      proposals: [expect.objectContaining({ action: 'archive' })],
    }));
  });

  it('exposes only read-only mailbox search while proposal mode is enabled', async () => {
    mcpMock.getActiveTools.mockReturnValue([
      {
        name: 'searchMailbox',
        description: 'Search local mailbox',
        inputSchema: { type: 'object' },
        source: 'mailbox',
      },
      {
        name: 'delete_external_record',
        description: 'Mutate an external system',
        inputSchema: { type: 'object' },
        source: 'mcp',
      },
    ]);
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({
        choices: [{ message: fetchCount === 1 ? {
          role: 'assistant',
          content: null,
          tool_calls: [{
            id: 'unsafe-tool-call',
            type: 'function',
            function: { name: 'delete_external_record', arguments: '{}' },
          }],
        } : { content: 'No action needed.' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Review the mailbox and propose safe actions.',
      toolPolicy: {
        enabled: true,
        allowMailboxSearch: true,
        allowActionProposals: true,
      },
    }, 'openAI');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.tools.map((tool: any) => tool.function.name)).toEqual(['searchMailbox']);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mcpMock.executeTool).not.toHaveBeenCalled();
  });

  it('scopes read-only calendar tools to the active operator account', async () => {
    mcpMock.getActiveTools.mockReturnValue([
      { name: 'searchCalendar', description: 'Search local calendar', inputSchema: { type: 'object' }, source: 'calendar' },
      { name: 'delete_external_record', description: 'Mutate an external system', inputSchema: { type: 'object' }, source: 'mcp' },
    ]);
    mcpMock.executeTool.mockResolvedValue({ privacyNote: 'Local cache', sources: [] });
    let fetchCount = 0;
    const fetchMock = vi.fn(async () => {
      fetchCount += 1;
      return new Response(JSON.stringify({
        choices: [{ message: fetchCount === 1 ? {
          role: 'assistant',
          content: null,
          tool_calls: [{ id: 'calendar-tool', type: 'function', function: { name: 'searchCalendar', arguments: '{"query":"planning","accountId":"all"}' } }],
        } : { content: 'No cached planning events were found.' } }],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    });
    vi.stubGlobal('fetch', fetchMock);

    await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Find planning events.',
      toolPolicy: {
        enabled: true,
        allowCalendarSearch: true,
        allowActionProposals: true,
        calendarAccountIds: ['me@example.com'],
      },
    }, 'openAI');

    const firstCall = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(String(firstCall[1].body));
    expect(body.tools.map((tool: { function: { name: string } }) => tool.function.name)).toEqual(['searchCalendar']);
    expect(mcpMock.executeTool).toHaveBeenCalledWith('searchCalendar', { query: 'planning', accountId: 'me@example.com' });
  });

  it('fails proposal capability closed on the OpenAI Responses endpoint', async () => {
    mockAIConfig = {
      OPENAI_API_KEY: 'fixture-openai-key',
      OPENAI_RESPONSES_URL: 'https://api.openai.com/v1/responses',
    };
    mcpMock.getActiveTools.mockReturnValue([{
      name: 'searchMailbox',
      description: 'Search local mailbox',
      inputSchema: { type: 'object' },
      source: 'mailbox',
    }]);
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      output_text: `I prepared an action.\n<DUMKA_REVIEW_QUEUE_V1>\n{"version":1,"proposals":[{"action":"archive","citation":{"accountId":"me@example.com","threadId":"thread-1","messageId":"message-1"},"reason":"Done.","confidence":90}]}\n</DUMKA_REVIEW_QUEUE_V1>`,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Archive completed work.',
      toolPolicy: {
        enabled: true,
        allowMailboxSearch: true,
        allowActionProposals: true,
      },
    }, 'openAI');

    expect(response.proposedActions).toBeUndefined();
    expect(response.proposalWarnings).toEqual([
      expect.stringMatching(/unavailable.*OpenAI Responses.*source-bound mailbox search/i),
    ]);
    expect(proposalResolverMock).not.toHaveBeenCalled();
  });

  it('does not interpret proposal envelopes without the separate proposal grant', async () => {
    mcpMock.getActiveTools.mockReturnValue([]);
    const text = '<DUMKA_REVIEW_QUEUE_V1>{"version":1,"proposals":[]}</DUMKA_REVIEW_QUEUE_V1>';
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
      choices: [{ message: { content: text } }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const response = await completeAI({
      action: 'chat',
      context: 'No thread open.',
      conversationHistory: [],
      userInstruction: 'Answer normally.',
      toolPolicy: { enabled: false, allowMailboxSearch: true },
    }, 'openAI');

    expect(response.text).toBe(text);
    expect(response.proposedActions).toBeUndefined();
    expect(proposalResolverMock).not.toHaveBeenCalled();
  });
});
