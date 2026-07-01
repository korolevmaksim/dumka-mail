import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingIndexKey,
  getDefaultEmbeddingSettings,
  getEmbeddingProviderConfig,
  normalizeEmbeddingSettings,
} from '../shared/embeddingProviders';

describe('embedding provider settings', () => {
  it('defaults to disabled-safe OpenAI settings without enabling semantic search', () => {
    const settings = getDefaultEmbeddingSettings();

    expect(settings.provider).toBe('openAI');
    expect(settings.model).toBe('text-embedding-3-small');
    expect(settings.dimensions).toBeNull();
    expect(getEmbeddingProviderConfig(settings.provider).requiresApiKey).toBe(true);
  });

  it('normalizes provider defaults when settings are incomplete', () => {
    const settings = normalizeEmbeddingSettings({ provider: 'ollama' });

    expect(settings.provider).toBe('ollama');
    expect(settings.model).toBe('embeddinggemma');
    expect(settings.baseURL).toBe('http://localhost:11434');
  });

  it('separates vector indexes by provider, model, dimensions, and compatible base URL', () => {
    const first = buildEmbeddingIndexKey({
      provider: 'openAICompatible',
      model: 'qwen3-embedding',
      baseURL: 'http://localhost:1234/v1',
      dimensions: 1024,
    });
    const second = buildEmbeddingIndexKey({
      provider: 'openAICompatible',
      model: 'qwen3-embedding',
      baseURL: 'http://localhost:11434/v1',
      dimensions: 1024,
    });

    expect(first).not.toBe(second);
    expect(first).toContain('dim=1024');
  });
});
