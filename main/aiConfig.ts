import fs from 'fs';
import path from 'path';
import { AIProviderDescriptor, AIProviderPreference, AI_SECRET_KEYS, AI_SECRET_STORED_PLACEHOLDER } from '../shared/types';
import { CONFIGURABLE_AI_PROVIDERS, getAIProviderConfig, isConfigurableAIProvider, type ConfigurableAIProvider } from '../shared/aiProviders';
import { isTextModelId } from '../shared/aiModelCatalog';
import { SettingsRepo } from './database';
import { getRefreshToken, saveRefreshToken, deleteRefreshToken } from './keychain';
import { ensurePrimaryConfigDir, resolveConfigFile } from './appPaths';

const AI_CONFIG_KEYS = [
  ...AI_SECRET_KEYS,
  'OPENAI_BASE_URL',
  'OPENAI_RESPONSES_URL',
  'OPENAI_MODEL',
  'OPENAI_REASONING_EFFORT',
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_VERSION',
  'ANTHROPIC_MAX_TOKENS',
  'ANTHROPIC_THINKING_EFFORT',
  'GEMINI_BASE_URL',
  'GEMINI_MODEL',
  'GEMINI_THINKING_LEVEL',
  'OPENROUTER_BASE_URL',
  'OPENROUTER_MODEL',
  'OPENROUTER_REASONING_EFFORT',
  'OPENROUTER_REFERER',
  'OPENROUTER_APP_TITLE',
  'DEEPSEEK_BASE_URL',
  'DEEPSEEK_MODEL',
  'DEEPSEEK_THINKING',
  'DEEPSEEK_REASONING_EFFORT',
  'OPENAI_COMPATIBLE_NAME',
  'OPENAI_COMPATIBLE_BASE_URL',
  'OPENAI_COMPATIBLE_MODEL',
  'PMC_AI_PROVIDER'
] as const;

const AI_CONFIG_KEY_SET = new Set<string>(AI_CONFIG_KEYS);
const AI_SECRET_KEY_SET = new Set<string>(AI_SECRET_KEYS);

function supportsGenerateContent(model: any): boolean {
  const methods = Array.isArray(model?.supportedGenerationMethods) ? model.supportedGenerationMethods : [];
  return methods.some((method: unknown) => String(method).toLowerCase() === 'generatecontent');
}

// Loads env vars from dotenv file
function parseEnvFile(filePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (!fs.existsSync(filePath)) return env;

  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    const lines = text.split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const equalIdx = trimmed.indexOf('=');
      if (equalIdx > 0) {
        const key = trimmed.substring(0, equalIdx).trim();
        let value = trimmed.substring(equalIdx + 1).trim();
        
        // Remove quotes if present
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.substring(1, value.length - 1);
        }
        env[key] = value;
      }
    }
  } catch (e) {
    console.error('Error parsing env file:', e);
  }
  return env;
}

function loadAIConfigFromFiles(): Record<string, string> {
  const config = resolveConfigFile('ai.env', ['openai.env']);
  return config.path ? parseEnvFile(config.path) : {};
}

function shouldUseKeychainForSecrets(): boolean {
  try {
    const raw = SettingsRepo.get('appSettings');
    if (raw) {
      return !!JSON.parse(raw)?.privacy?.useKeychainForSecrets;
    }
  } catch {}

  return true;
}

export function loadAIConfig(): Record<string, string> {
  const env = loadAIConfigFromFiles();

  // Allow system process environment overrides
  return { ...env, ...process.env } as Record<string, string>;
}

export async function loadAIConfigAsync(): Promise<Record<string, string>> {
  const env = loadAIConfig();
  const useKeychain = shouldUseKeychainForSecrets();

  if (useKeychain) {
    for (const key of AI_SECRET_KEYS) {
      const val = await getRefreshToken(`ai-secret:${key}`);
      if (val) {
        env[key] = val;
      }
    }
  }
  return env;
}

export async function loadAIConfigForRenderer(): Promise<Record<string, string>> {
  const env = loadAIConfig();
  const useKeychain = shouldUseKeychainForSecrets();
  const rendererConfig: Record<string, string> = {};

  for (const key of AI_CONFIG_KEYS) {
    if (env[key] !== undefined) {
      rendererConfig[key] = env[key];
    }
  }

  for (const key of AI_SECRET_KEYS) {
    const keychainValue = useKeychain ? await getRefreshToken(`ai-secret:${key}`) : null;
    const hasSecret = Boolean(keychainValue || env[key]);
    if (hasSecret) {
      rendererConfig[key] = AI_SECRET_STORED_PLACEHOLDER;
    } else {
      delete rendererConfig[key];
    }
  }

  return rendererConfig;
}

export function saveAIConfig(config: Record<string, string>): void {
  const dir = ensurePrimaryConfigDir();
  const filePath = path.join(dir, 'ai.env');
  
  let content = '# Dumka Mail AI Configuration\n';
  for (const [key, value] of Object.entries(config)) {
    if (value !== undefined && value !== null) {
      content += `${key}=${value}\n`;
    }
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export async function saveAIConfigAsync(config: Record<string, string>): Promise<void> {
  const useKeychain = shouldUseKeychainForSecrets();

  const fileConfig: Record<string, string> = {};
  for (const [key, value] of Object.entries(loadAIConfigFromFiles())) {
    if (AI_CONFIG_KEY_SET.has(key) && !(useKeychain && AI_SECRET_KEY_SET.has(key))) {
      fileConfig[key] = value;
    }
  }

  for (const [key, value] of Object.entries(config)) {
    if (!AI_CONFIG_KEY_SET.has(key)) continue;

    if (AI_SECRET_KEY_SET.has(key)) {
      if (useKeychain) {
        delete fileConfig[key];
        if (value === AI_SECRET_STORED_PLACEHOLDER) {
          // Self-healing migration: if the placeholder is sent but the key doesn't exist in Keychain
          // yet, migrate it from the env file if present.
          const existingKeychainValue = await getRefreshToken(`ai-secret:${key}`);
          if (!existingKeychainValue) {
            const fileValues = loadAIConfigFromFiles();
            const fileValue = fileValues[key];
            if (fileValue && fileValue !== AI_SECRET_STORED_PLACEHOLDER) {
              await saveRefreshToken(`ai-secret:${key}`, fileValue);
            }
          }
          continue;
        }
        if (value) {
          await saveRefreshToken(`ai-secret:${key}`, value);
        } else {
          await deleteRefreshToken(`ai-secret:${key}`);
        }
      } else {
        if (value === AI_SECRET_STORED_PLACEHOLDER) {
          // Self-healing migration: if the placeholder is sent but useKeychain is false,
          // migrate the key back from the Keychain to the file if it exists in the Keychain.
          const existingKeychainValue = await getRefreshToken(`ai-secret:${key}`);
          if (existingKeychainValue) {
            fileConfig[key] = existingKeychainValue;
          }
          await deleteRefreshToken(`ai-secret:${key}`);
          continue;
        }

        fileConfig[key] = value;
        await deleteRefreshToken(`ai-secret:${key}`);
      }
    } else {
      fileConfig[key] = value;
    }
  }

  saveAIConfig(fileConfig);
}

export async function getAIProviderDescriptor(preference: AIProviderPreference, overrideModel?: string): Promise<AIProviderDescriptor> {
  const env = await loadAIConfigAsync();
  const activePref = preference === 'automatic'
    ? (env['PMC_AI_PROVIDER'] as AIProviderPreference || 'automatic')
    : preference;

  if (activePref === 'disabled') {
    return {
      preference: 'disabled',
      displayName: 'Disabled',
      model: 'None',
      transport: 'None',
      status: 'AI disabled in settings',
      capabilities: { canTriage: false, canSummarize: false, canDraft: false }
    };
  }

  // The model is whatever the caller asks for or the user saved for the
  // provider. There is no built-in model: a provider with a key but no model
  // is reported as `Missing model` and nothing is sent to it.
  const describeProvider = (provider: ConfigurableAIProvider): AIProviderDescriptor => {
    const config = getAIProviderConfig(provider);
    const model = (overrideModel || env[config.modelEnv] || '').trim();
    const local = provider === 'openAICompatible';
    return {
      preference: provider,
      displayName: local ? env['OPENAI_COMPATIBLE_NAME'] || config.displayName : config.displayName,
      model,
      transport: config.transport,
      status: !env[config.apiKeyEnv]
        ? (local ? 'Missing API Key/Base URL' : 'Missing API Key')
        : model ? 'Configured' : 'Missing model',
      capabilities: { canTriage: true, canSummarize: true, canDraft: true }
    };
  };

  const selectDesc = (pref: AIProviderPreference): AIProviderDescriptor => {
    if (isConfigurableAIProvider(pref)) return describeProvider(pref);
    // Automatic: the first provider with a key and a chosen model, else the first with a key.
    const withKey = CONFIGURABLE_AI_PROVIDERS.filter(provider => env[getAIProviderConfig(provider).apiKeyEnv]);
    const ready = withKey.find(provider => describeProvider(provider).status === 'Configured') || withKey[0];
    if (ready) return describeProvider(ready);
    return {
      preference: 'disabled',
      displayName: 'None',
      model: 'None',
      transport: 'None',
      status: 'No AI keys found',
      capabilities: { canTriage: false, canSummarize: false, canDraft: false }
    };
  };

  const defaultDesc = selectDesc(activePref);
  
  if (preference === 'automatic') {
    return {
      ...defaultDesc,
      displayName: `Automatic (${defaultDesc.displayName})`
    };
  }

  return defaultDesc;
}

/** Keeps what can answer in text; the lists also carry embedding, audio and image models. No family names are assumed. */
function isListedTextModel(id: unknown): id is string {
  return typeof id === 'string' && isTextModelId(id);
}

export async function listProviderModels(provider: string, apiKey: string, baseUrl?: string): Promise<string[]> {
  let realApiKey = apiKey;
  let env: Record<string, string> | null = null;

  const getEnv = async () => {
    if (!env) {
      env = await loadAIConfigAsync();
    }
    return env;
  };

  if (!realApiKey || realApiKey === AI_SECRET_STORED_PLACEHOLDER) {
    const env = await getEnv();
    if (provider === 'openAI') {
      realApiKey = env['OPENAI_API_KEY'] || '';
    } else if (provider === 'gemini') {
      realApiKey = env['GEMINI_API_KEY'] || '';
    } else if (provider === 'openRouter') {
      realApiKey = env['OPENROUTER_API_KEY'] || '';
    } else if (provider === 'deepSeek') {
      realApiKey = env['DEEPSEEK_API_KEY'] || '';
    } else if (provider === 'anthropic') {
      realApiKey = env['ANTHROPIC_API_KEY'] || '';
    } else if (provider === 'openAICompatible') {
      realApiKey = env['OPENAI_COMPATIBLE_API_KEY'] || '';
    }
  }

  if (provider !== 'openAICompatible' && !realApiKey) {
    throw new Error(`API Key is required to list models for ${provider}`);
  }

  try {
    switch (provider) {
      case 'openAI': {
        const urlEnd = baseUrl || 'https://api.openai.com/v1/models';
        const res = await fetch(urlEnd, {
          headers: { 'Authorization': `Bearer ${realApiKey}` }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || [])
          .map((m: any) => m.id)
          .filter(isListedTextModel)
          .sort();
      }
      case 'gemini': {
        const urlEnd = `https://generativelanguage.googleapis.com/v1beta/models?key=${realApiKey}`;
        const res = await fetch(urlEnd);
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.models || [])
          .filter(supportsGenerateContent)
          .map((m: any) => m.name.replace('models/', ''))
          .filter(isListedTextModel)
          .sort();
      }
      case 'openRouter': {
        const env = await getEnv();
        const configuredBaseUrl = baseUrl || env['OPENROUTER_BASE_URL'] || getAIProviderConfig('openRouter').defaultBaseUrl;
        const normalizedBaseUrl = configuredBaseUrl.replace(/\/+$/, '');
        const urlEnd = normalizedBaseUrl.endsWith('/models') ? normalizedBaseUrl : `${normalizedBaseUrl}/models`;
        const headers: Record<string, string> = {
          'Authorization': `Bearer ${realApiKey}`
        };
        if (env['OPENROUTER_REFERER']) {
          headers['HTTP-Referer'] = env['OPENROUTER_REFERER'];
        }
        if (env['OPENROUTER_APP_TITLE']) {
          headers['X-OpenRouter-Title'] = env['OPENROUTER_APP_TITLE'];
        }
        const res = await fetch(urlEnd, { headers });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).filter(isListedTextModel).sort();
      }
      case 'deepSeek': {
        const urlEnd = baseUrl || 'https://api.deepseek.com/models';
        const res = await fetch(urlEnd, {
          headers: { 'Authorization': `Bearer ${realApiKey}` }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).filter(isListedTextModel).sort();
      }
      case 'anthropic': {
        const urlEnd = 'https://api.anthropic.com/v1/models';
        const res = await fetch(urlEnd, {
          headers: {
            'x-api-key': realApiKey,
            'anthropic-version': '2023-06-01'
          }
        });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).filter(isListedTextModel).sort();
      }
      case 'openAICompatible': {
        const urlEnd = baseUrl ? (baseUrl.endsWith('/models') ? baseUrl : `${baseUrl}/models`) : '';
        if (!urlEnd) {
          throw new Error('Base URL is required for OpenAI-Compatible provider');
        }
        const headers: any = {};
        if (realApiKey) headers['Authorization'] = `Bearer ${realApiKey}`;
        const res = await fetch(urlEnd, { headers });
        if (!res.ok) {
          let errText = '';
          try { errText = await res.text(); } catch {}
          throw new Error(`HTTP ${res.status}${errText ? ': ' + errText : ''}`);
        }
        const data = await res.json() as any;
        return (data.data || []).map((m: any) => m.id).filter(isListedTextModel).sort();
      }
      default:
        return [];
    }
  } catch (e) {
    console.error(`Failed to fetch models for ${provider}:`, e);
    throw e;
  }
}
