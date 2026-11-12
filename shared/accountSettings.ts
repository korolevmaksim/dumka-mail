// Per-account settings with inheritance (design-review/SPEC.md §8).
//
// Storage: `settings.accountOverrides[accountId]`, keyed by the lowercased
// account email. Every override field is optional; a missing field inherits
// the app-level value:
//   afterSend        ← compose.afterSend
//   notifications    ← accountDefaults.notifications   (default 'people')
//   agentAutonomy    ← accountDefaults.agentAutonomy   (default 'prepare')
//   modelMayReadMail ← ai.allowMailBodyContext
// `senderRules` is per-account only.
//
// Pure and dependency-free so the renderer and the main process (which reads
// raw stored JSON) resolve the same way. Helpers never mutate their input.
import type {
  AccountDefaultsSettings,
  AccountNotificationMode,
  AccountSettingsOverride,
  AgentAutonomy,
  ComposeAfterSend,
  SenderRule,
} from './types';

export type { AccountDefaultsSettings, AccountNotificationMode, AccountSettingsOverride, AgentAutonomy, SenderRule } from './types';

export const ACCOUNT_NOTIFICATION_MODES: readonly AccountNotificationMode[] = ['people', 'all', 'none'];
export const AGENT_AUTONOMY_LEVELS: readonly AgentAutonomy[] = ['prepare', 'prepareAndRules'];

export const DEFAULT_ACCOUNT_DEFAULTS: Readonly<AccountDefaultsSettings> = Object.freeze({
  notifications: 'people',
  agentAutonomy: 'prepare',
});

/** Fallbacks when the inherited global values are absent from stored settings. */
const DEFAULT_AFTER_SEND: ComposeAfterSend = 'archive';
const DEFAULT_MODEL_MAY_READ_MAIL = true;

/** The settings that have an app default and can be overridden per account. */
export interface AccountSettingValues {
  afterSend: ComposeAfterSend;
  notifications: AccountNotificationMode;
  agentAutonomy: AgentAutonomy;
  modelMayReadMail: boolean;
}

export type AccountSettingKey = keyof AccountSettingValues;

export const ACCOUNT_SETTING_KEYS: readonly AccountSettingKey[] = ['afterSend', 'notifications', 'agentAutonomy', 'modelMayReadMail'];

export type AccountSettingSource = 'account' | 'app';

export interface ResolvedAccountSetting<K extends AccountSettingKey> {
  value: AccountSettingValues[K];
  source: AccountSettingSource;
}

/**
 * The slice of `AppSettings` the resolver reads. Loose on purpose: the main
 * process passes parsed stored JSON that may predate these keys.
 */
export interface AccountSettingsSource {
  compose?: { afterSend?: unknown } | null;
  ai?: { allowMailBodyContext?: unknown } | null;
  accountDefaults?: Partial<Record<keyof AccountDefaultsSettings, unknown>> | null;
  accountOverrides?: Record<string, AccountSettingsOverride | undefined> | null;
}

/** Account ids are lowercased emails across the app (OAuth, cache, signatures). */
export function normalizeAccountId(accountId: string | null | undefined): string {
  return (accountId || '').trim().toLowerCase();
}

// --- Value validation --------------------------------------------------------

function isAfterSend(value: unknown): value is ComposeAfterSend {
  return value === 'archive' || value === 'keep';
}

function isNotificationMode(value: unknown): value is AccountNotificationMode {
  return typeof value === 'string' && (ACCOUNT_NOTIFICATION_MODES as readonly string[]).includes(value);
}

function isAgentAutonomy(value: unknown): value is AgentAutonomy {
  return typeof value === 'string' && (AGENT_AUTONOMY_LEVELS as readonly string[]).includes(value);
}

const VALIDATORS: { [K in AccountSettingKey]: (value: unknown) => value is AccountSettingValues[K] } = {
  afterSend: isAfterSend,
  notifications: isNotificationMode,
  agentAutonomy: isAgentAutonomy,
  modelMayReadMail: (value: unknown): value is boolean => typeof value === 'boolean',
};

export function isValidAccountSettingValue<K extends AccountSettingKey>(key: K, value: unknown): value is AccountSettingValues[K] {
  return VALIDATORS[key](value);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// --- Normalisation (load path) ----------------------------------------------

export function normalizeAccountDefaults(value: unknown): AccountDefaultsSettings {
  const input = isPlainRecord(value) ? value : {};
  return {
    notifications: isNotificationMode(input.notifications) ? input.notifications : DEFAULT_ACCOUNT_DEFAULTS.notifications,
    agentAutonomy: isAgentAutonomy(input.agentAutonomy) ? input.agentAutonomy : DEFAULT_ACCOUNT_DEFAULTS.agentAutonomy,
  };
}

function finiteCount(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : 0;
}

export function normalizeSenderRule(value: unknown): SenderRule | null {
  if (!isPlainRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const senderEmail = typeof value.senderEmail === 'string' ? value.senderEmail.trim().toLowerCase() : '';
  if (!id || !senderEmail) return null;
  const rule: SenderRule = {
    id,
    senderEmail,
    action: 'archive',
    enabled: value.enabled !== false,
    createdAt: typeof value.createdAt === 'string' && value.createdAt ? value.createdAt : new Date(0).toISOString(),
    confirmations: finiteCount(value.confirmations),
    bringBacks: finiteCount(value.bringBacks),
  };
  if (typeof value.senderName === 'string' && value.senderName.trim()) rule.senderName = value.senderName.trim();
  if (typeof value.autoDisabledAt === 'string' && value.autoDisabledAt) rule.autoDisabledAt = value.autoDisabledAt;
  return rule;
}

function normalizeSenderRules(value: unknown): SenderRule[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const rules: SenderRule[] = [];
  for (const entry of value) {
    const rule = normalizeSenderRule(entry);
    if (!rule || seen.has(rule.id)) continue;
    seen.add(rule.id);
    rules.push(rule);
  }
  return rules;
}

/**
 * Sanitises one override. Invalid known values are dropped (so they inherit);
 * fields this version does not know are kept for forward compatibility.
 */
export function normalizeAccountOverride(value: unknown): AccountSettingsOverride {
  if (!isPlainRecord(value)) return {};
  const out: Record<string, unknown> = { ...value };
  for (const key of ACCOUNT_SETTING_KEYS) {
    if (key in out && !isValidAccountSettingValue(key, out[key])) delete out[key];
  }
  if ('senderRules' in out) {
    const rules = normalizeSenderRules(out.senderRules);
    if (rules) out.senderRules = rules;
    else delete out.senderRules;
  }
  return out as AccountSettingsOverride;
}

/**
 * Normalises the whole map. Never drops an account (connected or not); key
 * variants of one account (`Alex@X.example`, ` alex@x.example`) are merged into
 * the lowercased key, with the canonical key's fields winning.
 */
export function normalizeAccountOverrides(value: unknown): Record<string, AccountSettingsOverride> {
  if (!isPlainRecord(value)) return {};
  const out: Record<string, AccountSettingsOverride> = {};
  const entries = Object.entries(value);
  // Variants first, canonical keys last, so the canonical entry wins on conflicts.
  entries.sort(([a], [b]) => Number(a === normalizeAccountId(a)) - Number(b === normalizeAccountId(b)));
  for (const [rawKey, override] of entries) {
    const key = normalizeAccountId(rawKey);
    if (!key) continue;
    out[key] = { ...(out[key] || {}), ...normalizeAccountOverride(override) };
  }
  return out;
}

// --- Reading -----------------------------------------------------------------

/** The stored override for an account, tolerating legacy key variants. */
export function getAccountOverride(settings: AccountSettingsSource, accountId: string): AccountSettingsOverride | undefined {
  const map = settings.accountOverrides;
  const key = normalizeAccountId(accountId);
  if (!map || !key) return undefined;
  if (key in map) return map[key];
  const variant = Object.keys(map).find(candidate => normalizeAccountId(candidate) === key);
  return variant === undefined ? undefined : map[variant];
}

/** The app-level value an account inherits when it has no override. */
export function getAppDefaultAccountSetting<K extends AccountSettingKey>(settings: AccountSettingsSource, key: K): AccountSettingValues[K] {
  const afterSend = settings.compose?.afterSend;
  const allowMailBodyContext = settings.ai?.allowMailBodyContext;
  const defaults = normalizeAccountDefaults(settings.accountDefaults);
  const values: AccountSettingValues = {
    afterSend: isAfterSend(afterSend) ? afterSend : DEFAULT_AFTER_SEND,
    notifications: defaults.notifications,
    agentAutonomy: defaults.agentAutonomy,
    modelMayReadMail: typeof allowMailBodyContext === 'boolean' ? allowMailBodyContext : DEFAULT_MODEL_MAY_READ_MAIL,
  };
  return values[key];
}

export function resolveAccountSetting<K extends AccountSettingKey>(
  settings: AccountSettingsSource,
  accountId: string,
  key: K,
): ResolvedAccountSetting<K> {
  const override = getAccountOverride(settings, accountId);
  const candidate = override?.[key];
  if (candidate !== undefined && isValidAccountSettingValue(key, candidate)) {
    return { value: candidate, source: 'account' };
  }
  return { value: getAppDefaultAccountSetting(settings, key), source: 'app' };
}

/** All four inheritable settings for an account at once. */
export function resolveAccountSettings(settings: AccountSettingsSource, accountId: string): { [K in AccountSettingKey]: ResolvedAccountSetting<K> } {
  return {
    afterSend: resolveAccountSetting(settings, accountId, 'afterSend'),
    notifications: resolveAccountSetting(settings, accountId, 'notifications'),
    agentAutonomy: resolveAccountSetting(settings, accountId, 'agentAutonomy'),
    modelMayReadMail: resolveAccountSetting(settings, accountId, 'modelMayReadMail'),
  };
}

export function getSenderRules(settings: AccountSettingsSource, accountId: string): SenderRule[] {
  return getAccountOverride(settings, accountId)?.senderRules ?? [];
}

// --- Writing (immutable) -----------------------------------------------------

type WithOverrides<S> = S & { accountOverrides: Record<string, AccountSettingsOverride> };

/** Rewrites one account's override; drops key variants and removes the entry once it is empty. */
function withAccountOverride<S extends AccountSettingsSource>(
  settings: S,
  accountId: string,
  update: (current: AccountSettingsOverride) => AccountSettingsOverride,
): WithOverrides<S> {
  const key = normalizeAccountId(accountId);
  const current = settings.accountOverrides || {};
  if (!key) return { ...settings, accountOverrides: { ...current } as Record<string, AccountSettingsOverride> };
  const next: Record<string, AccountSettingsOverride> = {};
  for (const [candidate, value] of Object.entries(current)) {
    if (normalizeAccountId(candidate) !== key && value) next[candidate] = value;
  }
  const updated = update({ ...(getAccountOverride(settings, key) || {}) });
  if (Object.keys(updated).length > 0) next[key] = updated;
  return { ...settings, accountOverrides: next };
}

export function setAccountOverride<S extends AccountSettingsSource, K extends AccountSettingKey>(
  settings: S,
  accountId: string,
  key: K,
  value: AccountSettingValues[K],
): WithOverrides<S> {
  if (!isValidAccountSettingValue(key, value)) {
    throw new Error(`Invalid value for account setting ${key}.`);
  }
  return withAccountOverride(settings, accountId, current => ({ ...current, [key]: value }));
}

/** Resets one setting to the app default. */
export function clearAccountOverride<S extends AccountSettingsSource>(
  settings: S,
  accountId: string,
  key: AccountSettingKey,
): WithOverrides<S> {
  return withAccountOverride(settings, accountId, current => {
    const next = { ...current };
    delete next[key];
    return next;
  });
}

export function setSenderRules<S extends AccountSettingsSource>(settings: S, accountId: string, rules: readonly SenderRule[]): WithOverrides<S> {
  return withAccountOverride(settings, accountId, current => {
    const next = { ...current };
    const normalized = normalizeSenderRules(rules) ?? [];
    if (normalized.length > 0) next.senderRules = normalized;
    else delete next.senderRules;
    return next;
  });
}

export function setSenderRuleEnabled<S extends AccountSettingsSource>(settings: S, accountId: string, ruleId: string, enabled: boolean): WithOverrides<S> {
  const rules = getSenderRules(settings, accountId).map(rule => {
    if (rule.id !== ruleId) return rule;
    // Turning an auto-disabled rule back on starts its bring-back count afresh.
    if (enabled && rule.autoDisabledAt) {
      const { autoDisabledAt: _cleared, ...rest } = rule;
      return { ...rest, enabled, bringBacks: 0 };
    }
    return { ...rule, enabled };
  });
  return setSenderRules(settings, accountId, rules);
}

export function deleteSenderRule<S extends AccountSettingsSource>(settings: S, accountId: string, ruleId: string): WithOverrides<S> {
  return setSenderRules(settings, accountId, getSenderRules(settings, accountId).filter(rule => rule.id !== ruleId));
}

/** Removes everything stored for an account (disconnect with cache purge). */
export function purgeAccountSettings<S extends AccountSettingsSource>(settings: S, accountId: string): WithOverrides<S> {
  return withAccountOverride(settings, accountId, () => ({}));
}
