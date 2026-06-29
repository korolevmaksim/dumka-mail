import React, { createContext, useContext, useCallback } from 'react';
import { Account, MailThread, MailMessage, Draft, MailActionLog, AIConversation, AIChatMessage, AIProviderPreference, AIProviderDescriptor, CustomClassifierRule, TabCategory, AppSettings, MailTriageActionPreview, MailTriagePlanItem, MailTriagePlan, AIAction, MCPServerConfig, MailTriageQueueReadiness, GmailSignatureSyncResult } from '../../../shared/types';
import { getAIProviderConfig, isConfigurableAIProvider } from '../../../shared/aiProviders';
import { SplitInboxKind } from '../../../shared/classifier';
import { useSettingsState } from './useSettingsState';
import { useMailState } from './useMailState';
import { useDraftsState } from './useDraftsState';
import { useAIState } from './useAIState';

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

export const SETTINGS_SCHEMA_VERSION = 6;

export const DEFAULT_SETTINGS: AppSettings = {
  settingsSchemaVersion: SETTINGS_SCHEMA_VERSION,
  profile: {
    fullName: 'Max Korolyov',
    role: '',
    company: '',
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  },
  general: {
    startupBehavior: 'inbox',
    defaultSplitInbox: 'important',
    showBottomShortcutBar: true,
    showRightContextPanel: true,
    openLinksInBackground: true,
    confirmBeforeQuitting: true,
    keepDraftsAcrossLaunches: true
  },
  inbox: {
    enableSplitInbox: true,
    showUnreadFirst: true,
    autoMarkReadOnOpen: true,
    openNextThreadAfterDone: true,
    archiveOnDoneShortcut: true,
    enableReminders: true,
    enableFollowUps: true,
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
    defaultSnippet: 'Thanks, Max'
  },
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
    fallback: {
      isEnabled: true,
      orderText: 'openai, anthropic, gemini, openrouter, deepseek'
    },
    providerConfigurations: [
      { id: 'openAI', provider: 'openAI', displayName: 'OpenAI', defaultModel: 'gpt-4o-mini', modelSelectionMode: 'catalog', baseURL: '', isEnabled: true, canRemove: false },
      { id: 'anthropic', provider: 'anthropic', displayName: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
      { id: 'gemini', provider: 'gemini', displayName: 'Gemini', defaultModel: 'gemini-3.5-flash', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
      { id: 'openRouter', provider: 'openRouter', displayName: 'OpenRouter', defaultModel: '~openai/gpt-latest', modelSelectionMode: 'catalog', baseURL: 'https://openrouter.ai/api/v1', isEnabled: false, canRemove: false },
      { id: 'deepSeek', provider: 'deepSeek', displayName: 'DeepSeek', defaultModel: 'deepseek-chat', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
      { id: 'openAICompatible', provider: 'openAICompatible', displayName: 'Local Model', defaultModel: 'local-mail-model', modelSelectionMode: 'custom', baseURL: 'http://localhost:11434/v1', isEnabled: false, canRemove: false }
    ],
    replyTone: 'direct',
    allowMailBodyContext: true,
    savePromptHistory: false,
    suggestDrafts: true,
    suggestAutoArchive: true,
    suggestLabels: true,
    translationEnabled: true,
    personalizationNotes: ''
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

interface AppStoreContextType {
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
  openThread: (thread: MailThread | null) => Promise<void>;
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
  searchCoverage: string;
  actionLog: MailActionLog[];
  executeMailAction: (kind: MailActionLog['kind'], threadId?: string | null, draftId?: string | null, customAction?: () => Promise<any>) => Promise<void>;
  undoLastAction: () => Promise<void>;
  snoozeThread: (thread: MailThread, date: Date) => Promise<void>;
  clearThreadReminder: (thread: MailThread) => Promise<void>;
  activeDraft: Draft | null;
  setActiveDraft: (d: Draft | null) => void;
  composeLayout: 'inline' | 'floating';
  setComposeLayout: (layout: 'inline' | 'floating') => void;
  draftsList: Draft[];
  startNewDraft: (accountId?: string | null) => Draft | null;
  saveDraftLocally: (body: string, to: string, subject: string) => Promise<void>;
  startReply: (message: MailMessage, replyAll?: boolean) => void;
  startForward: (message: MailMessage) => void;
  updateDraft: (patch: Partial<Draft>) => void;
  updateDraftBody: (body: string, bodyHtml?: string | null) => void;
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
  runAITriagePlan: () => Promise<void>;
  triagePlan: MailTriagePlan | null;
  setTriagePlan: (plan: MailTriagePlan | null) => void;
  aiPanelLoading: boolean;
  settingsOpen: boolean;
  setSettingsOpen: (open: boolean) => void;
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
  executeBatchMailAction: (kind: 'markRead' | 'markUnread' | 'markDone', threadIds: string[]) => Promise<void>;
  selectedTriageThreadIds: Set<string>;
  toggleTriagePlanItemSelection: (threadId: string) => void;

  selectAllApplicableTriagePlanItems: () => void;
  clearTriagePlanSelection: () => void;
  applySelectedTriagePlanItems: () => Promise<void>;
  applyTriagePlanItem: (item: MailTriagePlanItem, queuedActionLog?: any) => Promise<void>;
  triageQueueReadiness: MailTriageQueueReadiness | null;
  triageActionPreview: (item: MailTriagePlanItem) => MailTriageActionPreview;
}

const AppStoreContext = createContext<AppStoreContextType | null>(null);

export const AppStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const settingsState = useSettingsState();

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
  
  const mailState = useMailState({
    customClassifierRules: settingsState.customClassifierRules,
    tabCategories: settingsState.tabCategories,
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
    setThreads: mailState.setThreads,
    executeMailAction: mailState.executeMailAction,
    setSpeedProof: mailState.setSpeedProof
  });

  const fetchModelsForProvider = async (provider: string) => {
    let key = '';
    let baseUrl = '';
    
    if (isConfigurableAIProvider(provider)) {
      const providerConfig = getAIProviderConfig(provider);
      key = settingsState.customEnv[providerConfig.apiKeyEnv] || '';
      baseUrl = settingsState.customEnv[providerConfig.baseUrlEnv] || '';
    }
    
    return await window.electronAPI.listProviderModels(provider, key, baseUrl);
  };

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

  const storeValue: AppStoreContextType = {
    ...settingsState,
    ...mailState,
    ...draftsState,
    ...aiState,
    fetchModelsForProvider,
    syncGmailSignature
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
