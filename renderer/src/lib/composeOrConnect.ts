import type { Draft, WorkspaceView } from '../../../shared/types';
import { emitToast } from './toastBus';

export function composeOrConnectAccount(store: {
  startNewDraft: () => Draft | null | undefined;
  onboardAccount: (hint: string) => Promise<void> | void;
  setWorkspaceView: (view: WorkspaceView) => void;
  setSettingsOpen: (open: boolean) => void;
  setCleanupOpen: (open: boolean) => void;
}): void {
  const draft = store.startNewDraft();
  if (draft) return;
  store.setWorkspaceView('mail');
  store.setSettingsOpen(false);
  store.setCleanupOpen(false);
  emitToast({ type: 'info', message: 'Connect a Gmail account to compose.' });
  void store.onboardAccount('');
}
