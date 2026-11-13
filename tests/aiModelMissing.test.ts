import { describe, expect, it } from 'vitest';
import { isAIModelMissing, isAIProviderUnavailable } from '../shared/aiErrors';

describe('a provider with a key but no chosen model', () => {
  it('counts as unavailable, so nothing is sent with an invented model', () => {
    const descriptor = { preference: 'openAI', status: 'Missing model' };
    expect(isAIProviderUnavailable(descriptor)).toBe(true);
    expect(isAIModelMissing(descriptor)).toBe(true);
  });

  it('is told apart from a missing key and from a working provider', () => {
    expect(isAIModelMissing({ preference: 'openAI', status: 'Missing API Key' })).toBe(false);
    expect(isAIModelMissing({ preference: 'openAI', status: 'Configured' })).toBe(false);
    expect(isAIModelMissing(null)).toBe(false);
    expect(isAIProviderUnavailable({ preference: 'openAI', status: 'Configured' })).toBe(false);
  });
});
