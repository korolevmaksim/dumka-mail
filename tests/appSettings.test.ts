import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, SETTINGS_SCHEMA_VERSION } from '../renderer/src/stores/AppStore';

describe('AppSettings AI prompt shortcuts', () => {
  it('ships with a thread-scoped request explanation shortcut', () => {
    expect(DEFAULT_SETTINGS.ai.promptShortcuts).toEqual([
      expect.objectContaining({
        id: 'explain-request',
        title: 'Explain Request',
        requiresThread: true,
      }),
    ]);
    expect(DEFAULT_SETTINGS.ai.promptShortcuts[0].instruction).toContain('what the sender wants');
  });

  it('adds prompt shortcut defaults when migrating older settings', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      ai: {
        provider: 'automatic',
      },
    });

    expect(merged.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
    expect(merged.ai.promptShortcuts).toHaveLength(1);
    expect(merged.ai.promptShortcuts[0].id).toBe('explain-request');
  });

  it('preserves user-configured prompt shortcuts', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      ai: {
        promptShortcuts: [
          {
            id: 'custom-1',
            title: 'Decision Brief',
            instruction: 'Tell me the decision, owner, deadline, and next step.',
            requiresThread: false,
          },
        ],
      },
    });

    expect(merged.ai.promptShortcuts).toEqual([
      {
        id: 'custom-1',
        title: 'Decision Brief',
        instruction: 'Tell me the decision, owner, deadline, and next step.',
        requiresThread: false,
      },
    ]);
  });
});
