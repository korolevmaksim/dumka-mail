// Scheduled messages that were held because their time was missed
// (`shared/scheduledSend.ts`). The main process keeps each notice until this
// window says it has shown it: the list is read when the window opens and
// whenever a message is held while it is open; each new one is shown in a
// toast that stays until dismissed, Drafts is reloaded (the message is an
// ordinary draft again), and only then is the notice acknowledged.
// Mount once (App).
import { useEffect, useRef } from 'react';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { formatDateTime } from '../../../shared/dateFormat';
import { heldScheduledSendMessage, heldScheduledSendsToAnnounce } from '../../../shared/scheduledSend';

/** Shown in this window already. Module-level: a remount (StrictMode) or a repeated request never shows one twice. */
const announced = new Set<string>();

export function useHeldScheduledSends(): void {
  const store = useAppStore();
  const storeRef = useRef(store);
  storeRef.current = store;

  useEffect(() => {
    let disposed = false;
    const show = async () => {
      let listed;
      try {
        listed = await window.electronAPI.listHeldScheduledSends();
      } catch (error) {
        console.error('Failed to read held scheduled messages:', error);
        return;
      }
      // Nothing was shown, so nothing is acknowledged: the notices stay
      // stored for the effect that replaces this one, or for the next window.
      if (disposed || listed.length === 0) return;
      const fresh = heldScheduledSendsToAnnounce(listed, announced);
      if (fresh.length > 0) void storeRef.current.loadDrafts();
      for (const item of fresh) {
        announced.add(item.actionId);
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
      // Everything listed has now been shown here (just now or earlier).
      window.electronAPI.acknowledgeHeldScheduledSends(listed.map(item => item.actionId))
        .catch(error => console.error('Failed to acknowledge held scheduled messages:', error));
    };
    void show();
    const unsubscribe = window.electronAPI.onScheduledSendHeld(() => { void show(); });
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, []);
}
