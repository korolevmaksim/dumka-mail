import { describe, expect, it } from 'vitest';
import {
  addModelConfigEntries,
  describeModelConnectionError,
  hasStoredKey,
  keyForConnectionTest,
  validateAddModelInput,
  type AddModelInput,
} from '../shared/addModel';
import { AI_SECRET_STORED_PLACEHOLDER } from '../shared/types';

const input = (extra: Partial<AddModelInput> = {}): AddModelInput => ({ provider: 'anthropic', apiKey: '', model: '', baseUrl: '', ...extra });

describe('add a model', () => {
  it('asks for a key unless one is stored', () => {
    expect(validateAddModelInput(input(), false)).toBe('Enter your Anthropic API key.');
    expect(validateAddModelInput(input(), true)).toBeNull();
    expect(validateAddModelInput(input({ apiKey: 'sk-test' }), false)).toBeNull();
  });

  it('needs an http(s) server address for a local endpoint, not a key', () => {
    expect(validateAddModelInput(input({ provider: 'openAICompatible' }), false)).toMatch(/address/);
    expect(validateAddModelInput(input({ provider: 'openAICompatible', baseUrl: 'localhost:11434' }), false)).toMatch(/http/);
    expect(validateAddModelInput(input({ provider: 'openAICompatible', baseUrl: 'http://localhost:11434/v1' }), false)).toBeNull();
  });

  it('tests with the typed key or lets main resolve the stored one', () => {
    expect(keyForConnectionTest(input({ apiKey: ' sk-test ' }), true)).toBe('sk-test');
    expect(keyForConnectionTest(input(), true)).toBe(AI_SECRET_STORED_PLACEHOLDER);
    expect(keyForConnectionTest(input(), false)).toBe('');
  });

  it('saves only filled fields through the provider env names', () => {
    expect(addModelConfigEntries(input({ apiKey: 'sk-test', model: 'claude-x' }))).toEqual({
      PMC_AI_PROVIDER: 'anthropic',
      ANTHROPIC_API_KEY: 'sk-test',
      ANTHROPIC_MODEL: 'claude-x',
    });
    expect(addModelConfigEntries(input())).toEqual({ PMC_AI_PROVIDER: 'anthropic' });
    expect(addModelConfigEntries(input({ apiKey: AI_SECRET_STORED_PLACEHOLDER }))).toEqual({ PMC_AI_PROVIDER: 'anthropic' });
  });

  it('detects a stored key from the masked renderer config', () => {
    expect(hasStoredKey({ OPENAI_API_KEY: AI_SECRET_STORED_PLACEHOLDER }, 'openAI')).toBe(true);
    expect(hasStoredKey({}, 'openAI')).toBe(false);
  });

  it('turns provider failures into sentences without echoing the raw error', () => {
    const rejected = describeModelConnectionError(new Error("Error invoking remote method 'api:listProviderModels': Error: 401 Unauthorized sk-secret-123"), 'openAI');
    expect(rejected).toBe('OpenAI did not accept this key. Check that it is correct and still active.');
    expect(rejected).not.toContain('sk-secret');
    expect(describeModelConnectionError(new Error('fetch failed'), 'gemini')).toMatch(/Could not reach Gemini/);
    expect(describeModelConnectionError(new Error('connect ECONNREFUSED 127.0.0.1:11434'), 'openAICompatible')).toMatch(/model server/);
    expect(describeModelConnectionError(new Error('Connection verification failed: No models returned from deepSeek.'), 'deepSeek')).toMatch(/no models/);
    expect(describeModelConnectionError('weird', 'anthropic')).toBe('Could not connect to Anthropic. Check the key and try again.');
  });
});
