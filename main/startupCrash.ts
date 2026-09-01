import { app, dialog } from 'electron';
import {
  fatalProcessFailureMessage,
  isLikelyCorruptDatabaseError,
  startupFailureMessage,
  type StartupFailurePhase,
} from '../shared/startupFailure';
import { moveAsideLiveDatabase } from './backupService';

let fatalDialogInFlight = false;

export async function handleStartupFailure(
  error: unknown,
  phase: StartupFailurePhase = 'startup',
): Promise<void> {
  const message = startupFailureMessage(error, phase);
  console.error('[Startup] Dumka Mail failed to start:', error);
  if (fatalDialogInFlight) return;
  fatalDialogInFlight = true;
  try {
    const { response } = await dialog.showMessageBox({
      type: 'error',
      buttons: ['Quit', 'Move damaged database aside and restart'],
      defaultId: 0,
      cancelId: 0,
      title: phase === 'runtime' ? 'Dumka Mail needs to restart' : 'Dumka Mail could not start',
      message: phase === 'runtime' ? 'Dumka Mail needs to restart' : 'Dumka Mail could not start',
      detail: message,
    });
    if (response === 1) {
      moveAsideLiveDatabase();
      app.relaunch();
      app.exit(0);
      return;
    }
  } catch (dialogError) {
    console.error('[Startup] Failed to show the startup error dialog:', dialogError);
  }
  app.exit(1);
}

export async function handleFatalProcessFailure(error: unknown): Promise<void> {
  console.error('[Process] Fatal error:', error);
  if (fatalDialogInFlight) return;
  fatalDialogInFlight = true;
  try {
    await dialog.showMessageBox({
      type: 'error',
      buttons: ['Quit'],
      defaultId: 0,
      cancelId: 0,
      title: 'Dumka Mail needs to quit',
      message: 'Dumka Mail needs to quit',
      detail: fatalProcessFailureMessage(error),
    });
  } catch (dialogError) {
    console.error('[Process] Failed to show the fatal error dialog:', dialogError);
  }
  app.exit(1);
}

export function installProcessFailureHandlers(
  log: (scope: string, message: string, error?: unknown) => void,
): void {
  process.on('uncaughtException', error => {
    log('Process', 'Uncaught exception.', error);
    if (isLikelyCorruptDatabaseError(error)) {
      void handleStartupFailure(error, 'runtime');
      return;
    }
    void handleFatalProcessFailure(error);
  });
  process.on('unhandledRejection', reason => {
    log('Process', 'Unhandled promise rejection.', reason);
  });
}
