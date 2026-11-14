// Context-free request to open Settings at a specific page (e.g. the AI panel's
// "Add a model" line, or an account's page). SettingsPanel consumes the request
// on mount and listens for requests while it is already open.
import type { SettingsTabId } from '../../../shared/settingsNav';

export type SettingsTarget =
  | { kind: 'tab'; tab: SettingsTabId }
  | { kind: 'account'; accountId: string };

type Listener = (target: SettingsTarget) => void;

let pendingTarget: SettingsTarget | null = null;
const listeners = new Set<Listener>();

function request(target: SettingsTarget): void {
  pendingTarget = target;
  listeners.forEach(listener => listener(target));
}

export function requestSettingsTab(tab: SettingsTabId): void {
  request({ kind: 'tab', tab });
}

/** Opens the per-account page (Settings → Accounts → <account>). */
export function requestSettingsAccount(accountId: string): void {
  request({ kind: 'account', accountId: accountId.trim().toLowerCase() });
}

export function consumeRequestedSettingsTarget(): SettingsTarget | null {
  const target = pendingTarget;
  pendingTarget = null;
  return target;
}

export function subscribeSettingsTargetRequests(listener: Listener): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
