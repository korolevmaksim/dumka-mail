import { describe, expect, it } from 'vitest';
import {
  resolveAssistantModelProvider,
  resolveAssistantModelSummary,
  shouldFetchAssistantModelCatalog,
} from '../renderer/src/lib/aiAssistantModelControls';
import type { AIProviderDescriptor } from '../shared/types';

const anthropicDescriptor: AIProviderDescriptor = {
  preference: 'anthropic',
  displayName: 'Anthropic',
  model: 'claude-sonnet-5',
  transport: 'messages',
  status: 'Configured',
  capabilities: { canTriage: true, canSummarize: true, canDraft: true },
};

describe('AI assistant model controls', () => {
  it('uses the resolved automatic provider and configured provider model instead of a stale global model', () => {
    const provider = resolveAssistantModelProvider('automatic', anthropicDescriptor);

    expect(provider).toBe('anthropic');
    expect(resolveAssistantModelSummary(provider, 'claude-sonnet-5', anthropicDescriptor)).toBe('claude-sonnet-5');
  });

  it('does not fetch the provider model catalog until compact controls are opened', () => {
    expect(shouldFetchAssistantModelCatalog({
      controlsOpen: false,
      modelProvider: 'anthropic',
      cachedModels: undefined,
    })).toBe(false);
    expect(shouldFetchAssistantModelCatalog({
      controlsOpen: true,
      modelProvider: 'anthropic',
      cachedModels: undefined,
    })).toBe(true);
    expect(shouldFetchAssistantModelCatalog({
      controlsOpen: true,
      modelProvider: 'anthropic',
      cachedModels: ['claude-sonnet-5'],
    })).toBe(false);
  });
});
