import { describe, expect, it } from 'vitest';
import {
  hasDedicatedAutomationModel,
  resolveAIModelForPurpose,
} from '../shared/aiModelPurpose';

describe('resolveAIModelForPurpose', () => {
  it('uses session interactive model over settings interactive model', () => {
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: 'settings-gpt', automationModel: 'auto-flash' },
      'session-gpt',
    )).toBe('session-gpt');
  });

  it('falls back to settings interactive model when session is empty', () => {
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: 'settings-gpt', automationModel: 'auto-flash' },
      '',
    )).toBe('settings-gpt');
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: 'settings-gpt', automationModel: 'auto-flash' },
    )).toBe('settings-gpt');
  });

  it('returns undefined for interactive when both session and settings interactive are empty', () => {
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: '', automationModel: 'auto-flash' },
      '  ',
    )).toBeUndefined();
  });

  it('uses dedicated automation model when set', () => {
    expect(resolveAIModelForPurpose(
      'automation',
      { interactiveModel: 'settings-gpt', automationModel: 'auto-flash' },
      'session-gpt',
    )).toBe('auto-flash');
  });

  it('falls back from empty automation model to interactive (session then settings)', () => {
    expect(resolveAIModelForPurpose(
      'automation',
      { interactiveModel: 'settings-gpt', automationModel: '' },
      'session-gpt',
    )).toBe('session-gpt');

    expect(resolveAIModelForPurpose(
      'automation',
      { interactiveModel: 'settings-gpt', automationModel: '   ' },
      '',
    )).toBe('settings-gpt');
  });

  it('returns undefined for automation when automation and interactive are both empty', () => {
    expect(resolveAIModelForPurpose(
      'automation',
      { interactiveModel: '', automationModel: '' },
      null,
    )).toBeUndefined();
  });

  it('does not let interactive purpose read the automation model', () => {
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: '', automationModel: 'only-auto' },
      '',
    )).toBeUndefined();
  });

  it('keeps interactive and automation independent when both are set', () => {
    const settings = {
      interactiveModel: 'chat-sonnet',
      automationModel: 'draft-haiku',
    };
    expect(resolveAIModelForPurpose('interactive', settings)).toBe('chat-sonnet');
    expect(resolveAIModelForPurpose('automation', settings)).toBe('draft-haiku');

    // Changing only interactive does not change a dedicated automation choice.
    const updatedInteractive = { ...settings, interactiveModel: 'chat-opus' };
    expect(resolveAIModelForPurpose('interactive', updatedInteractive)).toBe('chat-opus');
    expect(resolveAIModelForPurpose('automation', updatedInteractive)).toBe('draft-haiku');
  });

  it('trims whitespace on purpose model fields', () => {
    expect(resolveAIModelForPurpose(
      'automation',
      { interactiveModel: '  chat  ', automationModel: '  cheap  ' },
    )).toBe('cheap');
    expect(resolveAIModelForPurpose(
      'interactive',
      { interactiveModel: '  chat  ', automationModel: 'cheap' },
      '  session  ',
    )).toBe('session');
  });
});

describe('hasDedicatedAutomationModel', () => {
  it('is true only when automation model is non-empty after trim', () => {
    expect(hasDedicatedAutomationModel({ automationModel: 'cheap' })).toBe(true);
    expect(hasDedicatedAutomationModel({ automationModel: '' })).toBe(false);
    expect(hasDedicatedAutomationModel({ automationModel: '  ' })).toBe(false);
    expect(hasDedicatedAutomationModel({})).toBe(false);
  });
});
