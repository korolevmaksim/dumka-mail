import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { getAIProviderDescriptor, listProviderModels, saveAIConfigAsync } from '../main/aiConfig';
import { AI_SECRET_STORED_PLACEHOLDER } from '../shared/types';

// State variables for mocked modules
let mockKeychain = new Map<string, string>();
let mockUseKeychain = true;
let mockFileContent = '';

// Mock database and keychain
vi.mock('../main/database', () => ({
  SettingsRepo: {
    get: vi.fn(() => JSON.stringify({ privacy: { useKeychainForSecrets: mockUseKeychain } }))
  }
}));

vi.mock('../main/keychain', () => ({
  getRefreshToken: vi.fn(async (key) => mockKeychain.get(key) || null),
  saveRefreshToken: vi.fn(async (key, value) => { mockKeychain.set(key, value); }),
  deleteRefreshToken: vi.fn(async (key) => { mockKeychain.delete(key); })
}));

describe('saveAIConfigAsync self-healing and separation', () => {
  beforeEach(() => {
    mockKeychain.clear();
    mockUseKeychain = true;
    mockFileContent = '';

    vi.spyOn(fs, 'existsSync').mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('openai.env')) {
        return true;
      }
      return false;
    });

    vi.spyOn(fs, 'readFileSync').mockImplementation((path) => {
      if (typeof path === 'string' && path.includes('openai.env')) {
        return mockFileContent;
      }
      return '';
    });

    vi.spyOn(fs, 'writeFileSync').mockImplementation((path, content) => {
      if (typeof path === 'string' && path.includes('openai.env')) {
        mockFileContent = content as string;
      }
      return undefined;
    });

    vi.spyOn(fs, 'mkdirSync').mockImplementation(() => {
      return undefined;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('runs key migration and separation scenarios sequentially', async () => {
    // Scenario 1: preserves existing file credentials when saving only settings (e.g. models or thinking)
    mockUseKeychain = false; // keys are saved in env file
    mockFileContent = 'OPENAI_API_KEY=sk-proj-actualkey123\nOPENAI_MODEL=gpt-4o-mini\n';

    await saveAIConfigAsync({ OPENAI_REASONING_EFFORT: 'high' });

    expect(mockFileContent).toContain('OPENAI_API_KEY=sk-proj-actualkey123');
    expect(mockFileContent).toContain('OPENAI_REASONING_EFFORT=high');

    // Scenario 2: migrates key from file to keychain when useKeychain is true and placeholder is sent
    mockKeychain.clear();
    mockUseKeychain = true;
    mockFileContent = 'OPENAI_API_KEY=sk-proj-from-file\nOPENAI_MODEL=gpt-4\n';

    await saveAIConfigAsync({
      OPENAI_API_KEY: AI_SECRET_STORED_PLACEHOLDER,
      OPENAI_MODEL: 'gpt-5'
    });

    expect(mockKeychain.get('ai-secret:OPENAI_API_KEY')).toBe('sk-proj-from-file');
    expect(mockFileContent).not.toContain('OPENAI_API_KEY');
    expect(mockFileContent).toContain('OPENAI_MODEL=gpt-5');

    // Scenario 3: migrates key from keychain back to file when useKeychain is false and placeholder is sent
    mockKeychain.clear();
    mockUseKeychain = false;
    mockKeychain.set('ai-secret:OPENAI_API_KEY', 'sk-proj-from-keychain');
    mockFileContent = 'OPENAI_MODEL=gpt-4\n';

    await saveAIConfigAsync({
      OPENAI_API_KEY: AI_SECRET_STORED_PLACEHOLDER,
      OPENAI_MODEL: 'gpt-5'
    });

    expect(mockKeychain.has('ai-secret:OPENAI_API_KEY')).toBe(false);
    expect(mockFileContent).toContain('OPENAI_API_KEY=sk-proj-from-keychain');
    expect(mockFileContent).toContain('OPENAI_MODEL=gpt-5');
  });

  it('stores OpenRouter credentials as a secret while keeping non-secret settings in the env file', async () => {
    mockUseKeychain = true;
    mockFileContent = '';

    await saveAIConfigAsync({
      OPENROUTER_API_KEY: 'sk-or-v1-test',
      OPENROUTER_BASE_URL: 'https://openrouter.ai/api/v1',
      OPENROUTER_MODEL: '~openai/gpt-latest',
      OPENROUTER_REFERER: 'https://dumka.local',
      OPENROUTER_APP_TITLE: 'Dumka Mail'
    });

    expect(mockKeychain.get('ai-secret:OPENROUTER_API_KEY')).toBe('sk-or-v1-test');
    expect(mockFileContent).not.toContain('sk-or-v1-test');
    expect(mockFileContent).toContain('OPENROUTER_BASE_URL=https://openrouter.ai/api/v1');
    expect(mockFileContent).toContain('OPENROUTER_MODEL=~openai/gpt-latest');
    expect(mockFileContent).toContain('OPENROUTER_REFERER=https://dumka.local');
    expect(mockFileContent).toContain('OPENROUTER_APP_TITLE=Dumka Mail');
  });

  it('resolves OpenRouter descriptors and lists models with a stored key', async () => {
    mockUseKeychain = true;
    mockFileContent = 'OPENROUTER_MODEL=~openai/gpt-latest\n';
    mockKeychain.set('ai-secret:OPENROUTER_API_KEY', 'sk-or-v1-keychain');

    const descriptor = await getAIProviderDescriptor('openRouter' as any);

    expect(descriptor.preference).toBe('openRouter');
    expect(descriptor.displayName).toBe('OpenRouter');
    expect(descriptor.model).toBe('~openai/gpt-latest');
    expect(descriptor.status).toBe('Configured');

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      data: [
        { id: 'openai/gpt-5.2' },
        { id: 'anthropic/claude-sonnet-4.6' }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels('openRouter', AI_SECRET_STORED_PLACEHOLDER);

    expect(models).toEqual(['anthropic/claude-sonnet-4.6', 'openai/gpt-5.2']);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://openrouter.ai/api/v1/models',
      expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-or-v1-keychain'
        })
      })
    );
  });

  it('returns the effective provider preference for automatic descriptors so runtime calls are executable', async () => {
    mockUseKeychain = true;
    mockFileContent = 'ANTHROPIC_MODEL=claude-sonnet-4.6\n';
    mockKeychain.set('ai-secret:ANTHROPIC_API_KEY', 'sk-ant-keychain');

    const descriptor = await getAIProviderDescriptor('automatic');

    expect(descriptor.preference).toBe('anthropic');
    expect(descriptor.displayName).toBe('Automatic (Anthropic)');
    expect(descriptor.model).toBe('claude-sonnet-4.6');
    expect(descriptor.status).toBe('Configured');
  });

  it('lists only Gemini models that support generateContent for chat use', async () => {
    mockUseKeychain = true;
    mockFileContent = '';
    mockKeychain.set('ai-secret:GEMINI_API_KEY', 'gemini-keychain');
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      models: [
        { name: 'models/gemini-3.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
        { name: 'models/gemini-3-pro-image', supportedGenerationMethods: ['predict'] },
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }
      ]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);

    const models = await listProviderModels('gemini', AI_SECRET_STORED_PLACEHOLDER);

    expect(models).toEqual(['gemini-2.5-flash', 'gemini-3.5-flash']);
  });
});
