// Scheduled messages that were held because their time was missed
// (`shared/scheduledSend.ts`). The main process keeps each one until a window
// has shown it: this hook takes them when the window opens and whenever one
// is held while it is open, reloads Drafts (the message is an ordinary draft
// again) and says so in a toast that stays until it is dismissed.
// Mount once (App).
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { formatDateTime } from '../../../shared/dateFormat';
import { heldScheduledSendMessage } from '../../../shared/scheduledSend';

export function useHeldScheduledSends(): void {
  const store = useAppStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let disposed = false;
    const take = async () => {
      let held;
      try {
        held = await window.electronAPI.takeHeldScheduledSends();
      } catch (error) {
        console.error('Failed to read held scheduled messages:', error);
        return;
      }
      if (disposed || held.length === 0) return;
      void storeRef.current.loadDrafts();
      for (const item of held) {
        emitToast({
          type: 'warning',
          message: heldScheduledSendMessage(item.subject, formatDateTime(item.sendAt)),
          actionLabel: 'Open Drafts',
          duration: 0,
          onAction: () => {
            const current = storeRef.current;
            current.setSettingsOpen(false);
            current.setWorkspaceView('mail');
            current.setMailboxView('drafts');
          },
        });
      }
    };
    void take();
    const unsubscribe = window.electronAPI.onScheduledSendHeld(() => { void take(); });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
