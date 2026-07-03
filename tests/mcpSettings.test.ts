import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AI_SECRET_STORED_PLACEHOLDER } from '../shared/types';

const keychainMock = vi.hoisted(() => ({
  store: new Map<string, string>(),
  getRefreshToken: vi.fn(async (key: string) => keychainMock.store.get(key) || null),
  saveRefreshToken: vi.fn(async (key: string, value: string) => {
    keychainMock.store.set(key, value);
  }),
  deleteRefreshToken: vi.fn(async (key: string) => {
    keychainMock.store.delete(key);
  }),
}));

vi.mock('../main/keychain', () => ({
  getRefreshToken: keychainMock.getRefreshToken,
  saveRefreshToken: keychainMock.saveRefreshToken,
  deleteRefreshToken: keychainMock.deleteRefreshToken,
}));

import {
  prepareAppSettingsForStorage,
  resolveAppSettingsSecrets,
} from '../main/mcpSettings';

describe('MCP and search settings secret storage', () => {
  beforeEach(() => {
    keychainMock.store.clear();
    keychainMock.getRefreshToken.mockClear();
    keychainMock.saveRefreshToken.mockClear();
    keychainMock.deleteRefreshToken.mockClear();
  });

  it('moves search API keys and MCP server environment values out of appSettings storage', async () => {
    const storedJson = await prepareAppSettingsForStorage(JSON.stringify({
      searchProviders: {
        tavily: { enabled: true, apiKey: 'tvly-secret' },
        brave: { enabled: true, apiKey: 'brave-secret' },
        perplexity: { enabled: false, apiKey: '' },
      },
      mcpServers: [
        {
          id: 'server-1',
          name: 'Local Files',
          type: 'stdio',
          enabled: true,
          command: 'node',
          args: ['server.js'],
          env: {
            API_TOKEN: 'mcp-token',
            MODE: 'readonly',
          },
        },
      ],
    }));

    expect(storedJson).not.toContain('tvly-secret');
    expect(storedJson).not.toContain('brave-secret');
    expect(storedJson).not.toContain('mcp-token');
    expect(storedJson).not.toContain('readonly');
    expect(keychainMock.store.get('search-secret:tavily:apiKey')).toBe('tvly-secret');
    expect(keychainMock.store.get('search-secret:brave:apiKey')).toBe('brave-secret');
    expect(keychainMock.store.get('mcp-secret:server-1:env:API_TOKEN')).toBe('mcp-token');
    expect(keychainMock.store.get('mcp-secret:server-1:env:MODE')).toBe('readonly');

    const stored = JSON.parse(storedJson);
    expect(stored.searchProviders.tavily.apiKey).toBe(AI_SECRET_STORED_PLACEHOLDER);
    expect(stored.searchProviders.brave.apiKey).toBe(AI_SECRET_STORED_PLACEHOLDER);
    expect(stored.mcpServers[0].env.API_TOKEN).toBe(AI_SECRET_STORED_PLACEHOLDER);
    expect(stored.mcpServers[0].env.MODE).toBe(AI_SECRET_STORED_PLACEHOLDER);

    const resolved = await resolveAppSettingsSecrets(stored);
    expect(resolved.searchProviders.tavily.apiKey).toBe('tvly-secret');
    expect(resolved.searchProviders.brave.apiKey).toBe('brave-secret');
    expect(resolved.mcpServers[0].env.API_TOKEN).toBe('mcp-token');
    expect(resolved.mcpServers[0].env.MODE).toBe('readonly');
  });

  it('preserves existing secret values when the renderer sends placeholders', async () => {
    keychainMock.store.set('search-secret:tavily:apiKey', 'existing-tvly-secret');
    keychainMock.store.set('mcp-secret:server-1:env:API_TOKEN', 'existing-mcp-token');

    const storedJson = await prepareAppSettingsForStorage(JSON.stringify({
      searchProviders: {
        tavily: { enabled: true, apiKey: AI_SECRET_STORED_PLACEHOLDER },
      },
      mcpServers: [
        {
          id: 'server-1',
          name: 'Local Files',
          type: 'stdio',
          enabled: true,
          command: 'node',
          env: {
            API_TOKEN: AI_SECRET_STORED_PLACEHOLDER,
          },
        },
      ],
    }));

    expect(keychainMock.store.get('search-secret:tavily:apiKey')).toBe('existing-tvly-secret');
    expect(keychainMock.store.get('mcp-secret:server-1:env:API_TOKEN')).toBe('existing-mcp-token');

    const resolved = await resolveAppSettingsSecrets(JSON.parse(storedJson));
    expect(resolved.searchProviders.tavily.apiKey).toBe('existing-tvly-secret');
    expect(resolved.mcpServers[0].env.API_TOKEN).toBe('existing-mcp-token');
  });
});
