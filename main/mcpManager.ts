import { AppSettings, MCPServerConfig } from '../shared/types';

let McpClient: any;
let StdioClientTransport: any;
let SSEClientTransport: any;
let EventSourcePolyfill: any;

async function loadMcpModule() {
  if (McpClient) return;
  const mcpSdk = await import('@modelcontextprotocol/sdk/client/index.js');
  const stdio = await import('@modelcontextprotocol/sdk/client/stdio.js');
  const sse = await import('@modelcontextprotocol/sdk/client/sse.js');
  const evs = (await import('eventsource')) as any;

  McpClient = mcpSdk.Client;
  StdioClientTransport = stdio.StdioClientTransport;
  SSEClientTransport = sse.SSEClientTransport;
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
}

class MCPManagerImpl {
  private clients = new Map<string, any>();
  private transports = new Map<string, any>();
  private serverTools = new Map<string, MCPToolSchema[]>();
  private searchSettings: AppSettings['searchProviders'] = undefined;

  async initialize(settings: AppSettings) {
    this.searchSettings = settings.searchProviders;

    // Shutdown existing connections
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
        console.log(`[MCP] Server "${server.name}" connected with ${tools.length} tools.`);
      } catch (err) {
        console.error(`[MCP] Failed to connect to server "${server.name}":`, err);
      }
    }
  }

  async shutdown() {
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
  }

  async verifyServer(server: MCPServerConfig): Promise<{ success: boolean; toolsCount: number; error?: string }> {
    let transport: any = null;
    try {
      const conn = await this.connectServer(server);
      transport = conn.transport;
      return { success: true, toolsCount: conn.tools.length };
    } catch (err: any) {
      return { success: false, toolsCount: 0, error: err.message || String(err) };
    } finally {
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
          ...process.env,
          ...(server.env || {})
        }
      });
    } else if (server.type === 'sse') {
      if (!server.url) {
        throw new Error('SSE URL is required.');
      }
      transport = new SSEClientTransport(new URL(server.url));
    } else {
      throw new Error(`Unsupported MCP type: ${server.type}`);
    }

    const client = new McpClient(
      { name: 'dumka-mail-client', version: '1.0.0' },
      { capabilities: {} }
    );

    await client.connect(transport);
    
    // List tools
    const toolsRes = await client.listTools();
    const tools: MCPToolSchema[] = (toolsRes.tools || []).map((t: any) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema || { type: 'object' }
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
      if (tools.some(t => t.name === name)) {
        const client = this.clients.get(serverId);
        if (!client) throw new Error(`MCP Client for server ${serverId} not found.`);
        return await client.callTool({ name, arguments: args });
      }
    }

    throw new Error(`Tool "${name}" is not registered or active.`);
  }

  private async executeTavily(query: string, apiKey: string) {
    const res = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ api_key: apiKey, query })
    });
    if (!res.ok) {
      throw new Error(`Tavily API returned status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as any;
    return data.results ? data.results.map((r: any) => ({ title: r.title, url: r.url, content: r.content })) : data;
  }

  private async executeBrave(query: string, apiKey: string) {
    const res = await fetch(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}`, {
      headers: {
        'X-Subscription-Token': apiKey,
        'Accept': 'application/json'
      }
    });
    if (!res.ok) {
      throw new Error(`Brave Search API returned status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as any;
    return data.web?.results ? data.web.results.map((r: any) => ({ title: r.title, url: r.url, description: r.description })) : data;
  }

  private async executePerplexity(query: string, apiKey: string) {
    const res = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'sonar',
        messages: [{ role: 'user', content: query }]
      })
    });
    if (!res.ok) {
      throw new Error(`Perplexity API returned status ${res.status}: ${await res.text()}`);
    }
    const data = await res.json() as any;
    return {
      answer: data.choices?.[0]?.message?.content || '',
      citations: data.citations || []
    };
  }
}

export const MCPManager = new MCPManagerImpl();
