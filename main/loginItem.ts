// "Open at login" belongs to the operating system: the app only asks for it
// and reports what the system says. Nothing is stored in app settings, so the
// switch in Settings can never disagree with System Settings → Login Items.
//
// Only an installed build registers itself. In development the process is
// the bare Electron binary, and registering that would add "Electron" to the
// person's login items.
import { app } from 'electron';
import type { LoginItemState } from '../shared/loginItem';
import { describeLoginItem } from '../shared/loginItem';

function supported(): boolean {
  return app.isPackaged && (process.platform === 'darwin' || process.platform === 'win32');
}

export function readLoginItemState(): LoginItemState {
  if (!supported()) return describeLoginItem({ supported: false });
  try {
    const settings = app.getLoginItemSettings();
    return describeLoginItem({
      supported: true,
      openAtLogin: settings.openAtLogin,
      status: (settings as { status?: string }).status,
    });
  } catch (error) {
    return describeLoginItem({ supported: true, error: error instanceof Error ? error.message : String(error) });
  }
}

export function setLaunchAtLogin(enabled: boolean): LoginItemState {
  if (!supported()) return describeLoginItem({ supported: false });
  try {
    app.setLoginItemSettings({ openAtLogin: enabled });
  } catch (error) {
    return describeLoginItem({ supported: true, error: error instanceof Error ? error.message : String(error) });
  }
  return readLoginItemState();
}
