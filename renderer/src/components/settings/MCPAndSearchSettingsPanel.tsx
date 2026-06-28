import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { MCPServerConfig } from 'shared/types';
import { Toggle } from './SettingsControls';
import { Cpu, Plus, Trash2, Check, AlertCircle, RefreshCw, Globe, Terminal, X, Sparkles } from 'lucide-react';

export function MCPAndSearchSettingsPanel() {
  const store = useAppStore();
  const searchSettings = store.settings.searchProviders || {
    tavily: { enabled: false, apiKey: '' },
    brave: { enabled: false, apiKey: '' },
    perplexity: { enabled: false, apiKey: '' }
  };
  const mcpServers = store.settings.mcpServers || [];

  // Form states for search providers
  const [tavilyEnabled, setTavilyEnabled] = useState(searchSettings.tavily?.enabled || false);
  const [tavilyKey, setTavilyKey] = useState(searchSettings.tavily?.apiKey || '');
  const [braveEnabled, setBraveEnabled] = useState(searchSettings.brave?.enabled || false);
  const [braveKey, setBraveKey] = useState(searchSettings.brave?.apiKey || '');
  const [perplexityEnabled, setPerplexityEnabled] = useState(searchSettings.perplexity?.enabled || false);
  const [perplexityKey, setPerplexityKey] = useState(searchSettings.perplexity?.apiKey || '');

  // Form states for editing custom MCP server
  const [editingServer, setEditingServer] = useState<MCPServerConfig | null>(null);
  const [serverName, setServerName] = useState('');
  const [serverType, setServerType] = useState<'stdio' | 'sse'>('stdio');
  const [serverCommand, setServerCommand] = useState('');
  const [serverArgs, setServerArgs] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [serverEnv, setServerEnv] = useState<{ key: string; value: string }[]>([]);
  const [serverEnabled, setServerEnabled] = useState(true);

  // Status map for custom MCP servers verification
  const [verifyStatus, setVerifyStatus] = useState<Record<string, { status: 'idle' | 'verifying' | 'success' | 'error'; toolsCount?: number; error?: string }>>({});

  useEffect(() => {
    if (store.settings.searchProviders) {
      setTavilyEnabled(store.settings.searchProviders.tavily?.enabled || false);
      setTavilyKey(store.settings.searchProviders.tavily?.apiKey || '');
      setBraveEnabled(store.settings.searchProviders.brave?.enabled || false);
      setBraveKey(store.settings.searchProviders.brave?.apiKey || '');
      setPerplexityEnabled(store.settings.searchProviders.perplexity?.enabled || false);
      setPerplexityKey(store.settings.searchProviders.perplexity?.apiKey || '');
    }
  }, [store.settings.searchProviders]);

  const handleSaveSearchProviders = async () => {
    await store.updateSettings(s => {
      s.searchProviders = {
        tavily: { enabled: tavilyEnabled, apiKey: tavilyKey },
        brave: { enabled: braveEnabled, apiKey: braveKey },
        perplexity: { enabled: perplexityEnabled, apiKey: perplexityKey }
      };
    });
  };

  const handleStartAddServer = () => {
    setEditingServer({
      id: crypto.randomUUID(),
      name: '',
      type: 'stdio',
      enabled: true
    });
    setServerName('');
    setServerType('stdio');
    setServerCommand('');
    setServerArgs('');
    setServerUrl('');
    setServerEnv([]);
    setServerEnabled(true);
  };

  const handleStartEditServer = (server: MCPServerConfig) => {
    setEditingServer(server);
    setServerName(server.name);
    setServerType(server.type);
    setServerCommand(server.command || '');
    setServerArgs(server.args ? server.args.join(', ') : '');
    setServerUrl(server.url || '');
    setServerEnabled(server.enabled);

    const envList: { key: string; value: string; }[] = [];
    if (server.env) {
      for (const [key, value] of Object.entries(server.env)) {
        envList.push({ key, value: String(value) });
      }
    }
    setServerEnv(envList);
  };

  const handleAddEnvRow = () => {
    setServerEnv(prev => [...prev, { key: '', value: '' }]);
  };

  const handleRemoveEnvRow = (index: number) => {
    setServerEnv(prev => prev.filter((_, i) => i !== index));
  };

  const handleEnvKeyChange = (index: number, val: string) => {
    setServerEnv(prev => prev.map((row, i) => i === index ? { ...row, key: val } : row));
  };

  const handleEnvValChange = (index: number, val: string) => {
    setServerEnv(prev => prev.map((row, i) => i === index ? { ...row, value: val } : row));
  };

  const handleSaveServer = async () => {
    if (!editingServer) return;
    if (!serverName.trim()) return;

    const envMap: Record<string, string> = {};
    for (const row of serverEnv) {
      if (row.key.trim()) {
        envMap[row.key.trim()] = row.value;
      }
    }

    const newConfig: MCPServerConfig = {
      id: editingServer.id,
      name: serverName.trim(),
      type: serverType,
      enabled: serverEnabled,
      ...(serverType === 'stdio'
        ? {
            command: serverCommand.trim(),
            args: serverArgs.split(',').map(a => a.trim()).filter(Boolean),
            env: envMap
          }
        : {
            url: serverUrl.trim()
          })
    };

    await store.updateSettings(s => {
      if (!s.mcpServers) s.mcpServers = [];
      const idx = s.mcpServers.findIndex(srv => srv.id === newConfig.id);
      if (idx !== -1) {
        s.mcpServers[idx] = newConfig;
      } else {
        s.mcpServers.push(newConfig);
      }
    });

    setEditingServer(null);
  };

  const handleDeleteServer = async (id: string) => {
    await store.updateSettings(s => {
      if (s.mcpServers) {
        s.mcpServers = s.mcpServers.filter(srv => srv.id !== id);
      }
    });
  };

  const handleToggleServerEnabled = async (server: MCPServerConfig, val: boolean) => {
    await store.updateSettings(s => {
      if (s.mcpServers) {
        const found = s.mcpServers.find(srv => srv.id === server.id);
        if (found) found.enabled = val;
      }
    });
  };

  const handleTestServer = async (server: MCPServerConfig) => {
    setVerifyStatus(prev => ({ ...prev, [server.id]: { status: 'verifying' } }));
    try {
      const result = await store.verifyMCPServer(server);
      if (result.success) {
        setVerifyStatus(prev => ({
          ...prev,
          [server.id]: { status: 'success', toolsCount: result.toolsCount }
        }));
      } else {
        setVerifyStatus(prev => ({
          ...prev,
          [server.id]: { status: 'error', error: result.error }
        }));
      }
    } catch (err: any) {
      setVerifyStatus(prev => ({
        ...prev,
        [server.id]: { status: 'error', error: err.message || String(err) }
      }));
    }
  };

  return (
    <div className="flex-1 flex flex-col gap-5 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1 flex items-center gap-1.5">
          <Cpu className="w-5 h-5 text-[var(--accent)]" />
          MCP & Search Configuration
        </h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          Enable search tools or custom Model Context Protocol (MCP) servers to give the AI assistant advanced execution capabilities.
        </p>
      </div>

      {/* 1. SEARCH PROVIDERS */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Built-in Search Providers</span>

        {/* Tavily */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-[var(--accent)]" />
              Tavily Web Search
            </span>
            <Toggle checked={tavilyEnabled} onChange={setTavilyEnabled} />
          </div>
          {tavilyEnabled && (
            <input
              type="password"
              placeholder="Tavily API Key (tvly-...)"
              value={tavilyKey}
              onChange={e => setTavilyKey(e.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          )}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40" />

        {/* Brave Search */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] flex items-center gap-1">
              <Globe className="w-3.5 h-3.5 text-[var(--accent)]" />
              Brave Search
            </span>
            <Toggle checked={braveEnabled} onChange={setBraveEnabled} />
          </div>
          {braveEnabled && (
            <input
              type="password"
              placeholder="Brave Subscription Token"
              value={braveKey}
              onChange={e => setBraveKey(e.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          )}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40" />

        {/* Perplexity */}
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-[var(--accent)]" />
              Perplexity Conversational Search
            </span>
            <Toggle checked={perplexityEnabled} onChange={setPerplexityEnabled} />
          </div>
          {perplexityEnabled && (
            <input
              type="password"
              placeholder="Perplexity API Key"
              value={perplexityKey}
              onChange={e => setPerplexityKey(e.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            />
          )}
        </div>

        <button
          onClick={handleSaveSearchProviders}
          className="mt-2 w-fit px-3 py-1 bg-[var(--accent)] hover:opacity-90 text-[calc(11px*var(--font-scale))] font-semibold text-white rounded cursor-pointer transition-opacity"
        >
          Save Search Providers
        </button>
      </div>

      {/* 2. CUSTOM MCP SERVERS */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Custom MCP Servers</span>
          {!editingServer && (
            <button
              onClick={handleStartAddServer}
              className="flex items-center gap-0.5 text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline font-semibold"
            >
              <Plus className="w-3 h-3" /> Add Server
            </button>
          )}
        </div>

        {/* Adding / Editing Form inline */}
        {editingServer && (
          <div className="bg-[var(--app-bg)] border border-[var(--border)] rounded-lg p-3 flex flex-col gap-2.5">
            <div className="flex items-center justify-between">
              <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">
                {serverName ? `Edit ${serverName}` : 'New Custom MCP Server'}
              </span>
              <button onClick={() => setEditingServer(null)} className="text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Server Name</label>
              <input
                type="text"
                placeholder="e.g. My Files Tool"
                value={serverName}
                onChange={e => setServerName(e.target.value)}
                className="bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Connection Type</label>
              <select
                value={serverType}
                onChange={e => setServerType(e.target.value as any)}
                className="bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
              >
                <option value="stdio">Local (Stdio CLI process)</option>
                <option value="sse">Remote (SSE Server URL)</option>
              </select>
            </div>

            {serverType === 'stdio' ? (
              <>
                <div className="flex flex-col gap-1">
                  <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Command</label>
                  <input
                    type="text"
                    placeholder="e.g. node or npx or python"
                    value={serverCommand}
                    onChange={e => setServerCommand(e.target.value)}
                    className="bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Arguments (comma-separated)</label>
                  <input
                    type="text"
                    placeholder="e.g. -y, @modelcontextprotocol/server-everything, arg2"
                    value={serverArgs}
                    onChange={e => setServerArgs(e.target.value)}
                    className="bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Custom Environment Variables</label>
                    <button
                      onClick={handleAddEnvRow}
                      className="text-[calc(9px*var(--font-scale))] text-[var(--accent)] hover:underline"
                    >
                      + Add Variable
                    </button>
                  </div>
                  {serverEnv.map((row, idx) => (
                    <div key={idx} className="flex items-center gap-1.5">
                      <input
                        type="text"
                        placeholder="KEY"
                        value={row.key}
                        onChange={e => handleEnvKeyChange(idx, e.target.value)}
                        className="flex-1 bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                      />
                      <span className="text-[var(--text-secondary)]">=</span>
                      <input
                        type="text"
                        placeholder="value"
                        value={row.value}
                        onChange={e => handleEnvValChange(idx, e.target.value)}
                        className="flex-1 bg-[var(--rail-bg)] border border(--border) rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                      />
                      <button onClick={() => handleRemoveEnvRow(idx)} className="text-[var(--danger)] hover:opacity-85">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="flex flex-col gap-1">
                <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">SSE URL</label>
                <input
                  type="text"
                  placeholder="e.g. http://localhost:3000/sse"
                  value={serverUrl}
                  onChange={e => setServerUrl(e.target.value)}
                  className="bg-[var(--rail-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
                />
              </div>
            )}

            <div className="flex items-center justify-between mt-1">
              <div className="flex items-center gap-2">
                <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] font-medium">Enabled</span>
                <Toggle checked={serverEnabled} onChange={setServerEnabled} />
              </div>
              <button
                onClick={handleSaveServer}
                disabled={!serverName.trim()}
                className="px-3 py-1 bg-[var(--accent)] hover:opacity-90 disabled:opacity-50 text-[calc(11px*var(--font-scale))] font-semibold text-white rounded cursor-pointer transition-opacity"
              >
                Save Server Config
              </button>
            </div>
          </div>
        )}

        {/* Servers list */}
        <div className="flex flex-col gap-2">
          {mcpServers.length === 0 ? (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] italic">No custom MCP servers configured.</span>
          ) : (
            mcpServers.map(srv => {
              const statusObj = verifyStatus[srv.id] || { status: 'idle' };
              return (
                <div key={srv.id} className="border border-[var(--border)] bg-[var(--app-bg)] rounded-lg p-3 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {srv.type === 'stdio' ? (
                        <Terminal className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                      ) : (
                        <Globe className="w-3.5 h-3.5 text-[var(--text-secondary)] shrink-0" />
                      )}
                      <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{srv.name}</span>
                      <span className="text-[calc(9px*var(--font-scale))] px-1.5 py-0.5 rounded bg-[var(--hover-row)] border border-[var(--border)] text-[var(--text-secondary)]">
                        {srv.type.toUpperCase()}
                      </span>
                    </div>

                    <div className="flex items-center gap-3">
                      <Toggle checked={srv.enabled} onChange={val => handleToggleServerEnabled(srv, val)} />
                      <button
                        onClick={() => handleStartEditServer(srv)}
                        className="text-[calc(10px*var(--font-scale))] text-[var(--accent)] hover:underline font-semibold"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDeleteServer(srv.id)}
                        className="text-[calc(10px*var(--font-scale))] text-[var(--danger)] hover:underline font-semibold"
                      >
                        Remove
                      </button>
                    </div>
                  </div>

                  {srv.type === 'stdio' ? (
                    <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] leading-tight">
                      Cmd: <code className="bg-[var(--rail-bg)] px-1 rounded">{srv.command} {srv.args?.join(' ')}</code>
                    </span>
                  ) : (
                    <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] leading-tight truncate">
                      URL: <code className="bg-[var(--rail-bg)] px-1 rounded">{srv.url}</code>
                    </span>
                  )}

                  {srv.enabled && (
                    <div className="flex items-center gap-2 mt-1">
                      <button
                        onClick={() => handleTestServer(srv)}
                        disabled={statusObj.status === 'verifying'}
                        className="flex items-center gap-1 px-2 py-0.5 border border-[var(--border)] hover:border-[var(--strong-border)] rounded text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] cursor-pointer transition-colors disabled:opacity-50"
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${statusObj.status === 'verifying' ? 'animate-spin' : ''}`} />
                        Test Connection
                      </button>

                      {statusObj.status === 'success' && (
                        <span className="text-[calc(10px*var(--font-scale))] text-[var(--success)] font-medium flex items-center gap-0.5">
                          <Check className="w-3.5 h-3.5" /> Connected ({statusObj.toolsCount} tools)
                        </span>
                      )}

                      {statusObj.status === 'error' && (
                        <span className="text-[calc(9px*var(--font-scale))] text-[var(--danger)] font-medium flex items-center gap-1 max-w-[320px] truncate" title={statusObj.error}>
                          <AlertCircle className="w-3 h-3 shrink-0" /> Failed: {statusObj.error}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
