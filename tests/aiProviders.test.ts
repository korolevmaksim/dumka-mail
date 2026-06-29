import { describe, expect, it } from 'vitest';
import {
  CONFIGURABLE_AI_PROVIDERS,
  getAIProviderConfig,
  getAIProviderConfigFields,
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
      defaultModel: '~openai/gpt-latest',
      transport: 'chat.completions'
    });
  });

  it('resolves provider-specific default models from AI config', () => {
    const env = {
      OPENAI_MODEL: 'gpt-5',
      GEMINI_MODEL: 'gemini-3.5-flash',
      ANTHROPIC_MODEL: 'claude-sonnet-4-6',
    };

    expect(resolveConfiguredProviderModel('gemini', env)).toBe('gemini-3.5-flash');
    expect(resolveConfiguredProviderModel('anthropic', env)).toBe('claude-sonnet-4-6');
    expect(resolveConfiguredProviderModel('openRouter', {})).toBe('~openai/gpt-latest');
  });
});
