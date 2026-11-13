import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE_AI_PROVIDERS,
  getAIProviderConfig,
  getAIProviderConfigFields,
  geminiEmbeddingUsesInlineInstruction,
  geminiSupportsThinkingLevel,
  resolveConfiguredProviderModel,
} from '../shared/aiProviders';

describe('AI provider registry', () => {
  it('keeps provider env fields explicit and stable', () => {
    expect(getAIProviderConfigFields('anthropic')).toEqual({
      apiKey: 'ANTHROPIC_API_KEY',
      baseUrl: 'ANTHROPIC_BASE_URL',
      model: 'ANTHROPIC_MODEL'
    });
    expect(getAIProviderConfigFields('gemini')).toEqual({
      apiKey: 'GEMINI_API_KEY',
      baseUrl: 'GEMINI_BASE_URL',
      model: 'GEMINI_MODEL'
    });
    expect(getAIProviderConfigFields('openRouter')).toEqual({
      apiKey: 'OPENROUTER_API_KEY',
      baseUrl: 'OPENROUTER_BASE_URL',
      model: 'OPENROUTER_MODEL'
    });
  });

  it('includes OpenRouter as a first-class configurable provider', () => {
    expect(CONFIGURABLE_AI_PROVIDERS).toContain('openRouter');
    expect(getAIProviderConfig('openRouter')).toMatchObject({
      displayName: 'OpenRouter',
      defaultBaseUrl: 'https://openrouter.ai/api/v1',
      transport: 'chat.completions'
    });
  });

  it('reads the model for a provider from AI config and has no built-in fallback', () => {
    const env = {
      OPENAI_MODEL: 'model-a',
      GEMINI_MODEL: ' model-b ',
    };

    expect(resolveConfiguredProviderModel('openAI', env)).toBe('model-a');
    expect(resolveConfiguredProviderModel('gemini', env)).toBe('model-b');
    expect(resolveConfiguredProviderModel('anthropic', env)).toBe('');
    expect(resolveConfiguredProviderModel('openRouter', {})).toBe('');
    for (const provider of CONFIGURABLE_AI_PROVIDERS) {
      expect(getAIProviderConfig(provider)).not.toHaveProperty('defaultModel');
    }
  });

  it('picks the request format from the generation of the chosen model, not from a list of names', () => {
    expect(geminiSupportsThinkingLevel('gemini-3-x')).toBe(true);
    expect(geminiSupportsThinkingLevel('models/gemini-3.8-x')).toBe(true);
    expect(geminiSupportsThinkingLevel('gemini-4-x')).toBe(true);
    expect(geminiSupportsThinkingLevel('gemini-12-x')).toBe(true);
    expect(geminiSupportsThinkingLevel('gemini-2.5-x')).toBe(false);
    expect(geminiSupportsThinkingLevel('other-4')).toBe(false);

    expect(geminiEmbeddingUsesInlineInstruction('gemini-embedding-2')).toBe(true);
    expect(geminiEmbeddingUsesInlineInstruction('models/gemini-embedding-3-large')).toBe(true);
    expect(geminiEmbeddingUsesInlineInstruction('gemini-embedding-001')).toBe(false);
    expect(geminiEmbeddingUsesInlineInstruction('my-embedding-model')).toBe(false);
  });
});
