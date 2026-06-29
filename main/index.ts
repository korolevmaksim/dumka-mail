import { app, BrowserWindow, ipcMain, dialog, Notification, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, getDatabase, AccountsRepo, ThreadsRepo, MessagesRepo, DraftsRepo, RemindersRepo, SyncStateRepo, ActionLogRepo, AIConversationsRepo, SearchRepo, SettingsRepo } from './database';
import { startOAuthFlow, GmailSyncService } from './gmail';
import { getRefreshToken } from './keychain';
import { getAIProviderDescriptor, completeAI, saveAIConfigAsync, listProviderModels, loadAIConfigForRenderer } from './ai';
import { MCPManager } from './mcpManager';
import { installApplicationMenu, updateApplicationMenuCommandState } from './menu';
import type { MailMessage, MailNotificationSettings, MailThread, SyncState } from '../shared/types';

let mainWindow: BrowserWindow | null = null;
let pendingOpenThread: { accountId: string; threadId: string } | null = null;
const activeNotifications = new Set<Notification>();
const DEFAULT_WINDOW_WIDTH = 1280;
const DEFAULT_WINDOW_HEIGHT = 832;
const MIN_WINDOW_WIDTH = 900;
const MIN_WINDOW_HEIGHT = 600;
const ALL_MAIL_NOTIFICATION_SCHEMA_VERSION = 4;
const DEFAULT_NOTIFICATION_SETTINGS: MailNotificationSettings = {
  desktopNotifications: true,
  sound: false,
  notifyImportantOnly: false,
  reminderNotifications: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '08:00'
};

interface RestoredWindowState {
  width: number;
  height: number;
  x?: number;
  y?: number;
  isMaximized?: boolean;
}

function assertTrustedSender(senderFrame: Electron.WebFrameMain | null) {
  if (!senderFrame) return;
  const url = senderFrame.url;
  const isDev = process.env.VITE_DEV_SERVER_URL && url.startsWith(process.env.VITE_DEV_SERVER_URL);
  const isProd = url.startsWith('file://');
  if (!isDev && !isProd) {
    throw new Error('Unauthorized IPC sender');
  }
}

function parseClockMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes)) return null;
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  return hours * 60 + minutes;
}

function isInQuietHours(settings: MailNotificationSettings, now = new Date()): boolean {
  if (!settings.quietHoursEnabled) return false;

  const start = parseClockMinutes(settings.quietHoursStart);
  const end = parseClockMinutes(settings.quietHoursEnd);
  if (start === null || end === null || start === end) return false;

  const current = now.getHours() * 60 + now.getMinutes();
  return start < end
    ? current >= start && current < end
    : current >= start || current < end;
}

function hasLabel(message: MailMessage, label: string): boolean {
  return message.labelIds.some(id => id.toUpperCase() === label);
}

function shouldNotifyOfNewMessage(message: MailMessage, settings: MailNotificationSettings): boolean {
  if (!settings.desktopNotifications || isInQuietHours(settings)) return false;
  if (!hasLabel(message, 'INBOX') || !hasLabel(message, 'UNREAD')) return false;

  if (settings.notifyImportantOnly) {
    return hasLabel(message, 'IMPORTANT') || hasLabel(message, 'CATEGORY_PRIMARY');
  }

  return true;
}

function readNotificationSettings(): MailNotificationSettings {
  try {
    const rawSettings = SettingsRepo.get('appSettings');
    if (!rawSettings) return DEFAULT_NOTIFICATION_SETTINGS;

    const parsed = JSON.parse(rawSettings);
    const notifications = parsed?.notifications || {};
    const schemaVersion = Number(parsed?.settingsSchemaVersion || 0);

    return {
      desktopNotifications: notifications.desktopNotifications !== false,
      sound: notifications.sound === true,
      notifyImportantOnly: schemaVersion >= ALL_MAIL_NOTIFICATION_SCHEMA_VERSION && notifications.notifyImportantOnly === true,
      reminderNotifications: notifications.reminderNotifications !== false,
      quietHoursEnabled: notifications.quietHoursEnabled === true,
      quietHoursStart: typeof notifications.quietHoursStart === 'string' ? notifications.quietHoursStart : DEFAULT_NOTIFICATION_SETTINGS.quietHoursStart,
      quietHoursEnd: typeof notifications.quietHoursEnd === 'string' ? notifications.quietHoursEnd : DEFAULT_NOTIFICATION_SETTINGS.quietHoursEnd
    };
  } catch (err) {
    console.error('Failed to read notification settings:', err);
    return DEFAULT_NOTIFICATION_SETTINGS;
  }
}

function getNotificationIconPath(): string | undefined {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function notifyOfNewMessages(messages: MailMessage[]) {
  if (messages.length === 0) return;

  const settings = readNotificationSettings();
  if (!settings.desktopNotifications) return;

  if (!Notification.isSupported()) {
    console.warn('Native desktop notifications are not supported in this Electron runtime.');
    return;
  }

  const icon = getNotificationIconPath();
  for (const message of messages) {
    if (!shouldNotifyOfNewMessage(message, settings)) continue;

    try {
      const sender = message.senderName || message.senderEmail || 'New mail';
      const notification = new Notification({
        title: sender,
        subtitle: message.subject || '(No Subject)',
        body: message.snippet || '',
        silent: !settings.sound,
        icon,
        id: `new-mail:${message.accountId}:${message.id}`,
        groupId: message.accountId
      });

      activeNotifications.add(notification);

      notification.on('click', () => {
        activeNotifications.delete(notification);
        if (mainWindow) {
          if (mainWindow.isMinimized()) mainWindow.restore();
          mainWindow.focus();
          mainWindow.webContents.send('api:openThread', {
            accountId: message.accountId,
            threadId: message.threadId
          });
        } else {
          pendingOpenThread = {
            accountId: message.accountId,
            threadId: message.threadId
          };
          createWindow();
        }
      });

      notification.on('close', () => {
        activeNotifications.delete(notification);
      });

      notification.on('failed', (_, error) => {
        activeNotifications.delete(notification);
        console.error('Notification failed to show:', error);
      });

      notification.show();
    } catch (err) {
      console.error('Failed to show push notification:', err);
    }
  }
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function intersectsAnyDisplay(bounds: { x: number; y: number; width: number; height: number }): boolean {
  return screen.getAllDisplays().some(display => {
    const area = display.workArea;
    return (
      bounds.x < area.x + area.width &&
      bounds.x + bounds.width > area.x &&
      bounds.y < area.y + area.height &&
      bounds.y + bounds.height > area.y
    );
  });
}

function restoreWindowState(): RestoredWindowState {
  const primaryWorkArea = screen.getPrimaryDisplay().workArea;
  const maxWidth = Math.max(MIN_WINDOW_WIDTH, primaryWorkArea.width);
  const maxHeight = Math.max(MIN_WINDOW_HEIGHT, primaryWorkArea.height);
  const restored: RestoredWindowState = {
    width: Math.min(DEFAULT_WINDOW_WIDTH, maxWidth),
    height: Math.min(DEFAULT_WINDOW_HEIGHT, maxHeight)
  };

  try {
    const saved = SettingsRepo.get('windowState');
    if (!saved) return restored;

    const parsed = JSON.parse(saved);
    const width = isFiniteNumber(parsed.width)
      ? clampNumber(parsed.width, MIN_WINDOW_WIDTH, maxWidth)
      : restored.width;
    const height = isFiniteNumber(parsed.height)
      ? clampNumber(parsed.height, MIN_WINDOW_HEIGHT, maxHeight)
      : restored.height;

    restored.width = width;
    restored.height = height;
    restored.isMaximized = parsed.isMaximized === true;

    if (isFiniteNumber(parsed.x) && isFiniteNumber(parsed.y)) {
      const candidate = { x: parsed.x, y: parsed.y, width, height };
      if (intersectsAnyDisplay(candidate)) {
        restored.x = parsed.x;
        restored.y = parsed.y;
      }
    }
  } catch {}

  return restored;
}

function createWindow() {
  const iconPath = path.join(__dirname, '../../assets/icon.png');

  // Read the persisted appearance preference to decide on native macOS vibrancy.
  // (The CSS .panel-surface path toggles instantly; native vibrancy needs a relaunch.)
  let translucent = false;
  try {
    const raw = SettingsRepo.get('appSettings');
    if (raw) translucent = !!JSON.parse(raw)?.appearance?.useTranslucentPanels;
  } catch { /* fall back to opaque */ }

  const vibrancyOptions =
    process.platform === 'darwin' && translucent
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const }
      : {};

  const restoredWindowState = restoreWindowState();

  mainWindow = new BrowserWindow({
    width: restoredWindowState.width,
    height: restoredWindowState.height,
    x: restoredWindowState.x,
    y: restoredWindowState.y,
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    title: 'Dumka Mail',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    ...vibrancyOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true
    }
  });

  if (restoredWindowState.isMaximized) {
    mainWindow.maximize();
  }

  let saveBoundsTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized() || mainWindow.isFullScreen()) return;
    try {
      const b = mainWindow.isMaximized() ? mainWindow.getNormalBounds() : mainWindow.getBounds();
      SettingsRepo.set('windowState', JSON.stringify({
        width: b.width,
        height: b.height,
        x: b.x,
        y: b.y,
        isMaximized: mainWindow.isMaximized()
      }));
    } catch (err) {
      console.error('Failed to save window state:', err);
    }
  };

  const queueSaveBounds = () => {
    if (saveBoundsTimer) clearTimeout(saveBoundsTimer);
    saveBoundsTimer = setTimeout(() => {
      saveBoundsTimer = null;
      saveBounds();
    }, 500);
  };

  mainWindow.on('resize', queueSaveBounds);
  mainWindow.on('move', queueSaveBounds);
  mainWindow.on('close', () => {
    if (saveBoundsTimer) {
      clearTimeout(saveBoundsTimer);
      saveBoundsTimer = null;
    }
    saveBounds();
  });

  mainWindow.webContents.on('found-in-page', (_, result) => {
    if (mainWindow) {
      mainWindow.webContents.send('api:foundInPageResult', result);
    }
  });

  if (process.platform === 'darwin' && fs.existsSync(iconPath)) {
    try {
      app.dock?.setIcon(iconPath);
    } catch (err) {
      console.error('Failed to set dock icon:', err);
    }
  }

  // Load Vite Dev Server in development, local index.html in production
  if (process.env.VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../dist/index.html'));
  }

  // Open external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  // Initialize SQLite database and run migrations
  initializeDatabase();

  createWindow();

  // Install the native application menu
  installApplicationMenu(() => mainWindow);
  
  // Start background sync worker loop
  startBackgroundSyncWorker();
  startBackgroundMailboxSyncWorker();

  // Initialize MCPManager with stored settings
  try {
    const raw = SettingsRepo.get('appSettings');
    if (raw) {
      MCPManager.initialize(JSON.parse(raw));
    }
  } catch (err) {
    console.error('Failed to initialize MCPManager on startup:', err);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  MCPManager.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

function saveMessagesToDatabase(messages: MailMessage[], options?: { notifyOfNew?: boolean }) {
  const newMessages: MailMessage[] = [];
  if (options?.notifyOfNew) {
    try {
      const db = getDatabase();
      const checkExist = db.prepare('SELECT 1 FROM messages WHERE account_id = ? AND id = ?');
      for (const message of messages) {
        const exists = checkExist.get(message.accountId, message.id);
        if (!exists) {
          newMessages.push(message);
        }
      }
    } catch (err) {
      console.error('Failed to check existing messages:', err);
    }
  }

  MessagesRepo.save(messages);

  if (options?.notifyOfNew && newMessages.length > 0) {
    notifyOfNewMessages(newMessages);
  }
}

function buildThreadFromMessages(accountId: string, threadId: string, messages: MailMessage[]): MailThread | null {
  if (messages.length === 0) return null;

  const lastMessage = messages[messages.length - 1];
  return {
    id: threadId,
    accountId,
    subject: lastMessage.subject || '',
    snippet: lastMessage.snippet || '',
    lastMessageAt: lastMessage.receivedAt,
    senderNames: Array.from(new Set(messages.map(message => message.senderName || message.senderEmail))),
    senderEmail: lastMessage.senderEmail,
    labelIds: Array.from(new Set(messages.flatMap(message => message.labelIds))),
    hasAttachments: messages.some(message => message.hasAttachments),
    isUnread: messages.some(message => message.isUnread)
  };
}

// === Bind IPC Database Channels ===
function registerSecureHandler(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event.senderFrame);
    return listener(event, ...args);
  });
}

registerSecureHandler('db:listAccounts', () => AccountsRepo.list());
registerSecureHandler('db:getAccount', (_, id) => AccountsRepo.get(id));
registerSecureHandler('db:saveAccount', (_, account) => AccountsRepo.save(account));
registerSecureHandler('db:deleteAccount', (_, id) => AccountsRepo.delete(id));

registerSecureHandler('db:listThreads', (_, accountId) => ThreadsRepo.list(accountId));
registerSecureHandler('db:saveThreads', (_, threads) => ThreadsRepo.save(threads));
registerSecureHandler('db:deleteThread', (_, accountId, threadId) => ThreadsRepo.delete(accountId, threadId));

registerSecureHandler('db:listMessagesForThread', (_, accountId, threadId) => MessagesRepo.listForThread(accountId, threadId));
registerSecureHandler('db:saveMessages', async (_, messages: MailMessage[], options?: { notifyOfNew?: boolean }) => {
  saveMessagesToDatabase(messages, options);
});

registerSecureHandler('api:getPendingOpenThread', () => {
  const pending = pendingOpenThread;
  pendingOpenThread = null;
  return pending;
});

registerSecureHandler('db:listDrafts', (_, accountId) => DraftsRepo.list(accountId));
registerSecureHandler('db:getDraft', (_, id) => DraftsRepo.get(id));
registerSecureHandler('db:saveDraft', (_, draft) => DraftsRepo.save(draft));
registerSecureHandler('db:deleteDraft', (_, id) => DraftsRepo.delete(id));

registerSecureHandler('db:getReminder', (_, accountId, threadId) => RemindersRepo.get(accountId, threadId));
registerSecureHandler('db:saveReminder', (_, accountId, threadId, reminderAt) => RemindersRepo.save(accountId, threadId, reminderAt));
registerSecureHandler('db:deleteReminder', (_, accountId, threadId) => RemindersRepo.delete(accountId, threadId));

registerSecureHandler('db:getSyncState', (_, accountId) => SyncStateRepo.get(accountId));
registerSecureHandler('db:saveSyncState', (_, state) => SyncStateRepo.save(state));

registerSecureHandler('db:listActionLog', (_, accountId) => ActionLogRepo.list(accountId));
registerSecureHandler('db:saveActionLog', (_, log) => ActionLogRepo.save(log));

registerSecureHandler('db:listConversations', (_, accountId) => AIConversationsRepo.list(accountId));
registerSecureHandler('db:getConversationMessages', (_, id) => AIConversationsRepo.getMessages(id));
registerSecureHandler('db:saveConversation', (_, conv, messages) => AIConversationsRepo.saveConversation(conv, messages));
registerSecureHandler('db:deleteConversation', (_, id) => AIConversationsRepo.deleteConversation(id));

registerSecureHandler('db:searchFTS', (_, accountId, query) => SearchRepo.search(accountId, query));

registerSecureHandler('db:getSetting', (_, key) => SettingsRepo.get(key));
registerSecureHandler('db:setSetting', (_, key, value) => {
  const result = SettingsRepo.set(key, value);
  if (key === 'appSettings') {
    try {
      MCPManager.initialize(JSON.parse(value));
    } catch (err) {
      console.error('Failed to reload MCPManager after settings update:', err);
    }
  }
  return result;
});

registerSecureHandler('api:verifyMCPServer', (_, config) => MCPManager.verifyServer(config));

// === Bind IPC API / Service Channels ===
registerSecureHandler('api:onboardAccount', (_, emailHint) => startOAuthFlow(emailHint));

registerSecureHandler('api:verifyTokenExists', async (_, email) => {
  const token = await getRefreshToken(email);
  return token !== null;
});

registerSecureHandler('api:syncInbox', (_, email) => GmailSyncService.syncInbox(email));
registerSecureHandler('api:syncIncremental', (_, email, startHistoryId) => GmailSyncService.syncIncremental(email, startHistoryId));
registerSecureHandler('api:syncBackfillPage', (_, email, pageToken) => GmailSyncService.syncBackfillPage(email, pageToken));
registerSecureHandler('api:fetchThreadDetail', (_, email, threadId) => GmailSyncService.fetchThreadDetail(email, threadId));
registerSecureHandler('api:fetchRawMessage', (_, email, messageId) => GmailSyncService.fetchRawMessage(email, messageId));
registerSecureHandler('api:downloadAttachment', async (_, email, messageId, attachmentId, filename) => {
  if (!mainWindow) return;
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    defaultPath: filename,
    title: 'Save Attachment'
  });

  if (!filePath) return;

  const base64Data = await GmailSyncService.fetchAttachment(email, messageId, attachmentId);
  const buffer = Buffer.from(base64Data, 'base64url');
  fs.writeFileSync(filePath, buffer);
});

registerSecureHandler('api:uploadAttachment', async () => {
  if (!mainWindow) return null;
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Select File to Attach'
  });

  if (!filePaths || filePaths.length === 0) return null;
  const filePath = filePaths[0];
  const filename = path.basename(filePath);
  const sizeBytes = fs.statSync(filePath).size;
  const mimeType = getMimeType(filePath);
  const base64Data = fs.readFileSync(filePath).toString('base64');

  return {
    id: crypto.randomUUID(),
    filename,
    mimeType,
    sizeBytes,
    base64Data
  };
});
registerSecureHandler('api:modifyLabels', async (_, email, threadId, addLabelIds, removeLabelIds, actionId?: string) => {
  // 1. Optimistically write to local SQLite database first for instant persistence
  ThreadsRepo.updateLabels(email, threadId, addLabelIds, removeLabelIds);
  
  try {
    // 2. Perform the actual remote Gmail API sync
    await GmailSyncService.modifyLabels(email, threadId, addLabelIds, removeLabelIds);
    return { offline: false };
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.warn('Network error in modifyLabels, queueing offline action:', err.message);
      if (actionId) {
        const log = ActionLogRepo.list(email).find(l => l.id === actionId);
        if (log) {
          log.status = 'pending_sync';
          ActionLogRepo.save(log);
        } else {
          ActionLogRepo.save({
            id: actionId,
            accountId: email,
            threadId,
            kind: addLabelIds.includes('INBOX') ? 'restoreInbox' : (removeLabelIds.includes('INBOX') ? 'markDone' : (addLabelIds.includes('UNREAD') ? 'markUnread' : 'markRead')),
            status: 'pending_sync',
            createdAt: new Date().toISOString()
          });
        }
      }
      return { offline: true };
    }
    // 3. Roll back local database state on remote network/API failure
    ThreadsRepo.updateLabels(email, threadId, removeLabelIds, addLabelIds);
    throw err;
  }
});
registerSecureHandler('api:sendDraft', async (_, email, draft, actionId?: string) => {
  try {
    const threadId = await GmailSyncService.sendDraft(email, draft);
    return { offline: false, threadId };
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.warn('Network error in sendDraft, queueing offline send:', err.message);
      if (actionId) {
        const log = ActionLogRepo.list(email).find(l => l.id === actionId);
        if (log) {
          log.status = 'pending_sync';
          ActionLogRepo.save(log);
        } else {
          ActionLogRepo.save({
            id: actionId,
            accountId: email,
            draftId: draft.id,
            threadId: draft.threadId,
            kind: 'send',
            status: 'pending_sync',
            createdAt: new Date().toISOString()
          });
        }
      }
      return { offline: true };
    }
    throw err;
  }
});

registerSecureHandler('api:getAIProviderDescriptor', (_, preference, overrideModel) => getAIProviderDescriptor(preference, overrideModel));
registerSecureHandler('api:completeAI', (_, request, preference, overrideModel) => completeAI(request, preference, overrideModel));
registerSecureHandler('api:loadAIConfig', () => loadAIConfigForRenderer());
registerSecureHandler('api:saveAIConfig', (_, config) => saveAIConfigAsync(config));
registerSecureHandler('api:listProviderModels', (_, provider, apiKey, baseUrl) => listProviderModels(provider, apiKey, baseUrl));
registerSecureHandler('api:setMenuCommandState', (_, state) => updateApplicationMenuCommandState(state));
registerSecureHandler('api:findInPage', (event, text, options) => {
  event.sender.findInPage(text, options);
});
registerSecureHandler('api:stopFindInPage', (event, action) => {
  event.sender.stopFindInPage(action);
});

// === Helper Functions and Background Sync Worker ===

function isNetworkError(err: any): boolean {
  if (!err) return false;
  const msg = String(err.message || err).toLowerCase();
  const code = String(err.code || '').toUpperCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('timeout') ||
    msg.includes('request failed') ||
    msg.includes('failed to fetch') ||
    msg.includes('dns') ||
    code === 'ENOTFOUND' ||
    code === 'EAI_AGAIN' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNRESET' ||
    code === 'ETIMEDOUT' ||
    code === 'EHOSTUNREACH' ||
    code === 'ENETUNREACH'
  );
}

let syncWorkerActive = false;
let mailboxSyncWorkerActive = false;

function startBackgroundSyncWorker() {
  setInterval(async () => {
    if (syncWorkerActive) return;
    syncWorkerActive = true;

    try {
      const pendingActions = ActionLogRepo.listPending();
      if (pendingActions.length === 0) {
        syncWorkerActive = false;
        return;
      }

      console.log(`[Sync Worker] Found ${pendingActions.length} pending actions to sync`);

      for (const action of pendingActions) {
        action.status = 'running';
        ActionLogRepo.save(action);

        try {
          if (action.kind === 'markDone') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [], ['INBOX']);
          } else if (action.kind === 'restoreInbox') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['INBOX'], []);
          } else if (action.kind === 'markRead') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [], ['UNREAD']);
          } else if (action.kind === 'markUnread') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['UNREAD'], []);
          } else if (action.kind === 'send') {
            if (action.draftId) {
              const draft = DraftsRepo.get(action.draftId);
              if (draft) {
                await GmailSyncService.sendDraft(action.accountId, draft);
                DraftsRepo.delete(action.draftId);
              }
            }
          }

          action.status = 'completed';
          action.completedAt = new Date().toISOString();
          ActionLogRepo.save(action);
          console.log(`[Sync Worker] Successfully synced action ${action.id} of kind ${action.kind}`);
        } catch (err: any) {
          if (isNetworkError(err)) {
            console.log(`[Sync Worker] Network still offline, will retry action ${action.id} later:`, err.message);
            action.status = 'pending_sync';
            ActionLogRepo.save(action);
            break;
          } else {
            console.error(`[Sync Worker] Action ${action.id} failed permanently:`, err);
            action.status = 'failed';
            action.completedAt = new Date().toISOString();
            action.failureMessage = err.message;
            ActionLogRepo.save(action);

            // Roll back local DB changes for labels on permanent failure
            if (action.threadId) {
              if (action.kind === 'markDone') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['INBOX'], []);
              } else if (action.kind === 'restoreInbox') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, [], ['INBOX']);
              } else if (action.kind === 'markRead') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['UNREAD'], []);
              } else if (action.kind === 'markUnread') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, [], ['UNREAD']);
              }
            }
          }
        }
      }
    } catch (e) {
      console.error('[Sync Worker] Error in background sync loop:', e);
    } finally {
      syncWorkerActive = false;
    }
  }, 15000);
}

function nextSyncState(accountId: string, base: SyncState | null, historyId: string, lastFullSyncAt?: string | null): SyncState {
  return {
    accountId,
    historyId,
    lastFullSyncAt: lastFullSyncAt ?? base?.lastFullSyncAt ?? null,
    historyBackfillPageToken: base?.historyBackfillPageToken || null,
    lastHistoryBackfillAt: base?.lastHistoryBackfillAt || null,
    historyBackfillCompletedAt: base?.historyBackfillCompletedAt || null,
    historyBackfillPagesSynced: base?.historyBackfillPagesSynced || 0,
    historyBackfillThreadsSynced: base?.historyBackfillThreadsSynced || 0
  };
}

async function runMailboxSyncForAccount(email: string) {
  const syncState = SyncStateRepo.get(email);

  if (!syncState?.historyId) {
    const fullSync = await GmailSyncService.syncInbox(email);
    ThreadsRepo.save(fullSync.threads);
    saveMessagesToDatabase(fullSync.messages);
    SyncStateRepo.save(nextSyncState(email, syncState, fullSync.historyId, new Date().toISOString()));
    return;
  }

  try {
    const incrementalSync = await GmailSyncService.syncIncremental(email, syncState.historyId);

    for (const threadId of incrementalSync.updatedThreadIds) {
      try {
        const messages = await GmailSyncService.fetchThreadDetail(email, threadId);
        saveMessagesToDatabase(messages, { notifyOfNew: true });

        const thread = buildThreadFromMessages(email, threadId, messages);
        if (thread) {
          ThreadsRepo.save([thread]);
        }
      } catch (err: any) {
        console.warn(`[Mailbox Sync] Failed to fetch thread detail for ${threadId}:`, err);
        if (err.message?.includes('not found') || err.message?.includes('404')) {
          ThreadsRepo.delete(email, threadId);
        }
      }
    }

    for (const threadId of incrementalSync.deletedThreadIds) {
      ThreadsRepo.delete(email, threadId);
    }

    SyncStateRepo.save(nextSyncState(email, syncState, incrementalSync.historyId));
  } catch (err: any) {
    if (err.message === 'HISTORY_EXPIRED') {
      const fullSync = await GmailSyncService.syncInbox(email);
      ThreadsRepo.save(fullSync.threads);
      saveMessagesToDatabase(fullSync.messages);
      SyncStateRepo.save(nextSyncState(email, syncState, fullSync.historyId, new Date().toISOString()));
      return;
    }
    throw err;
  }
}

function startBackgroundMailboxSyncWorker() {
  const run = async () => {
    if (mailboxSyncWorkerActive) return;
    mailboxSyncWorkerActive = true;

    try {
      const accounts = AccountsRepo.list();
      for (const account of accounts) {
        await runMailboxSyncForAccount(account.email);
      }
    } catch (err) {
      console.error('[Mailbox Sync] Background mailbox sync failed:', err);
    } finally {
      mailboxSyncWorkerActive = false;
    }
  };

  setTimeout(() => {
    void run();
  }, 10000);

  setInterval(() => {
    void run();
  }, 60000);
}

function getMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mimes: Record<string, string> = {
    '.pdf': 'application/pdf',
    '.txt': 'text/plain',
    '.html': 'text/html',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.gif': 'image/gif',
    '.zip': 'application/zip',
    '.json': 'application/json',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.xls': 'application/vnd.ms-excel',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4'
  };
  return mimes[ext] || 'application/octet-stream';
}
