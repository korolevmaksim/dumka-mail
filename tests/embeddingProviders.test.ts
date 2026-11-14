import { describe, expect, it } from 'vitest';
import {
  buildEmbeddingIndexKey,
  getDefaultEmbeddingSettings,
  getEmbeddingProviderConfig,
  normalizeEmbeddingSettings,
} from '../shared/embeddingProviders';

describe('embedding provider settings', () => {
  it('has no built-in embedding model: the default settings leave it empty', () => {
    const settings = getDefaultEmbeddingSettings();

    expect(settings.provider).toBe('openAI');
    expect(settings.model).toBe('');
    expect(settings.dimensions).toBeNull();
    expect(getEmbeddingProviderConfig(settings.provider).requiresApiKey).toBe(true);
  });

  it('fills the endpoint but never a model when settings are incomplete', () => {
    const settings = normalizeEmbeddingSettings({ provider: 'ollama' });

    expect(settings.provider).toBe('ollama');
    expect(settings.model).toBe('');
    expect(settings.baseURL).toBe('http://localhost:11434');
  });

  it('keeps the model and dimensions the user entered', () => {
    const settings = normalizeEmbeddingSettings({ provider: 'gemini', model: '  my-embedding-model ', dimensions: 3072 });

    expect(settings.model).toBe('my-embedding-model');
    expect(settings.dimensions).toBe(3072);
  });

  it('separates vector indexes by provider, model, dimensions, and compatible base URL', () => {
    const first = buildEmbeddingIndexKey({
      provider: 'openAICompatible',
      model: 'my-embedding-model',
      baseURL: 'http://localhost:1234/v1',
      dimensions: 1024,
    });
    const second = buildEmbeddingIndexKey({
      provider: 'openAICompatible',
      model: 'my-embedding-model',
      baseURL: 'http://localhost:11434/v1',
      dimensions: 1024,
    });

    expect(first).not.toBe(second);
    expect(first).toContain('dim=1024');
  });
});
