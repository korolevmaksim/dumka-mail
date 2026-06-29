import { Account } from '../../../shared/types';

export function resolveComposeAccountId(activeAccount: Account | null, accounts: Account[]): string | null {
  if (activeAccount?.id === 'unified') {
    return accounts[0]?.email ?? null;
  }

  return activeAccount?.email ?? accounts[0]?.email ?? null;
}
