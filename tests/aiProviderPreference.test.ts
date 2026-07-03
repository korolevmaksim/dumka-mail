import { describe, expect, it } from 'vitest';
import { resolveAIProviderPreference } from '../shared/aiProviderPreference';

describe('AI provider preference source of truth', () => {
  it('prefers persisted app settings over missing or stale env preference values', () => {
    expect(resolveAIProviderPreference('anthropic', undefined)).toBe('anthropic');
    expect(resolveAIProviderPreference('gemini', 'automatic')).toBe('gemini');
  });

  it('keeps the legacy env preference as a fallback when app settings are unavailable', () => {
    expect(resolveAIProviderPreference(undefined, 'openRouter')).toBe('openRouter');
    expect(resolveAIProviderPreference(undefined, 'unsupported')).toBe('automatic');
  });
});
