import React, { createContext, useContext, useCallback, useEffect, useMemo, useState } from 'react';
import {
  Account,
  CalendarAttendeeResponse,
  CalendarEvent,
  CalendarEventCreateInput,
  CalendarEventDeleteOptions,
  CalendarEventUpdateInput,
  CalendarListEntry,
  CalendarFreeBusyRequest,
  CalendarFreeBusyResult,
  CalendarInvite,
  ContactCard,
  ContactGroup,
  MailLabelDefinition,
  NavigationActivity,
  GoogleIntegrationStatus,
  MailThread,
  MailMessage,
  Draft,
  MailActionLog,
  MailActionExecutionResult,
  AIConversation,
  AIChatMessage,
  AIProviderPreference,
  AIProviderDescriptor,
  AIPromptShortcut,
  CustomClassifierRule,
  TabCategory,
  AppSettings,
  MailTriagePlan,
  AgentPlan,
  AgentPlanItem,
  AgentPlanActionPreview,
  AgentPlanQueueReadiness,
  DailyBriefing,
  DailyBriefingBuildOptions,
  DailyBriefingItem,
  AIAction,
  MCPServerConfig,
  GmailSignatureSyncResult,
  MailboxView,
  ThreadAgentInsights,
  FollowUpRadarResult,
  FollowUpRadarItem,
  ReplyPipelineDraftResult,
  ReplyPipelineState,
  MailSyncCompletion,
  WorkspaceView
} from '../../../shared/types';
import { getAIProviderConfig, isConfigurableAIProvider } from '../../../shared/aiProviders';
import { getDefaultEmbeddingSettings } from '../../../shared/embeddingProviders';
import { DEFAULT_DAILY_BRIEFING_SETTINGS } from '../../../shared/dailyBriefing';
import { DEFAULT_MAIL_RULES_SETTINGS, normalizeMailRulesSettings } from '../../../shared/mailRules';
import { normalizeSnippetTemplates } from '../../../shared/snippets';
import { normalizeAppLanguage } from '../../../shared/i18n';
import { SplitInboxKind } from '../../../shared/classifier';
import { useSettingsState } from './useSettingsState';
import { useMailState } from './useMailState';
import { useDraftsState } from './useDraftsState';
import { useAIState } from './useAIState';
import { useReplyPipelineState } from './useReplyPipelineState';
import { useCalendarState, type CalendarEventRange } from './useCalendarState';
import { DUMKA_MUTED_LABEL_NAME } from '../../../shared/mailboxView';
import type { ThreadHeaderMessagesStatus } from '../lib/threadHeader';
import type { MailSearchState } from './mailSearchStatus';

export const UNIFIED_ACCOUNT: Account = {
  id: 'unified',
  email: 'unified',
  displayName: 'Unified Inbox',
  colorHex: '#3b82f6',
  createdAt: new Date().toISOString()
};

export const DEFAULT_CATEGORIES: TabCategory[] = [
  { id: 'important', displayName: 'Important', isSystem: true, active: true },
  { id: 'purchases', displayName: 'Purchases', isSystem: true, active: true },
  { id: 'linkedIn', displayName: 'LinkedIn', isSystem: true, active: true },
  { id: 'automation', displayName: 'Automation', isSystem: true, active: true },
  { id: 'other', displayName: 'Other', isSystem: true, active: true },
];

export const SETTINGS_SCHEMA_VERSION = 19;

export const DEFAULT_SETTINGS: AppSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  profile: {
    fullName: '',
    role: '',
    company: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  },
  general: {
    language: 'system',
    startupBehavior: 'inbox',
    defaultSplitInbox: 'important',
    showBottomShortcutBar: true,
    showRightContextPanel: true,
    openLinksInBackground: true,
    confirmBeforeQuitting: true,
    keepDraftsAcrossLaunches: true,
    attachmentDownloadFolder: '',
  },
  inbox: {
    enableSplitInbox: true,
    showUnreadFirst: true,
    autoMarkReadOnOpen: true,
    openNextThreadAfterDone: true,
    archiveOnDoneShortcut: true,
    enableReminders: true,
    enableFollowUps: true,
    followUpThresholdHours: 48,
    followUpMaxAgeDays: 30,
    followUpMaxItems: 12,
    followUpSnoozeHours: 24,
    showPurchasesSplit: true,
    showLinkedInSplit: true,
    showAutomationSplit: true,
    collapseReadThreads: false,
    categories: {
      builtIn: [
        { id: 'important', title: 'Important', isEnabled: true, matchMode: 'any', extraRules: [] },
        { id: 'purchases', title: 'Purchases', isEnabled: true, matchMode: 'any', extraRules: [] },
        { id: 'linkedIn', title: 'LinkedIn', isEnabled: true, matchMode: 'any', extraRules: [] },
        { id: 'automation', title: 'Automation', isEnabled: true, matchMode: 'any', extraRules: [] },
        { id: 'other', title: 'Other', isEnabled: true, matchMode: 'any', extraRules: [] }
      ],
      custom: []
    }
  },
  compose: {
    defaultSignature: '',
    defaultSignatureHtml: '',
    signatureFormat: 'plain',
    signaturesByAccount: {},
    autoSaveDrafts: true,
    spellCheck: true,
    autocorrect: true,
    smartCompose: true,
    alwaysReplyAll: false,
    sendUndoDelay: 10,
    defaultFontSize: 'normal'
  },
  calendar: {
    showAgendaInRightPanel: true,
    defaultMeetingDurationMinutes: 30,
    availabilityLookaheadDays: 5,
    availabilityStartTime: '09:00',
    availabilityEndTime: '17:00',
    availabilitySlotStepMinutes: 30,
    calendlyUrl: '',
    calComUrl: '',
    defaultConferenceProvider: 'googleMeet',
    defaultView: 'month',
    lastAnchorDate: '',
    lastAccountScope: 'unified',
    weekStartsOn: 1,
    showWeekends: true,
    showWeekNumbers: false,
    workingDays: [1, 2, 3, 4, 5],
    hiddenCalendarIds: [],
    defaultCalendarId: 'primary',
    defaultReminderMinutes: 10,
    secondaryTimeZone: '',
    favoriteTimeZones: [],
    defaultTravelTimeMinutes: 15,
    calendarSets: [],
    activeCalendarSetId: null,
    eventTemplates: [],
    hideNotificationDetails: false,
    mutedNotificationCalendarKeys: [],
  },
  shortcuts: {
    mode: 'superhuman',
    singleKeyShortcuts: true,
    commandPaletteEnabled: true,
    vimNavigation: false,
    composeShortcutEnabled: true,
    reminderShortcutEnabled: true
  },
  snippets: {
    enabled: true,
    expandWithTab: true,
    includeSignature: true,
    defaultSnippetTrigger: ';thanks',
    defaultSnippet: 'Thanks',
    templates: [
      {
        id: 'follow-up',
        title: 'Follow up',
        trigger: ';followup',
        body: 'Hi {first_name},\n\nFollowing up on this.',
        includeSignature: true,
      },
      {
        id: 'availability',
        title: 'Share availability',
        trigger: ';avail',
        body: 'Hi {first_name},\n\nHere are a few times that work for me:',
        includeSignature: true,
      },
    ],
  },
  mailRules: DEFAULT_MAIL_RULES_SETTINGS,
  notifications: {
    desktopNotifications: true,
    sound: false,
    notifyImportantOnly: false,
    reminderNotifications: true,
    quietHoursEnabled: false,
    quietHoursStart: '22:00',
    quietHoursEnd: '08:00'
  },
  ai: {
    provider: 'automatic',
    globalDefaultModel: '',
    automationModel: '',
    fallback: {
      isEnabled: true,
      orderText: 'openai, anthropic, gemini, openrouter, deepseek'
    },
    providerConfigurations: [
      { id: 'openAI', provider: 'openAI', displayName: 'OpenAI', defaultModel: getAIProviderConfig('openAI').defaultModel, modelSelectionMode: 'catalog', baseURL: getAIProviderConfig('openAI').defaultBaseUrl, isEnabled: true, canRemove: false },
      { id: 'anthropic', provider: 'anthropic', displayName: 'Anthropic', defaultModel: getAIProviderConfig('anthropic').defaultModel, modelSelectionMode: 'catalog', baseURL: getAIProviderConfig('anthropic').defaultBaseUrl, isEnabled: false, canRemove: false },
      { id: 'gemini', provider: 'gemini', displayName: 'Gemini', defaultModel: 'gemini-3.5-flash', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
      { id: 'openRouter', provider: 'openRouter', displayName: 'OpenRouter', defaultModel: '~openai/gpt-latest', modelSelectionMode: 'catalog', baseURL: 'https://openrouter.ai/api/v1', isEnabled: false, canRemove: false },
      { id: 'deepSeek', provider: 'deepSeek', displayName: 'DeepSeek', defaultModel: getAIProviderConfig('deepSeek').defaultModel, modelSelectionMode: 'catalog', baseURL: getAIProviderConfig('deepSeek').defaultBaseUrl, isEnabled: false, canRemove: false },
      { id: 'openAICompatible', provider: 'openAICompatible', displayName: 'Local Model', defaultModel: getAIProviderConfig('openAICompatible').defaultModel, modelSelectionMode: 'custom', baseURL: 'http://localhost:11434/v1', isEnabled: false, canRemove: false }
    ],
    promptShortcuts: [
      {
        id: 'explain-request',
        title: 'Explain Request',
        instruction: 'Read the selected email thread and explain plainly what the sender wants from me, who they are, why it matters, and the next action I should take. If the message is not in English, translate the relevant parts before explaining.',
        requiresThread: true
      }
    ],
    replyTone: 'direct',
    allowMailBodyContext: true,
    savePromptHistory: false,
    proactiveDraftsEnabled: false,
    semanticSearchEnabled: false,
    externalToolsEnabled: false,
    embeddings: getDefaultEmbeddingSettings(),
    agentRules: {
      proactiveDraftTrigger: 'directOrActionRequest',
      blockBulkAndAutomated: true,
      maxDraftSourceWords: 6000
    },
    dailyBriefing: { ...DEFAULT_DAILY_BRIEFING_SETTINGS },
    suggestDrafts: true,
    suggestAutoArchive: true,
    suggestLabels: true,
    translationEnabled: true,
    personalizationNotes: '',
    embeddingsByAccount: {},
    semanticSearchEnabledByAccount: {}
  },
  privacy: {
    loadRemoteImages: true,
    includeBodiesInSearchIndex: true,
    redactLogs: true,
    useKeychainForSecrets: true,
    clearCacheOnDisconnect: true,
    diagnosticsEnabled: false
  },
  appearance: {
    interfaceStyle: 'classic',
    theme: 'system',
    density: 'compact',
    accentColorHex: '#668FEA',
    showAvatars: true,
    useTranslucentPanels: false,
    enablePreviewPane: true,
    fontScale: 1.0,
    readerMaxWidth: 'standard'
  },
  mcpServers: [],
  searchProviders: {
    tavily: { enabled: false, apiKey: '' },
    brave: { enabled: false, apiKey: '' },
    perplexity: { enabled: false, apiKey: '' }
  }
};

function isPlainObject(v: any): v is Record<string, any> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base: any, override: any): any {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out: any = { ...base };
  for (const key of Object.keys(base)) {
    if (key in override) out[key] = deepMerge(base[key], override[key]);
  }
  for (const key of Object.keys(override)) {
    if (!(key in base)) out[key] = override[key];
  }
  return out;
}

export function mergeSettings(parsed: any): AppSettings {
  const merged = deepMerge(DEFAULT_SETTINGS, parsed || {}) as AppSettings;
  const parsedSchemaVersion = Number(parsed?.settingsSchemaVersion || 0);

  const defBuiltIn = DEFAULT_SETTINGS.inbox.categories.builtIn;
  const parsedBuiltIn: any[] = parsed?.inbox?.categories?.builtIn || [];
  merged.inbox.categories.builtIn = defBuiltIn.map(def => {
    const found = parsedBuiltIn.find((b: any) => b.id === def.id);
    return found ? deepMerge(def, found) : { ...def };
  });
  merged.inbox.categories.custom = parsed?.inbox?.categories?.custom || [];

  const defProviders = DEFAULT_SETTINGS.ai.providerConfigurations;
  const parsedProviders: any[] = parsed?.ai?.providerConfigurations || [];
  const baseIds = new Set(defProviders.map(p => p.id));
  const baseMerged = defProviders.map(def => {
    const found = parsedProviders.find((p: any) => p.id === def.id);
    return found ? deepMerge(def, found) : { ...def };
  });
  merged.ai.providerConfigurations = [...baseMerged, ...parsedProviders.filter((p: any) => !baseIds.has(p.id))];
  merged.ai.promptShortcuts = Array.isArray(merged.ai.promptShortcuts)
    ? merged.ai.promptShortcuts
        .filter((shortcut: AIPromptShortcut) => shortcut.id && shortcut.title && shortcut.instruction)
        .map((shortcut: AIPromptShortcut) => ({
          id: String(shortcut.id),
          title: String(shortcut.title),
          instruction: String(shortcut.instruction),
          requiresThread: shortcut.requiresThread !== false,
        }))
    : DEFAULT_SETTINGS.ai.promptShortcuts.map(shortcut => ({ ...shortcut }));
  merged.snippets.templates = normalizeSnippetTemplates(merged.snippets.templates);
  merged.mailRules = normalizeMailRulesSettings(merged.mailRules);
  merged.general.language = normalizeAppLanguage(merged.general.language);
  if (!['classic', 'soft'].includes(merged.appearance.interfaceStyle)) {
    merged.appearance.interfaceStyle = 'classic';
  }
  if (!['today', 'inbox', 'lastSelectedAccount', 'commandPalette'].includes(merged.general.startupBehavior)) {
    merged.general.startupBehavior = 'inbox';
  }

  if (parsedSchemaVersion < 6) {
    merged.notifications.notifyImportantOnly = false;
  }

  merged.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
}

interface SpeedProof {
  cacheReadyMs?: number;
  syncReadyMs?: number;
  searchMs?: number;
  aiMs?: number;
  detailCacheCoverage: string;
}

interface CalendarDraftSeed {
  summary: string;
  attendees: string[];
  sourceMessageId?: string | null;
  sourceThreadId?: string | null;
}

interface CalendarFocusRequest {
  accountId: string;
  eventId: string;
}

interface AppStoreContextType {
  settingsLoaded: boolean;
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  accounts: Account[];
  activeAccount: Account | null;
  setActiveAccount: (a: Account | null) => void;
  onboardAccount: (email: string) => Promise<void>;
  disconnectAccount: (id: string) => Promise<void>;
  threads: MailThread[];
  visibleThreads: MailThread[];
  focusedThreadId: string | null;
  setFocusedThreadId: (id: string | null) => void;
  openedThread: MailThread | null;
  openedThreadMessages: MailMessage[];
  openedThreadMessagesKey: string | null;
  openedThreadMessagesStatus: ThreadHeaderMessagesStatus;
  threadAgentInsights: ThreadAgentInsights | null;
  agentInsightsLoading: boolean;
  openThread: (thread: MailThread | null) => Promise<void>;
  refreshThreadAgentInsights: () => Promise<void>;
  dismissAgentDraftSuggestion: (id: string) => Promise<void>;
  markAgentDraftSuggestionApplied: (id: string) => Promise<void>;
  unsubscribeThread: (threadId?: string | null) => Promise<void>;
  mailboxView: MailboxView;
  setMailboxView: (view: MailboxView) => void;
  mailboxCounts: Record<MailboxView, number>;
  navigationActivity: NavigationActivity;
  activeSplit: SplitInboxKind;
  setActiveSplit: (s: SplitInboxKind) => void;
  splitCounts: Record<string, number>;
  tabCategories: TabCategory[];
  addTabCategory: (displayName: string, colorHex?: string, accountId?: string) => void;
  updateTabCategory: (id: string, updated: Partial<TabCategory>) => void;
  toggleTabCategory: (id: string, active: boolean) => void;
  deleteTabCategory: (id: string) => void;
  updateTabCategoriesOrder: (categories: TabCategory[]) => void;
  enablePreviewPane: boolean;
  setEnablePreviewPane: (val: boolean) => void;
  previewPaneWidth: number;
  setPreviewPaneWidth: (val: number) => void;
  customClassifierRules: CustomClassifierRule[];
  addCustomClassifierRule: (rule: Omit<CustomClassifierRule, 'id'>) => void;
  updateCustomClassifierRule: (id: string, updated: Partial<CustomClassifierRule>) => void;
  deleteCustomClassifierRule: (id: string) => void;
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchStatus: MailSearchState;
  searchTopCount: number;
  semanticMatchThreadIds: Set<string>;
  searchCoverage: string;
  googleIntegrationStatus: GoogleIntegrationStatus | null;
  labelDefinitions: MailLabelDefinition[];
  contacts: ContactCard[];
  contactGroups: ContactGroup[];
  calendarEvents: CalendarEvent[];
  calendarLists: CalendarListEntry[];
  calendarDraftSeed: CalendarDraftSeed | null;
  clearCalendarDraftSeed: () => void;
  startCalendarEventFromThread: (thread?: MailThread | null) => void;
  calendarFocusRequest: CalendarFocusRequest | null;
  clearCalendarFocusRequest: () => void;
  openCalendarEvent: (event: CalendarEvent) => void;
  authorizeGoogleIntegration: (integration: 'calendar' | 'contacts', email?: string) => Promise<void>;
  loadLabels: (email?: string) => Promise<MailLabelDefinition[]>;
  syncLabels: (email?: string) => Promise<void>;
  createLabel: (name: string, email?: string) => Promise<void>;
  updateLabel: (labelId: string, patch: Partial<MailLabelDefinition>, email?: string) => Promise<void>;
  deleteLabel: (labelId: string, email?: string) => Promise<void>;
  moveThreadToLabel: (labelId: string, threadId?: string | null, move?: boolean) => Promise<void>;
  muteThread: (threadId?: string | null) => Promise<void>;
  unmuteThread: (threadId?: string | null) => Promise<void>;
  syncContacts: (email?: string) => Promise<void>;
  updateContactLocal: (contactId: string, patch: Partial<ContactCard>, email?: string) => Promise<void>;
  saveContactGroup: (name: string, email?: string) => Promise<void>;
  renameContactGroup: (groupId: string, name: string, email?: string) => Promise<void>;
  deleteContactGroup: (groupId: string, email?: string) => Promise<void>;
  syncCalendarAgenda: (email?: string, range?: CalendarEventRange) => Promise<CalendarEvent[]>;
  syncCalendarLists: (email?: string) => Promise<CalendarListEntry[]>;
  queryCalendarFreeBusy: (input: CalendarFreeBusyRequest, email?: string) => Promise<CalendarFreeBusyResult>;
  respondToCalendarInvite: (invite: CalendarInvite, responseStatus: CalendarAttendeeResponse, email?: string) => Promise<void>;
  respondToCalendarEvent: (event: CalendarEvent, responseStatus: CalendarAttendeeResponse) => Promise<CalendarEvent>;
  addCalendarEvent: (invite: CalendarInvite, email?: string) => Promise<void>;
  createCalendarEvent: (input: CalendarEventCreateInput, email?: string) => Promise<CalendarEvent>;
  updateCalendarEvent: (input: CalendarEventUpdateInput, email?: string) => Promise<CalendarEvent>;
  deleteCalendarEvent: (event: CalendarEvent, email?: string, options?: CalendarEventDeleteOptions) => Promise<void>;
  resolveCalendarConflict: (action: MailActionLog, strategy: 'local' | 'remote') => Promise<void>;
  createGoogleMeetDraftEvent: () => Promise<CalendarEvent | null>;
  actionLog: MailActionLog[];
  followUpRadar: FollowUpRadarResult | null;
  followUpRadarLoading: boolean;
  followUpRadarError: string | null;
  loadFollowUpRadar: () => Promise<void>;
  dismissFollowUpRadarItem: (item: FollowUpRadarItem) => Promise<void>;
  snoozeFollowUpRadarItem: (item: FollowUpRadarItem, snoozedUntil: string) => Promise<void>;
  replyPipelineItems: ReplyPipelineState[];
  replyPipelineLoading: boolean;
  replyPipelineError: string | null;
  loadReplyPipeline: () => Promise<void>;
  prepareReplyPipelineDraft: (accountId: string, threadId: string) => Promise<ReplyPipelineDraftResult>;
  snoozeReplyPipelineItem: (item: ReplyPipelineState, snoozedUntil: string) => Promise<void>;
  suppressReplyPipelineItem: (item: ReplyPipelineState) => Promise<void>;
  resolveReplyPipelineItem: (item: ReplyPipelineState) => Promise<void>;
  executeMailAction: (kind: MailActionLog['kind'], threadId?: string | null, draftId?: string | null, customAction?: (actionId: string) => Promise<any>, payloadJson?: string | null) => Promise<MailActionExecutionResult>;
  undoLastAction: () => Promise<void>;
  snoozeThread: (thread: MailThread, date: Date) => Promise<void>;
  clearThreadReminder: (thread: MailThread) => Promise<void>;
  activeDraft: Draft | null;
  setActiveDraft: (d: Draft | null) => void;
  composeLayout: 'inline' | 'floating';
  setComposeLayout: (layout: 'inline' | 'floating') => void;
  draftsList: Draft[];
  loadDrafts: () => Promise<void>;
  startNewDraft: (accountId?: string | null, seed?: Partial<Pick<Draft, 'to' | 'cc' | 'bcc' | 'subject'>>) => Draft | null;
  saveDraftLocally: (body: string, to: string, subject: string) => Promise<void>;
  startReply: (message: MailMessage, replyAll?: boolean) => void;
  startReplyWithBody: (message: MailMessage, bodyPlain: string, replyAll?: boolean) => Draft | null;
  startForward: (message: MailMessage) => void;
  updateDraft: (patch: Partial<Draft>) => void;
  updateDraftBody: (body: string, bodyHtml?: string | null) => void;
  scheduleDraftSend: (date: Date) => Promise<void>;
  sendDraftWithUndo: () => Promise<void>;
  pendingSend: boolean;
  pendingSendSeconds: number;
  cancelPendingSend: () => void;
  addAttachmentToDraft: () => Promise<void>;
  removeAttachmentFromDraft: (id: string) => Promise<void>;
  discardDraft: (draftId: string) => Promise<void>;
  syncHealth: 'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect';
  syncStatusText: string;
  backfillProgress: string;
  triggerBackfillManual: () => Promise<void>;
  isSyncing: boolean;
  lastSuccessfulSync: MailSyncCompletion | null;
  triggerSyncManual: () => Promise<void>;
  syncGmailSignature: (email?: string) => Promise<GmailSignatureSyncResult>;
  aiPanelOpen: boolean;
  setAiPanelOpen: (open: boolean) => void;
  aiProvider: AIProviderPreference;
  setAiProvider: (pref: AIProviderPreference) => void;
  aiProviderDesc: AIProviderDescriptor | null;
  aiConversations: AIConversation[];
  activeAIConversation: AIConversation | null;
  activeAIMessages: AIChatMessage[];
  startNewAIConversation: () => void;
  selectAIConversation: (conv: AIConversation) => Promise<void>;
  sendAIMessage: (text: string) => Promise<void>;
  runAIAction: (action: AIAction) => Promise<void>;
  runAIPromptShortcut: (shortcut: AIPromptShortcut) => Promise<void>;
  runAITriagePlan: () => Promise<void>;
  runDailyBriefing: (options?: DailyBriefingBuildOptions, behavior?: { openPanel?: boolean; silent?: boolean; preserveOnError?: boolean; autoRefreshWindowKey?: string }) => Promise<boolean>;
  dismissDailyBriefingItem: (itemOrThreadId: DailyBriefingItem | string) => void;
  addDailyBriefingItemToAgentPlan: (item: DailyBriefingItem, labelId?: string | null) => void;
  addAgentPlanItems: (items: AgentPlanItem[]) => void;
  triagePlan: MailTriagePlan | null;
  setTriagePlan: (plan: MailTriagePlan | null) => void;
  agentPlan: AgentPlan | null;
  setAgentPlan: (plan: AgentPlan | null) => void;
  dailyBriefing: DailyBriefing | null;
  setDailyBriefing: (briefing: DailyBriefing | null) => void;
  dailyBriefingLoading: boolean;
  aiPanelLoading: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
  cleanupOpen: boolean;
  setCleanupOpen: (open: boolean) => void;
  workspaceView: WorkspaceView;
  setWorkspaceView: (view: WorkspaceView) => void;
  /** When non-null, user-initiated thread close restores this workspace (Today / Follow-up Radar). */
  returnWorkspaceView: Exclude<WorkspaceView, 'mail'> | null;
  /**
   * Enter mail workspace while remembering Today as the back target.
   * Use before openThread when the open path is not openThreadFromToday itself.
   */
  beginTodayThreadNavigation: () => void;
  /** Open a thread from Today surfaces; Back/Escape returns to Today. */
  openThreadFromToday: (thread: MailThread) => Promise<void>;
  openThreadFromCalendar: (thread: MailThread) => Promise<void>;
  /** Close the opened thread and restore returnWorkspaceView when present. */
  closeOpenedThread: () => Promise<void>;
  aiModel: string;
  setAiModel: (model: string) => void;
  customEnv: Record<string, string>;
  loadAIConfig: () => Promise<void>;
  saveAIConfig: (config: Record<string, string>) => Promise<void>;
  fetchModelsForProvider: (provider: string) => Promise<string[]>;
  modelsCache: Record<string, string[]>;
  verifyConnectionAndFetchModels: (provider: string, apiKey: string, baseUrl?: string) => Promise<string[]>;
  verifyMCPServer: (config: MCPServerConfig) => Promise<{ success: boolean; toolsCount?: number; error?: string }>;
  speedProof: SpeedProof;
  triggerVisibleBodyRepair: () => Promise<void>;
  settings: AppSettings;
  updateSettings: (updater: (s: AppSettings) => void) => Promise<void>;
  selectedThreadIds: Set<string>;
  setSelectedThreadIds: (ids: Set<string>) => void;
  toggleThreadSelection: (threadId: string) => void;
  selectAllThreads: () => void;
  clearThreadSelection: () => void;
  executeBatchMailAction: (kind: 'markRead' | 'markUnread' | 'markDone' | 'moveToTrash' | 'restoreFromTrash' | 'reportSpam' | 'restoreFromSpam', threadIds: string[]) => Promise<void>;
  selectedAgentPlanItemIds: Set<string>;
  toggleAgentPlanItemSelection: (itemId: string) => void;

  selectAllApplicableAgentPlanItems: () => void;
  clearAgentPlanSelection: () => void;
  applySelectedAgentPlanItems: () => Promise<void>;
  applyAgentPlanItem: (item: AgentPlanItem) => Promise<void>;
  rejectAgentPlanItem: (itemId: string) => void;
  agentPlanQueueReadiness: AgentPlanQueueReadiness | null;
  agentPlanActionPreview: (item: AgentPlanItem) => AgentPlanActionPreview;
}

const AppStoreContext = createContext<AppStoreContextType | null>(null);

function replaceLabelsForAccount(
  current: MailLabelDefinition[],
  accountId: string,
  next: MailLabelDefinition[],
): MailLabelDefinition[] {
  const normalizedAccountId = accountId.trim().toLowerCase();
  return [
    ...current.filter(label => label.accountId.trim().toLowerCase() !== normalizedAccountId),
    ...next,
  ];
}

function sameStringList(left: string[] | undefined, right: string[]): boolean {
  return Array.isArray(left)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

export const AppStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settingsState = useSettingsState();
  const [googleIntegrationStatus, setGoogleIntegrationStatus] = useState<GoogleIntegrationStatus | null>(null);
  const [labelDefinitions, setLabelDefinitions] = useState<MailLabelDefinition[]>([]);
  const [contacts, setContacts] = useState<ContactCard[]>([]);
  const [contactGroups, setContactGroups] = useState<ContactGroup[]>([]);
  const [calendarDraftSeed, setCalendarDraftSeed] = useState<CalendarDraftSeed | null>(null);
  const [calendarFocusRequest, setCalendarFocusRequest] = useState<CalendarFocusRequest | null>(null);

  const applyGmailSignatureSyncResult = useCallback(async (result: GmailSignatureSyncResult) => {
    await settingsState.updateSettings(s => {
      const accountId = result.accountId.trim().toLowerCase();
      if (!accountId) return;

      s.compose.signaturesByAccount = {
        ...(s.compose.signaturesByAccount || {}),
        [accountId]: {
          signaturePlain: result.signaturePlain,
          signatureHtml: result.signatureHtml,
          signatureFormat: result.signatureHtml.trim() ? 'html' : 'plain',
          sourceEmail: result.sourceEmail,
          importedAt: result.importedAt,
        }
      };
    });
  }, [settingsState.updateSettings]);

  const mutedLabelIdsByAccount = useMemo(() => {
    const result: Record<string, string[]> = {};
    for (const label of labelDefinitions) {
      if (label.name.trim().toLowerCase() !== DUMKA_MUTED_LABEL_NAME.toLowerCase()) continue;
      const accountLabelIds = result[label.accountId] || [];
      accountLabelIds.push(label.id);
      result[label.accountId] = accountLabelIds;
    }
    return result;
  }, [labelDefinitions]);
  
  const mailState = useMailState({
    tabCategories: settingsState.tabCategories,
    categorySettings: settingsState.settings.inbox.categories,
    inboxSettings: settingsState.settings.inbox,
    privacySettings: settingsState.settings.privacy,
    labelDefinitions,
    mutedLabelIdsByAccount,
    applyGmailSignatureSyncResult,
  });

  const draftsState = useDraftsState({
    settings: settingsState.settings,
    accounts: mailState.accounts,
    activeAccount: mailState.activeAccount,
    openedThread: mailState.openedThread,
    openThread: mailState.openThread,
    executeMailAction: mailState.executeMailAction,
  });

  const aiState = useAIState({
    settings: settingsState.settings,
    accounts: mailState.accounts,
    activeAccount: mailState.activeAccount,
    openedThread: mailState.openedThread,
    openedThreadMessages: mailState.openedThreadMessages,
    visibleThreads: mailState.visibleThreads,
    activeSplit: mailState.activeSplit,
    threads: mailState.threads,
    labelDefinitions,
    lastSuccessfulSync: mailState.lastSuccessfulSync,
    openThread: mailState.openThread,
    startReplyWithBody: draftsState.startReplyWithBody,
    executeMailAction: mailState.executeMailAction,
    setSpeedProof: mailState.setSpeedProof
  });

  const replyPipelineState = useReplyPipelineState({
    accounts: mailState.accounts,
    activeAccount: mailState.activeAccount,
    dailyBriefing: aiState.dailyBriefing,
    followUpRadar: mailState.followUpRadar,
  });

  const primaryWorkspaceEmail = useMemo(() => {
    if (mailState.activeAccount && mailState.activeAccount.id !== 'unified') return mailState.activeAccount.email;
    return mailState.accounts[0]?.email || '';
  }, [mailState.activeAccount, mailState.accounts]);

  const calendarState = useCalendarState({
    primaryEmail: primaryWorkspaceEmail,
    activeDraft: draftsState.activeDraft,
    defaultMeetingDurationMinutes: settingsState.settings.calendar.defaultMeetingDurationMinutes,
    loadActionLog: mailState.loadActionLog,
    updateDraftBody: draftsState.updateDraftBody,
    onIntegrationStatus: setGoogleIntegrationStatus,
  });
  const {
    calendarEvents,
    calendarLists,
    syncCalendarAgenda,
    syncCalendarLists,
    queryCalendarFreeBusy,
    respondToCalendarInvite,
    respondToCalendarEvent,
    addCalendarEvent,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    resolveCalendarConflict,
    createGoogleMeetDraftEvent,
  } = calendarState;

  const loadWorkspaceCache = useCallback(async (email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) {
      setGoogleIntegrationStatus(null);
      setLabelDefinitions([]);
      setContacts([]);
      setContactGroups([]);
      calendarState.clearCalendarCache();
      return;
    }

    const [status, labels, contactList, groups] = await Promise.all([
      window.electronAPI.getGoogleIntegrationStatus(targetEmail),
      window.electronAPI.listLabels(targetEmail),
      window.electronAPI.listContacts(targetEmail),
      window.electronAPI.listContactGroups(targetEmail),
      calendarState.loadCachedRange(targetEmail),
    ]);
    setGoogleIntegrationStatus(status);
    setLabelDefinitions(current => replaceLabelsForAccount(current, targetEmail, labels));
    setContacts(contactList);
    setContactGroups(groups);
  }, [calendarState.clearCalendarCache, calendarState.loadCachedRange, primaryWorkspaceEmail]);

  useEffect(() => {
    void loadWorkspaceCache();
  }, [loadWorkspaceCache]);

  const loadLabels = useCallback(async (email?: string): Promise<MailLabelDefinition[]> => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) return [];
    const labels = await window.electronAPI.listLabels(targetEmail);
    setLabelDefinitions(current => replaceLabelsForAccount(current, targetEmail, labels));
    return labels;
  }, [primaryWorkspaceEmail]);

  const syncLabels = useCallback(async (email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) return;
    const labels = await window.electronAPI.syncLabels(targetEmail);
    setLabelDefinitions(current => replaceLabelsForAccount(current, targetEmail, labels));
  }, [primaryWorkspaceEmail]);

  const createLabel = useCallback(async (name: string, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    const trimmedName = name.trim();
    if (!targetEmail || !trimmedName) return;
    await window.electronAPI.createLabel(targetEmail, trimmedName);
    await syncLabels(targetEmail);
  }, [primaryWorkspaceEmail, syncLabels]);

  const updateLabel = useCallback(async (labelId: string, patch: Partial<MailLabelDefinition>, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail || !labelId) return;
    await window.electronAPI.updateLabel(targetEmail, labelId, patch);
    await syncLabels(targetEmail);
  }, [primaryWorkspaceEmail, syncLabels]);

  const deleteLabel = useCallback(async (labelId: string, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail || !labelId) return;
    await window.electronAPI.deleteLabel(targetEmail, labelId);
    await syncLabels(targetEmail);
  }, [primaryWorkspaceEmail, syncLabels]);

  const moveThreadToLabel = useCallback(async (labelId: string, threadId?: string | null, move = true) => {
    if (!labelId) return;
    await mailState.executeMailAction(move ? 'moveToLabel' : 'applyLabel', threadId, null, undefined, JSON.stringify({ labelId }));
    await loadWorkspaceCache();
  }, [loadWorkspaceCache, mailState.executeMailAction]);

  const muteThread = useCallback(async (threadId?: string | null) => {
    const thread = threadId ? mailState.threads.find(item => item.id === threadId) : mailState.openedThread;
    const targetEmail = thread?.accountId || primaryWorkspaceEmail;
    if (!targetEmail) return;
    let mutedLabel = labelDefinitions.find(
      label => label.accountId === targetEmail && label.name.toLowerCase() === DUMKA_MUTED_LABEL_NAME.toLowerCase()
    );
    if (!mutedLabel) {
      mutedLabel = await window.electronAPI.createLabel(targetEmail, DUMKA_MUTED_LABEL_NAME);
      await syncLabels(targetEmail);
    }
    await mailState.executeMailAction('muteThread', threadId, null, undefined, JSON.stringify({ labelId: mutedLabel.id, labelName: mutedLabel.name }));
  }, [labelDefinitions, mailState.executeMailAction, mailState.openedThread, mailState.threads, primaryWorkspaceEmail, syncLabels]);

  const unmuteThread = useCallback(async (threadId?: string | null) => {
    const thread = threadId ? mailState.threads.find(item => item.id === threadId) : mailState.openedThread;
    const targetEmail = thread?.accountId || primaryWorkspaceEmail;
    if (!targetEmail) return;
    const mutedLabel = labelDefinitions.find(
      label => label.accountId === targetEmail && label.name.toLowerCase() === DUMKA_MUTED_LABEL_NAME.toLowerCase()
    );
    if (!mutedLabel) return;
    await mailState.executeMailAction('unmuteThread', threadId, null, undefined, JSON.stringify({ labelId: mutedLabel.id, labelName: mutedLabel.name }));
  }, [labelDefinitions, mailState.executeMailAction, mailState.openedThread, mailState.threads, primaryWorkspaceEmail]);

  const syncContacts = useCallback(async (email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) return;
    const result = await window.electronAPI.syncContacts(targetEmail);
    setContacts(result.contacts);
    setContactGroups(result.groups);
    const status = await window.electronAPI.getGoogleIntegrationStatus(targetEmail);
    setGoogleIntegrationStatus(status);
  }, [primaryWorkspaceEmail]);

  const updateContactLocal = useCallback(async (contactId: string, patch: Partial<ContactCard>, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) return;
    await window.electronAPI.updateContactLocal(targetEmail, contactId, patch);
    setContacts(await window.electronAPI.listContacts(targetEmail));
  }, [primaryWorkspaceEmail]);

  const saveContactGroup = useCallback(async (name: string, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    const trimmed = name.trim();
    if (!targetEmail || !trimmed) return;
    await window.electronAPI.saveContactGroup({
      id: crypto.randomUUID(),
      accountId: targetEmail,
      name: trimmed,
      memberCount: 0,
      updatedAt: new Date().toISOString()
    });
    setContactGroups(await window.electronAPI.listContactGroups(targetEmail));
  }, [primaryWorkspaceEmail]);

  const renameContactGroup = useCallback(async (groupId: string, name: string, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    const trimmed = name.trim();
    const group = contactGroups.find(item => item.id === groupId && item.accountId === targetEmail);
    if (!targetEmail || !trimmed || !group) return;
    await window.electronAPI.saveContactGroup({
      ...group,
      name: trimmed,
      updatedAt: new Date().toISOString()
    });
    setContactGroups(await window.electronAPI.listContactGroups(targetEmail));
  }, [contactGroups, primaryWorkspaceEmail]);

  const deleteContactGroup = useCallback(async (groupId: string, email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail || !groupId) return;
    await window.electronAPI.deleteContactGroup(targetEmail, groupId);
    setContactGroups(await window.electronAPI.listContactGroups(targetEmail));
  }, [primaryWorkspaceEmail]);

  const authorizeGoogleIntegration = useCallback(async (integration: 'calendar' | 'contacts', email?: string) => {
    const targetEmail = email || primaryWorkspaceEmail;
    if (!targetEmail) {
      throw new Error('Connect a Gmail account before enabling Google integrations.');
    }
    const status = await window.electronAPI.authorizeGoogleIntegration(targetEmail, integration);
    setGoogleIntegrationStatus(status);
    if (integration === 'calendar') {
      await syncCalendarAgenda(targetEmail);
    } else {
      await syncContacts(targetEmail);
    }
  }, [primaryWorkspaceEmail, syncCalendarAgenda, syncContacts]);

  const fetchModelsForProvider = useCallback(async (provider: string) => {
    let key = '';
    let baseUrl = '';
    
    if (isConfigurableAIProvider(provider)) {
      const providerConfig = getAIProviderConfig(provider);
      key = settingsState.customEnv[providerConfig.apiKeyEnv] || '';
      baseUrl = settingsState.customEnv[providerConfig.baseUrlEnv] || '';
    }
    
    const models = await window.electronAPI.listProviderModels(provider, key, baseUrl);
    if (models.length > 0) {
      settingsState.setModelsCache(prev => {
        if (sameStringList(prev[provider], models)) return prev;
        const updated = { ...prev, [provider]: models };
        window.electronAPI.setSetting(`models_cache:${provider}`, JSON.stringify(models)).catch(err => {
          console.error(`Failed to save models_cache:${provider} to SQLite:`, err);
        });
        return updated;
      });
    }
    return models;
  }, [settingsState.customEnv, settingsState.setModelsCache]);

  const syncGmailSignature = async (email?: string): Promise<GmailSignatureSyncResult> => {
    const targetEmail = email
      || (mailState.activeAccount && mailState.activeAccount.id !== 'unified' ? mailState.activeAccount.email : null)
      || mailState.accounts[0]?.email;

    if (!targetEmail) {
      throw new Error('Connect a Gmail account before syncing the signature.');
    }

    const result = await window.electronAPI.syncGmailSignature(targetEmail);
    await applyGmailSignatureSyncResult(result);
    return result;
  };

  const startCalendarEventFromThread = useCallback((thread?: MailThread | null) => {
    const target = thread || mailState.openedThread;
    if (!target) return;
    const sourceMessage = [...mailState.openedThreadMessages].reverse().find(message => message.threadId === target.id);
    setCalendarDraftSeed({
      summary: `Meeting: ${target.subject}`,
      attendees: target.senderEmail ? [target.senderEmail] : [],
      sourceMessageId: sourceMessage?.id || null,
      sourceThreadId: target.id,
    });
    settingsState.setWorkspaceView('calendar');
    settingsState.setSettingsOpen(false);
    settingsState.setCleanupOpen(false);
  }, [mailState.openedThread, mailState.openedThreadMessages, settingsState.setCleanupOpen, settingsState.setSettingsOpen, settingsState.setWorkspaceView]);

  const openCalendarEvent = useCallback((event: CalendarEvent) => {
    setCalendarFocusRequest({ accountId: event.accountId, eventId: event.id });
    settingsState.setWorkspaceView('calendar');
    settingsState.setSettingsOpen(false);
    settingsState.setCleanupOpen(false);
  }, [settingsState.setCleanupOpen, settingsState.setSettingsOpen, settingsState.setWorkspaceView]);

  useEffect(() => window.electronAPI.onOpenCalendar(data => {
    if (data.eventId) setCalendarFocusRequest({ accountId: data.accountId, eventId: data.eventId });
    settingsState.setWorkspaceView('calendar');
    settingsState.setSettingsOpen(false);
    settingsState.setCleanupOpen(false);
  }), [settingsState.setCleanupOpen, settingsState.setSettingsOpen, settingsState.setWorkspaceView]);

  const beginTodayThreadNavigation = useCallback(() => {
    settingsState.setReturnWorkspaceView('today');
    settingsState.enterMailWorkspacePreservingReturn();
    settingsState.setSettingsOpen(false);
    settingsState.setCleanupOpen(false);
  }, [
    settingsState.enterMailWorkspacePreservingReturn,
    settingsState.setCleanupOpen,
    settingsState.setReturnWorkspaceView,
    settingsState.setSettingsOpen,
  ]);

  const openThreadFromToday = useCallback(async (thread: MailThread) => {
    beginTodayThreadNavigation();
    await mailState.openThread(thread);
  }, [beginTodayThreadNavigation, mailState.openThread]);

  const openThreadFromCalendar = useCallback(async (thread: MailThread) => {
    settingsState.setReturnWorkspaceView('calendar');
    settingsState.enterMailWorkspacePreservingReturn();
    settingsState.setSettingsOpen(false);
    settingsState.setCleanupOpen(false);
    await mailState.openThread(thread);
  }, [mailState.openThread, settingsState.enterMailWorkspacePreservingReturn, settingsState.setCleanupOpen, settingsState.setReturnWorkspaceView, settingsState.setSettingsOpen]);

  const closeOpenedThread = useCallback(async () => {
    const returnTo = settingsState.returnWorkspaceView;
    settingsState.setReturnWorkspaceView(null);
    await mailState.openThread(null);
    if (returnTo) {
      // return is already cleared; setWorkspaceView('today') only switches surface.
      settingsState.setWorkspaceView(returnTo);
    }
  }, [mailState.openThread, settingsState.returnWorkspaceView, settingsState.setReturnWorkspaceView, settingsState.setWorkspaceView]);

  const {
    enterMailWorkspacePreservingReturn: _enterMailWorkspacePreservingReturn,
    setReturnWorkspaceView: _setReturnWorkspaceView,
    ...publicSettingsState
  } = settingsState;

  const storeValue: AppStoreContextType = {
    ...publicSettingsState,
    ...mailState,
    ...draftsState,
    ...aiState,
    ...replyPipelineState,
    googleIntegrationStatus,
    labelDefinitions,
    contacts,
    contactGroups,
    calendarEvents,
    calendarLists,
    calendarDraftSeed,
    clearCalendarDraftSeed: () => setCalendarDraftSeed(null),
    startCalendarEventFromThread,
    calendarFocusRequest,
    clearCalendarFocusRequest: () => setCalendarFocusRequest(null),
    openCalendarEvent,
    authorizeGoogleIntegration,
    loadLabels,
    syncLabels,
    createLabel,
    updateLabel,
    deleteLabel,
    moveThreadToLabel,
    muteThread,
    unmuteThread,
    syncContacts,
    updateContactLocal,
    saveContactGroup,
    renameContactGroup,
    deleteContactGroup,
    syncCalendarAgenda,
    syncCalendarLists,
    queryCalendarFreeBusy,
    respondToCalendarInvite,
    respondToCalendarEvent,
    addCalendarEvent,
    createCalendarEvent,
    updateCalendarEvent,
    deleteCalendarEvent,
    resolveCalendarConflict,
    createGoogleMeetDraftEvent,
    fetchModelsForProvider,
    syncGmailSignature,
    beginTodayThreadNavigation,
    openThreadFromToday,
    openThreadFromCalendar,
    closeOpenedThread,
  };

  return (
    <AppStoreContext.Provider value={storeValue}>
      {children}
    </AppStoreContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error('useAppStore must be used inside AppStoreProvider');
  return context;
};
