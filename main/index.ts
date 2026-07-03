import { app, BrowserWindow, ipcMain, dialog, Notification, screen, type NotificationAction } from 'electron';
import path from 'path';
import fs from 'fs';
import {
  initializeDatabase,
  AccountIntegrationsRepo,
  AccountsRepo,
  CalendarEventsRepo,
  ContactGroupsRepo,
  ContactsRepo,
  DraftsRepo,
  EmailSuggestionsRepo,
  LabelsRepo,
  MessagesRepo,
  RemindersRepo,
  SearchRepo,
  SettingsRepo,
  SyncStateRepo,
  ActionLogRepo,
  AIConversationsRepo,
  ThreadsRepo,
} from './database';
import { startOAuthFlow, GmailSyncService } from './gmail';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_CONTACTS_SCOPES, GOOGLE_OAUTH_SCOPES } from './gmailOAuth';
import { GoogleWorkspaceService } from './googleWorkspace';
import { deleteRefreshToken, getRefreshToken, saveRefreshToken } from './keychain';
import { getAIProviderDescriptor, completeAI, saveAIConfigAsync, listProviderModels, loadAIConfigForRenderer } from './ai';
import { AgenticService } from './agentic';
import { MCPManager } from './mcpManager';
import { prepareAppSettingsForStorage, resolveAppSettingsSecrets, resolveMCPServerConfigSecrets } from './mcpSettings';
import { parseStoredAppSettings, settingsAffectMCPRuntime, settingsAffectSearchBodyIndexing } from './settingsSideEffects';
import { installApplicationMenu, updateApplicationMenuCommandState } from './menu';
import { buildOnboardedAccount, normalizeOAuthEmail } from './accountOnboarding';
import { databaseWorkerClient } from './databaseWorkerClient';
import { checkForAppUpdates, getAutoUpdateStatus, initializeAutoUpdates, installDownloadedAppUpdate } from './autoUpdate';
import { shouldNotifyForMessage } from '../shared/mailSecurity';
import { buildAutoReplyDraft, shouldAutoReplyToMessage } from '../shared/autoReply';
import { evaluateMailRules, normalizeMailRulesSettings, type MailRuleEffect } from '../shared/mailRules';
import { escapeHtml } from '../shared/draftHtml';
import { nextMorningIso, notificationActionAt, notificationActionsFor, type MailNotificationKind } from '../shared/notificationActions';
import type { ActionKind, CalendarAttendeeResponse, CalendarInvite, MailMessage, MailNotificationSettings, MailRuleAction, MailRulesSettings, MailThread, SyncState } from '../shared/types';

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
const DEFAULT_MAIL_RULES_SETTINGS: MailRulesSettings = {
  enabled: false,
  rules: []
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

function shouldNotifyOfNewMessage(message: MailMessage, settings: MailNotificationSettings): boolean {
  if (!settings.desktopNotifications || isInQuietHours(settings)) return false;
  return shouldNotifyForMessage(message, settings);
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

function readIncludeBodiesInSearchIndex(): boolean {
  try {
    const rawSettings = SettingsRepo.get('appSettings');
    if (!rawSettings) return true;
    const parsed = JSON.parse(rawSettings);
    return parsed?.privacy?.includeBodiesInSearchIndex !== false;
  } catch (err) {
    console.error('Failed to read search indexing privacy setting:', err);
    return true;
  }
}

function readMailRulesSettings(): MailRulesSettings {
  try {
    const rawSettings = SettingsRepo.get('appSettings');
    if (!rawSettings) return DEFAULT_MAIL_RULES_SETTINGS;
    const parsed = JSON.parse(rawSettings);
    return normalizeMailRulesSettings(parsed?.mailRules);
  } catch (err) {
    console.error('Failed to read mail rule settings:', err);
    return DEFAULT_MAIL_RULES_SETTINGS;
  }
}

function buildForwardDraftFromThread(email: string, thread: MailThread, forwardTo: string) {
  const messages = MessagesRepo.listForThread(email, thread.id);
  const lastMessage = messages[messages.length - 1] || null;
  const from = lastMessage?.senderEmail || thread.senderEmail;
  const subject = thread.subject || '(no subject)';
  const body = (lastMessage?.bodyPlain || lastMessage?.snippet || thread.snippet || '').trim();
  const forwardedBody = [
    'Forwarded by Dumka Mail rule.',
    '',
    `From: ${from}`,
    `Subject: ${subject}`,
    '',
    body || thread.snippet || '(no preview available)',
  ].join('\n');
  const htmlBody = [
    '<p>Forwarded by Dumka Mail rule.</p>',
    '<hr>',
    `<p><strong>From:</strong> ${escapeHtml(from)}<br><strong>Subject:</strong> ${escapeHtml(subject)}</p>`,
    `<blockquote>${escapeHtml(body || thread.snippet || '(no preview available)').replace(/\n/g, '<br>')}</blockquote>`,
  ].join('');

  return {
    to: [{ name: '', email: forwardTo }],
    cc: [],
    bcc: [],
    subject: subject.startsWith('Fwd:') ? subject : `Fwd: ${subject}`,
    bodyPlain: forwardedBody,
    bodyHtml: htmlBody,
  };
}

function latestIncomingMessageForThread(accountId: string, threadId: string): MailMessage | null {
  const self = accountId.trim().toLowerCase();
  const messages = MessagesRepo.listForThread(accountId, threadId);
  return [...messages].reverse().find(message => message.senderEmail.trim().toLowerCase() !== self) || null;
}

function buildAutoReplyDraftFromRule(accountId: string, threadId: string, replyBody: string) {
  const message = latestIncomingMessageForThread(accountId, threadId);
  if (!message) {
    throw new Error('Auto-reply skipped: no incoming message found.');
  }

  const safety = shouldAutoReplyToMessage(message, accountId, replyBody);
  if (!safety.allowed) {
    throw new Error(`Auto-reply skipped: ${safety.reason || 'unsafe message'}.`);
  }

  return buildAutoReplyDraft(message, accountId, replyBody);
}

function getNotificationIconPath(): string | undefined {
  const iconPath = path.join(__dirname, '../../assets/icon.png');
  return fs.existsSync(iconPath) ? iconPath : undefined;
}

function openThreadFromNotification(accountId: string, threadId: string) {
  if (mainWindow) {
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.webContents.send('api:openThread', { accountId, threadId });
    return;
  }

  pendingOpenThread = { accountId, threadId };
  createWindow();
}

function dismissNotification(notification: Notification) {
  activeNotifications.delete(notification);
  notification.close();
}

function notificationButtonActions(kind: MailNotificationKind): NotificationAction[] {
  return notificationActionsFor(kind).map(action => ({
    type: 'button',
    text: action.title,
  }));
}

function refreshRemindersDue(accountId: string, threadId: string) {
  mainWindow?.webContents.send('api:remindersDue', [{ accountId, threadId }]);
}

async function runNotificationLabelAction(
  accountId: string,
  threadId: string,
  kind: Extract<ActionKind, 'markDone' | 'markRead'>,
  addLabelIds: string[],
  removeLabelIds: string[],
) {
  const now = new Date().toISOString();
  const log = {
    id: crypto.randomUUID(),
    accountId,
    threadId,
    kind,
    status: 'running' as const,
    createdAt: now,
    payloadJson: JSON.stringify({ source: 'notification' }),
  };

  ThreadsRepo.updateLabels(accountId, threadId, addLabelIds, removeLabelIds);
  ActionLogRepo.save(log);

  try {
    await runRemoteLabelAction(accountId, threadId, addLabelIds, removeLabelIds, kind);
    ActionLogRepo.save({ ...log, status: 'completed', completedAt: new Date().toISOString() });
  } catch (err: any) {
    if (isNetworkError(err)) {
      ActionLogRepo.save({ ...log, status: 'pending_sync', failureMessage: err?.message || String(err) });
      return;
    }

    ThreadsRepo.updateLabels(accountId, threadId, removeLabelIds, addLabelIds);
    ActionLogRepo.save({
      ...log,
      status: 'failed',
      completedAt: new Date().toISOString(),
      failureMessage: err?.message || String(err),
    });
  }
}

async function handleNotificationAction(
  kind: MailNotificationKind,
  actionIndex: number,
  accountId: string,
  threadId: string,
) {
  const action = notificationActionAt(kind, actionIndex);
  if (!action) return;

  if (action.id === 'open') {
    openThreadFromNotification(accountId, threadId);
    return;
  }

  if (action.id === 'archive') {
    await runNotificationLabelAction(accountId, threadId, 'markDone', [], ['INBOX']);
    return;
  }

  if (action.id === 'markRead') {
    await runNotificationLabelAction(accountId, threadId, 'markRead', [], ['UNREAD']);
    return;
  }

  if (action.id === 'clearReminder') {
    RemindersRepo.delete(accountId, threadId);
    ActionLogRepo.save({
      id: crypto.randomUUID(),
      accountId,
      threadId,
      kind: 'clearReminder',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      payloadJson: JSON.stringify({ source: 'notification' }),
    });
    refreshRemindersDue(accountId, threadId);
    return;
  }

  if (action.id === 'snoozeTomorrow') {
    const reminderAt = nextMorningIso();
    RemindersRepo.save(accountId, threadId, reminderAt);
    ActionLogRepo.save({
      id: crypto.randomUUID(),
      accountId,
      threadId,
      kind: 'setReminder',
      status: 'completed',
      createdAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      payloadJson: JSON.stringify({ source: 'notification', reminderAt }),
    });
    refreshRemindersDue(accountId, threadId);
  }
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
        groupId: message.accountId,
        actions: notificationButtonActions('newMail')
      });

      activeNotifications.add(notification);

      notification.on('click', () => {
        dismissNotification(notification);
        openThreadFromNotification(message.accountId, message.threadId);
      });

      notification.on('action', (details) => {
        dismissNotification(notification);
        void handleNotificationAction('newMail', details.actionIndex, message.accountId, message.threadId).catch(err => {
          console.error('Failed to handle new mail notification action:', err);
        });
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

function notifyOfDueReminders(threads: MailThread[]) {
  if (threads.length === 0) return;

  const settings = readNotificationSettings();
  if (!settings.desktopNotifications || !settings.reminderNotifications || isInQuietHours(settings)) return;

  if (!Notification.isSupported()) {
    console.warn('Native reminder notifications are not supported in this Electron runtime.');
    return;
  }

  const icon = getNotificationIconPath();
  for (const thread of threads) {
    try {
      const notification = new Notification({
        title: 'Reminder',
        subtitle: thread.subject || '(No Subject)',
        body: thread.snippet || thread.senderEmail || '',
        silent: !settings.sound,
        icon,
        id: `reminder:${thread.accountId}:${thread.id}`,
        groupId: thread.accountId,
        actions: notificationButtonActions('reminder')
      });

      activeNotifications.add(notification);

      notification.on('click', () => {
        dismissNotification(notification);
        openThreadFromNotification(thread.accountId, thread.id);
      });

      notification.on('action', (details) => {
        dismissNotification(notification);
        void handleNotificationAction('reminder', details.actionIndex, thread.accountId, thread.id).catch(err => {
          console.error('Failed to handle reminder notification action:', err);
        });
      });

      notification.on('close', () => {
        activeNotifications.delete(notification);
      });

      notification.on('failed', (_, error) => {
        activeNotifications.delete(notification);
        console.error('Reminder notification failed to show:', error);
      });

      notification.show();
    } catch (err) {
      console.error('Failed to show reminder notification:', err);
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

app.whenReady().then(async () => {
  // Initialize SQLite database and run migrations
  initializeDatabase();

  createWindow();

  // Install the native application menu
  installApplicationMenu(() => mainWindow);
  initializeAutoUpdates(() => mainWindow);
  
  // Start background sync worker loop
  startBackgroundSyncWorker();
  startReminderNotificationWorker();
  startBackgroundMailboxSyncWorker();
  startBackgroundAgenticWorker();

  // Initialize MCPManager with stored settings
  try {
    const raw = SettingsRepo.get('appSettings');
    if (raw) {
      const sanitized = await prepareAppSettingsForStorage(raw);
      if (sanitized !== raw) {
        SettingsRepo.set('appSettings', sanitized);
      }
      const resolved = await resolveAppSettingsSecrets(JSON.parse(sanitized));
      await MCPManager.initialize(resolved as any);
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
  databaseWorkerClient.shutdown();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

async function saveThreadsToDatabase(threads: MailThread[]) {
  await databaseWorkerClient.saveThreads(threads);
  void runMailRulesForThreads(threads).catch(err => {
    console.error('Failed to apply mail rules:', err);
  });
}

async function saveMessagesToDatabase(messages: MailMessage[], options?: { notifyOfNew?: boolean }) {
  const { newMessages } = await databaseWorkerClient.saveMessages(messages, {
    ...options,
    indexBodies: readIncludeBodiesInSearchIndex()
  });

  if (options?.notifyOfNew && newMessages.length > 0) {
    notifyOfNewMessages(newMessages);
    void AgenticService.processNewMessages(newMessages);
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
registerSecureHandler('db:deleteAccount', (_, id, options?: { purgeCache?: boolean }) => AccountsRepo.delete(id, options));

registerSecureHandler('db:listThreads', (_, accountId) => ThreadsRepo.list(accountId));
registerSecureHandler('db:saveThreads', (_, threads) => saveThreadsToDatabase(threads));
registerSecureHandler('db:deleteThread', (_, accountId, threadId) => ThreadsRepo.delete(accountId, threadId));

registerSecureHandler('db:listMessagesForThread', (_, accountId, threadId) => MessagesRepo.listForThread(accountId, threadId));
registerSecureHandler('db:saveMessages', async (_, messages: MailMessage[], options?: { notifyOfNew?: boolean }) => {
  await saveMessagesToDatabase(messages, options);
});
registerSecureHandler('db:listEmailSuggestions', (_, accountId?: string, limit?: number) => EmailSuggestionsRepo.list(accountId, limit));

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
registerSecureHandler('db:setSetting', async (_, key, value) => {
  if (key !== 'appSettings') {
    return SettingsRepo.set(key, value);
  }

  const previousValue = SettingsRepo.get('appSettings');
  const previousSettings = parseStoredAppSettings(previousValue);
  const nextSettings = parseStoredAppSettings(value);
  const shouldRefreshMCP = settingsAffectMCPRuntime(previousSettings, nextSettings);
  const shouldRefreshSearchBodyIndex = settingsAffectSearchBodyIndexing(previousSettings, nextSettings);
  const storedValue = shouldRefreshMCP
    ? await prepareAppSettingsForStorage(value)
    : value;
  const result = SettingsRepo.set(key, storedValue);

  try {
    const parsed = JSON.parse(storedValue);
    if (shouldRefreshSearchBodyIndex) {
      SearchRepo.setBodyIndexEnabled(parsed?.privacy?.includeBodiesInSearchIndex !== false);
    }
    if (shouldRefreshMCP) {
      void resolveAppSettingsSecrets(parsed)
        .then(resolved => MCPManager.initialize(resolved as any))
        .catch(err => {
          console.error('Failed to refresh MCPManager after settings update:', err);
        });
    }
  } catch (err) {
    console.error('Failed to apply settings update side effects:', err);
  }

  return result;
});

registerSecureHandler('api:verifyMCPServer', async (_, config) => {
  const resolved = await resolveMCPServerConfigSecrets(config);
  return MCPManager.verifyServer(resolved);
});

// === Bind IPC API / Service Channels ===
registerSecureHandler('api:onboardAccount', async (_, emailHint) => {
  const profile = await startOAuthFlow(emailHint);
  const email = normalizeOAuthEmail(profile.email);
  const existingAccount = AccountsRepo.get(email);
  const account = buildOnboardedAccount(profile, existingAccount);
  let signatureSync;
  let signatureSyncError;

  if (!profile.refreshToken) {
    throw new Error('No refresh token returned. Revoke permissions first.');
  }
  await saveRefreshToken(account.email, profile.refreshToken);
  AccountsRepo.save(account);
  AccountIntegrationsRepo.patch(account.email, { gmailEnabled: true });

  try {
    signatureSync = await GmailSyncService.fetchDefaultSignature(account.email);
  } catch (err: any) {
    signatureSyncError = err?.message || String(err);
    console.warn(`Gmail signature import failed for ${account.email}:`, signatureSyncError);
  }

  return { account, signatureSync, signatureSyncError };
});

registerSecureHandler('api:verifyTokenExists', async (_, email) => {
  const token = await getRefreshToken(email);
  return token !== null;
});

registerSecureHandler('api:disconnectAccount', async (_, email, options?: { purgeCache?: boolean; revokeToken?: boolean }) => {
  const normalizedEmail = normalizeOAuthEmail(email);
  let revokeStatus: 'skipped' | 'missing' | 'revoked' | 'failed' = 'skipped';

  if (options?.revokeToken !== false) {
    try {
      revokeStatus = await GmailSyncService.revokeRefreshToken(normalizedEmail);
    } catch (err) {
      revokeStatus = 'failed';
      console.warn(`Google token revoke failed for ${normalizedEmail}; deleting local token anyway:`, err);
    }
  }

  await deleteRefreshToken(normalizedEmail);
  AccountsRepo.delete(normalizedEmail, { purgeCache: options?.purgeCache !== false });
  return { revokeStatus };
});

registerSecureHandler('db:getGoogleIntegrationStatus', (_, accountId) => AccountIntegrationsRepo.get(accountId));
registerSecureHandler('db:listLabels', (_, accountId) => LabelsRepo.list(accountId));
registerSecureHandler('db:listContacts', (_, accountId, query) => ContactsRepo.list(accountId, query));
registerSecureHandler('db:updateContactLocal', (_, accountId, contactId, patch) => ContactsRepo.updateLocal(accountId, contactId, patch));
registerSecureHandler('db:listContactGroups', (_, accountId) => ContactGroupsRepo.list(accountId));
registerSecureHandler('db:saveContactGroup', (_, group) => ContactGroupsRepo.save(group));
registerSecureHandler('db:deleteContactGroup', (_, accountId, groupId) => ContactGroupsRepo.delete(accountId, groupId));
registerSecureHandler('db:listCalendarEvents', (_, accountId, startAt, endAt) => CalendarEventsRepo.listBetween(accountId, startAt, endAt));

registerSecureHandler('api:authorizeGoogleIntegration', async (_, email, integration: 'calendar' | 'contacts') => {
  const baseScopes = Array.from(GOOGLE_OAUTH_SCOPES);
  const extraScopes = integration === 'calendar' ? Array.from(GOOGLE_CALENDAR_SCOPES) : Array.from(GOOGLE_CONTACTS_SCOPES);
  const profile = await startOAuthFlow(email, [...baseScopes, ...extraScopes]);
  const authorizedEmail = normalizeOAuthEmail(profile.email);
  const expectedEmail = normalizeOAuthEmail(email);
  if (authorizedEmail !== expectedEmail) {
    throw new Error(`Google authorized ${authorizedEmail}, but ${expectedEmail} is selected in Dumka Mail.`);
  }
  if (profile.refreshToken) {
    await saveRefreshToken(expectedEmail, profile.refreshToken);
  }
  AccountIntegrationsRepo.patch(expectedEmail, integration === 'calendar'
    ? { calendarEnabled: true }
    : { contactsEnabled: true });
  return AccountIntegrationsRepo.get(expectedEmail);
});

registerSecureHandler('api:syncLabels', async (_, email) => {
  const labels = await GmailSyncService.listLabels(email);
  LabelsRepo.saveMany(labels);
  return labels;
});

registerSecureHandler('api:createLabel', async (_, email, name) => {
  const label = await GmailSyncService.createLabel(email, name);
  LabelsRepo.saveMany([label]);
  return label;
});

registerSecureHandler('api:updateLabel', async (_, email, labelId, patch) => {
  const label = await GmailSyncService.updateLabel(email, labelId, patch);
  LabelsRepo.saveMany([label]);
  return label;
});

registerSecureHandler('api:deleteLabel', async (_, email, labelId) => {
  await GmailSyncService.deleteLabel(email, labelId);
  LabelsRepo.delete(email, labelId);
});

registerSecureHandler('api:syncContacts', async (_, email) => {
  const result = await GoogleWorkspaceService.listContacts(email);
  ContactsRepo.saveMany(result.contacts);
  for (const group of result.groups) ContactGroupsRepo.save(group);
  AccountIntegrationsRepo.patch(email, { contactsEnabled: true });
  return result;
});

registerSecureHandler('api:syncCalendarEvents', async (_, email, startAt, endAt) => {
  const events = await GoogleWorkspaceService.listPrimaryCalendarEvents(email, startAt, endAt);
  CalendarEventsRepo.saveMany(events);
  AccountIntegrationsRepo.patch(email, { calendarEnabled: true });
  return events;
});

registerSecureHandler('api:queryCalendarFreeBusy', async (_, email, input) => (
  GoogleWorkspaceService.queryCalendarFreeBusy(email, input)
));

registerSecureHandler('api:respondToCalendarInvite', async (_, email, invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, actionId?: string) => {
  const event = await GoogleWorkspaceService.respondToInvite(email, invite, responseStatus);
  CalendarEventsRepo.saveMany([event]);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId: email,
      kind: 'calendarRSVP',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ uid: invite.uid, responseStatus })
    });
  }
  return event;
});

registerSecureHandler('api:addCalendarEvent', async (_, email, invite: CalendarInvite, actionId?: string) => {
  const event = await GoogleWorkspaceService.addInviteToCalendar(email, invite);
  CalendarEventsRepo.saveMany([event]);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId: email,
      kind: 'addCalendarEvent',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ uid: invite.uid, eventId: event.id })
    });
  }
  return event;
});

registerSecureHandler('api:createGoogleMeetDraftEvent', async (_, email, input) => {
  const event = await GoogleWorkspaceService.createGoogleMeetDraftEvent(email, input);
  CalendarEventsRepo.saveMany([event]);
  return event;
});

registerSecureHandler('api:createCalendarEvent', async (_, email, input, actionId?: string) => {
  const event = await GoogleWorkspaceService.createCalendarEvent(email, input);
  CalendarEventsRepo.saveMany([event]);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId: email,
      kind: 'createCalendarEvent',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ eventId: event.id, summary: event.summary })
    });
  }
  return event;
});

registerSecureHandler('api:updateCalendarEvent', async (_, email, input, actionId?: string) => {
  const event = await GoogleWorkspaceService.updateCalendarEvent(email, input);
  CalendarEventsRepo.saveMany([event]);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId: email,
      kind: 'updateCalendarEvent',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ eventId: event.id, summary: event.summary })
    });
  }
  return event;
});

registerSecureHandler('api:deleteCalendarEvent', async (_, email, calendarId: string, eventId: string, actionId?: string) => {
  await GoogleWorkspaceService.deleteCalendarEvent(email, eventId, calendarId || 'primary');
  CalendarEventsRepo.delete(email, calendarId || 'primary', eventId);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId: email,
      kind: 'deleteCalendarEvent',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ calendarId: calendarId || 'primary', eventId })
    });
  }
});

registerSecureHandler('api:syncInbox', (_, email) => GmailSyncService.syncInbox(email));
registerSecureHandler('api:syncSent', (_, email) => GmailSyncService.syncSent(email));
registerSecureHandler('api:syncIncremental', (_, email, startHistoryId) => GmailSyncService.syncIncremental(email, startHistoryId));
registerSecureHandler('api:syncBackfillPage', (_, email, pageToken) => GmailSyncService.syncBackfillPage(email, pageToken));
registerSecureHandler('api:runBackfillPage', (_, email) => runBackfillPageForAccount(email));
registerSecureHandler('api:syncGmailSignature', (_, email) => GmailSyncService.fetchDefaultSignature(email));
registerSecureHandler('api:fetchThreadDetail', (_, email, threadId) => GmailSyncService.fetchThreadDetail(email, threadId));
registerSecureHandler('api:fetchRawMessage', (_, email, messageId) => GmailSyncService.fetchRawMessage(email, messageId));
registerSecureHandler('api:fetchAttachmentData', (_, email, messageId, attachmentId) => GmailSyncService.fetchAttachment(email, messageId, attachmentId));
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
function inferLabelActionKind(addLabelIds: string[], removeLabelIds: string[]): any {
  if (addLabelIds.includes('TRASH')) return 'moveToTrash';
  if (removeLabelIds.includes('TRASH')) return 'restoreFromTrash';
  if (addLabelIds.includes('SPAM')) return 'reportSpam';
  if (removeLabelIds.includes('SPAM')) return 'restoreFromSpam';
  if (addLabelIds.includes('UNREAD')) return 'markUnread';
  if (removeLabelIds.includes('UNREAD')) return 'markRead';
  if (addLabelIds.includes('INBOX')) return 'restoreInbox';
  if (removeLabelIds.includes('INBOX')) return 'markDone';
  if (addLabelIds.length > 0 && removeLabelIds.includes('INBOX')) return 'moveToLabel';
  if (addLabelIds.length > 0) return 'applyLabel';
  if (removeLabelIds.length > 0) return 'removeLabel';
  return 'applyLabel';
}

async function runRemoteLabelAction(email: string, threadId: string, addLabelIds: string[], removeLabelIds: string[], kind?: string) {
  if (kind === 'moveToTrash') {
    await GmailSyncService.trashThread(email, threadId);
    return;
  }
  if (kind === 'restoreFromTrash') {
    await GmailSyncService.untrashThread(email, threadId);
    return;
  }
  await GmailSyncService.modifyLabels(email, threadId, addLabelIds, removeLabelIds);
}

function labelMutationForRuleAction(action: MailRuleAction): { kind: 'markDone' | 'applyLabel' | 'moveToLabel'; addLabelIds: string[]; removeLabelIds: string[] } | null {
  if (action.type === 'archive') {
    return { kind: 'markDone', addLabelIds: [], removeLabelIds: ['INBOX'] };
  }
  if (action.type === 'applyLabel' && action.labelId) {
    return { kind: 'applyLabel', addLabelIds: [action.labelId], removeLabelIds: [] };
  }
  if (action.type === 'moveToLabel' && action.labelId) {
    return { kind: 'moveToLabel', addLabelIds: [action.labelId], removeLabelIds: ['INBOX'] };
  }
  return null;
}

async function applyMailRuleEffect(thread: MailThread, effect: MailRuleEffect) {
  if (ActionLogRepo.get(effect.actionId)) return;

  const now = new Date().toISOString();
  const payloadJson = JSON.stringify({
    ruleId: effect.rule.id,
    ruleTitle: effect.rule.title,
    action: effect.action,
  });

  if (effect.action.type === 'forward') {
    if (!effect.action.forwardTo) return;
    const log = {
      id: effect.actionId,
      accountId: thread.accountId,
      threadId: thread.id,
      kind: 'forwardThread' as const,
      status: 'running' as const,
      createdAt: now,
      payloadJson,
    };
    ActionLogRepo.save(log);

    try {
      await GmailSyncService.sendDraft(
        thread.accountId,
        buildForwardDraftFromThread(thread.accountId, thread, effect.action.forwardTo),
      );
      ActionLogRepo.save({ ...log, status: 'completed', completedAt: new Date().toISOString() });
    } catch (err: any) {
      if (isNetworkError(err)) {
        ActionLogRepo.save({ ...log, status: 'pending_sync', failureMessage: err?.message || String(err) });
        return;
      }
      ActionLogRepo.save({ ...log, status: 'failed', completedAt: new Date().toISOString(), failureMessage: err?.message || String(err) });
    }
    return;
  }

  if (effect.action.type === 'autoReply') {
    const replyBody = effect.action.replyBody?.trim();
    if (!replyBody) return;
    const log = {
      id: effect.actionId,
      accountId: thread.accountId,
      threadId: thread.id,
      kind: 'autoReply' as const,
      status: 'running' as const,
      createdAt: now,
      payloadJson,
    };
    ActionLogRepo.save(log);

    try {
      await GmailSyncService.sendDraft(
        thread.accountId,
        buildAutoReplyDraftFromRule(thread.accountId, thread.id, replyBody),
      );
      ActionLogRepo.save({ ...log, status: 'completed', completedAt: new Date().toISOString() });
    } catch (err: any) {
      if (isNetworkError(err)) {
        ActionLogRepo.save({ ...log, status: 'pending_sync', failureMessage: err?.message || String(err) });
        return;
      }
      ActionLogRepo.save({ ...log, status: 'failed', completedAt: new Date().toISOString(), failureMessage: err?.message || String(err) });
    }
    return;
  }

  const mutation = labelMutationForRuleAction(effect.action);
  if (!mutation) return;

  ThreadsRepo.updateLabels(thread.accountId, thread.id, mutation.addLabelIds, mutation.removeLabelIds);
  const log = {
    id: effect.actionId,
    accountId: thread.accountId,
    threadId: thread.id,
    kind: mutation.kind,
    status: 'running' as const,
    createdAt: now,
    payloadJson,
  };
  ActionLogRepo.save(log);

  try {
    await runRemoteLabelAction(thread.accountId, thread.id, mutation.addLabelIds, mutation.removeLabelIds, mutation.kind);
    ActionLogRepo.save({ ...log, status: 'completed', completedAt: new Date().toISOString() });
  } catch (err: any) {
    if (isNetworkError(err)) {
      ActionLogRepo.save({ ...log, status: 'pending_sync', failureMessage: err?.message || String(err) });
      return;
    }
    ThreadsRepo.updateLabels(thread.accountId, thread.id, mutation.removeLabelIds, mutation.addLabelIds);
    ActionLogRepo.save({ ...log, status: 'failed', completedAt: new Date().toISOString(), failureMessage: err?.message || String(err) });
  }
}

async function runMailRulesForThreads(threads: MailThread[]) {
  if (threads.length === 0) return;

  const settings = readMailRulesSettings();
  if (!settings.enabled || settings.rules.length === 0) return;

  for (const thread of threads) {
    for (const effect of evaluateMailRules(thread, settings)) {
      await applyMailRuleEffect(thread, effect);
    }
  }
}

registerSecureHandler('api:modifyLabels', async (_, email, threadId, addLabelIds, removeLabelIds, actionId?: string, actionKind?: string, payloadJson?: string) => {
  // 1. Optimistically write to local SQLite database first for instant persistence
  ThreadsRepo.updateLabels(email, threadId, addLabelIds, removeLabelIds);
  const resolvedKind = actionKind || inferLabelActionKind(addLabelIds, removeLabelIds);
  
  try {
    // 2. Perform the actual remote Gmail API sync
    await runRemoteLabelAction(email, threadId, addLabelIds, removeLabelIds, resolvedKind);
    return { offline: false };
  } catch (err: any) {
    if (isNetworkError(err)) {
      console.warn('Network error in modifyLabels, queueing offline action:', err.message);
      if (actionId) {
        const log = ActionLogRepo.list(email).find(l => l.id === actionId);
        if (log) {
          log.status = 'pending_sync';
          log.payloadJson = payloadJson || log.payloadJson || null;
          ActionLogRepo.save(log);
        } else {
          ActionLogRepo.save({
            id: actionId,
            accountId: email,
            threadId,
            kind: resolvedKind,
            status: 'pending_sync',
            createdAt: new Date().toISOString(),
            payloadJson
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
registerSecureHandler('api:getThreadAgentInsights', (_, accountId, threadId) => AgenticService.getThreadInsights(accountId, threadId));
registerSecureHandler('api:buildDailyBriefing', (_, accountId, options) => AgenticService.buildDailyBriefing(accountId, options));
registerSecureHandler('api:dismissAgentDraftSuggestion', (_, id) => AgenticService.dismissDraftSuggestion(id));
registerSecureHandler('api:markAgentDraftSuggestionApplied', (_, id) => AgenticService.markDraftSuggestionApplied(id));
registerSecureHandler('api:testEmbeddingConfig', (_, settings) => AgenticService.testEmbeddingConfig(settings));
registerSecureHandler('api:getEmbeddingIndexStatus', (_, accountId) => AgenticService.getEmbeddingIndexStatus(accountId));
registerSecureHandler('api:startEmbeddingReindex', (_, accountId, options) => AgenticService.startEmbeddingReindex(accountId, options));
registerSecureHandler('api:cancelEmbeddingReindex', (_, accountId) => AgenticService.cancelEmbeddingReindex(accountId));
registerSecureHandler('api:deleteEmbeddingIndex', (_, accountId, model) => AgenticService.deleteEmbeddingIndex(accountId, model));
registerSecureHandler('api:deleteOtherEmbeddingIndexes', (_, accountId) => AgenticService.deleteOtherEmbeddingIndexes(accountId));
registerSecureHandler('api:searchSemantic', async (_, accountId, query, limit) => {
  try {
    return await AgenticService.searchSemantic(accountId, query, limit);
  } catch (err) {
    console.warn('[Agentic] Semantic search unavailable:', err);
    return [];
  }
});
registerSecureHandler('api:unsubscribeThread', async (_, email, threadId, actionId?: string) => {
  const id = actionId || crypto.randomUUID();
  const now = new Date().toISOString();
  ActionLogRepo.save({
    id,
    accountId: email,
    threadId,
    kind: 'unsubscribeSender',
    status: 'running',
    createdAt: now
  });

  try {
    const result = await AgenticService.unsubscribeThread(email, threadId);
    ActionLogRepo.save({
      id,
      accountId: email,
      threadId,
      kind: 'unsubscribeSender',
      status: 'completed',
      createdAt: now,
      completedAt: new Date().toISOString(),
      payloadJson: JSON.stringify(result)
    });
    return result;
  } catch (err: any) {
    ActionLogRepo.save({
      id,
      accountId: email,
      threadId,
      kind: 'unsubscribeSender',
      status: 'failed',
      createdAt: now,
      completedAt: new Date().toISOString(),
      failureMessage: err?.message || String(err)
    });
    throw err;
  }
});
registerSecureHandler('api:loadAIConfig', () => loadAIConfigForRenderer());
registerSecureHandler('api:saveAIConfig', (_, config) => saveAIConfigAsync(config));
registerSecureHandler('api:listProviderModels', (_, provider, apiKey, baseUrl) => listProviderModels(provider, apiKey, baseUrl));
registerSecureHandler('api:setMenuCommandState', (_, state) => updateApplicationMenuCommandState(state));
registerSecureHandler('api:getAutoUpdateStatus', () => getAutoUpdateStatus());
registerSecureHandler('api:checkForAppUpdates', () => checkForAppUpdates());
registerSecureHandler('api:installDownloadedAppUpdate', () => installDownloadedAppUpdate());
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
let agenticWorkerActive = false;
let reminderWorkerActive = false;
const activeBackfillAccounts = new Set<string>();

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
          const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
          if (action.kind === 'markDone') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [], ['INBOX']);
          } else if (action.kind === 'restoreInbox') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['INBOX'], []);
          } else if (action.kind === 'markRead') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [], ['UNREAD']);
          } else if (action.kind === 'markUnread') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['UNREAD'], []);
          } else if (action.kind === 'moveToTrash') {
            await GmailSyncService.trashThread(action.accountId, action.threadId!);
          } else if (action.kind === 'restoreFromTrash') {
            await GmailSyncService.untrashThread(action.accountId, action.threadId!);
          } else if (action.kind === 'reportSpam') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['SPAM'], ['INBOX']);
          } else if (action.kind === 'restoreFromSpam') {
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['INBOX'], ['SPAM']);
          } else if (action.kind === 'muteThread') {
            const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, labelId ? [labelId] : [], ['INBOX']);
          } else if (action.kind === 'unmuteThread') {
            const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
            await GmailSyncService.modifyLabels(action.accountId, action.threadId!, ['INBOX'], labelId ? [labelId] : []);
          } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel') {
            const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
            if (labelId) {
              await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [labelId], action.kind === 'moveToLabel' ? ['INBOX'] : []);
            }
          } else if (action.kind === 'removeLabel') {
            const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
            if (labelId) await GmailSyncService.modifyLabels(action.accountId, action.threadId!, [], [labelId]);
          } else if (action.kind === 'send') {
            if (action.draftId) {
              const draft = DraftsRepo.get(action.draftId);
              if (!draft) throw new Error('Draft not found for pending send.');
              await GmailSyncService.sendDraft(action.accountId, draft);
              DraftsRepo.delete(action.draftId);
            }
          } else if (action.kind === 'forwardThread') {
            const payloadAction = payload.action as MailRuleAction | undefined;
            const forwardTo = payloadAction?.forwardTo;
            const thread = action.threadId ? ThreadsRepo.get(action.accountId, action.threadId) : null;
            if (!forwardTo) throw new Error('Forward rule action is missing forwardTo.');
            if (!thread) throw new Error('Thread not found for pending forward rule.');
            await GmailSyncService.sendDraft(
              action.accountId,
              buildForwardDraftFromThread(action.accountId, thread, forwardTo),
            );
          } else if (action.kind === 'autoReply') {
            const payloadAction = payload.action as MailRuleAction | undefined;
            const replyBody = payloadAction?.replyBody?.trim();
            if (!replyBody) throw new Error('Auto-reply rule action is missing replyBody.');
            if (!action.threadId) throw new Error('Thread id is missing for pending auto-reply rule.');
            await GmailSyncService.sendDraft(
              action.accountId,
              buildAutoReplyDraftFromRule(action.accountId, action.threadId, replyBody),
            );
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
              } else if (action.kind === 'moveToTrash') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['INBOX'], ['TRASH']);
              } else if (action.kind === 'restoreFromTrash') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['TRASH'], ['INBOX']);
              } else if (action.kind === 'reportSpam') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['INBOX'], ['SPAM']);
              } else if (action.kind === 'restoreFromSpam') {
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['SPAM'], ['INBOX']);
              } else if (action.kind === 'muteThread') {
                const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
                ThreadsRepo.updateLabels(action.accountId, action.threadId, ['INBOX'], typeof payload.labelId === 'string' ? [payload.labelId] : []);
              } else if (action.kind === 'unmuteThread') {
                const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
                ThreadsRepo.updateLabels(action.accountId, action.threadId, typeof payload.labelId === 'string' ? [payload.labelId] : [], ['INBOX']);
              } else if (action.kind === 'applyLabel' || action.kind === 'moveToLabel' || action.kind === 'removeLabel') {
                const payload = action.payloadJson ? JSON.parse(action.payloadJson) : {};
                const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
                if (labelId && action.kind === 'removeLabel') {
                  ThreadsRepo.updateLabels(action.accountId, action.threadId, [labelId], []);
                } else if (labelId) {
                  ThreadsRepo.updateLabels(action.accountId, action.threadId, action.kind === 'moveToLabel' ? ['INBOX'] : [], [labelId]);
                }
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

function startReminderNotificationWorker() {
  const run = async () => {
    if (reminderWorkerActive) return;
    reminderWorkerActive = true;

    try {
      const dueThreads = RemindersRepo.listDue(new Date().toISOString(), 25);
      if (dueThreads.length === 0) return;

      for (const thread of dueThreads) {
        RemindersRepo.delete(thread.accountId, thread.id);
      }

      notifyOfDueReminders(dueThreads);
      mainWindow?.webContents.send('api:remindersDue', dueThreads.map(thread => ({
        accountId: thread.accountId,
        threadId: thread.id
      })));
    } catch (err) {
      console.error('[Reminder Worker] Failed to process due reminders:', err);
    } finally {
      reminderWorkerActive = false;
    }
  };

  setInterval(run, 15000);
  void run();
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

async function runBackfillPageForAccount(email: string): Promise<{ threadsIndexed: number; pageThreadsIndexed: number; completed: boolean; busy: boolean }> {
  if (activeBackfillAccounts.has(email)) {
    const state = SyncStateRepo.get(email);
    return {
      threadsIndexed: state?.historyBackfillThreadsSynced || 0,
      pageThreadsIndexed: 0,
      completed: Boolean(state?.historyBackfillCompletedAt),
      busy: true
    };
  }

  activeBackfillAccounts.add(email);

  try {
    const syncState = SyncStateRepo.get(email);
    if (syncState?.historyBackfillCompletedAt) {
      return {
        threadsIndexed: syncState.historyBackfillThreadsSynced,
        pageThreadsIndexed: 0,
        completed: true,
        busy: false
      };
    }

    const page = await GmailSyncService.syncBackfillPage(email, syncState?.historyBackfillPageToken || undefined);
    await saveThreadsToDatabase(page.threads);
    await saveMessagesToDatabase(page.messages);

    const now = new Date().toISOString();
    const nextPagesSynced = (syncState?.historyBackfillPagesSynced || 0) + 1;
    const nextThreadsSynced = (syncState?.historyBackfillThreadsSynced || 0) + page.threads.length;

    SyncStateRepo.save({
      accountId: email,
      historyId: syncState?.historyId || null,
      lastFullSyncAt: syncState?.lastFullSyncAt || null,
      historyBackfillPageToken: page.nextPageToken || null,
      lastHistoryBackfillAt: now,
      historyBackfillCompletedAt: page.nextPageToken ? null : now,
      historyBackfillPagesSynced: nextPagesSynced,
      historyBackfillThreadsSynced: nextThreadsSynced
    });

    return {
      threadsIndexed: nextThreadsSynced,
      pageThreadsIndexed: page.threads.length,
      completed: !page.nextPageToken,
      busy: false
    };
  } finally {
    activeBackfillAccounts.delete(email);
  }
}

async function runMailboxSyncForAccount(email: string) {
  const syncState = SyncStateRepo.get(email);

  if (!syncState?.historyId) {
    const fullSync = await GmailSyncService.syncInbox(email);
    await saveThreadsToDatabase(fullSync.threads);
    await saveMessagesToDatabase(fullSync.messages);
    SyncStateRepo.save(nextSyncState(email, syncState, fullSync.historyId, new Date().toISOString()));
    return;
  }

  try {
    const incrementalSync = await GmailSyncService.syncIncremental(email, syncState.historyId);

    for (const threadId of incrementalSync.updatedThreadIds) {
      try {
        const messages = await GmailSyncService.fetchThreadDetail(email, threadId);
        await saveMessagesToDatabase(messages, { notifyOfNew: true });

        const thread = buildThreadFromMessages(email, threadId, messages);
        if (thread) {
          await saveThreadsToDatabase([thread]);
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
      await saveThreadsToDatabase(fullSync.threads);
      await saveMessagesToDatabase(fullSync.messages);
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

function startBackgroundAgenticWorker() {
  const run = async () => {
    if (agenticWorkerActive) return;
    agenticWorkerActive = true;

    try {
      await AgenticService.runBackgroundPass();
    } catch (err) {
      console.error('[Agentic] Background pass failed:', err);
    } finally {
      agenticWorkerActive = false;
    }
  };

  setTimeout(() => {
    void run();
  }, 20000);

  setInterval(() => {
    void run();
  }, 120000);
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
