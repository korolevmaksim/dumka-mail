import { AI_SECRET_STORED_PLACEHOLDER, AppSettings, MCPServerConfig, SearchProvidersSettings } from '../shared/types';
import { deleteRefreshToken, getRefreshToken, saveRefreshToken } from './keychain';

const SEARCH_PROVIDER_IDS = ['tavily', 'brave', 'perplexity'] as const;

type MutableAppSettings = Partial<AppSettings> & {
  searchProviders?: Partial<Record<typeof SEARCH_PROVIDER_IDS[number], { enabled?: boolean; apiKey?: string }>>;
  mcpServers?: MCPServerConfig[];
};

function cloneSettings<T>(settings: T): T {
  return JSON.parse(JSON.stringify(settings || {}));
}

function searchSecretKey(provider: typeof SEARCH_PROVIDER_IDS[number]): string {
  return `search-secret:${provider}:apiKey`;
}

function mcpSecretKey(serverId: string, scope: 'env' | 'headers', key: string): string {
  return `mcp-secret:${serverId}:${scope}:${key}`;
}

async function storeSecret(secretKey: string, value: unknown): Promise<string> {
  if (value === AI_SECRET_STORED_PLACEHOLDER) {
    return AI_SECRET_STORED_PLACEHOLDER;
  }

  const stringValue = typeof value === 'string' ? value : '';
  if (!stringValue) {
    await deleteRefreshToken(secretKey);
    return '';
  }

  await saveRefreshToken(secretKey, stringValue);
  return AI_SECRET_STORED_PLACEHOLDER;
}

async function resolveSecret(secretKey: string, value: unknown): Promise<string> {
  if (value !== AI_SECRET_STORED_PLACEHOLDER) {
    return typeof value === 'string' ? value : '';
  }
  return await getRefreshToken(secretKey) || '';
}

async function sanitizeSearchProviders(settings: MutableAppSettings): Promise<void> {
  if (!settings.searchProviders) return;

  for (const provider of SEARCH_PROVIDER_IDS) {
    const config = settings.searchProviders[provider];
    if (!config) continue;
    config.apiKey = await storeSecret(searchSecretKey(provider), config.apiKey || '');
  }
}

async function resolveSearchProviders(settings: MutableAppSettings): Promise<void> {
  if (!settings.searchProviders) return;

  for (const provider of SEARCH_PROVIDER_IDS) {
    const config = settings.searchProviders[provider];
    if (!config) continue;
    config.apiKey = await resolveSecret(searchSecretKey(provider), config.apiKey || '');
  }
}

async function sanitizeRecordSecrets(
  serverId: string,
  scope: 'env' | 'headers',
  record: Record<string, string> | undefined,
): Promise<void> {
  if (!record) return;

  for (const [key, value] of Object.entries(record)) {
    record[key] = await storeSecret(mcpSecretKey(serverId, scope, key), value);
  }
}

async function resolveRecordSecrets(
  serverId: string,
  scope: 'env' | 'headers',
  record: Record<string, string> | undefined,
): Promise<void> {
  if (!record) return;

  for (const [key, value] of Object.entries(record)) {
    record[key] = await resolveSecret(mcpSecretKey(serverId, scope, key), value);
  }
}

async function sanitizeMCPServers(settings: MutableAppSettings): Promise<void> {
  if (!Array.isArray(settings.mcpServers)) return;

  for (const server of settings.mcpServers) {
    if (!server.id) continue;
    await sanitizeRecordSecrets(server.id, 'env', server.env);
    await sanitizeRecordSecrets(server.id, 'headers', server.headers);
  }
}

async function resolveMCPServers(settings: MutableAppSettings): Promise<void> {
  if (!Array.isArray(settings.mcpServers)) return;

  for (const server of settings.mcpServers) {
    if (!server.id) continue;
    await resolveRecordSecrets(server.id, 'env', server.env);
    await resolveRecordSecrets(server.id, 'headers', server.headers);
  }
}

export async function prepareAppSettingsForStorage(value: string): Promise<string> {
  const settings = cloneSettings(JSON.parse(value)) as MutableAppSettings;
  await sanitizeSearchProviders(settings);
  await sanitizeMCPServers(settings);
  return JSON.stringify(settings);
}

export async function resolveAppSettingsSecrets<T extends Partial<AppSettings>>(settings: T): Promise<T> {
  const resolved = cloneSettings(settings) as MutableAppSettings;
  await resolveSearchProviders(resolved);
  await resolveMCPServers(resolved);
  return resolved as T;
}

export async function resolveMCPServerConfigSecrets(server: MCPServerConfig): Promise<MCPServerConfig> {
  const resolved = await resolveAppSettingsSecrets({ mcpServers: [server] });
  return resolved.mcpServers?.[0] || server;
}

export function hasStoredSearchProviderSecret(settings: Partial<AppSettings>, provider: keyof SearchProvidersSettings): boolean {
  return settings.searchProviders?.[provider]?.apiKey === AI_SECRET_STORED_PLACEHOLDER;
}
