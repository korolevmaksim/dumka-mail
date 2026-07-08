import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, SETTINGS_SCHEMA_VERSION } from '../renderer/src/stores/AppStore';

describe('AppSettings AI prompt shortcuts', () => {
  it('ships with system language as the default interface locale', () => {
    expect(DEFAULT_SETTINGS.general.language).toBe('system');
  });

  it('defaults attachment download folder to empty (system Downloads)', () => {
    expect(DEFAULT_SETTINGS.general.attachmentDownloadFolder).toBe('');
  });

  it('fills attachmentDownloadFolder when migrating older settings blobs', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      general: {
        language: 'en',
      },
    });

    expect(merged.general.attachmentDownloadFolder).toBe('');
    expect(merged.general.language).toBe('en');
  });

  it('preserves a user-configured attachment download folder', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      general: {
        attachmentDownloadFolder: '/Users/me/Mail Downloads',
      },
    });

    expect(merged.general.attachmentDownloadFolder).toBe('/Users/me/Mail Downloads');
  });

  it('normalizes invalid persisted interface language values', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      general: {
        language: 'unsupported',
      },
    });

    expect(merged.general.language).toBe('system');
  });

  it('preserves supported persisted interface language values', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      general: {
        language: 'pseudo',
      },
    });

    expect(merged.general.language).toBe('pseudo');
  });

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

  it('adds disabled mail rules defaults when migrating older settings', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
    });

    expect(merged.mailRules).toEqual({
      enabled: false,
      rules: [],
    });
  });

  it('preserves valid user-configured mail rules', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      mailRules: {
        enabled: true,
        rules: [{
          id: 'receipts',
          title: 'Receipts',
          isEnabled: true,
          accountId: 'me@example.com',
          matchMode: 'all',
          conditions: [{
            id: 'condition-1',
            field: 'senderDomain',
            operation: 'equals',
            value: 'vendor.com',
            isNegated: false,
            accountId: 'me@example.com',
          }],
          actions: [{ id: 'archive', type: 'archive' }],
        }],
      },
    });

    expect(merged.mailRules.enabled).toBe(true);
    expect(merged.mailRules.rules).toHaveLength(1);
    expect(merged.mailRules.rules[0].actions[0].type).toBe('archive');
  });
});
