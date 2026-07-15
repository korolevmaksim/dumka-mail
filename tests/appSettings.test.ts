import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, SETTINGS_SCHEMA_VERSION } from '../renderer/src/stores/AppStore';

describe('AppSettings AI prompt shortcuts', () => {
  it('ships with system language as the default interface locale', () => {
    expect(DEFAULT_SETTINGS.general.language).toBe('system');
  });

  it('preserves Today as a supported startup workspace and rejects unknown values', () => {
    expect(mergeSettings({ general: { startupBehavior: 'today' } }).general.startupBehavior).toBe('today');
    expect(mergeSettings({ general: { startupBehavior: 'unknown' } }).general.startupBehavior).toBe('inbox');
  });

  it('defaults attachment download folder to empty (system Downloads)', () => {
    expect(DEFAULT_SETTINGS.general.attachmentDownloadFolder).toBe('');
  });

  it('defaults calendar scope to all accounts and preserves an explicit account', () => {
    expect(DEFAULT_SETTINGS.calendar.lastAccountScope).toBe('unified');
    expect(mergeSettings({ calendar: { lastAccountScope: 'work@example.com' } }).calendar.lastAccountScope).toBe('work@example.com');
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

  it('ships a 30-day Follow-up Radar lookback so archaeology stays out of the radar', () => {
    expect(DEFAULT_SETTINGS.inbox.followUpMaxAgeDays).toBe(30);
    expect(DEFAULT_SETTINGS.inbox.followUpThresholdHours).toBe(48);
  });

  it('fills followUpMaxAgeDays when migrating older settings blobs', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      inbox: {
        enableFollowUps: true,
        followUpThresholdHours: 72,
        followUpMaxItems: 8,
      },
    });

    expect(merged.inbox.followUpMaxAgeDays).toBe(30);
    expect(merged.inbox.followUpThresholdHours).toBe(72);
    expect(merged.inbox.followUpMaxItems).toBe(8);
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

  it('ships interactive and automation model fields empty so installs fall back to provider defaults', () => {
    expect(DEFAULT_SETTINGS.ai.globalDefaultModel).toBe('');
    expect(DEFAULT_SETTINGS.ai.automationModel).toBe('');
  });

  it('fills automationModel when migrating older settings blobs that only had interactive model', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1,
      ai: {
        provider: 'openAI',
        globalDefaultModel: 'gpt-5.4',
      },
    });

    expect(merged.ai.globalDefaultModel).toBe('gpt-5.4');
    expect(merged.ai.automationModel).toBe('');
  });

  it('preserves a user-configured automation model independently of interactive model', () => {
    const merged = mergeSettings({
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      ai: {
        globalDefaultModel: 'gpt-5.4',
        automationModel: 'gpt-5.4-mini',
      },
    });

    expect(merged.ai.globalDefaultModel).toBe('gpt-5.4');
    expect(merged.ai.automationModel).toBe('gpt-5.4-mini');
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
    expect(merged.mailRules.rules[0].mode).toBe('active');
    expect(merged.mailRules.rules[0].actions[0].type).toBe('archive');
  });
});
