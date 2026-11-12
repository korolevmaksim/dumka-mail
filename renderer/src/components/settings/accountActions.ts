import { useCallback } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { purgeAccountSettings } from '../../../../shared/accountSettings';
import type { Account } from '../../../../shared/types';

/**
 * The existing disconnect confirmation (a warning toast with a `Disconnect`
 * action). When the cache is purged on disconnect (Privacy and data), the
 * account's settings overrides are removed with it.
 */
export function useConfirmDisconnectAccount(): (account: Account) => void {
  const { disconnectAccount, updateSettings } = useAppStore();
  return useCallback((account: Account) => {
    emitToast({
      type: 'warning',
      message: `Disconnect ${account.email}?`,
      actionLabel: 'Disconnect',
      onAction: () => {
        void (async () => {
          try {
            await disconnectAccount(account.id);
            await updateSettings(settings => {
              if (!settings.privacy.clearCacheOnDisconnect) return;
              settings.accountOverrides = purgeAccountSettings(settings, account.email).accountOverrides;
            });
          } catch (err) {
            console.error('Failed to disconnect account:', err);
            emitToast({ type: 'error', message: `Could not disconnect ${account.email}. Please try again.` });
          }
        })();
      },
      duration: 6000,
    });
  }, [disconnectAccount, updateSettings]);
}
