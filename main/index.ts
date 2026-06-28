import { app, BrowserWindow, ipcMain, dialog, Notification } from 'electron';
import path from 'path';
import fs from 'fs';
import { initializeDatabase, getDatabase, AccountsRepo, ThreadsRepo, MessagesRepo, DraftsRepo, RemindersRepo, SyncStateRepo, ActionLogRepo, AIConversationsRepo, SearchRepo, SettingsRepo } from './database';
import { startOAuthFlow, GmailSyncService } from './gmail';
import { getRefreshToken } from './keychain';
import { getAIProviderDescriptor, completeAI, saveAIConfig, listProviderModels, loadAIConfig } from './ai';
import { MCPManager } from './mcpManager';

let mainWindow: BrowserWindow | null = null;
let pendingOpenThread: { accountId: string; threadId: string } | null = null;
const activeNotifications = new Set<Notification>();

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

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 832,
    minWidth: 900,
    minHeight: 600,
    title: 'Dumka Mail',
    icon: fs.existsSync(iconPath) ? iconPath : undefined,
    titleBarStyle: 'hiddenInset', // Gives native macOS traffic lights inside chrome
    ...vibrancyOptions,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false
    }
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
  
  // Start background sync worker loop
  startBackgroundSyncWorker();

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

// === Bind IPC Database Channels ===
ipcMain.handle('db:listAccounts', () => AccountsRepo.list());
ipcMain.handle('db:getAccount', (_, id) => AccountsRepo.get(id));
ipcMain.handle('db:saveAccount', (_, account) => AccountsRepo.save(account));
ipcMain.handle('db:deleteAccount', (_, id) => AccountsRepo.delete(id));

ipcMain.handle('db:listThreads', (_, accountId) => ThreadsRepo.list(accountId));
ipcMain.handle('db:saveThreads', (_, threads) => ThreadsRepo.save(threads));
ipcMain.handle('db:deleteThread', (_, accountId, threadId) => ThreadsRepo.delete(accountId, threadId));

ipcMain.handle('db:listMessagesForThread', (_, accountId, threadId) => MessagesRepo.listForThread(accountId, threadId));
ipcMain.handle('db:saveMessages', async (_, messages, options?: { notifyOfNew?: boolean }) => {
  let newMessages: any[] = [];
  if (options?.notifyOfNew) {
    try {
      const db = getDatabase();
      const checkExist = db.prepare('SELECT 1 FROM messages WHERE account_id = ? AND id = ?');
      for (const m of messages) {
        const exists = checkExist.get(m.accountId, m.id);
        if (!exists) {
          newMessages.push(m);
        }
      }
    } catch (err) {
      console.error('Failed to check existing messages:', err);
    }
  }

  MessagesRepo.save(messages);

  if (options?.notifyOfNew && newMessages.length > 0) {
    let showNotifications = true;
    let notifyImportantOnly = true;
    try {
      const rawSettings = SettingsRepo.get('appSettings');
      if (rawSettings) {
        const parsed = JSON.parse(rawSettings);
        if (parsed.notifications) {
          showNotifications = parsed.notifications.desktopNotifications !== false;
          notifyImportantOnly = parsed.notifications.notifyImportantOnly !== false;
        }
      }
    } catch (err) {
      console.error('Failed to read notification settings:', err);
    }

    if (showNotifications) {
      for (const m of newMessages) {
        const isInbox = m.labelIds.includes('INBOX') || m.labelIds.includes('inbox');
        const isUnread = m.labelIds.includes('UNREAD') || m.labelIds.includes('unread');
        
        if (isInbox && isUnread) {
          if (notifyImportantOnly) {
            const isImportant = m.labelIds.includes('IMPORTANT') || m.labelIds.includes('important') || m.labelIds.includes('CATEGORY_PRIMARY');
            if (!isImportant) {
              continue;
            }
          }

          try {
            const sender = m.senderName || m.senderEmail;
            const notification = new Notification({
              title: sender,
              subtitle: m.subject || '(No Subject)',
              body: m.snippet || '',
            });

            activeNotifications.add(notification);

            notification.on('click', () => {
              activeNotifications.delete(notification);
              if (mainWindow) {
                if (mainWindow.isMinimized()) mainWindow.restore();
                mainWindow.focus();
                mainWindow.webContents.send('api:openThread', {
                  accountId: m.accountId,
                  threadId: m.threadId
                });
              } else {
                pendingOpenThread = {
                  accountId: m.accountId,
                  threadId: m.threadId
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
    }
  }
});

ipcMain.handle('api:getPendingOpenThread', () => {
  const pending = pendingOpenThread;
  pendingOpenThread = null;
  return pending;
});

ipcMain.handle('db:listDrafts', (_, accountId) => DraftsRepo.list(accountId));
ipcMain.handle('db:getDraft', (_, id) => DraftsRepo.get(id));
ipcMain.handle('db:saveDraft', (_, draft) => DraftsRepo.save(draft));
ipcMain.handle('db:deleteDraft', (_, id) => DraftsRepo.delete(id));

ipcMain.handle('db:getReminder', (_, accountId, threadId) => RemindersRepo.get(accountId, threadId));
ipcMain.handle('db:saveReminder', (_, accountId, threadId, reminderAt) => RemindersRepo.save(accountId, threadId, reminderAt));
ipcMain.handle('db:deleteReminder', (_, accountId, threadId) => RemindersRepo.delete(accountId, threadId));

ipcMain.handle('db:getSyncState', (_, accountId) => SyncStateRepo.get(accountId));
ipcMain.handle('db:saveSyncState', (_, state) => SyncStateRepo.save(state));

ipcMain.handle('db:listActionLog', (_, accountId) => ActionLogRepo.list(accountId));
ipcMain.handle('db:saveActionLog', (_, log) => ActionLogRepo.save(log));

ipcMain.handle('db:listConversations', (_, accountId) => AIConversationsRepo.list(accountId));
ipcMain.handle('db:getConversationMessages', (_, id) => AIConversationsRepo.getMessages(id));
ipcMain.handle('db:saveConversation', (_, conv, messages) => AIConversationsRepo.saveConversation(conv, messages));
ipcMain.handle('db:deleteConversation', (_, id) => AIConversationsRepo.deleteConversation(id));

ipcMain.handle('db:searchFTS', (_, accountId, query) => SearchRepo.search(accountId, query));

ipcMain.handle('db:getSetting', (_, key) => SettingsRepo.get(key));
ipcMain.handle('db:setSetting', (_, key, value) => {
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

ipcMain.handle('api:verifyMCPServer', (_, config) => MCPManager.verifyServer(config));

// === Bind IPC API / Service Channels ===
ipcMain.handle('api:onboardAccount', (_, emailHint) => startOAuthFlow(emailHint));

ipcMain.handle('api:verifyTokenExists', async (_, email) => {
  const token = await getRefreshToken(email);
  return token !== null;
});

ipcMain.handle('api:syncInbox', (_, email) => GmailSyncService.syncInbox(email));
ipcMain.handle('api:syncIncremental', (_, email, startHistoryId) => GmailSyncService.syncIncremental(email, startHistoryId));
ipcMain.handle('api:syncBackfillPage', (_, email, pageToken) => GmailSyncService.syncBackfillPage(email, pageToken));
ipcMain.handle('api:fetchThreadDetail', (_, email, threadId) => GmailSyncService.fetchThreadDetail(email, threadId));
ipcMain.handle('api:fetchRawMessage', (_, email, messageId) => GmailSyncService.fetchRawMessage(email, messageId));
ipcMain.handle('api:downloadAttachment', async (_, email, messageId, attachmentId, filename) => {
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

ipcMain.handle('api:uploadAttachment', async () => {
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
ipcMain.handle('api:modifyLabels', async (_, email, threadId, addLabelIds, removeLabelIds, actionId?: string) => {
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
ipcMain.handle('api:sendDraft', async (_, email, draft, actionId?: string) => {
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

ipcMain.handle('api:getAIProviderDescriptor', (_, preference, overrideModel) => getAIProviderDescriptor(preference, overrideModel));
ipcMain.handle('api:completeAI', (_, request, preference, overrideModel) => completeAI(request, preference, overrideModel));
ipcMain.handle('api:loadAIConfig', () => loadAIConfig());
ipcMain.handle('api:saveAIConfig', (_, config) => saveAIConfig(config));
ipcMain.handle('api:listProviderModels', (_, provider, apiKey, baseUrl) => listProviderModels(provider, apiKey, baseUrl));
ipcMain.handle('api:findInPage', (event, text, options) => {
  event.sender.findInPage(text, options);
});
ipcMain.handle('api:stopFindInPage', (event, action) => {
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
