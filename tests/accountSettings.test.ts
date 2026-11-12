import { describe, expect, it } from 'vitest';
import {
  clearAccountOverride,
  deleteSenderRule,
  getAccountOverride,
  getSenderRules,
  normalizeAccountId,
  normalizeAccountOverrides,
  purgeAccountSettings,
  resolveAccountSetting,
  resolveAccountSettings,
  setAccountOverride,
  setSenderRuleEnabled,
  setSenderRules,
  type AccountSettingsSource,
} from '../shared/accountSettings';
import { DEFAULT_SETTINGS, SETTINGS_SCHEMA_VERSION, mergeSettings } from '../renderer/src/stores/AppStore';
import type { SenderRule } from '../shared/types';

const WORK = 'alex.morgan@northwind.example';
const HOME = 'alex@morgan-family.example';

function rule(id: string, senderEmail: string, extra: Partial<SenderRule> = {}): SenderRule {
  return {
    id,
    senderEmail,
    action: 'archive',
    enabled: true,
    createdAt: '2026-10-01T09:00:00.000Z',
    confirmations: 3,
    bringBacks: 0,
    ...extra,
  };
}

function base(overrides: AccountSettingsSource['accountOverrides'] = {}): AccountSettingsSource {
  return {
    compose: { afterSend: 'archive' },
    ai: { allowMailBodyContext: true },
    accountDefaults: { notifications: 'people', agentAutonomy: 'prepare' },
    accountOverrides: overrides,
  };
}

describe('account settings inheritance', () => {
  it('inherits every setting from the app when the account has no override', () => {
    const resolved = resolveAccountSettings(base(), WORK);
    expect(resolved).toEqual({
      afterSend: { value: 'archive', source: 'app' },
      notifications: { value: 'people', source: 'app' },
      agentAutonomy: { value: 'prepare', source: 'app' },
      modelMayReadMail: { value: true, source: 'app' },
    });
  });

  it('follows the existing global flags for afterSend and mail text', () => {
    const settings = { ...base(), compose: { afterSend: 'keep' }, ai: { allowMailBodyContext: false } };
    expect(resolveAccountSetting(settings, WORK, 'afterSend')).toEqual({ value: 'keep', source: 'app' });
    expect(resolveAccountSetting(settings, WORK, 'modelMayReadMail')).toEqual({ value: false, source: 'app' });
  });

  it('falls back to built-in defaults when stored settings predate the keys', () => {
    expect(resolveAccountSettings({}, WORK)).toEqual({
      afterSend: { value: 'archive', source: 'app' },
      notifications: { value: 'people', source: 'app' },
      agentAutonomy: { value: 'prepare', source: 'app' },
      modelMayReadMail: { value: true, source: 'app' },
    });
  });

  it('an override wins for its account only', () => {
    const settings = setAccountOverride(base(), WORK, 'notifications', 'none');
    expect(resolveAccountSetting(settings, WORK, 'notifications')).toEqual({ value: 'none', source: 'account' });
    expect(resolveAccountSetting(settings, HOME, 'notifications')).toEqual({ value: 'people', source: 'app' });
  });

  it('an override equal to the app default still counts as customised', () => {
    const settings = setAccountOverride(base(), WORK, 'afterSend', 'archive');
    expect(resolveAccountSetting(settings, WORK, 'afterSend').source).toBe('account');
  });

  it('ignores invalid stored override values and inherits instead', () => {
    const settings = base({ [WORK]: { notifications: 'sometimes' as never, modelMayReadMail: 'yes' as never } });
    expect(resolveAccountSetting(settings, WORK, 'notifications')).toEqual({ value: 'people', source: 'app' });
    expect(resolveAccountSetting(settings, WORK, 'modelMayReadMail')).toEqual({ value: true, source: 'app' });
  });

  it('refuses to write an invalid value', () => {
    expect(() => setAccountOverride(base(), WORK, 'agentAutonomy', 'everything' as never)).toThrow();
  });

  it('does not mutate its input', () => {
    const settings = base();
    const next = setAccountOverride(settings, WORK, 'afterSend', 'keep');
    expect(settings.accountOverrides).toEqual({});
    expect(next).not.toBe(settings);
  });
});

describe('reset to app default', () => {
  it('clears one setting and keeps the others', () => {
    let settings = setAccountOverride(base(), WORK, 'afterSend', 'keep');
    settings = setAccountOverride(settings, WORK, 'notifications', 'all');
    settings = clearAccountOverride(settings, WORK, 'afterSend');
    expect(resolveAccountSetting(settings, WORK, 'afterSend')).toEqual({ value: 'archive', source: 'app' });
    expect(resolveAccountSetting(settings, WORK, 'notifications')).toEqual({ value: 'all', source: 'account' });
  });

  it('removes the account entry once nothing is overridden', () => {
    const settings = clearAccountOverride(setAccountOverride(base(), WORK, 'afterSend', 'keep'), WORK, 'afterSend');
    expect(settings.accountOverrides).toEqual({});
  });
});

describe('account id normalisation', () => {
  it('lowercases and trims', () => {
    expect(normalizeAccountId('  Alex.Morgan@Northwind.EXAMPLE ')).toBe(WORK);
  });

  it('reads and writes through any key variant and converges on the lowercased key', () => {
    const legacy = base({ 'Alex.Morgan@Northwind.example': { afterSend: 'keep' } });
    expect(resolveAccountSetting(legacy, WORK, 'afterSend')).toEqual({ value: 'keep', source: 'account' });
    expect(resolveAccountSetting(legacy, 'ALEX.MORGAN@NORTHWIND.EXAMPLE', 'afterSend').source).toBe('account');

    const next = setAccountOverride(legacy, 'Alex.Morgan@northwind.example', 'notifications', 'all');
    expect(Object.keys(next.accountOverrides)).toEqual([WORK]);
    expect(next.accountOverrides[WORK]).toEqual({ afterSend: 'keep', notifications: 'all' });
  });

  it('merges variants on load with the canonical key winning', () => {
    const merged = normalizeAccountOverrides({
      [WORK]: { afterSend: 'archive' },
      'Alex.Morgan@Northwind.example': { afterSend: 'keep', notifications: 'none' },
    });
    expect(merged).toEqual({ [WORK]: { afterSend: 'archive', notifications: 'none' } });
  });
});

describe('sender rules', () => {
  it('stores, toggles and deletes rules per account', () => {
    let settings = setSenderRules(base(), WORK, [rule('r1', 'Digest@Updates.Example'), rule('r2', 'news@shop.example')]);
    expect(getSenderRules(settings, WORK).map(r => r.senderEmail)).toEqual(['digest@updates.example', 'news@shop.example']);
    expect(getSenderRules(settings, HOME)).toEqual([]);

    settings = setSenderRuleEnabled(settings, WORK, 'r1', false);
    expect(getSenderRules(settings, WORK).find(r => r.id === 'r1')?.enabled).toBe(false);

    settings = deleteSenderRule(settings, WORK, 'r1');
    settings = deleteSenderRule(settings, WORK, 'r2');
    expect(getSenderRules(settings, WORK)).toEqual([]);
    expect(getAccountOverride(settings, WORK)).toBeUndefined();
  });

  it('drops malformed rules on load', () => {
    const merged = normalizeAccountOverrides({
      [WORK]: { senderRules: [rule('ok', 'a@b.example'), { id: '', senderEmail: 'x@y.example' }, 'junk', rule('ok', 'dup@b.example')] },
    });
    expect(merged[WORK].senderRules?.map(r => r.id)).toEqual(['ok']);
  });
});

describe('loading stored settings', () => {
  it('accepts old settings without the new keys', () => {
    const merged = mergeSettings({ settingsSchemaVersion: SETTINGS_SCHEMA_VERSION - 1, compose: { afterSend: 'keep' } });
    expect(merged.accountDefaults).toEqual({ notifications: 'people', agentAutonomy: 'prepare' });
    expect(merged.accountOverrides).toEqual({});
    expect(resolveAccountSetting(merged, WORK, 'afterSend')).toEqual({ value: 'keep', source: 'app' });
    expect(merged.settingsSchemaVersion).toBe(SETTINGS_SCHEMA_VERSION);
  });

  it('ships app defaults for the new keys', () => {
    expect(DEFAULT_SETTINGS.accountDefaults).toEqual({ notifications: 'people', agentAutonomy: 'prepare' });
    expect(DEFAULT_SETTINGS.accountOverrides).toEqual({});
  });

  it('never drops overrides of accounts that are not connected', () => {
    const stored = {
      settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
      accountOverrides: {
        [WORK]: { afterSend: 'keep', senderRules: [rule('r1', 'digest@updates.example')] },
        'gone@old-account.example': { notifications: 'none', futureKey: 'kept' },
      },
    };
    const merged = mergeSettings(stored);
    expect(merged.accountOverrides[WORK].afterSend).toBe('keep');
    expect(merged.accountOverrides[WORK].senderRules).toHaveLength(1);
    expect(merged.accountOverrides['gone@old-account.example']).toEqual({ notifications: 'none', futureKey: 'kept' });
  });

  it('round-trips through JSON storage unchanged', () => {
    const settings = setAccountOverride(mergeSettings({}), WORK, 'agentAutonomy', 'prepareAndRules');
    const reloaded = mergeSettings(JSON.parse(JSON.stringify(settings)));
    expect(reloaded.accountOverrides).toEqual(settings.accountOverrides);
  });
});

describe('purge on disconnect', () => {
  it('removes only the disconnected account', () => {
    let settings = setAccountOverride(base(), WORK, 'afterSend', 'keep');
    settings = setAccountOverride(settings, HOME, 'notifications', 'none');
    settings = setSenderRules(settings, WORK, [rule('r1', 'digest@updates.example')]);
    const purged = purgeAccountSettings(settings, 'Alex.Morgan@Northwind.example');
    expect(Object.keys(purged.accountOverrides)).toEqual([HOME]);
    expect(resolveAccountSetting(purged, WORK, 'afterSend')).toEqual({ value: 'archive', source: 'app' });
    expect(getSenderRules(purged, WORK)).toEqual([]);
  });

  it('removes legacy key variants too', () => {
    const purged = purgeAccountSettings(base({ 'Alex.Morgan@Northwind.example': { afterSend: 'keep' } }), WORK);
    expect(purged.accountOverrides).toEqual({});
  });
});
