import { createServer, type ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCPManagerImpl } from '../main/mcpManager';
import { DEFAULT_SETTINGS } from '../renderer/src/stores/AppStore';

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close();
});

function fixtureServer() {
  const server = new McpServer({ name: 'dependency-smoke', version: '1.0.0' });
  server.registerTool('fixture_ping', { description: 'Synthetic transport check' }, async () => ({
    content: [{ type: 'text', text: 'fixture-pong' }],
  }));
  return server;
}

function failResponse(response: ServerResponse, error: unknown) {
  if (response.headersSent) response.destroy(error instanceof Error ? error : undefined);
  else { response.writeHead(500); response.end('Fixture server failed'); }
}

describe('MCP dependency transport compatibility', () => {
  it.each(['sse', 'streamableHttp'] as const)('initializes, lists and calls tools over %s without a global EventSource polyfill', async type => {
    const sdkServer = fixtureServer();
    let sse: SSEServerTransport | undefined;
    const httpTransport = type === 'streamableHttp'
      ? new StreamableHTTPServerTransport({ sessionIdGenerator: randomUUID, enableJsonResponse: true }) : undefined;
    if (httpTransport) await sdkServer.connect(httpTransport);
    const http = createServer((request, response) => {
      const handle = async () => {
        if (httpTransport) await httpTransport.handleRequest(request, response);
        else if (request.method === 'GET' && request.url === '/sse') {
          sse = new SSEServerTransport('/messages', response);
          await sdkServer.connect(sse);
        } else if (request.method === 'POST' && sse) await sse.handlePostMessage(request, response);
        else { response.writeHead(404); response.end(); }
      };
      void handle().catch(error => failResponse(response, error));
    });
    cleanup.push(async () => {
      await sdkServer.close();
      http.closeAllConnections();
      await new Promise<void>((resolve, reject) => http.close(error => error ? reject(error) : resolve()));
    });
    await new Promise<void>((resolve, reject) => {
      http.once('error', reject);
      http.listen(0, '127.0.0.1', resolve);
    });
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing fixture address');
    const manager = new MCPManagerImpl({ requestTimeoutMs: 3000 });
    cleanup.push(() => manager.shutdown());
    const originalEventSource = globalThis.EventSource;
    await manager.initialize({ ...DEFAULT_SETTINGS, mcpServers: [{
      id: 'fixture', name: 'Dependency fixture', enabled: true, type,
      url: `http://127.0.0.1:${address.port}/${type === 'sse' ? 'sse' : 'mcp'}`,
    }] });
    const tool = manager.getActiveTools().find(value => value.originalName === 'fixture_ping');
    expect(tool).toBeDefined();
    if (!tool) throw new Error('Fixture tool was not discovered');
    expect(await manager.executeTool(tool.name, {})).toMatchObject({ content: [{ type: 'text', text: 'fixture-pong' }] });
    expect(globalThis.EventSource).toBe(originalEventSource);
  });
});
