import { AppSettings, MCPServerConfig } from '../shared/types';
import { redactSecrets } from '../shared/aiContext';

let McpClient: any;
let StdioClientTransport: any;
let getDefaultMCPEnvironment: (() => Record<string, string>) | undefined;
let SSEClientTransport: any;
let StreamableHTTPClientTransport: any;
let EventSourcePolyfill: any;

async function loadMcpModule() {
  if (McpClient) return;
  const mcpSdk = await import('@modelcontextprotocol/sdk/client/index.js');
  const stdio = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const sse = await import('@modelcontextprotocol/sdk/client/sse.js');
  const streamableHttp = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');
  const evs = (await import('eventsource')) as any;

  McpClient = mcpSdk.Client;
  StdioClientTransport = stdio.StdioClientTransport;
  getDefaultMCPEnvironment = typeof stdio.getDefaultEnvironment === 'function'
    ? stdio.getDefaultEnvironment
    : undefined;
  SSEClientTransport = sse.SSEClientTransport;
  StreamableHTTPClientTransport = streamableHttp.StreamableHTTPClientTransport;
  EventSourcePolyfill = evs.default || evs;

  // Make EventSource globally available for the SSE transport
  (global as any).EventSource = EventSourcePolyfill;
}

export interface MCPToolSchema {
  name: string;
  description?: string;
  inputSchema: {
    type: 'object';
    properties?: Record<string, any>;
    required?: string[];
  };
  source: 'search' | 'mcp';
  serverId?: string;
  serverName?: string;
  originalName?: string;
}

export interface MCPManagerOptions {
  requestTimeoutMs?: number;
  maxToolResultChars?: number;
}

const DEFAULT_MCP_REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 32_000;

function requestOptions(timeout: number) {
  return {
    timeout,
    resetTimeoutOnProgress: true,
    maxTotalTimeout: Math.max(timeout, timeout * 2)
  };
}

function validTimeoutMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(120_000, Math.max(1_000, Math.round(value)));
}

function sanitizeToolSegment(value: string): string {
  return value
    .trim()
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48) || 'tool';
}

function exposedMCPToolName(server: MCPServerConfig, toolName: string): string {
  const serverSegment = sanitizeToolSegment(server.name || server.id);
  const toolSegment = sanitizeToolSegment(toolName);
  return `mcp_${serverSegment}_${toolSegment}`.slice(0, 96);
}

function normalizeInputSchema(schema: any): MCPToolSchema['inputSchema'] {
  if (!schema || typeof schema !== 'object' || schema.type !== 'object') {
    return { type: 'object' };
  }
  return schema;
}

function buildRequestInit(headers?: Record<string, string>): RequestInit | undefined {
  if (!headers || Object.keys(headers).length === 0) return undefined;
  return { headers };
}

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function httpError(prefix: string, res: Response): Promise<Error> {
  let body = '';
  try {
    body = await res.text();
  } catch {}
  return new Error(`${prefix} returned status ${res.status}${body ? `: ${redactSecrets(body)}` : ''}`);
}

export class MCPManagerImpl {
  private clients = new Map<string, any>();
  private transports = new Map<string, any>();
  private serverTools = new Map<string, MCPToolSchema[]>();
  private serverTimeouts = new Map<string, number>();
  private searchSettings: AppSettings['searchProviders'] = undefined;
  private initializeQueue: Promise<void> = Promise.resolve();
  private requestTimeoutMs: number;
  private maxToolResultChars: number;

  constructor(options: MCPManagerOptions = {}) {
    this.requestTimeoutMs = validTimeoutMs(options.requestTimeoutMs, DEFAULT_MCP_REQUEST_TIMEOUT_MS);
    this.maxToolResultChars = options.maxToolResultChars || DEFAULT_MAX_TOOL_RESULT_CHARS;
  }

  async initialize(settings: AppSettings) {
    const next = this.initializeQueue.then(() => this.initializeNow(settings));
    this.initializeQueue = next.catch(() => {});
    return next;
  }

  async whenReady(): Promise<void> {
    await this.initializeQueue;
  }

  private async initializeNow(settings: AppSettings) {
    this.searchSettings = settings.searchProviders;
    await this.shutdown();

    const mcpServers = settings.mcpServers || [];
    for (const server of mcpServers) {
      if (!server.enabled) continue;
      try {
        console.log(`[MCP] Connecting to server "${server.name}" (${server.type})...`);
        const { client, transport, tools } = await this.connectServer(server);
        this.clients.set(server.id, client);
        this.transports.set(server.id, transport);
        this.serverTools.set(server.id, tools);
        this.serverTimeouts.set(server.id, validTimeoutMs(server.timeoutMs, this.requestTimeoutMs));
        console.log(`[MCP] Server "${server.name}" connected with ${tools.length} tools.`);
      } catch (err) {
        console.error(`[MCP] Failed to connect to server "${server.name}":`, err);
      }
    }
  }

  async shutdown() {
    for (const [id, client] of this.clients.entries()) {
      if (typeof client.close !== 'function') continue;
      try {
        await client.close();
      } catch (err) {
        console.error(`[MCP] Error closing client for server ${id}:`, err);
      }
    }
    for (const [id, transport] of this.transports.entries()) {
      try {
        await transport.close();
      } catch (err) {
        console.error(`[MCP] Error closing transport for server ${id}:`, err);
      }
    }
    this.clients.clear();
    this.transports.clear();
    this.serverTools.clear();
    this.serverTimeouts.clear();
  }

  async verifyServer(server: MCPServerConfig): Promise<{ success: boolean; toolsCount: number; error?: string }> {
    let transport: any = null;
    let client: any = null;
    try {
      const conn = await this.connectServer(server);
      transport = conn.transport;
      client = conn.client;
      return { success: true, toolsCount: conn.tools.length };
    } catch (err: any) {
      return { success: false, toolsCount: 0, error: err.message || String(err) };
    } finally {
      if (client && typeof client.close === 'function') {
        try {
          await client.close();
        } catch {}
      }
      if (transport) {
        try {
          await transport.close();
        } catch {}
      }
    }
  }

  private async connectServer(server: MCPServerConfig): Promise<{ client: any; transport: any; tools: MCPToolSchema[] }> {
    await loadMcpModule();

    let transport: any;
    if (server.type === 'stdio') {
      if (!server.command) {
        throw new Error('Stdio command is required.');
      }
      transport = new StdioClientTransport({
        command: server.command,
        args: server.args || [],
        env: {
          ...(getDefaultMCPEnvironment ? getDefaultMCPEnvironment() : {}),
          ...(server.env || {})
        },
        cwd: server.cwd,
        stderr: 'pipe'
      });
    } else if (server.type === 'streamableHttp') {
      if (!server.url) {
        throw new Error('Streamable HTTP URL is required.');
      }
      transport = new StreamableHTTPClientTransport(new URL(server.url), {
        requestInit: buildRequestInit(server.headers)
      });
    } else if (server.type === 'sse') {
      if (!server.url) {
        throw new Error('SSE URL is required.');
      }
      transport = new SSEClientTransport(new URL(server.url), {
        requestInit: buildRequestInit(server.headers),
        eventSourceInit: buildRequestInit(server.headers)
      });
    } else {
      throw new Error(`Unsupported MCP type: ${server.type}`);
    }

    const client = new McpClient(
      { name: 'dumka-mail-client', version: '1.0.0' },
      { capabilities: {} }
    );

    const timeoutMs = validTimeoutMs(server.timeoutMs, this.requestTimeoutMs);
    await client.connect(transport, requestOptions(timeoutMs));
    
    const toolsRes = await client.listTools(undefined, requestOptions(timeoutMs));
    const tools: MCPToolSchema[] = (toolsRes.tools || []).map((t: any) => ({
      name: exposedMCPToolName(server, String(t.name || 'tool')),
      description: t.description,
      inputSchema: normalizeInputSchema(t.inputSchema),
      source: 'mcp',
      serverId: server.id,
      serverName: server.name,
      originalName: String(t.name || 'tool')
    }));

    return { client, transport, tools };
  }

  getActiveTools(): MCPToolSchema[] {
    const list: MCPToolSchema[] = [];

    // 1. Built-in search tools
    if (this.searchSettings?.tavily?.enabled && this.searchSettings.tavily.apiKey) {
      list.push({
        name: 'tavily_search',
        description: 'Perform a search using Tavily. Best for general web search and extracting structured answer chunks for AI.',
        source: 'search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to execute' }
          },
          required: ['query']
        }
      });
    }

    if (this.searchSettings?.brave?.enabled && this.searchSettings.brave.apiKey) {
      list.push({
        name: 'brave_search',
        description: 'Perform a privacy-oriented web search using Brave Search.',
        source: 'search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query to execute' }
          },
          required: ['query']
        }
      });
    }

    if (this.searchSettings?.perplexity?.enabled && this.searchSettings.perplexity.apiKey) {
      list.push({
        name: 'perplexity_search',
        description: "Perform a conversational web search using Perplexity's Sonar model. Best for synthesis and up-to-date fact verification.",
        source: 'search',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query or question to execute' }
          },
          required: ['query']
        }
      });
    }

    // 2. Custom MCP tools
    for (const tools of this.serverTools.values()) {
      list.push(...tools);
    }

    return list;
  }

  async executeTool(name: string, args: any): Promise<any> {
    // 1. Check if it's a built-in search tool
    if (name === 'tavily_search') {
      const apiKey = this.searchSettings?.tavily?.apiKey;
      if (!apiKey) throw new Error('Tavily API key is missing.');
      return await this.executeTavily(args.query, apiKey);
    }
    if (name === 'brave_search') {
      const apiKey = this.searchSettings?.brave?.apiKey;
      if (!apiKey) throw new Error('Brave API key is missing.');
      return await this.executeBrave(args.query, apiKey);
    }
    if (name === 'perplexity_search') {
      const apiKey = this.searchSettings?.perplexity?.apiKey;
      if (!apiKey) throw new Error('Perplexity API key is missing.');
      return await this.executePerplexity(args.query, apiKey);
    }

    // 2. Search for the tool in custom MCP clients
    for (const [serverId, tools] of this.serverTools.entries()) {
      const tool = tools.find(t => t.name === name);
      if (tool) {
        const client = this.clients.get(serverId);
        if (!client) throw new Error(`MCP Client for server ${serverId} not found.`);
        const timeoutMs = this.serverTimeouts.get(serverId) || this.requestTimeoutMs;
        const result = await client.callTool(
          { name: tool.originalName || name, arguments: args },
          undefined,
          requestOptions(timeoutMs)
        );
        const serialized = typeof result === 'string' ? result : JSON.stringify(result);
        if (serialized.length > this.maxToolResultChars) {
          return {
            content: serialized.slice(0, this.maxToolResultChars),
            truncated: true
          };
        }
        return result;
      }
    }

    throw new Error(`Tool "${name}" is not registered or active.`);
  }

  private async executeTavily(query: string, apiKey: string) {
    const res = await fetchWithTimeout('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query })
    }, this.requestTimeoutMs);
    if (!res.ok) {
      throw await httpError('Tavily API', res);
    }
    const data = await res.json() as any;
    return data.results ? data.results.map((r: any) => ({ title: r.title, url: r.url, content: r.content })) : data;
  }

  private async executeBrave(query: string, apiKey: string) {
    const res = await fetchWithTimeout(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json'
      }
    }, this.requestTimeoutMs);
    if (!res.ok) {
      throw await httpError('Brave Search API', res);
    }
    const data = await res.json() as any;
    return data.web?.results ? data.web.results.map((r: any) => ({ title: r.title, url: r.url, description: r.description })) : data;
  }

  private async executePerplexity(query: string, apiKey: string) {
    const res = await fetchWithTimeout('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }]
      })
    }, this.requestTimeoutMs);
    if (!res.ok) {
      throw await httpError('Perplexity API', res);
    }
    const data = await res.json() as any;
    return {
      answer: data.choices?.[0]?.message?.content || '',
      citations: data.citations || []
    };
  }
}

export const MCPManager = new MCPManagerImpl();
