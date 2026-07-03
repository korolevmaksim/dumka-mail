import { beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMock = vi.hoisted(() => {
  const createdTransports: Array<{ kind: string; options: any }> = [];
  const listToolOptions: any[] = [];
  const callToolOptions: any[] = [];

  class FakeClient {
    async connect() {}

    async listTools(_params?: any, options?: any) {
      listToolOptions.push(options);
      return {
        tools: [
          {
            name: 'lookup',
            description: 'Lookup data',
            inputSchema: { type: 'object' },
          },
        ],
      };
    }

    async callTool(_params: any, _schema?: any, options?: any) {
      callToolOptions.push(options);
      return { content: [{ type: 'text', text: 'ok' }] };
    }
  }

  class FakeStdioTransport {
    constructor(options: any) {
      createdTransports.push({ kind: 'stdio', options });
    }

    async close() {}
  }

  class FakeSSETransport {
    constructor(url: URL, options?: any) {
      createdTransports.push({ kind: 'sse', options: { url: url.toString(), ...options } });
    }

    async close() {}
  }

  class FakeStreamableHTTPTransport {
    constructor(url: URL, options?: any) {
      createdTransports.push({ kind: 'streamableHttp', options: { url: url.toString(), ...options } });
    }

    async close() {}
  }

  return {
    createdTransports,
    listToolOptions,
    callToolOptions,
    FakeClient,
    FakeStdioTransport,
    FakeSSETransport,
    FakeStreamableHTTPTransport,
  };
});

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => ({
  Client: sdkMock.FakeClient,
}));

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => ({
  StdioClientTransport: sdkMock.FakeStdioTransport,
  getDefaultEnvironment: () => ({ PATH: '/usr/bin' }),
}));

vi.mock('@modelcontextprotocol/sdk/client/sse.js', () => ({
  SSEClientTransport: sdkMock.FakeSSETransport,
}));

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => ({
  StreamableHTTPClientTransport: sdkMock.FakeStreamableHTTPTransport,
}));

vi.mock('eventsource', () => ({
  default: class FakeEventSource {},
}));

import { MCPManagerImpl } from '../main/mcpManager';

describe('MCPManagerImpl transport and timeout behavior', () => {
  beforeEach(() => {
    sdkMock.createdTransports.length = 0;
    sdkMock.listToolOptions.length = 0;
    sdkMock.callToolOptions.length = 0;
    process.env.DUMKA_TEST_SECRET = 'must-not-leak';
  });

  it('supports Streamable HTTP servers and uses bounded MCP request timeouts', async () => {
    const manager = new MCPManagerImpl({ requestTimeoutMs: 1234 });

    await manager.initialize({
      mcpServers: [
        {
          id: 'remote-1',
          name: 'Remote MCP',
          type: 'streamableHttp',
          enabled: true,
          url: 'https://mcp.example.com/mcp',
        },
      ],
    } as any);

    expect(sdkMock.createdTransports[0]).toMatchObject({
      kind: 'streamableHttp',
      options: { url: 'https://mcp.example.com/mcp' },
    });
    expect(sdkMock.listToolOptions[0]).toMatchObject({ timeout: 1234 });

    const exposedName = manager.getActiveTools().find(tool => tool.originalName === 'lookup')?.name;
    expect(exposedName).toBeTruthy();
    await manager.executeTool(exposedName!, { query: 'status' });
    expect(sdkMock.callToolOptions[0]).toMatchObject({ timeout: 1234 });
  });

  it('does not pass the full process environment to stdio MCP servers', async () => {
    const manager = new MCPManagerImpl({ requestTimeoutMs: 1234 });

    await manager.initialize({
      mcpServers: [
        {
          id: 'local-1',
          name: 'Local MCP',
          type: 'stdio',
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: {
            MCP_TOKEN: 'fixture-token',
          },
        },
      ],
    } as any);

    const env = sdkMock.createdTransports[0].options.env;
    expect(env.MCP_TOKEN).toBe('fixture-token');
    expect(env.DUMKA_TEST_SECRET).toBeUndefined();
  });
});
