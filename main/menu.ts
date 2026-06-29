import { Menu, BrowserWindow, shell } from 'electron';

export interface ApplicationMenuCommandState {
  canCreateDraft: boolean;
  canUndo: boolean;
}

let currentGetMainWindow: (() => BrowserWindow | null) | null = null;
let commandState: ApplicationMenuCommandState = {
  canCreateDraft: false,
  canUndo: false
};

function sendCommand(getMainWindow: () => BrowserWindow | null, commandId: string) {
  const win = getMainWindow();
  if (win) win.webContents.send('menu:executeCommand', commandId);
}

export function installApplicationMenu(getMainWindow: () => BrowserWindow | null) {
  currentGetMainWindow = getMainWindow;
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{ role: 'appMenu' as const }]
      : []),
    {
      label: 'File',
      submenu: [
        {
          label: 'New Draft',
          accelerator: 'CommandOrControl+N',
          enabled: commandState.canCreateDraft,
          click: () => sendCommand(getMainWindow, 'file.newDraft')
        },
        { type: 'separator' },
        { role: 'close' }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo Last Mail Action',
          accelerator: 'CommandOrControl+Z',
          enabled: commandState.canUndo,
          click: () => sendCommand(getMainWindow, 'edit.undo')
        },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Toggle AI Copilot',
          accelerator: 'CommandOrControl+J',
          click: () => sendCommand(getMainWindow, 'view.toggleAiCopilot')
        },
        {
          label: 'Toggle Settings',
          accelerator: 'CommandOrControl+,',
          click: () => sendCommand(getMainWindow, 'view.settings')
        },
        {
          label: 'Toggle Theme',
          accelerator: 'CommandOrControl+Shift+T',
          click: () => sendCommand(getMainWindow, 'view.toggleTheme')
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    {
      role: 'windowMenu'
    },
    {
      role: 'help',
      submenu: [
        {
          label: 'Documentation',
          click: async () => {
            await shell.openExternal('https://github.com/dumka-mail-agy');
          }
        }
      ]
    }
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

export function updateApplicationMenuCommandState(nextState: Partial<ApplicationMenuCommandState>) {
  commandState = {
    ...commandState,
    ...nextState
  };

  if (currentGetMainWindow) {
    installApplicationMenu(currentGetMainWindow);
  }
}
