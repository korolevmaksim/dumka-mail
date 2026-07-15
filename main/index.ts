import { app, BrowserWindow, ipcMain, dialog, Notification, screen, shell, type NotificationAction } from 'electron';
import { execFileSync } from 'child_process';
import path from 'path';
import fs from 'fs';
import os from 'os';
import {
  initializeDatabase,
  AccountIntegrationsRepo,
  AccountsRepo,
  CalendarListsRepo,
  CalendarEventsRepo,
  CalendarMutationsRepo,
  CleanupExclusionsRepo,
  ContactGroupsRepo,
  ContactsRepo,
  DraftsRepo,
  EmailSuggestionsRepo,
  LabelsRepo,
  MessagesRepo,
  RemindersRepo,
  FollowUpRadarRepo,
  OperatorHomeStateRepo,
  SearchRepo,
  SettingsRepo,
  SyncStateRepo,
  ActionLogRepo,
  AIConversationsRepo,
  ThreadsRepo,
} from './database';
import { isNetworkError, startBackgroundSyncWorker } from './actionReconciler';
import { startOAuthFlow, GmailSyncService } from './gmail';
import { GOOGLE_CALENDAR_SCOPES, GOOGLE_CONTACTS_SCOPES, GOOGLE_OAUTH_SCOPES } from './gmailOAuth';
import { GoogleCalendarSyncTokenExpiredError, GoogleWorkspaceService } from './googleWorkspace';
import { optimisticCalendarEvent, queueCalendarMutation, startCalendarMutationWorker } from './calendarMutationWorker';
import { startCalendarNotificationWorker } from './calendarNotifications';
import { deleteRefreshToken, getRefreshToken, saveRefreshToken } from './keychain';
import { getAIProviderDescriptor, completeAI, saveAIConfigAsync, listProviderModels, loadAIConfigForRenderer } from './ai';
import {
  validateAgentActionProposalItem,
  validateAgentActionProposalMutation,
  type AgentActionProposalMutationAction,
} from './agentActionProposalResolver';
import { AgenticService } from './agentic';
import { ReplyPipelineService } from './replyPipelineService';
import { sendReplyPipelineUpdateSafely } from './replyPipelineNotifications';
import { MCPManager } from './mcpManager';
import { executeMailboxSearchTool } from './mailboxSearchTool';
import { executeCalendarAssistantTool } from './calendarAssistantTools';
import { prepareAppSettingsForStorage, resolveAppSettingsSecrets, resolveMCPServerConfigSecrets } from './mcpSettings';
import { parseStoredAppSettings, settingsAffectMCPRuntime, settingsAffectSearchBodyIndexing } from './settingsSideEffects';
import { installApplicationMenu, updateApplicationMenuCommandState } from './menu';
import { buildOnboardedAccount, normalizeOAuthEmail } from './accountOnboarding';
import { databaseWorkerClient } from './databaseWorkerClient';
import { semanticSearchWorkerClient } from './semanticSearchWorkerClient';
import { checkForAppUpdates, getAutoUpdateStatus, initializeAutoUpdates, installDownloadedAppUpdate } from './autoUpdate';
import { shouldNotifyForMessage } from '../shared/mailSecurity';
import { buildAutoReplyDraft, shouldAutoReplyToMessage } from '../shared/autoReply';
import { buildMailRuleShadowLog, evaluateMailRules, evaluateShadowMailRules, normalizeMailRulesSettings, type MailRuleEffect } from '../shared/mailRules';
import { escapeHtml } from '../shared/draftHtml';
import { replyDraftPlaceholderValidationMessage } from '../shared/replyPipeline';
import { calendarEventToIcs } from '../shared/calendar';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import { nextMorningIso, notificationActionAt, notificationActionsFor, type MailNotificationKind } from '../shared/notificationActions';
import type {
  ActionKind,
  AgentPlanItem,
  AppSettings,
  AttachmentOpenBlocked,
  AttachmentOpenResult,
  AttachmentSaveCancelled,
  AttachmentSaveResult,
  CalendarAttendeeResponse,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
  CalendarInvite,
  CleanupSenderExclusion,
  DailyBriefing,
  FollowUpRadarListOptions,
  MailMessage,
  MailboxDelta,
  MailNotificationSettings,
  MailRuleAction,
  MailRulesSettings,
  MailThread,
  OperatorHomeStateSnapshot,
  ReplyPipelineCandidate,
  SyncState,
} from '../shared/types';
import {
  allocateUniqueFilename,
  canOpenExternally,
  sanitizeAttachmentFilename,
} from '../shared/attachments';

let mainWindow: BrowserWindow | null = null;
let pendingOpenThread: { accountId: string; threadId: string } | null = null;
const activeNotifications = new Set<Notification>();
const calendarSyncInFlight = new Map<string, Promise<CalendarEvent[]>>();
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

function notifyReplyPipelineUpdated(accountId: string, threadId: string): void {
  sendReplyPipelineUpdateSafely(mainWindow, accountId, threadId);
}

MCPManager.setMailboxSearchExecutor(executeMailboxSearchTool);
MCPManager.setCalendarAssistantExecutor(executeCalendarAssistantTool);

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
  startBackgroundSyncWorker({
    actionLog: ActionLogRepo,
    threads: ThreadsRepo,
    drafts: DraftsRepo,
    gmail: GmailSyncService,
    buildForwardDraft: buildForwardDraftFromThread,
    buildAutoReplyDraft: buildAutoReplyDraftFromRule,
    onDraftSent: (accountId, draftId) => {
      const state = ReplyPipelineService.markSentByDraftBestEffort(accountId, draftId);
      if (state) notifyReplyPipelineUpdated(state.accountId, state.threadId);
    },
    validateAgentProposalReplay: (action, payload) => {
      const provenance = payload.provenance;
      if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)
        || (provenance as Record<string, unknown>).origin !== 'aiAssistant') return;
      const item = payload.proposalValidationItem;
      if (!item || typeof item !== 'object' || Array.isArray(item) || !action.threadId) {
        throw new Error('This pending AI proposal is missing its replay validation proof.');
      }
      if (action.kind === 'markDone') {
        assertAgentProposalReadyForMutation({
          item: item as AgentPlanItem,
          accountId: action.accountId,
          threadId: action.threadId,
          action: 'archive',
          allowOptimisticState: true,
        });
        return;
      }
      const labelId = typeof payload.labelId === 'string' ? payload.labelId : null;
      assertAgentProposalReadyForMutation({
        item: item as AgentPlanItem,
        accountId: action.accountId,
        threadId: action.threadId,
        action: 'applyLabel',
        labelId,
        allowOptimisticState: true,
      });
    },
  });
  startReminderNotificationWorker();
  startCalendarMutationWorker(() => mainWindow);
  startCalendarNotificationWorker(() => mainWindow);
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
  semanticSearchWorkerClient.shutdown();
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

  try {
    for (const state of ReplyPipelineService.processNewMessages(messages)) {
      notifyReplyPipelineUpdated(state.accountId, state.threadId);
    }
  } catch (pipelineError) {
    console.error('[Reply Pipeline] Failed to reconcile persisted messages:', pipelineError);
  }

  if (options?.notifyOfNew && newMessages.length > 0) {
    notifyOfNewMessages(newMessages);
    void AgenticService.processNewMessages(newMessages);
  }
}

// === Bind IPC Database Channels ===
function registerSecureHandler(channel: string, listener: (event: Electron.IpcMainInvokeEvent, ...args: any[]) => any) {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedSender(event.senderFrame);
    return listener(event, ...args);
  });
}

function requireCalendarText(value: unknown, field: string, maxLength = 512): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength || value.includes('\0')) {
    throw new Error(`Invalid calendar ${field}.`);
  }
  return value;
}

function requireCalendarRange(startAt: unknown, endAt: unknown): { startAt: string; endAt: string } {
  const start = new Date(requireCalendarText(startAt, 'range start', 64));
  const end = new Date(requireCalendarText(endAt, 'range end', 64));
  const duration = end.getTime() - start.getTime();
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || duration <= 0 || duration > 370 * 86_400_000) {
    throw new Error('Invalid calendar date range.');
  }
  return { startAt: start.toISOString(), endAt: end.toISOString() };
}

registerSecureHandler('db:listAccounts', () => AccountsRepo.list());
registerSecureHandler('db:getAccount', (_, id) => AccountsRepo.get(id));
registerSecureHandler('db:saveAccount', (_, account) => AccountsRepo.save(account));
registerSecureHandler('db:deleteAccount', (_, id, options?: { purgeCache?: boolean }) => AccountsRepo.delete(id, options));

registerSecureHandler('db:listThreads', (_, accountId) => databaseWorkerClient.listThreads([accountId]));
registerSecureHandler('db:listThreadsForAccounts', (_, accountIds: string[]) => databaseWorkerClient.listThreads(accountIds));
registerSecureHandler('db:saveThreads', (_, threads) => saveThreadsToDatabase(threads));
registerSecureHandler('db:deleteThread', (_, accountId, threadId) => ThreadsRepo.delete(accountId, threadId));

registerSecureHandler('db:listMessagesForThread', (_, accountId, threadId) => databaseWorkerClient.listMessagesForThread(accountId, threadId));
registerSecureHandler('api:getThreadReaderPayload', async (_, accountId: string, threadId: string) => {
  const messages = await databaseWorkerClient.listMessagesForThread(accountId, threadId);
  const insights = await AgenticService.getThreadInsights(accountId, threadId, messages);
  return { accountId, threadId, messages, insights };
});
registerSecureHandler('db:saveMessages', async (_, messages: MailMessage[], options?: { notifyOfNew?: boolean }) => {
  await saveMessagesToDatabase(messages, options);
});
registerSecureHandler('db:listEmailSuggestions', (_, accountId?: string, limit?: number) => EmailSuggestionsRepo.list(accountId, limit));

registerSecureHandler('api:getPendingOpenThread', () => {
  const pending = pendingOpenThread;
  pendingOpenThread = null;
  return pending;
});

registerSecureHandler('api:listFollowUpRadarItems', (_, accountId: string, options?: FollowUpRadarListOptions) => FollowUpRadarRepo.listItems(accountId, options));
registerSecureHandler('api:dismissFollowUpRadarItem', (_, accountId: string, threadId: string, sentMessageId: string) => FollowUpRadarRepo.dismiss(accountId, threadId, sentMessageId));
registerSecureHandler('api:snoozeFollowUpRadarItem', (_, accountId: string, threadId: string, sentMessageId: string, snoozedUntil: string) => FollowUpRadarRepo.snooze(accountId, threadId, sentMessageId, snoozedUntil));

registerSecureHandler('api:reconcileReplyPipeline', (_, candidates: ReplyPipelineCandidate[]) => ReplyPipelineService.reconcileCandidates(candidates));
registerSecureHandler('api:listReplyPipeline', (_, accountIds: string[]) => ReplyPipelineService.list(accountIds));
registerSecureHandler('api:prepareReplyPipelineDraft', (_, accountId: string, threadId: string) => ReplyPipelineService.prepareDraft(accountId, threadId));
registerSecureHandler('api:snoozeReplyPipelineItem', (_, accountId: string, threadId: string, snoozedUntil: string) => ReplyPipelineService.snooze(accountId, threadId, snoozedUntil));
registerSecureHandler('api:suppressReplyPipelineItem', (_, accountId: string, threadId: string) => ReplyPipelineService.suppress(accountId, threadId));
registerSecureHandler('api:resolveReplyPipelineItem', (_, accountId: string, threadId: string) => ReplyPipelineService.resolve(accountId, threadId));

registerSecureHandler('db:listDrafts', (_, accountId) => DraftsRepo.list(accountId));
registerSecureHandler('db:getDraft', (_, id) => DraftsRepo.get(id));
registerSecureHandler('db:saveDraft', (_, draft) => {
  DraftsRepo.save(draft);
  if (typeof draft?.accountId === 'string' && typeof draft?.id === 'string') {
    const state = ReplyPipelineService.refreshDraftPlaceholdersBestEffort(
      draft.accountId,
      draft.id,
      typeof draft.bodyPlain === 'string' ? draft.bodyPlain : '',
      typeof draft.bodyHtml === 'string' ? draft.bodyHtml : null,
    );
    if (state) notifyReplyPipelineUpdated(state.accountId, state.threadId);
  }
});
registerSecureHandler('db:deleteDraft', (_, id) => DraftsRepo.delete(id));

registerSecureHandler('db:getReminder', (_, accountId, threadId) => RemindersRepo.get(accountId, threadId));
registerSecureHandler('db:saveReminder', (_, accountId, threadId, reminderAt, proposalItem?: AgentPlanItem) => {
  if (proposalItem) {
    assertAgentProposalReadyForMutation({
      item: proposalItem,
      accountId,
      threadId,
      action: 'setReminder',
      reminderAt,
    });
  }
  return RemindersRepo.save(accountId, threadId, reminderAt);
});
registerSecureHandler('db:deleteReminder', (_, accountId, threadId) => RemindersRepo.delete(accountId, threadId));

registerSecureHandler('db:getSyncState', (_, accountId) => SyncStateRepo.get(accountId));
registerSecureHandler('db:saveSyncState', (_, state) => SyncStateRepo.save(state));

registerSecureHandler('db:listActionLog', (_, accountId) => ActionLogRepo.list(accountId));
registerSecureHandler('db:saveActionLog', (_, log) => ActionLogRepo.save(log));

registerSecureHandler('db:listCleanupExclusions', (_, accountIds: string[]) => CleanupExclusionsRepo.list(accountIds));
registerSecureHandler('db:saveCleanupExclusion', (_, exclusion: CleanupSenderExclusion) => CleanupExclusionsRepo.save(exclusion));
registerSecureHandler('db:deleteCleanupExclusion', (_, accountId: string, senderEmail: string) => CleanupExclusionsRepo.delete(accountId, senderEmail));

registerSecureHandler('db:getOperatorHomeState', (_, scopeId: string) => OperatorHomeStateRepo.get(scopeId));
registerSecureHandler('db:saveOperatorHomeState', (_, snapshot: OperatorHomeStateSnapshot) => OperatorHomeStateRepo.saveSnapshot(snapshot));
registerSecureHandler('db:finalizeOperatorHomeAutoRefreshWindow', (_, scopeId: string, windowKey: string, briefing: DailyBriefing) => OperatorHomeStateRepo.finalizeAutoRefreshWindow(scopeId, windowKey, briefing));

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
registerSecureHandler('db:listCalendarEvents', (_, accountId, startAt, endAt) => {
  const range = requireCalendarRange(startAt, endAt);
  return CalendarEventsRepo.listBetween(requireCalendarText(accountId, 'account'), range.startAt, range.endAt);
});
registerSecureHandler('db:listCalendars', (_, accountId) => CalendarListsRepo.list(requireCalendarText(accountId, 'account')));
registerSecureHandler('db:searchCalendarEvents', (_, accountIds: unknown, query: unknown, limit?: number) => {
  if (!Array.isArray(accountIds) || accountIds.length === 0 || accountIds.length > 20) throw new Error('Invalid calendar search accounts.');
  const validatedAccounts = accountIds.map(accountId => requireCalendarText(accountId, 'account'));
  const validatedQuery = requireCalendarText(query, 'search query', 256);
  return CalendarEventsRepo.search(validatedAccounts, validatedQuery, limit);
});

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

registerSecureHandler('api:syncCalendarLists', async (_, accountId) => {
  const email = requireCalendarText(accountId, 'account');
  const calendars = await GoogleWorkspaceService.listCalendars(email);
  CalendarListsRepo.replaceForAccount(email, calendars);
  AccountIntegrationsRepo.patch(email, { calendarEnabled: true });
  return calendars;
});

registerSecureHandler('api:pickCalendarIcsFile', async () => {
  if (!mainWindow) return null;
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openFile'],
    title: 'Import Calendar File',
    filters: [{ name: 'iCalendar', extensions: ['ics', 'ical'] }],
  });
  const filePath = filePaths?.[0];
  if (!filePath) return null;
  const stat = fs.statSync(filePath);
  if (stat.size > 2 * 1024 * 1024) throw new Error('Calendar import is limited to 2 MB.');
  return { filename: path.basename(filePath), text: fs.readFileSync(filePath, 'utf8') };
});

registerSecureHandler('api:exportCalendarEventIcs', async (_, event: CalendarEvent) => {
  if (!mainWindow) return null;
  const safeBase = sanitizeAttachmentFilename(`${event.summary || 'event'}.ics`);
  const { filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Export Calendar Event',
    defaultPath: path.join(app.getPath('downloads'), safeBase),
    filters: [{ name: 'iCalendar', extensions: ['ics'] }],
  });
  if (!filePath) return null;
  fs.writeFileSync(filePath, calendarEventToIcs(event), 'utf8');
  return filePath;
});

async function performCalendarSync(email: string, startAt: string, endAt: string): Promise<CalendarEvent[]> {
  let calendars = await GoogleWorkspaceService.listCalendars(email);
  if (calendars.length === 0) {
    calendars = [{
      id: 'primary',
      accountId: email,
      summary: email,
      primary: true,
      selected: true,
      accessRole: 'owner',
      backgroundColor: '#3b82f6',
      foregroundColor: '#ffffff',
      updatedAt: new Date().toISOString(),
    }];
  }
  CalendarListsRepo.replaceForAccount(email, calendars);
  const allEvents = [];
  for (const calendar of calendars) {
    if (!calendar.selected || calendar.deleted || calendar.accessRole === 'none' || calendar.accessRole === 'freeBusyReader') continue;
    try {
      let syncToken = CalendarEventsRepo.getRangeSyncToken(email, calendar.id, startAt, endAt);
      let result;
      try {
        result = await GoogleWorkspaceService.syncCalendarEvents(email, calendar.id, startAt, endAt, syncToken);
      } catch (error) {
        if (!(error instanceof GoogleCalendarSyncTokenExpiredError)) throw error;
        CalendarEventsRepo.clearRangeSyncToken(email, calendar.id, startAt, endAt);
        syncToken = null;
        result = await GoogleWorkspaceService.syncCalendarEvents(email, calendar.id, startAt, endAt);
      }
      const pendingEventIds = new Set(CalendarMutationsRepo.list()
        .filter(mutation => mutation.accountId === email && mutation.calendarId === calendar.id && mutation.eventId)
        .map(mutation => mutation.eventId as string));
      const syncEvents = result.events.filter(event => !pendingEventIds.has(event.id));
      if (syncToken && result.nextSyncToken) {
        CalendarEventsRepo.applyRangeDelta(email, calendar.id, startAt, endAt, syncEvents, result.nextSyncToken);
      } else {
        CalendarEventsRepo.replaceRange(email, calendar.id, startAt, endAt, syncEvents, result.nextSyncToken);
      }
      const cachedEvents = CalendarEventsRepo.listBetween(email, startAt, endAt)
        .filter(event => event.calendarId === calendar.id);
      allEvents.push(...cachedEvents.filter(event => event.status !== 'cancelled'));
    } catch (error) {
      console.warn(`Calendar sync skipped ${calendar.id}:`, error);
      allEvents.push(...CalendarEventsRepo.listBetween(email, startAt, endAt)
        .filter(event => event.calendarId === calendar.id && event.status !== 'cancelled'));
    }
  }
  AccountIntegrationsRepo.patch(email, { calendarEnabled: true });
  return Array.from(new Map(allEvents.map(event => [`${event.calendarId}:${event.id}`, event])).values());
}

function runCalendarSync(email: string, startAt: string, endAt: string): Promise<CalendarEvent[]> {
  const key = `${email}\0${startAt}\0${endAt}`;
  const existing = calendarSyncInFlight.get(key);
  if (existing) return existing;
  const task = performCalendarSync(email, startAt, endAt).finally(() => {
    if (calendarSyncInFlight.get(key) === task) calendarSyncInFlight.delete(key);
  });
  calendarSyncInFlight.set(key, task);
  return task;
}

registerSecureHandler('api:syncCalendarEvents', (_, accountId, startAt, endAt) => {
  const email = requireCalendarText(accountId, 'account');
  const range = requireCalendarRange(startAt, endAt);
  return runCalendarSync(email, range.startAt, range.endAt);
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

registerSecureHandler('api:respondToCalendarEvent', async (_, email, calendarId, eventId, responseStatus: CalendarAttendeeResponse, actionId?: string) => {
  const accountId = requireCalendarText(email, 'account');
  const targetCalendarId = requireCalendarText(calendarId, 'calendar');
  const targetEventId = requireCalendarText(eventId, 'event');
  if (!['needsAction', 'accepted', 'declined', 'tentative'].includes(responseStatus)) throw new Error('Invalid calendar response.');
  const event = await GoogleWorkspaceService.respondToCalendarEvent(accountId, targetCalendarId, targetEventId, responseStatus);
  CalendarEventsRepo.saveMany([event]);
  if (actionId) {
    const now = new Date().toISOString();
    ActionLogRepo.save({
      id: actionId,
      accountId,
      kind: 'calendarRSVP',
      status: 'completed',
      createdAt: now,
      completedAt: now,
      payloadJson: JSON.stringify({ calendarId: targetCalendarId, eventId: targetEventId, responseStatus }),
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

registerSecureHandler('api:importCalendarInvite', async (_, email, invite: CalendarInvite, calendarId: string) => {
  const event = await GoogleWorkspaceService.addInviteToCalendar(email, invite, calendarId || 'primary');
  CalendarEventsRepo.saveMany([event]);
  return event;
});

registerSecureHandler('api:createGoogleMeetDraftEvent', async (_, email, input) => {
  const event = await GoogleWorkspaceService.createGoogleMeetDraftEvent(email, input);
  CalendarEventsRepo.saveMany([event]);
  return event;
});

registerSecureHandler('api:createCalendarEvent', async (_, email, input: CalendarEventCreateInput, actionId?: string) => {
  try {
    const event = await GoogleWorkspaceService.createCalendarEvent(email, input);
    CalendarEventsRepo.saveMany([event]);
    if (actionId) {
      const now = new Date().toISOString();
      ActionLogRepo.save({ id: actionId, accountId: email, kind: 'createCalendarEvent', status: 'completed', createdAt: now, completedAt: now, payloadJson: JSON.stringify({ eventId: event.id, summary: event.summary }) });
    }
    return event;
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    const event = optimisticCalendarEvent(email, input);
    CalendarEventsRepo.saveMany([event]);
    queueCalendarMutation({ actionId, accountId: email, kind: 'create', calendarId: event.calendarId, eventId: event.id, payload: { input, optimisticEventId: event.id }, actionKind: 'createCalendarEvent' });
    return event;
  }
});

registerSecureHandler('api:updateCalendarEvent', async (_, email, input: CalendarEventUpdateInput, actionId?: string) => {
  const calendarId = input.calendarId || 'primary';
  const originalCalendarId = input.originalCalendarId || calendarId;
  const previousEvent = CalendarEventsRepo.get(email, originalCalendarId, input.eventId);
  if (input.eventId.startsWith('local-')) {
    const createMutation = CalendarMutationsRepo.list().find(record => record.accountId === email && record.kind === 'create' && record.eventId === input.eventId);
    if (createMutation) {
      CalendarMutationsRepo.save({ ...createMutation, calendarId, payloadJson: JSON.stringify({ input, optimisticEventId: input.eventId }) });
      const event = { ...optimisticCalendarEvent(email, input, input.eventId), updatedAt: new Date().toISOString() };
      if (originalCalendarId !== calendarId) CalendarEventsRepo.delete(email, originalCalendarId, input.eventId);
      CalendarEventsRepo.saveMany([event]);
      return event;
    }
  }
  try {
    const event = await GoogleWorkspaceService.updateCalendarEvent(email, input);
    if (originalCalendarId !== event.calendarId) CalendarEventsRepo.delete(email, originalCalendarId, input.eventId);
    CalendarEventsRepo.saveMany([event]);
    if (actionId) {
      const now = new Date().toISOString();
      ActionLogRepo.save({ id: actionId, accountId: email, kind: 'updateCalendarEvent', status: 'completed', createdAt: now, completedAt: now, payloadJson: JSON.stringify({ eventId: event.id, summary: event.summary }) });
    }
    return event;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('Calendar conflict:') && actionId) {
      const now = new Date().toISOString();
      ActionLogRepo.save({
        id: actionId,
        accountId: email,
        kind: 'updateCalendarEvent',
        status: 'failed',
        createdAt: now,
        completedAt: now,
        failureMessage: error.message,
        payloadJson: JSON.stringify({ conflict: true, input, previousEvent }),
      });
    }
    if (!isNetworkError(error)) throw error;
    if (input.mutationScope === 'following') {
      throw new Error('Changing this and following events requires a network connection.');
    }
    const event: CalendarEvent = {
      ...(previousEvent || optimisticCalendarEvent(email, input, input.eventId)),
      ...optimisticCalendarEvent(email, input, input.eventId),
      id: input.eventId,
      accountId: email,
      calendarId,
      status: 'pending',
      updatedAt: new Date().toISOString(),
    };
    if (originalCalendarId !== calendarId) CalendarEventsRepo.delete(email, originalCalendarId, input.eventId);
    CalendarEventsRepo.saveMany([event]);
    queueCalendarMutation({ actionId, accountId: email, kind: 'update', calendarId: originalCalendarId, eventId: input.eventId, payload: { input, previousEvent }, actionKind: 'updateCalendarEvent' });
    return event;
  }
});

registerSecureHandler('api:deleteCalendarEvent', async (_, email, calendarId: string, eventId: string, actionId?: string, options: CalendarEventDeleteOptions = {}) => {
  const normalizedCalendarId = calendarId || 'primary';
  const deletedEvent = CalendarEventsRepo.get(email, normalizedCalendarId, eventId);
  if (eventId.startsWith('local-')) {
    const createMutation = CalendarMutationsRepo.list().find(record => record.accountId === email && record.kind === 'create' && record.eventId === eventId);
    if (createMutation) {
      CalendarMutationsRepo.delete(createMutation.id);
      const originalAction = ActionLogRepo.get(createMutation.id);
      if (originalAction) ActionLogRepo.save({ ...originalAction, status: 'completed', completedAt: new Date().toISOString(), failureMessage: null });
      CalendarEventsRepo.delete(email, normalizedCalendarId, eventId);
      return;
    }
  }
  try {
    await GoogleWorkspaceService.deleteCalendarEvent(email, eventId, normalizedCalendarId, options);
    CalendarEventsRepo.delete(email, normalizedCalendarId, eventId);
    if (actionId) {
      const now = new Date().toISOString();
      ActionLogRepo.save({ id: actionId, accountId: email, kind: 'deleteCalendarEvent', status: 'completed', createdAt: now, completedAt: now, payloadJson: JSON.stringify({ calendarId: normalizedCalendarId, eventId }) });
    }
  } catch (error) {
    if (!isNetworkError(error)) throw error;
    if (options.mutationScope === 'following') {
      throw new Error('Deleting this and following events requires a network connection.');
    }
    CalendarEventsRepo.delete(email, normalizedCalendarId, eventId);
    queueCalendarMutation({ actionId, accountId: email, kind: 'delete', calendarId: normalizedCalendarId, eventId, payload: { deletedEvent, deleteOptions: options }, actionKind: 'deleteCalendarEvent' });
  }
});

registerSecureHandler('api:syncInbox', (_, email) => GmailSyncService.syncInbox(email));
registerSecureHandler('api:syncMailboxNow', async (_, accountIds: string[]): Promise<MailboxDelta[]> => {
  const connected = new Set(AccountsRepo.list().map(account => account.email));
  const requested = Array.from(new Set((Array.isArray(accountIds) ? accountIds : [])
    .map(accountId => accountId.trim())
    .filter(accountId => connected.has(accountId))));
  const targets = requested.length > 0 ? requested : Array.from(connected);
  const results: MailboxDelta[] = [];
  for (const accountId of targets) {
    results.push(await runMailboxSyncForAccount(accountId));
  }
  return results;
});
registerSecureHandler('api:syncSent', (_, email) => GmailSyncService.syncSent(email));
registerSecureHandler('api:syncIncremental', (_, email, startHistoryId) => GmailSyncService.syncIncremental(email, startHistoryId));
registerSecureHandler('api:syncBackfillPage', (_, email, pageToken) => GmailSyncService.syncBackfillPage(email, pageToken));
registerSecureHandler('api:runBackfillPage', (_, email) => runBackfillPageForAccount(email));
registerSecureHandler('api:syncGmailSignature', (_, email) => GmailSyncService.fetchDefaultSignature(email));
registerSecureHandler('api:fetchThreadDetail', (_, email, threadId) => GmailSyncService.fetchThreadDetail(email, threadId));
registerSecureHandler('api:fetchRawMessage', (_, email, messageId) => GmailSyncService.fetchRawMessage(email, messageId));
registerSecureHandler('api:fetchAttachmentData', (_, email, messageId, attachmentId) => GmailSyncService.fetchAttachment(email, messageId, attachmentId));

registerSecureHandler(
  'api:downloadAttachment',
  async (
    _,
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    options?: { saveAs?: boolean; base64Data?: string | null },
  ): Promise<AttachmentSaveResult | AttachmentSaveCancelled> => {
    const safeName = sanitizeAttachmentFilename(filename);
    const buffer = await loadAttachmentBuffer(email, messageId, attachmentId, options?.base64Data);

    let targetPath: string;
    if (options?.saveAs) {
      if (!mainWindow) return { ok: false, cancelled: true };
      const { filePath } = await dialog.showSaveDialog(mainWindow, {
        defaultPath: path.join(resolveAttachmentDownloadDir(), safeName),
        title: 'Save Attachment',
      });
      if (!filePath) return { ok: false, cancelled: true };
      targetPath = filePath;
    } else {
      // Allocate after the network fetch so concurrent saves cannot race the same free name.
      targetPath = allocatePathInDir(resolveAttachmentDownloadDir(), safeName);
    }

    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, buffer);
    applyDownloadQuarantine(targetPath);
    return { ok: true, filePath: targetPath };
  },
);

registerSecureHandler(
  'api:openAttachment',
  async (
    _,
    email: string,
    messageId: string,
    attachmentId: string,
    filename: string,
    mimeType: string,
    options?: { base64Data?: string | null },
  ): Promise<AttachmentOpenResult | AttachmentOpenBlocked> => {
    const safeName = sanitizeAttachmentFilename(filename);
    if (!canOpenExternally(mimeType || '', safeName)) {
      return {
        ok: false,
        reason: 'unsafe',
        message: 'This attachment type cannot be opened automatically for safety. Use Download instead.',
      };
    }

    try {
      const buffer = await loadAttachmentBuffer(email, messageId, attachmentId, options?.base64Data);
      const openDir = path.join(os.tmpdir(), 'dumka-mail-open');
      fs.mkdirSync(openDir, { recursive: true });
      // Stable cache key per message+attachment so reopening reuses the same path (rewritten each open).
      const cacheKey = `${messageId.slice(0, 12)}-${(attachmentId || safeName).replace(/[^\w.-]+/g, '_').slice(0, 40)}`;
      const cachedName = `${cacheKey}-${safeName}`;
      const filePath = path.join(openDir, cachedName);
      fs.writeFileSync(filePath, buffer);
      applyDownloadQuarantine(filePath);

      const openError = await shell.openPath(filePath);
      if (openError) {
        return { ok: false, reason: 'open_failed', message: openError };
      }
      return { ok: true, filePath };
    } catch (err: any) {
      const msg = err?.message || String(err);
      if (/fetchAttachment|No attachment|missing/i.test(msg)) {
        return { ok: false, reason: 'fetch_failed', message: msg };
      }
      if (/missing|not found|empty/i.test(msg)) {
        return { ok: false, reason: 'missing', message: msg };
      }
      return { ok: false, reason: 'fetch_failed', message: msg };
    }
  },
);

registerSecureHandler('api:chooseAttachmentDownloadFolder', async (): Promise<string | null> => {
  if (!mainWindow) return null;
  const defaultPath = resolveAttachmentDownloadDir();
  const { filePaths } = await dialog.showOpenDialog(mainWindow, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Choose Attachment Download Folder',
    defaultPath,
  });
  return filePaths?.[0] || null;
});

registerSecureHandler('api:getSystemDownloadsPath', (): string => {
  return app.getPath('downloads');
});

registerSecureHandler('api:revealInFolder', async (_, filePath: string): Promise<void> => {
  if (typeof filePath !== 'string' || !filePath) return;
  // Only reveal existing absolute paths to avoid shell injection-ish misuse.
  if (!path.isAbsolute(filePath) || !fs.existsSync(filePath)) return;
  shell.showItemInFolder(filePath);
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

function proposalItemFromActionPayload(payloadJson?: string): AgentPlanItem | null {
  if (!payloadJson) return null;
  let payload: unknown;
  try {
    payload = JSON.parse(payloadJson);
  } catch {
    throw new Error('The reviewed action payload is invalid.');
  }
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  const record = payload as Record<string, unknown>;
  if (record.source !== 'agentReviewQueue') return null;
  const provenance = record.provenance;
  if (!provenance || typeof provenance !== 'object' || Array.isArray(provenance)
    || (provenance as Record<string, unknown>).origin !== 'aiAssistant') return null;
  const proposalItem = record.proposalValidationItem;
  if (!proposalItem || typeof proposalItem !== 'object' || Array.isArray(proposalItem)) {
    throw new Error('This AI proposal is missing its mutation-boundary validation proof.');
  }
  return proposalItem as AgentPlanItem;
}

function assertAgentProposalReadyForMutation(input: {
  item: AgentPlanItem;
  accountId: string;
  threadId: string;
  action: AgentActionProposalMutationAction;
  labelId?: string | null;
  reminderAt?: string | null;
  allowOptimisticState?: boolean;
}): void {
  const validation = validateAgentActionProposalMutation(input);
  if (!validation.valid) throw new Error(validation.message);
}

function assertLabelProposalReadyForMutation(
  payloadJson: string | undefined,
  accountId: string,
  threadId: string,
  addLabelIds: string[],
  removeLabelIds: string[],
  actionKind: string,
): void {
  const item = proposalItemFromActionPayload(payloadJson);
  if (!item) return;

  if (actionKind === 'markDone'
    && addLabelIds.length === 0
    && removeLabelIds.length === 1
    && removeLabelIds[0] === 'INBOX') {
    assertAgentProposalReadyForMutation({ item, accountId, threadId, action: 'archive' });
    return;
  }
  if (actionKind === 'applyLabel'
    && addLabelIds.length === 1
    && removeLabelIds.length === 0) {
    assertAgentProposalReadyForMutation({
      item,
      accountId,
      threadId,
      action: 'applyLabel',
      labelId: addLabelIds[0],
    });
    return;
  }
  throw new Error('The requested mailbox mutation does not match the reviewed AI proposal.');
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
    source: 'mailRule',
    ruleId: effect.rule.id,
    ruleTitle: effect.rule.title,
    mode: 'active',
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
    for (const effect of evaluateShadowMailRules(thread, settings)) {
      if (!ActionLogRepo.get(effect.actionId)) {
        ActionLogRepo.save(buildMailRuleShadowLog(effect, thread));
      }
    }
    for (const effect of evaluateMailRules(thread, settings)) {
      await applyMailRuleEffect(thread, effect);
    }
  }
}

registerSecureHandler('api:modifyLabels', async (_, email, threadId, addLabelIds, removeLabelIds, actionId?: string, actionKind?: string, payloadJson?: string) => {
  const resolvedKind = actionKind || inferLabelActionKind(addLabelIds, removeLabelIds);
  assertLabelProposalReadyForMutation(payloadJson, email, threadId, addLabelIds, removeLabelIds, resolvedKind);
  // 1. Optimistically write to local SQLite database first for instant persistence
  ThreadsRepo.updateLabels(email, threadId, addLabelIds, removeLabelIds);
  
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
  if (!draft || typeof draft.accountId !== 'string'
    || draft.accountId.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new Error('Draft account does not match the sending account.');
  }
  const placeholderError = replyDraftPlaceholderValidationMessage(
    typeof draft.bodyPlain === 'string' ? draft.bodyPlain : '',
    typeof draft.bodyHtml === 'string' ? draft.bodyHtml : null,
  );
  if (placeholderError) throw new Error(placeholderError);
  try {
    const threadId = await GmailSyncService.sendDraft(email, draft);
    if (draft?.id) {
      const state = ReplyPipelineService.markSentByDraftBestEffort(email, draft.id);
      if (state) notifyReplyPipelineUpdated(state.accountId, state.threadId);
    }
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
registerSecureHandler('api:validateAgentActionProposal', (_, item: AgentPlanItem) => validateAgentActionProposalItem(item));
registerSecureHandler('api:getThreadAgentInsights', async (_, accountId, threadId) => {
  const messages = await databaseWorkerClient.listMessageMetadataForThread(accountId, threadId);
  return AgenticService.getThreadInsights(accountId, threadId, messages);
});
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
    return {
      status: 'error',
      results: [],
      coverage: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    };
  }
});
registerSecureHandler('api:unsubscribeThread', async (_, email, threadId, actionId?: string, sourceMessageId?: string) => {
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
    const result = await AgenticService.unsubscribeThread(email, threadId, sourceMessageId);
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
registerSecureHandler('api:listCleanupSenderStats', (_, accountId: string) => databaseWorkerClient.senderCleanupStats(accountId));
registerSecureHandler('api:listRecentSenderMessages', (_, accountId: string, senderEmail: string, limit = 3) =>
  databaseWorkerClient.recentSenderMessages(accountId, senderEmail, limit));
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

let mailboxSyncWorkerActive = false;
let agenticWorkerActive = false;
let reminderWorkerActive = false;
const activeBackfillAccounts = new Set<string>();
const mailboxSyncInFlight = new Map<string, Promise<MailboxDelta>>();
let mailboxSyncRevision = 0;

function publishMailboxDelta(
  accountId: string,
  upserts: MailThread[],
  deletedThreadIds: string[],
): MailboxDelta {
  const delta: MailboxDelta = {
    accountId,
    upserts,
    deletedThreadIds: Array.from(new Set(deletedThreadIds)),
    revision: ++mailboxSyncRevision,
    completedAt: new Date().toISOString(),
  };
  mainWindow?.webContents.send('api:mailboxDelta', delta);
  return delta;
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
    if (page.threads.length > 0) {
      publishMailboxDelta(email, page.threads, []);
    }

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

async function performMailboxSyncForAccount(email: string): Promise<MailboxDelta> {
  const syncState = SyncStateRepo.get(email);
  const upserts: MailThread[] = [];
  const deletedThreadIds: string[] = [];

  if (!syncState?.historyId) {
    const fullSync = await GmailSyncService.syncInbox(email);
    await saveThreadsToDatabase(fullSync.threads);
    await saveMessagesToDatabase(fullSync.messages);
    SyncStateRepo.save(nextSyncState(email, syncState, fullSync.historyId, new Date().toISOString()));
    upserts.push(...fullSync.threads);
    return publishMailboxDelta(email, upserts, deletedThreadIds);
  }

  try {
    const incrementalSync = await GmailSyncService.syncIncremental(email, syncState.historyId);

    for (const threadId of incrementalSync.updatedThreadIds) {
      try {
        const messages = await GmailSyncService.fetchThreadDetail(email, threadId);
        await saveMessagesToDatabase(messages, { notifyOfNew: true });

        const thread = buildMailThreadFromMessages(email, threadId, messages);
        if (thread) {
          await saveThreadsToDatabase([thread]);
          upserts.push(thread);
        }
      } catch (err: any) {
        console.warn(`[Mailbox Sync] Failed to fetch thread detail for ${threadId}:`, err);
        if (err.message?.includes('not found') || err.message?.includes('404')) {
          ThreadsRepo.delete(email, threadId);
          deletedThreadIds.push(threadId);
        }
      }
    }

    for (const threadId of incrementalSync.deletedThreadIds) {
      ThreadsRepo.delete(email, threadId);
      deletedThreadIds.push(threadId);
    }

    SyncStateRepo.save(nextSyncState(email, syncState, incrementalSync.historyId));
  } catch (err: any) {
    if (err.message === 'HISTORY_EXPIRED') {
      const fullSync = await GmailSyncService.syncInbox(email);
      await saveThreadsToDatabase(fullSync.threads);
      await saveMessagesToDatabase(fullSync.messages);
      SyncStateRepo.save(nextSyncState(email, syncState, fullSync.historyId, new Date().toISOString()));
      upserts.push(...fullSync.threads);
      return publishMailboxDelta(email, upserts, deletedThreadIds);
    }
    throw err;
  }

  return publishMailboxDelta(email, upserts, deletedThreadIds);
}

function runMailboxSyncForAccount(email: string): Promise<MailboxDelta> {
  const existing = mailboxSyncInFlight.get(email);
  if (existing) return existing;

  const task = performMailboxSyncForAccount(email).finally(() => {
    if (mailboxSyncInFlight.get(email) === task) {
      mailboxSyncInFlight.delete(email);
    }
  });
  mailboxSyncInFlight.set(email, task);
  return task;
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

/** Decode Gmail base64url payloads and standard base64 (inline parts). */
function decodeAttachmentBase64(data: string): Buffer {
  const trimmed = (data || '').trim();
  if (!trimmed) return Buffer.alloc(0);
  // Gmail attachment API returns base64url; Node accepts it via 'base64url'.
  // Also tolerate standard base64 (inline MIME parts converted earlier).
  if (trimmed.includes('-') || trimmed.includes('_')) {
    return Buffer.from(trimmed, 'base64url');
  }
  return Buffer.from(trimmed, 'base64');
}

function readConfiguredAttachmentDownloadFolder(): string {
  try {
    const raw = SettingsRepo.get('appSettings');
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const folder = parsed?.general?.attachmentDownloadFolder;
    return typeof folder === 'string' ? folder.trim() : '';
  } catch {
    return '';
  }
}

function isAllowedAttachmentDownloadDir(dir: string): boolean {
  if (typeof dir !== 'string' || !dir.trim()) return false;
  if (!path.isAbsolute(dir)) return false;
  try {
    const resolved = path.resolve(dir);
    // Reject exotic absolute forms that are not real local directories.
    if (resolved.startsWith('\\\\') || /^[a-zA-Z]+:\/\//.test(dir)) return false;
    return fs.existsSync(resolved) && fs.statSync(resolved).isDirectory();
  } catch {
    return false;
  }
}

function resolveAttachmentDownloadDir(): string {
  const configured = readConfiguredAttachmentDownloadFolder();
  if (configured && isAllowedAttachmentDownloadDir(configured)) {
    return path.resolve(configured);
  }
  return app.getPath('downloads');
}

/** Best-effort Gatekeeper quarantine so opened/saved mail files behave like browser downloads. */
function applyDownloadQuarantine(filePath: string): void {
  if (process.platform !== 'darwin') return;
  try {
    // flags;timestamp_hex;agent-name; (LS_QUARANTINE_FLAG_DOWNLOAD | USER)
    const value = `0081;${Math.floor(Date.now() / 1000).toString(16)};Dumka Mail;`;
    execFileSync('xattr', ['-w', 'com.apple.quarantine', value, filePath], {
      stdio: 'ignore',
      timeout: 2000,
    });
  } catch {
    // Non-fatal: missing xattr tooling or SIP-restricted tmp paths.
  }
}

function allocatePathInDir(dir: string, filename: string): string {
  fs.mkdirSync(dir, { recursive: true });
  let existing: string[] = [];
  try {
    existing = fs.readdirSync(dir);
  } catch {
    existing = [];
  }
  const names = new Set(existing.map(name => name.toLowerCase()));
  const unique = allocateUniqueFilename(names, filename);
  return path.join(dir, unique);
}

async function loadAttachmentBuffer(
  email: string,
  messageId: string,
  attachmentId: string,
  inlineBase64?: string | null,
): Promise<Buffer> {
  if (inlineBase64) {
    const buf = decodeAttachmentBase64(inlineBase64);
    if (buf.length > 0) return buf;
  }
  if (!attachmentId) {
    throw new Error('Attachment payload is missing (no attachment id or inline data).');
  }
  const remote = await GmailSyncService.fetchAttachment(email, messageId, attachmentId);
  const buf = decodeAttachmentBase64(remote);
  if (buf.length === 0) {
    throw new Error('Attachment payload was empty.');
  }
  return buf;
}
