import { describe, expect, it } from 'vitest';
import { backgroundProvider, defaultBackgroundProvider, effectiveBackgroundModel, seedBackgroundProvider } from '../renderer/src/lib/backgroundModel';
import { AI_SECRET_STORED_PLACEHOLDER, type AIProviderDescriptor, type AppSettings } from '../shared/types';

const descriptor = (preference: string, status = 'Configured') => ({ preference, status } as unknown as AIProviderDescriptor);
const settings = (ai: Record<string, unknown> = {}) => ({ ai: { automationProvider: '', automationModel: '', ...ai } } as unknown as Pick<AppSettings, 'ai'>);
const KEY = AI_SECRET_STORED_PLACEHOLDER;

describe('background provider and model', () => {
  it('uses the provider in use, else the first one that is set up', () => {
    expect(defaultBackgroundProvider(descriptor('anthropic'), {})).toBe('anthropic');
    expect(defaultBackgroundProvider(descriptor('openAI', 'Missing API Key'), { GEMINI_API_KEY: KEY })).toBe('gemini');
    expect(defaultBackgroundProvider(descriptor('openAI', 'Missing model'), { OPENAI_API_KEY: KEY })).toBe('openAI');
    expect(defaultBackgroundProvider(null, {})).toBeNull();
    expect(backgroundProvider(settings({ automationProvider: 'deepSeek' }), descriptor('anthropic'), {})).toBe('deepSeek');
    expect(backgroundProvider(settings(), descriptor('anthropic'), {})).toBe('anthropic');
  });

  it('makes the provider explicit when background work is switched on, and never guesses a model', () => {
    const next = settings();
    seedBackgroundProvider(next, 'openAI');
    expect(next.ai).toMatchObject({ automationProvider: 'openAI', automationModel: '' });
  });

  it('keeps a provider and a model the user already chose', () => {
    const next = settings({ automationProvider: 'gemini', automationModel: 'my-model' });
    seedBackgroundProvider(next, 'openAI');
    expect(next.ai).toMatchObject({ automationProvider: 'gemini', automationModel: 'my-model' });
  });

  it('does nothing without any provider', () => {
    const next = settings();
    seedBackgroundProvider(next, null);
    expect(next.ai).toMatchObject({ automationProvider: '', automationModel: '' });
  });

  it('reports the model that will run: the one chosen for background work, else the one saved for the provider', () => {
    const env = { OPENAI_MODEL: ' saved-model ' };
    expect(effectiveBackgroundModel(settings({ automationModel: 'small-model' }), 'openAI', env)).toBe('small-model');
    expect(effectiveBackgroundModel(settings(), 'openAI', env)).toBe('saved-model');
    // Nothing chosen anywhere: nothing runs, and the settings page says so.
    expect(effectiveBackgroundModel(settings(), 'gemini', env)).toBe('');
    expect(effectiveBackgroundModel(settings(), null, env)).toBe('');
  });
});
