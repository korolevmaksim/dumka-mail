import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import { saveAIConfigAsync } from '../main/aiConfig';
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
});
