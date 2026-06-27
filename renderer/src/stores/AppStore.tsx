import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { Account, MailThread, MailMessage, Draft, MailActionLog, AIConversation, AIChatMessage, AIProviderPreference, AIProviderDescriptor, CustomClassifierRule, TabCategory, AppSettings, MailTriageActionPreview, MailTriageQueueReadiness, MailTriagePlanItem, MailTriagePlan, CustomMailCategorySettings, MailCategoryRule, AutomationRulePreview, TriageRecommendation, AIAction } from '../../../shared/types';
import { SplitInboxRouter, SplitInboxKind, MailSignalClassifier } from '../../../shared/classifier';
import { parseSearchQuery } from '../../../shared/search';
import { buildThreadContext } from '../../../shared/aiContext';
import { startReply as buildReplySeed, startForward as buildForwardSeed } from '../../../shared/compose';
import { emitToast } from '../lib/toastBus';

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

interface SpeedProof {
  cacheReadyMs?: number;
  syncReadyMs?: number;
  searchMs?: number;
  aiMs?: number;
  detailCacheCoverage: string; // "100% detail / 100% bodies"
}

interface AppStoreContextType {
  theme: 'light' | 'dark' | 'system';
  setTheme: (t: 'light' | 'dark' | 'system') => void;
  
  // Accounts
  accounts: Account[];
  activeAccount: Account | null;
  setActiveAccount: (a: Account | null) => void;
  onboardAccount: (email: string) => Promise<void>;
  disconnectAccount: (id: string) => Promise<void>;

  // Mail List & Navigation
  threads: MailThread[];
  visibleThreads: MailThread[];
  focusedThreadId: string | null;
  setFocusedThreadId: (id: string | null) => void;
  openedThread: MailThread | null;
  openedThreadMessages: MailMessage[];
  openThread: (thread: MailThread | null) => Promise<void>;
  
  // Split Inbox
  activeSplit: SplitInboxKind;
  setActiveSplit: (s: SplitInboxKind) => void;
  splitCounts: Record<string, number>;

  // Tab Categories
  tabCategories: TabCategory[];
  addTabCategory: (displayName: string, colorHex?: string) => void;
  toggleTabCategory: (id: string, active: boolean) => void;
  deleteTabCategory: (id: string) => void;
  updateTabCategoriesOrder: (categories: TabCategory[]) => void;

  // Preview Pane Settings
  enablePreviewPane: boolean;
  setEnablePreviewPane: (val: boolean) => void;
  previewPaneWidth: number;
  setPreviewPaneWidth: (val: number) => void;

  // Custom Classifier Rules
  customClassifierRules: CustomClassifierRule[];
  addCustomClassifierRule: (rule: Omit<CustomClassifierRule, 'id'>) => void;
  updateCustomClassifierRule: (id: string, updated: Partial<CustomClassifierRule>) => void;
  deleteCustomClassifierRule: (id: string) => void;

  // Search
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  searchCoverage: string;

  // Actions
  actionLog: MailActionLog[];
  executeMailAction: (kind: MailActionLog['kind'], threadId?: string | null, draftId?: string | null, customAction?: () => Promise<any>) => Promise<void>;
  undoLastAction: () => Promise<void>;
  snoozeThread: (thread: MailThread, date: Date) => Promise<void>;
  clearThreadReminder: (thread: MailThread) => Promise<void>;
  
  // Compose / Drafts
  activeDraft: Draft | null;
  setActiveDraft: (d: Draft | null) => void;
  draftsList: Draft[];
  saveDraftLocally: (body: string, to: string, subject: string) => Promise<void>;
  startReply: (message: MailMessage, replyAll?: boolean) => void;
  startForward: (message: MailMessage) => void;
  updateDraftBody: (body: string) => void;
  sendDraftWithUndo: () => Promise<void>;
  pendingSend: boolean;
  pendingSendSeconds: number;
  cancelPendingSend: () => void;
  addAttachmentToDraft: () => Promise<void>;
  removeAttachmentFromDraft: (id: string) => Promise<void>;

  // Sync & Backfill
  syncHealth: 'ready' | 'syncing' | 'indexing' | 'paused' | 'failed' | 'reconnect';
  syncStatusText: string;
  backfillProgress: string;
  triggerBackfillManual: () => Promise<void>;
  isSyncing: boolean;
  triggerSyncManual: () => Promise<void>;

  // AI Panel
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

  // Settings & Config
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

  // Performance Telemetry
  speedProof: SpeedProof;
  triggerVisibleBodyRepair: () => Promise<void>;

  // Unified Settings Properties
  settings: AppSettings;
  updateSettings: (updater: (s: AppSettings) => void) => Promise<void>;
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

export const SETTINGS_SCHEMA_VERSION = 3;

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
    notifyImportantOnly: true,
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
      orderText: 'openai, anthropic, gemini, deepseek'
    },
    providerConfigurations: [
      { id: 'openAI', provider: 'openAI', displayName: 'OpenAI', defaultModel: 'gpt-4o-mini', modelSelectionMode: 'catalog', baseURL: '', isEnabled: true, canRemove: false },
      { id: 'anthropic', provider: 'anthropic', displayName: 'Anthropic', defaultModel: 'claude-3-5-sonnet-latest', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
      { id: 'gemini', provider: 'gemini', displayName: 'Gemini', defaultModel: 'gemini-3.5-flash', modelSelectionMode: 'catalog', baseURL: '', isEnabled: false, canRemove: false },
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
    fontScale: 1.0
  }
};

// ---- Forward-compatible settings load (ST-C20) ----
// Recursively fills any missing nested field from DEFAULT_SETTINGS so that adding
// a new settings key never silently drops on load, then rebuilds the fixed-shape
// collections (5 built-in categories + 5 base provider configs).
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

  merged.settingsSchemaVersion = SETTINGS_SCHEMA_VERSION;
  return merged;
}

export const AppStoreProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [selectedTriageThreadIds, setSelectedTriageThreadIds] = useState<Set<string>>(new Set());

  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [activeAccount, setActiveAccountState] = useState<Account | null>(null);
  
  const [threads, setThreads] = useState<MailThread[]>([]);
  const [visibleThreads, setVisibleThreads] = useState<MailThread[]>([]);
  const [focusedThreadId, setFocusedThreadId] = useState<string | null>(null);
  const [openedThread, setOpenedThread] = useState<MailThread | null>(null);
  const [openedThreadMessages, setOpenedThreadMessages] = useState<MailMessage[]>([]);

  const [activeSplit, setActiveSplitState] = useState<SplitInboxKind>('important');
  const setActiveSplit = (split: SplitInboxKind) => {
    setActiveSplitState(split);
    setOpenedThread(null);
    setOpenedThreadMessages([]);
    setFocusedThreadId(null);
  };
  const [splitCounts, setSplitCounts] = useState<Record<string, number>>({});

  const [enablePreviewPane, setEnablePreviewPaneState] = useState<boolean>(true);
  const setEnablePreviewPane = (val: boolean) => {
    setEnablePreviewPaneState(val);
    window.electronAPI.setSetting('enablePreviewPane', String(val)).catch(err => {
      console.error('Failed to save enablePreviewPane to SQLite:', err);
    });
  };

  const [previewPaneWidth, setPreviewPaneWidthState] = useState<number>(320);
  const setPreviewPaneWidth = (val: number) => {
    setPreviewPaneWidthState(val);
    window.electronAPI.setSetting('previewPaneWidth', String(val)).catch(err => {
      console.error('Failed to save previewPaneWidth to SQLite:', err);
    });
  };

  const [customClassifierRules, setCustomClassifierRulesState] = useState<CustomClassifierRule[]>([]);
  const saveRules = (rules: CustomClassifierRule[]) => {
    setCustomClassifierRulesState(rules);
    window.electronAPI.setSetting('customClassifierRules', JSON.stringify(rules)).catch(err => {
      console.error('Failed to save customClassifierRules to SQLite:', err);
    });
  };

  const [tabCategories, setTabCategoriesState] = useState<TabCategory[]>(DEFAULT_CATEGORIES);
  const saveTabCategories = (categories: TabCategory[]) => {
    setTabCategoriesState(categories);
    window.electronAPI.setSetting('tabCategories', JSON.stringify(categories)).catch(err => {
      console.error('Failed to save tabCategories to SQLite:', err);
    });
  };

  const [modelsCache, setModelsCache] = useState<Record<string, string[]>>({});

  const updateSettings = async (updater: (s: AppSettings) => void) => {
    setSettingsState(prev => {
      const copy = JSON.parse(JSON.stringify(prev));
      updater(copy);
      window.electronAPI.setSetting('appSettings', JSON.stringify(copy)).catch(err => {
        console.error('Failed to save appSettings to SQLite:', err);
      });
      
      // Synchronize states
      setThemeState(copy.appearance.theme);
      setEnablePreviewPaneState(copy.appearance.enablePreviewPane);
      
      const cats: TabCategory[] = copy.inbox.categories.builtIn.map((b: any) => ({
        id: b.id,
        displayName: b.title,
        isSystem: true,
        active: b.isEnabled
      })).concat(copy.inbox.categories.custom.map((c: any) => ({
        id: c.id,
        displayName: c.title,
        isSystem: false,
        active: c.isEnabled
      })));
      setTabCategoriesState(cats);
      
      const rules: CustomClassifierRule[] = [];
      copy.inbox.categories.builtIn.forEach((b: any) => {
        b.extraRules.forEach((r: any) => {
          rules.push({
            id: r.id,
            field: r.field === 'from' ? 'from' : 'subject',
            condition: r.operation,
            value: r.value,
            targetCategory: b.id,
            active: b.isEnabled
          });
        });
      });
      copy.inbox.categories.custom.forEach((c: any) => {
        c.rules.forEach((r: any) => {
          rules.push({
            id: r.id,
            field: r.field === 'from' ? 'from' : 'subject',
            condition: r.operation,
            value: r.value,
            targetCategory: c.id,
            active: c.isEnabled
          });
        });
      });
      setCustomClassifierRulesState(rules);
      
      setAiProviderState(copy.ai.provider);
      setAiModel(copy.ai.globalDefaultModel);
      
      return copy;
    });
  };

  useEffect(() => {
    async function loadSettingsFromSQLite() {
      try {
        let loaded: AppSettings = { ...DEFAULT_SETTINGS };
        const appSettingsStr = await window.electronAPI.getSetting('appSettings');
        if (appSettingsStr) {
          try {
            const parsed = JSON.parse(appSettingsStr);
            loaded = mergeSettings(parsed);
          } catch (e) {
            console.error('Failed to parse appSettings:', e);
          }
        } else {
          // Perform legacy migration
          const catValue = await window.electronAPI.getSetting('tabCategories');
          if (catValue) {
            try {
              const cats = JSON.parse(catValue) as TabCategory[];
              const customCats: CustomMailCategorySettings[] = [];
              const builtInCats = [...DEFAULT_SETTINGS.inbox.categories.builtIn];
              cats.forEach(c => {
                const b = builtInCats.find(bc => bc.id === c.id);
                if (b) {
                  b.title = c.displayName;
                  b.isEnabled = c.active;
                } else {
                  customCats.push({
                    id: c.id,
                    title: c.displayName,
                    isEnabled: c.active,
                    matchMode: 'any',
                    rules: []
                  });
                }
              });
              loaded.inbox.categories.builtIn = builtInCats;
              loaded.inbox.categories.custom = customCats;
            } catch {}
          }
          
          const rulesValue = await window.electronAPI.getSetting('customClassifierRules');
          if (rulesValue) {
            try {
              const rules = JSON.parse(rulesValue) as CustomClassifierRule[];
              rules.forEach(r => {
                const rule: MailCategoryRule = {
                  id: r.id,
                  field: r.field === 'from' ? 'from' : 'subject',
                  operation: r.condition,
                  value: r.value,
                  isNegated: false
                };
                const b = loaded.inbox.categories.builtIn.find(bc => bc.id === r.targetCategory);
                if (b) {
                  b.extraRules.push(rule);
                } else {
                  const c = loaded.inbox.categories.custom.find(cc => cc.id === r.targetCategory);
                  if (c) {
                    c.rules.push(rule);
                  }
                }
              });
            } catch {}
          }
          
          const enablePreviewValue = await window.electronAPI.getSetting('enablePreviewPane');
          if (enablePreviewValue !== null) {
            loaded.appearance.enablePreviewPane = enablePreviewValue !== 'false';
          }
          
          const themeValue = await window.electronAPI.getSetting('theme');
          if (themeValue === 'light' || themeValue === 'dark' || themeValue === 'system') {
            loaded.appearance.theme = themeValue;
          }
          
          // Save migrated settings
          await window.electronAPI.setSetting('appSettings', JSON.stringify(loaded));
        }

        setSettingsState(loaded);
        
        // Sync states to React hooks
        setThemeState(loaded.appearance.theme);
        setEnablePreviewPaneState(loaded.appearance.enablePreviewPane);
        
        const tabCats: TabCategory[] = loaded.inbox.categories.builtIn.map(b => ({
          id: b.id,
          displayName: b.title,
          isSystem: true,
          active: b.isEnabled
        })).concat(loaded.inbox.categories.custom.map(c => ({
          id: c.id,
          displayName: c.title,
          isSystem: false,
          active: c.isEnabled
        })));
        setTabCategoriesState(tabCats);
        
        const legacyRules: CustomClassifierRule[] = [];
        loaded.inbox.categories.builtIn.forEach(b => {
          b.extraRules.forEach(r => {
            legacyRules.push({
              id: r.id,
              field: r.field === 'from' ? 'from' : 'subject',
              condition: r.operation,
              value: r.value,
              targetCategory: b.id,
              active: b.isEnabled
            });
          });
        });
        loaded.inbox.categories.custom.forEach(c => {
          c.rules.forEach(r => {
            legacyRules.push({
              id: r.id,
              field: r.field === 'from' ? 'from' : 'subject',
              condition: r.operation,
              value: r.value,
              targetCategory: c.id,
              active: c.isEnabled
            });
          });
        });
        setCustomClassifierRulesState(legacyRules);
        
        setAiProviderState(loaded.ai.provider);
        setAiModel(loaded.ai.globalDefaultModel);

        const cache: Record<string, string[]> = {};
        const providers = ['openAI', 'anthropic', 'gemini', 'deepSeek', 'openAICompatible'];
        for (const p of providers) {
          const val = await window.electronAPI.getSetting(`models_cache:${p}`);
          if (val) {
            try {
              cache[p] = JSON.parse(val);
            } catch (e) {
              console.error(`Failed to parse models cache for ${p}:`, e);
            }
          }
        }
        setModelsCache(cache);
      } catch (err) {
        console.error('Failed to load settings from SQLite:', err);
      }
    }
    loadSettingsFromSQLite();
  }, []);

  const addCustomClassifierRule = (rule: Omit<CustomClassifierRule, 'id'>) => {
    const newRule: CustomClassifierRule = {
      ...rule,
      id: crypto.randomUUID()
    };
    saveRules([...customClassifierRules, newRule]);
  };

  const updateCustomClassifierRule = (id: string, updated: Partial<CustomClassifierRule>) => {
    const updatedRules = customClassifierRules.map(r => r.id === id ? { ...r, ...updated } : r);
    saveRules(updatedRules);
  };

  const deleteCustomClassifierRule = (id: string) => {
    saveRules(customClassifierRules.filter(r => r.id !== id));
  };

  const addTabCategory = (displayName: string, colorHex?: string) => {
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const id = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    const newCategory: TabCategory = {
      id,
      displayName,
      isSystem: false,
      colorHex: colorHex || '#8b5cf6',
      active: true,
    };
    saveTabCategories([...tabCategories, newCategory]);
  };

  const toggleTabCategory = (id: string, active: boolean) => {
    if (id === 'other') return;
    const updated = tabCategories.map(c => c.id === id ? { ...c, active } : c);
    saveTabCategories(updated);
    
    if (!active && activeSplit === id) {
      const nextActive = updated.find(c => c.active);
      if (nextActive) {
        setActiveSplit(nextActive.id);
      }
    }
  };

  const deleteTabCategory = (id: string) => {
    const category = tabCategories.find(c => c.id === id);
    if (!category || category.isSystem) return;
    
    const updated = tabCategories.filter(c => c.id !== id);
    saveTabCategories(updated);

    if (activeSplit === id) {
      const nextActive = updated.find(c => c.active);
      if (nextActive) {
        setActiveSplit(nextActive.id);
      } else {
        setActiveSplit('other');
      }
    }

    const updatedRules = customClassifierRules.map(rule => 
      rule.targetCategory === id ? { ...rule, targetCategory: 'other' } : rule
    );
    saveRules(updatedRules);
  };

  const updateTabCategoriesOrder = (categories: TabCategory[]) => {
    saveTabCategories(categories);
  };

  const getThreadCategory = useCallback((t: MailThread): string => {
    for (const rule of customClassifierRules) {
      if (!rule.active) continue;

      const category = tabCategories.find(c => c.id === rule.targetCategory);
      if (!category || !category.active) continue;

      let match = false;
      const val = rule.value.toLowerCase().trim();
      if (!val) continue;

      if (rule.field === 'from') {
        const fromStr = `${t.senderNames.join(' ')} ${t.senderEmail}`.toLowerCase();
        if (rule.condition === 'contains') match = fromStr.includes(val);
        else if (rule.condition === 'equals') match = t.senderEmail.toLowerCase() === val;
        else if (rule.condition === 'startsWith') match = t.senderEmail.toLowerCase().startsWith(val);
        else if (rule.condition === 'endsWith') match = t.senderEmail.toLowerCase().endsWith(val);
      } else if (rule.field === 'subject') {
        const subjectStr = t.subject.toLowerCase();
        if (rule.condition === 'contains') match = subjectStr.includes(val);
        else if (rule.condition === 'equals') match = subjectStr === val;
        else if (rule.condition === 'startsWith') match = subjectStr.startsWith(val);
        else if (rule.condition === 'endsWith') match = subjectStr.endsWith(val);
      }

      if (match) {
        return rule.targetCategory;
      }
    }

    const systemSplit = SplitInboxRouter.split(t);
    const systemTab = tabCategories.find(c => c.id === systemSplit);
    if (systemTab && systemTab.active) {
      return systemSplit;
    }
    return 'other';
  }, [customClassifierRules, tabCategories]);

  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchCoverage] = useState<string>('Local Cache');

  const [actionLog, setActionLog] = useState<MailActionLog[]>([]);
  const [draftsList, setDraftsList] = useState<Draft[]>([]);
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);

  const [pendingSend, setPendingSend] = useState<boolean>(false);
  const [pendingSendSeconds, setPendingSendSeconds] = useState<number>(0);
  const pendingSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDraftRef = useRef<Draft | null>(null);

  const [syncHealth, setSyncHealth] = useState<AppStoreContextType['syncHealth']>('ready');
  const [syncStatusText, setSyncStatusText] = useState<string>('Ready');
  const [backfillProgress, setBackfillProgress] = useState<string>('0%');

  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [aiProvider, setAiProviderState] = useState<AIProviderPreference>('automatic');
  const [aiProviderDesc, setAiProviderDesc] = useState<AIProviderDescriptor | null>(null);
  const [aiConversations, setAiConversations] = useState<AIConversation[]>([]);
  const [activeAIConversation, setActiveAIConversation] = useState<AIConversation | null>(null);
  const [activeAIMessages, setActiveAIMessages] = useState<AIChatMessage[]>([]);
  const [triagePlan, setTriagePlan] = useState<MailTriagePlan | null>(null);
  const [aiPanelLoading, setAiPanelLoading] = useState<boolean>(false);

  // New settings states
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [aiModel, setAiModel] = useState<string>('');
  const [customEnv, setCustomEnv] = useState<Record<string, string>>({});

  const [speedProof, setSpeedProof] = useState<SpeedProof>({
    detailCacheCoverage: '0% detail · 0% bodies'
  });

  const setTheme = (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    window.electronAPI.setSetting('theme', t).catch(err => {
      console.error('Failed to save theme to SQLite:', err);
    });
  };

  useEffect(() => {
    const applyTheme = () => {
      let resolvedTheme: 'light' | 'dark';
      if (theme === 'system') {
        const matches = window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = matches ? 'dark' : 'light';
      } else {
        resolvedTheme = theme;
      }
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    };

    applyTheme();

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const listener = () => {
        applyTheme();
      };
      mediaQuery.addEventListener('change', listener);
      return () => {
        mediaQuery.removeEventListener('change', listener);
      };
    }
    return () => {};
  }, [theme]);

  // Apply layout density (DS-C1): drives all --*-h / --row-px CSS variables.
  useEffect(() => {
    document.documentElement.setAttribute('data-density', settings.appearance.density);
  }, [settings.appearance.density]);

  // Apply runtime accent color (DS-C2): single hex for both themes.
  useEffect(() => {
    const hex = settings.appearance.accentColorHex;
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    document.documentElement.style.setProperty('--accent', valid ? hex : '#668FEA');
  }, [settings.appearance.accentColorHex]);

  // Apply translucent panels (DS-C4): gates the .panel-surface backdrop blur.
  useEffect(() => {
    document.documentElement.setAttribute('data-translucent', String(settings.appearance.useTranslucentPanels));
  }, [settings.appearance.useTranslucentPanels]);

  // Apply font scale (DS-C5): scales text only via root font-size, layout stays fixed.
  useEffect(() => {
    const raw = settings.appearance.fontScale ?? 1.0;
    const scale = Math.min(1.2, Math.max(0.85, raw));
    document.documentElement.style.setProperty('--font-scale', String(scale));
  }, [settings.appearance.fontScale]);

  // Resolve active AI provider descriptors
  useEffect(() => {
    window.electronAPI.getAIProviderDescriptor(aiProvider, aiModel || undefined).then(setAiProviderDesc);
  }, [aiProvider, aiModel]);

  // Synchronize model with provider default on provider change
  useEffect(() => {
    if (aiProviderDesc) {
      setAiModel(aiProviderDesc.model);
    }
  }, [aiProvider]);

  // Load configuration on mount
  useEffect(() => {
    loadAIConfig();
  }, []);

  const loadAIConfig = async () => {
    const config = await window.electronAPI.loadAIConfig();
    setCustomEnv(config);
  };

  const saveAIConfig = async (config: Record<string, string>) => {
    await window.electronAPI.saveAIConfig(config);
    setCustomEnv(config);
    const desc = await window.electronAPI.getAIProviderDescriptor(aiProvider, aiModel || undefined);
    setAiProviderDesc(desc);
  };

  const fetchModelsForProvider = async (provider: string) => {
    let key = '';
    let baseUrl = '';
    
    if (provider === 'openAI') {
      key = customEnv['OPENAI_API_KEY'] || '';
      baseUrl = customEnv['OPENAI_BASE_URL'] || '';
    } else if (provider === 'gemini') {
      key = customEnv['GEMINI_API_KEY'] || '';
      baseUrl = customEnv['GEMINI_BASE_URL'] || '';
    } else if (provider === 'deepSeek') {
      key = customEnv['DEEPSEEK_API_KEY'] || '';
      baseUrl = customEnv['DEEPSEEK_BASE_URL'] || '';
    } else if (provider === 'anthropic') {
      key = customEnv['ANTHROPIC_API_KEY'] || '';
      baseUrl = customEnv['ANTHROPIC_BASE_URL'] || '';
    } else if (provider === 'openAICompatible') {
      key = customEnv['OPENAI_COMPATIBLE_API_KEY'] || '';
      baseUrl = customEnv['OPENAI_COMPATIBLE_BASE_URL'] || '';
    }
    
    return await window.electronAPI.listProviderModels(provider, key, baseUrl);
  };

  const verifyConnectionAndFetchModels = async (provider: string, apiKey: string, baseUrl?: string): Promise<string[]> => {
    const models = await window.electronAPI.listProviderModels(provider, apiKey, baseUrl);
    if (!models || models.length === 0) {
      throw new Error(`Connection verification failed: No models returned from ${provider}.`);
    }

    setModelsCache(prev => {
      const updated = { ...prev, [provider]: models };
      window.electronAPI.setSetting(`models_cache:${provider}`, JSON.stringify(models)).catch(err => {
        console.error(`Failed to save models_cache:${provider} to SQLite:`, err);
      });
      return updated;
    });

    return models;
  };

  // Load accounts initially
  const loadAccounts = useCallback(async () => {
    const accList = await window.electronAPI.listAccounts();
    setAccounts(accList);
    if (accList.length > 0 && !activeAccount) {
      setActiveAccountState(accList[0]);
    }
  }, [activeAccount]);

  useEffect(() => {
    loadAccounts();
  }, [loadAccounts]);

  const setActiveAccount = (account: Account | null) => {
    setActiveAccountState(account);
    setOpenedThread(null);
    setOpenedThreadMessages([]);
    setFocusedThreadId(null);
    setSearchQuery('');
  };

  // Main threads load & sync loop
  const loadThreadsFromDB = useCallback(async () => {
    if (!activeAccount) return;
    const start = performance.now();
    
    let list: MailThread[] = [];
    if (activeAccount.id === 'unified') {
      const allThreads: MailThread[] = [];
      for (const acc of accounts) {
        const accThreads = await window.electronAPI.listThreads(acc.email);
        allThreads.push(...accThreads);
      }
      allThreads.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
      list = allThreads;
    } else {
      list = await window.electronAPI.listThreads(activeAccount.email);
    }
    
    setThreads(list);
    
    // Telemetry: Cache ready speed
    setSpeedProof(prev => ({
      ...prev,
      cacheReadyMs: Math.round(performance.now() - start)
    }));

    // Update body/detail metrics
    const total = list.length;
    if (total > 0) {
      // Calculate coverage
      const messages = await Promise.all(list.slice(0, 30).map(t => window.electronAPI.listMessagesForThread(t.accountId, t.id)));
      const detailHydrated = messages.filter(m => m.length > 0).length;
      const bodiesReady = messages.filter(m => m.some(msg => msg.bodyPlain || msg.bodyHtml)).length;
      
      const detailPct = Math.round((detailHydrated / Math.min(total, 30)) * 100);
      const bodyPct = Math.round((bodiesReady / Math.min(total, 30)) * 100);

      setSpeedProof(prev => ({
        ...prev,
        detailCacheCoverage: `${detailPct}% detail · ${bodyPct}% bodies`
      }));
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadThreadsFromDB();
  }, [loadThreadsFromDB]);

  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const isSyncingRef = useRef<boolean>(false);

  // Backfill background loader
  const triggerSilentBackfill = useCallback(async () => {
    if (!activeAccount || activeAccount.id === 'unified') return;
    const syncState = await window.electronAPI.getSyncState(activeAccount.email);
    if (syncState && syncState.historyBackfillCompletedAt) {
      setBackfillProgress('All mail indexed');
      return;
    }

    setSyncHealth('indexing');
    setSyncStatusText('Indexing older mail...');

    try {
      const page = await window.electronAPI.syncBackfillPage(activeAccount.email, syncState?.historyBackfillPageToken || undefined);
      
      await window.electronAPI.saveThreads(page.threads);
      await window.electronAPI.saveMessages(page.messages);

      const nextPagesSynced = (syncState?.historyBackfillPagesSynced || 0) + 1;
      const nextThreadsSynced = (syncState?.historyBackfillThreadsSynced || 0) + page.threads.length;

      await window.electronAPI.saveSyncState({
        accountId: activeAccount.email,
        historyId: syncState?.historyId || null,
        lastFullSyncAt: syncState?.lastFullSyncAt || null,
        historyBackfillPageToken: page.nextPageToken || null,
        historyBackfillCompletedAt: page.nextPageToken ? null : new Date().toISOString(),
        historyBackfillPagesSynced: nextPagesSynced,
        historyBackfillThreadsSynced: nextThreadsSynced
      });

      setBackfillProgress(`${nextThreadsSynced} threads indexed`);
      setSyncHealth('ready');
      setSyncStatusText('Ready');
    } catch (e: any) {
      console.error('Silent backfill page fetch failed:', e);
      setSyncHealth('paused');
      setSyncStatusText('Indexing paused');
    }
  }, [activeAccount]);

  const triggerBackfillManual = useCallback(async () => {
    await triggerSilentBackfill();
  }, [triggerSilentBackfill]);

  // Sync Inbox logic
  const runSync = useCallback(async (silent = false, forceFull = false) => {
    if (isSyncingRef.current || !activeAccount) return;
    isSyncingRef.current = true;
    setIsSyncing(true);

    if (!silent) {
      setSyncHealth('syncing');
      setSyncStatusText('Gmail Reconciliation...');
    }

    try {
      const start = performance.now();
      const targetAccounts = activeAccount.id === 'unified' ? accounts : [activeAccount];

      for (const acc of targetAccounts) {
        const syncState = await window.electronAPI.getSyncState(acc.email);
        
        let syncResult;
        if (syncState && syncState.historyId && !forceFull) {
          // Attempt incremental sync
          try {
            const incResult = await window.electronAPI.syncIncremental(acc.email, syncState.historyId);
            
            // Re-fetch only modified threads and insert both messages and thread metadata
            for (const tid of incResult.updatedThreadIds) {
              try {
                const msgs = await window.electronAPI.fetchThreadDetail(acc.email, tid);
                await window.electronAPI.saveMessages(msgs);

                if (msgs.length > 0) {
                  const lastMsg = msgs[msgs.length - 1];
                  const senderNames = Array.from(new Set(msgs.map(m => m.senderName || m.senderEmail)));
                  const thread = {
                    id: tid,
                    accountId: acc.email,
                    subject: lastMsg.subject || '',
                    snippet: lastMsg.snippet || '',
                    lastMessageAt: lastMsg.receivedAt,
                    senderNames,
                    senderEmail: lastMsg.senderEmail,
                    labelIds: Array.from(new Set(msgs.flatMap(m => m.labelIds))),
                    hasAttachments: msgs.some(m => m.hasAttachments),
                    isUnread: msgs.some(m => m.isUnread)
                  };
                  await window.electronAPI.saveThreads([thread]);
                }
              } catch (e: any) {
                console.warn(`Failed to fetch thread detail for ${tid} during incremental sync:`, e);
                // If thread is deleted from server (404/not found), clean it up locally
                if (e.message?.includes('not found') || e.message?.includes('404')) {
                  await window.electronAPI.deleteThread(acc.email, tid);
                }
              }
            }
            for (const tid of incResult.deletedThreadIds) {
              await window.electronAPI.deleteThread(acc.email, tid);
            }

            await window.electronAPI.saveSyncState({
              accountId: acc.email,
              historyId: incResult.historyId,
              lastFullSyncAt: syncState.lastFullSyncAt,
              historyBackfillPagesSynced: syncState.historyBackfillPagesSynced,
              historyBackfillThreadsSynced: syncState.historyBackfillThreadsSynced,
              historyBackfillPageToken: syncState.historyBackfillPageToken
            });
          } catch (e: any) {
            if (e.message === 'HISTORY_EXPIRED') {
              // History cursor invalid, fallback to full refresh
              syncResult = await window.electronAPI.syncInbox(acc.email);
            } else {
              throw e;
            }
          }
        } else {
          // Full refresh
          syncResult = await window.electronAPI.syncInbox(acc.email);
        }

        if (syncResult) {
          // Write to DB
          await window.electronAPI.saveThreads(syncResult.threads);
          await window.electronAPI.saveMessages(syncResult.messages);
          await window.electronAPI.saveSyncState({
            accountId: acc.email,
            historyId: syncResult.historyId,
            lastFullSyncAt: new Date().toISOString(),
            historyBackfillPagesSynced: 0,
            historyBackfillThreadsSynced: 0
          });
        }
      }

      await loadThreadsFromDB();
      setSyncHealth('ready');
      setSyncStatusText('Ready');
      setSpeedProof(prev => ({
        ...prev,
        syncReadyMs: Math.round(performance.now() - start)
      }));

      // Trigger background idle backfill page check
      if (activeAccount.id !== 'unified' && !silent) {
        triggerSilentBackfill();
      }
    } catch (err: any) {
      console.error('Inbox sync error:', err);
      setSyncHealth('failed');
      setSyncStatusText(err.message.includes('credentials') ? 'Reconnect Gmail' : 'Degraded sync');
    } finally {
      isSyncingRef.current = false;
      setIsSyncing(false);
    }
  }, [activeAccount, loadThreadsFromDB, accounts, triggerSilentBackfill]);

  // Sync Inbox on startup / account switch & periodically
  useEffect(() => {
    if (!activeAccount) return;
    
    // Run immediately on startup or switch (forces full sync of latest 30 threads for reconciliation)
    runSync(false, true);

    // Periodically sync new incoming mail every 60 seconds
    const intervalId = setInterval(() => {
      runSync(true);
    }, 60000);

    return () => {
      clearInterval(intervalId);
    };
  }, [activeAccount, runSync]);

  const triggerSyncManual = useCallback(async () => {
    await runSync(false, true); // Force full refresh on manual sync
  }, [runSync]);

  // Sync Drafts list
  const loadDrafts = useCallback(async () => {
    if (!activeAccount) return;
    if (activeAccount.id === 'unified') {
      const allDrafts: Draft[] = [];
      for (const acc of accounts) {
        const list = await window.electronAPI.listDrafts(acc.email);
        allDrafts.push(...list);
      }
      setDraftsList(allDrafts);
    } else {
      const list = await window.electronAPI.listDrafts(activeAccount.email);
      setDraftsList(list);
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // Sync Action Log
  const loadActionLog = useCallback(async () => {
    if (!activeAccount) return;
    if (activeAccount.id === 'unified') {
      const allLogs: MailActionLog[] = [];
      for (const acc of accounts) {
        const list = await window.electronAPI.listActionLog(acc.email);
        allLogs.push(...list);
      }
      allLogs.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      setActionLog(allLogs);
    } else {
      const list = await window.electronAPI.listActionLog(activeAccount.email);
      setActionLog(list);
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadActionLog();
  }, [loadActionLog]);

  // Sync AI conversations
  const loadAIConversations = useCallback(async () => {
    if (!activeAccount) return;
    if (activeAccount.id === 'unified') {
      const allConvs: AIConversation[] = [];
      for (const acc of accounts) {
        const list = await window.electronAPI.listConversations(acc.email);
        allConvs.push(...list);
      }
      allConvs.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
      setAiConversations(allConvs);
    } else {
      const list = await window.electronAPI.listConversations(activeAccount.email);
      setAiConversations(list);
    }
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadAIConversations();
  }, [loadAIConversations]);

  // Onboard new account
  const onboardAccount = async (emailHint: string) => {
    try {
      const { email, displayName, avatarUrl } = await window.electronAPI.onboardAccount(emailHint);
      
      const newAcc: Account = {
        id: email,
        email,
        displayName: displayName || email.split('@')[0],
        colorHex: '#' + Math.floor(Math.random()*16777215).toString(16),
        createdAt: new Date().toISOString(),
        avatarUrl: avatarUrl || undefined
      };

      await window.electronAPI.saveAccount(newAcc);
      await loadAccounts();
      setActiveAccountState(newAcc);
    } catch (e) {
      console.error('Account onboarding failed:', e);
      emitToast({ type: 'error', message: 'Google authentication failed. Please try again.' });
    }
  };

  // Disconnect account
  const disconnectAccount = async (id: string) => {
    await window.electronAPI.deleteAccount(id);
    loadAccounts();
    if (activeAccount?.id === id) {
      setActiveAccountState(null);
    }
  };

  // Visible Threads filtering based on Search Query and Split Tabs
  useEffect(() => {
    if (threads.length === 0 || !activeAccount) {
      setVisibleThreads([]);
      return;
    }

    const filterThreads = async () => {
      if (!activeAccount) return;
      let filtered = threads;

      // Handle search query
      if (searchQuery.trim()) {
        const parsed = parseSearchQuery(searchQuery);
        const start = performance.now();
        
        let ftsMatches: { threadId: string; messageId: string }[] = [];
        if (activeAccount.id === 'unified') {
          for (const acc of accounts) {
            const matches = await window.electronAPI.searchFTS(acc.email, parsed.textTerms.join(' '));
            ftsMatches.push(...matches);
          }
        } else {
          ftsMatches = await window.electronAPI.searchFTS(activeAccount.email, parsed.textTerms.join(' '));
        }
        
        setSpeedProof(prev => ({
          ...prev,
          searchMs: Math.round(performance.now() - start)
        }));

        const matchThreadIds = new Set(ftsMatches.map(m => m.threadId));
        filtered = threads.filter(t => matchThreadIds.has(t.id));

        // Apply metadata filters
        if (parsed.from) {
          filtered = filtered.filter(t => t.senderEmail.includes(parsed.from!) || t.senderNames.some(n => n.toLowerCase().includes(parsed.from!)));
        }
        if (parsed.domain) {
          filtered = filtered.filter(t => t.senderEmail.endsWith(`@${parsed.domain}`) || t.senderEmail.endsWith(`.${parsed.domain}`));
        }
        if (parsed.hasAttachment !== undefined) {
          filtered = filtered.filter(t => t.hasAttachments === parsed.hasAttachment);
        }
        if (parsed.isUnread !== undefined) {
          filtered = filtered.filter(t => t.isUnread === parsed.isUnread);
        }
      } else {
        // Apply Split Tabs only if search is empty
        filtered = threads.filter(t => {
          // Verify thread is currently in Inbox
          const inInbox = t.labelIds.some(l => l.toUpperCase() === 'INBOX');
          if (!inInbox) return false;

          // Filter out future local reminders
          if (t.reminderAt && new Date(t.reminderAt) > new Date()) {
            return false;
          }
          return getThreadCategory(t) === activeSplit;
        });
      }

      setVisibleThreads(filtered);

      // Keep the current focus if the thread is still visible; only fall back to
      // the first row when the focused thread has left the filtered list (IL-G12).
      setFocusedThreadId(prev => {
        if (prev && filtered.some(t => t.id === prev)) return prev;
        return filtered.length > 0 ? filtered[0].id : null;
      });
    };

    filterThreads();
  }, [threads, searchQuery, activeSplit, activeAccount, accounts, getThreadCategory]);

  // Recalculate Split Tabs counters
  useEffect(() => {
    const counts: Record<string, number> = {};
    for (const c of tabCategories) {
      counts[c.id] = 0;
    }

    for (const t of threads) {
      // Verify thread is currently in Inbox
      const inInbox = t.labelIds.some(l => l.toUpperCase() === 'INBOX');
      if (!inInbox) continue;

      if (t.reminderAt && new Date(t.reminderAt) > new Date()) continue;
      const split = getThreadCategory(t);
      if (counts[split] !== undefined) {
        counts[split]++;
      } else {
        counts[split] = 1;
      }
    }

    setSplitCounts(counts);
  }, [threads, getThreadCategory, tabCategories]);

  // Open Thread Detail
  const openThread = async (thread: MailThread | null) => {
    setOpenedThread(thread);
    if (!thread || !activeAccount) {
      setOpenedThreadMessages([]);
      return;
    }

    // Move the keyboard focus onto the opened thread so the selection indicator
    // follows the click instead of staying on the first row.
    setFocusedThreadId(thread.id);

    // Load messages from DB
    let msgs = await window.electronAPI.listMessagesForThread(thread.accountId, thread.id);
    setOpenedThreadMessages(msgs);

    // Auto mark read if configured (default is true)
    if (thread.isUnread) {
      executeMailAction('markRead', thread.id);
    }
  };

  // Draft Compose Actions
  const saveDraftLocally = async (body: string, toStr: string, subject: string) => {
    if (!activeAccount) return;

    const toRecipients = toStr ? toStr.split(',').map(e => ({ name: '', email: e.trim() })) : [];
    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0].email : activeAccount.email);

    const draft: Draft = {
      id: activeDraft?.id || crypto.randomUUID(),
      accountId: targetAccountId,
      threadId: openedThread?.id || null,
      to: toRecipients,
      cc: [],
      bcc: [],
      subject: subject || (openedThread ? `Re: ${openedThread.subject}` : ''),
      bodyPlain: body,
      attachments: activeDraft?.attachments || [],
      updatedAt: new Date().toISOString()
    };

    await window.electronAPI.saveDraft(draft);
    setActiveDraft(draft);
    loadDrafts();
  };

  // Reply / Reply-all: prefill recipients, subject, quoted body, and RFC threading
  // headers from the source message (CO-G5/G6).
  const startReply = (message: MailMessage, replyAll = false) => {
    if (!activeAccount) return;
    const selfEmail = activeAccount.id === 'unified'
      ? (accounts.find(a => a.email === message.accountId)?.email || message.accountId)
      : activeAccount.email;
    const seed = buildReplySeed(message, selfEmail, replyAll || settings.compose.alwaysReplyAll);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: message.threadId,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: seed.body,
      attachments: [],
      replyMessageId: seed.replyMessageId || null,
      replyReferences: seed.replyReferences || null,
      updatedAt: new Date().toISOString()
    };
    window.electronAPI.saveDraft(draft).catch(e => console.error('saveDraft (reply) failed', e));
    setActiveDraft(draft);
    loadDrafts();
  };

  // Forward: quoted body, "Fwd:" subject, empty recipients; opens the compose drawer.
  const startForward = (message: MailMessage) => {
    if (!activeAccount) return;
    const seed = buildForwardSeed(message);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: null,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: seed.body,
      attachments: [],
      updatedAt: new Date().toISOString()
    };
    setOpenedThread(null);
    setOpenedThreadMessages([]);
    window.electronAPI.saveDraft(draft).catch(e => console.error('saveDraft (forward) failed', e));
    setActiveDraft(draft);
    loadDrafts();
  };

  // Update only the body of the active draft (preserves recipients/threading).
  const updateDraftBody = (body: string) => {
    if (!activeDraft) return;
    const updated: Draft = { ...activeDraft, bodyPlain: body, updatedAt: new Date().toISOString() };
    setActiveDraft(updated);
    window.electronAPI.saveDraft(updated).catch(e => console.error('saveDraft (body) failed', e));
  };

  const addAttachmentToDraft = async () => {
    if (!activeDraft) return;
    const attachment = await window.electronAPI.uploadAttachment();
    if (!attachment) return;
    const updatedDraft: Draft = {
      ...activeDraft,
      attachments: [...(activeDraft.attachments || []), attachment],
      updatedAt: new Date().toISOString()
    };
    await window.electronAPI.saveDraft(updatedDraft);
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const removeAttachmentFromDraft = async (attId: string) => {
    if (!activeDraft) return;
    const updatedDraft: Draft = {
      ...activeDraft,
      attachments: (activeDraft.attachments || []).filter(a => a.id !== attId),
      updatedAt: new Date().toISOString()
    };
    await window.electronAPI.saveDraft(updatedDraft);
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const sendDraftWithUndo = async () => {
    if (!activeDraft || !activeAccount) return;
    if (pendingSend) return; // guard against double-send while a send is already pending

    const draftToSend = activeDraft;
    pendingDraftRef.current = draftToSend;

    const performSend = async () => {
      if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
      pendingSendTimerRef.current = null;
      setPendingSend(false);
      setPendingSendSeconds(0);
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (!draft) return;
      try {
        await executeMailAction('send', draft.threadId || openedThread?.id, draft.id, async (actionId) => {
          const res = await window.electronAPI.sendDraft(draft.accountId, draft, actionId);
          if (res && !res.offline) {
            await window.electronAPI.deleteDraft(draft.id);
          }
          return res;
        });
        loadDrafts();
        if (draft.threadId === openedThread?.id) openThread(null);
        emitToast({ type: 'success', message: 'Message sent.' });
      } catch (e) {
        console.error('Failed to send draft:', e);
        emitToast({ type: 'error', message: 'Failed to send message.' });
      }
    };

    // Honor the configurable undo window (settings.compose.sendUndoDelay; 0 = send now).
    const delaySec = Math.max(0, Math.round(settings.compose.sendUndoDelay ?? 10));

    // Discard the editor immediately; the banner becomes the active surface.
    setActiveDraft(null);

    if (delaySec === 0) {
      await performSend();
      return;
    }

    setPendingSend(true);
    setPendingSendSeconds(delaySec);
    pendingSendIntervalRef.current = setInterval(() => {
      setPendingSendSeconds(s => (s > 1 ? s - 1 : 0));
    }, 1000);
    pendingSendTimerRef.current = setTimeout(performSend, delaySec * 1000);
  };

  const cancelPendingSend = () => {
    if (pendingSendTimerRef.current) { clearTimeout(pendingSendTimerRef.current); pendingSendTimerRef.current = null; }
    if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
    setPendingSend(false);
    setPendingSendSeconds(0);
    // Restore the draft into the editor so the user can keep editing.
    if (pendingDraftRef.current) setActiveDraft(pendingDraftRef.current);
    pendingDraftRef.current = null;
  };

  // Mail Operations wrapper (Read, Done, Reminders)
  const executeMailAction = async (
    kind: MailActionLog['kind'],
    threadId?: string | null,
    draftId?: string | null,
    customAction?: (actionId: string) => Promise<any>
  ) => {
    if (!activeAccount) return;

    const targetThreadId = threadId || openedThread?.id || focusedThreadId;
    if (!targetThreadId) return;

    const actionId = crypto.randomUUID();
    const thread = threads.find(t => t.id === targetThreadId);
    const targetAccountId = thread ? thread.accountId : activeAccount.email;
    
    const log: MailActionLog = {
      id: actionId,
      accountId: targetAccountId,
      threadId: targetThreadId,
      draftId,
      kind,
      status: 'queued',
      createdAt: new Date().toISOString()
    };

    setActionLog(prev => [log, ...prev]);

    // === INSTANT OPTIMISTIC UI STATE TRANSITIONS ===
    // Find next thread to transition to before filtering
    const currentIdx = visibleThreads.findIndex(t => t.id === targetThreadId);
    let nextThread: MailThread | null = null;
    if (currentIdx !== -1) {
      if (currentIdx + 1 < visibleThreads.length) {
        nextThread = visibleThreads[currentIdx + 1];
      } else if (currentIdx - 1 >= 0) {
        nextThread = visibleThreads[currentIdx - 1];
      }
    }

    if (kind === 'markDone') {
      // Evict from active state immediately
      setThreads(prev => prev.filter(t => t.id !== targetThreadId));
      if (openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
      if (nextThread) {
        setFocusedThreadId(nextThread.id);
      } else {
        setFocusedThreadId(null);
      }
    } else if (kind === 'autoMarkRead') {
      // Evict snoozed thread immediately by setting a future reminderAt date
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, reminderAt: tomorrow.toISOString() } : t));
      if (openedThread?.id === targetThreadId) {
        openThread(nextThread);
      }
      if (nextThread) {
        setFocusedThreadId(nextThread.id);
      } else {
        setFocusedThreadId(null);
      }
    } else if (kind === 'markRead') {
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: false } : t));
    } else if (kind === 'markUnread') {
      setThreads(prev => prev.map(t => t.id === targetThreadId ? { ...t, isUnread: true } : t));
    }

    // Run remote API and database persistence asynchronously in the background
    (async () => {
      try {
        await window.electronAPI.saveActionLog(log);
        log.status = 'running';
        await window.electronAPI.saveActionLog(log);

        let res: any = null;
        if (customAction) {
          res = await customAction(actionId);
        } else {
          // Default Gmail label API modifications
          if (kind === 'markDone') {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['INBOX'], actionId);
          } else if (kind === 'restoreInbox') {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['INBOX'], [], actionId);
            loadThreadsFromDB();
          } else if (kind === 'markRead') {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, [], ['UNREAD'], actionId);
          } else if (kind === 'markUnread') {
            res = await window.electronAPI.modifyLabels(targetAccountId, targetThreadId, ['UNREAD'], [], actionId);
          }
        }

        if (res && res.offline) {
          // Action was queued offline, status is updated by main process
          loadActionLog();
        } else {
          log.status = 'completed';
          log.completedAt = new Date().toISOString();
          await window.electronAPI.saveActionLog(log);
          loadActionLog();
        }
      } catch (err: any) {
        console.error('Background mail action failed:', err);
        log.status = 'failed';
        log.failureMessage = err.message;
        await window.electronAPI.saveActionLog(log);
        loadActionLog();

        // Roll back the optimistic UI state by reloading records from SQLite
        loadThreadsFromDB();
      }
    })();
  };

  const undoLastAction = async () => {
    const lastReversible = actionLog.find(l => l.status === 'completed' && ['markRead', 'markUnread', 'markDone', 'restoreInbox'].includes(l.kind));
    if (!lastReversible) {
      emitToast({ type: 'info', message: 'Nothing to undo.' });
      return;
    }

    const reverseKind: MailActionLog['kind'] = 
      lastReversible.kind === 'markDone' ? 'restoreInbox' :
      lastReversible.kind === 'restoreInbox' ? 'markDone' :
      lastReversible.kind === 'markRead' ? 'markUnread' : 'markRead';

    await executeMailAction(reverseKind, lastReversible.threadId);
  };

  // Snooze a thread until `date`: evicts it from the inbox and persists the
  // reminder (RA-C3). The real reminder date comes back from SQLite on reload.
  const snoozeThread = async (thread: MailThread, date: Date) => {
    await executeMailAction('autoMarkRead', thread.id, null, async () => {
      await window.electronAPI.saveReminder(thread.accountId, thread.id, date.toISOString());
    });
  };

  const clearThreadReminder = async (thread: MailThread) => {
    await window.electronAPI.deleteReminder(thread.accountId, thread.id);
    setThreads(prev => prev.map(t => t.id === thread.id ? { ...t, reminderAt: null } : t));
    loadThreadsFromDB();
  };

  // AI Panel Chat interface
  const startNewAIConversation = () => {
    setActiveAIConversation(null);
    setActiveAIMessages([]);
  };

  const selectAIConversation = async (conv: AIConversation) => {
    setActiveAIConversation(conv);
    const msgs = await window.electronAPI.getConversationMessages(conv.id);
    setActiveAIMessages(msgs);
  };

  const sendAIMessage = async (text: string) => {
    if (!activeAccount) return;

    const start = performance.now();
    setAiPanelLoading(true);

    const userMsg: AIChatMessage = {
      id: crypto.randomUUID(),
      role: 'user',
      text
    };

    const newMsgs = [...activeAIMessages, userMsg];
    setActiveAIMessages(newMsgs);

    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0].email : activeAccount.email);

    let conv = activeAIConversation;
    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        title: text.substring(0, 30),
        accountId: targetAccountId,
        threadId: openedThread?.id || null,
        threadSubject: openedThread?.subject || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setActiveAIConversation(conv);
    }

    try {
      const response = await window.electronAPI.completeAI({
        action: 'chat',
        context: openedThread
          ? `Thread Subject: ${openedThread.subject}\nSnippet: ${openedThread.snippet}\nMessages:\n${openedThreadMessages.map(m => m.bodyPlain).join('\n')}`
          : 'No thread open.',
        conversationHistory: newMsgs,
        userInstruction: text
      }, aiProvider, aiModel || undefined);

      const assistantMsg: AIChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: response.text
      };

      const finalMsgs = [...newMsgs, assistantMsg];
      setActiveAIMessages(finalMsgs);
      await window.electronAPI.saveConversation(conv, finalMsgs);
      loadAIConversations();

      setSpeedProof(prev => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
    } catch (e) {
      console.error('AI chat completion failed:', e);
      emitToast({ type: 'error', message: 'AI request failed. Check your provider keys in Settings → AI.' });
    } finally {
      setAiPanelLoading(false);
    }
  };

  const [activeAccountCredentialsValid, setActiveAccountCredentialsValid] = useState<boolean>(true);

  // Check connected account credentials
  useEffect(() => {
    if (!activeAccount || activeAccount.id === 'unified') {
      setActiveAccountCredentialsValid(true);
      return;
    }
    window.electronAPI.verifyTokenExists(activeAccount.email).then(valid => {
      setActiveAccountCredentialsValid(valid);
    });
  }, [activeAccount]);

  const triageActionPreview = useCallback((item: MailTriagePlanItem): MailTriageActionPreview => {
    const isSelected = selectedTriageThreadIds.has(item.threadId);
    let eligibility: MailTriageActionPreview['eligibility'] = 'ready';
    const isLocalOnly = item.recommendation === 'setReminder';
    
    if (!isLocalOnly) {
      if (!activeAccount) {
        eligibility = 'remoteUnavailable';
      } else if (!activeAccountCredentialsValid) {
        eligibility = 'requiresReconnect';
      }
    } else {
      eligibility = 'ready';
    }

    const scope: MailTriageActionPreview['scope'] = 
      (item.recommendation === 'readNow' || item.recommendation === 'markDoneCandidate') ? 'gmail' :
      (item.recommendation === 'setReminder') ? 'local' : 'focus';

    const selectionPolicy: MailTriageActionPreview['selectionPolicy'] = 
      (item.recommendation === 'readNow' || item.recommendation === 'setReminder') ? 'autoSelected' :
      (item.recommendation === 'markDoneCandidate') ? 'explicitOptIn' : 'previewOnly';

    return {
      threadId: item.threadId,
      recommendation: item.recommendation,
      isSelected,
      eligibility,
      scope,
      selectionPolicy
    };
  }, [selectedTriageThreadIds, activeAccount, activeAccountCredentialsValid]);

  const triageQueueReadiness = (() => {
    if (!triagePlan) return null;
    const items = triagePlan.items.filter(item => {
      const canApply = item.recommendation === 'readNow' || item.recommendation === 'setReminder' || item.recommendation === 'markDoneCandidate';
      return canApply && selectedTriageThreadIds.has(item.threadId);
    });
    if (items.length === 0) return null;

    const remoteGmailCount = items.filter(i => i.recommendation !== 'setReminder').length;
    const localCount = items.filter(i => i.recommendation === 'setReminder').length;
    const hasCredentialsError = !activeAccountCredentialsValid;
    
    const blockedRemoteCount = (remoteGmailCount > 0 && hasCredentialsError) ? remoteGmailCount : 0;
    const executableRemoteCount = remoteGmailCount - blockedRemoteCount;

    const parts: string[] = [];
    if (remoteGmailCount > 0) {
      parts.push(`${remoteGmailCount} Gmail action${remoteGmailCount === 1 ? '' : 's'} ${hasCredentialsError ? 'need reconnect' : 'ready'}`);
    }
    if (localCount > 0) {
      parts.push(`${localCount} local action${localCount === 1 ? '' : 's'} ready`);
    }

    return {
      summary: parts.join(' · '),
      level: hasCredentialsError && remoteGmailCount > 0 ? 'warning' as const : 'ready' as const,
      executableActionCount: executableRemoteCount + localCount,
      blockedActionCount: blockedRemoteCount,
      canApplySelected: (executableRemoteCount + localCount) > 0,
      applyButtonTitle: (executableRemoteCount + localCount) > 0 ? `Apply ${executableRemoteCount + localCount}` : (blockedRemoteCount > 0 ? 'Reconnect' : 'Apply 0')
    };
  })();

  const toggleTriagePlanItemSelection = (threadId: string) => {
    setSelectedTriageThreadIds(prev => {
      const copy = new Set(prev);
      if (copy.has(threadId)) {
        copy.delete(threadId);
      } else {
        copy.add(threadId);
      }
      return copy;
    });
  };

  const selectAllApplicableTriagePlanItems = () => {
    if (!triagePlan) return;
    const applicableIds = triagePlan.items
      .filter(i => i.recommendation === 'readNow' || i.recommendation === 'setReminder' || i.recommendation === 'markDoneCandidate')
      .map(i => i.threadId);
    setSelectedTriageThreadIds(new Set(applicableIds));
  };

  const clearTriagePlanSelection = () => {
    setSelectedTriageThreadIds(new Set());
  };

  const applyTriagePlanItem = async (item: MailTriagePlanItem) => {
    if (!activeAccount) return;
    const thread = threads.find(t => t.id === item.threadId);
    if (!thread) return;

    if (item.recommendation === 'readNow') {
      await executeMailAction('markRead', item.threadId);
      setTriagePlan(prev => {
        if (!prev) return null;
        return {
          ...prev,
          items: prev.items.filter(i => i.threadId !== item.threadId)
        };
      });
    } else if (item.recommendation === 'markDoneCandidate') {
      await executeMailAction('markDone', item.threadId);
      setTriagePlan(prev => {
        if (!prev) return null;
        return {
          ...prev,
          items: prev.items.filter(i => i.threadId !== item.threadId)
        };
      });
    } else if (item.recommendation === 'setReminder') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await window.electronAPI.saveReminder(activeAccount.email, item.threadId, tomorrow.toISOString());
      setThreads(prev => prev.map(t => t.id === item.threadId ? { ...t, reminderAt: tomorrow.toISOString() } : t));
      
      setTriagePlan(prev => {
        if (!prev) return null;
        return {
          ...prev,
          items: prev.items.filter(i => i.threadId !== item.threadId)
        };
      });
    }
  };

  const applySelectedTriagePlanItems = async () => {
    if (!triagePlan || selectedTriageThreadIds.size === 0) return;
    const executableItems = triagePlan.items.filter(i => {
      const canApply = i.recommendation === 'readNow' || i.recommendation === 'setReminder' || i.recommendation === 'markDoneCandidate';
      if (!canApply || !selectedTriageThreadIds.has(i.threadId)) return false;
      if (i.recommendation !== 'setReminder' && !activeAccountCredentialsValid) return false;
      return true;
    });

    for (const item of executableItems) {
      await applyTriagePlanItem(item);
    }
    setSelectedTriageThreadIds(new Set());
  };

  const AutomationRulePreviewBuilder = {
    build(threads: MailThread[]): AutomationRulePreview {
      const candidates = [
        {
          id: 'unread-automation',
          title: 'Unread automation',
          criteria: 'Unread no-reply, code, digest, or notification mail',
          recommendation: 'readNow' as TriageRecommendation,
          priority: 100,
          predicate: (t: MailThread) => t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t)
        },
        {
          id: 'security-codes',
          title: 'Security codes',
          criteria: 'Verification or login-code wording from automation',
          recommendation: 'readNow' as TriageRecommendation,
          priority: 90,
          predicate: (t: MailThread) => MailSignalClassifier.isVerificationOrSecurityCode(t)
        },
        {
          id: 'read-automation',
          title: 'Read automation',
          criteria: 'Read automated updates already seen',
          recommendation: 'markDoneCandidate' as TriageRecommendation,
          priority: 80,
          predicate: (t: MailThread) => !t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t)
        },
        {
          id: 'marketing-digests',
          title: 'Marketing and digests',
          criteria: 'Promotions, newsletters, digests, or campaign mail',
          recommendation: 'markDoneCandidate' as TriageRecommendation,
          priority: 70,
          predicate: (t: MailThread) => MailSignalClassifier.isMarketingAutomation(t)
        },
        {
          id: 'bot-notifications',
          title: 'Bot notifications',
          criteria: 'No-reply, bot, dependency, or service notifications',
          recommendation: 'markDoneCandidate' as TriageRecommendation,
          priority: 60,
          predicate: (t: MailThread) => MailSignalClassifier.isAutomatedSender(t) && !MailSignalClassifier.isVerificationOrSecurityCode(t)
        }
      ];

      const rules = candidates
        .map(candidate => {
          const matchCount = threads.filter(candidate.predicate).length;
          if (matchCount === 0) return null;
          return {
            id: candidate.id,
            title: candidate.title,
            criteria: candidate.criteria,
            recommendation: candidate.recommendation,
            matchCount,
            priority: candidate.priority
          };
        })
        .filter((r): r is NonNullable<typeof r> => r !== null)
        .sort((a, b) => {
          if (a.matchCount === b.matchCount) {
            if (a.priority === b.priority) {
              return a.title.localeCompare(b.title);
            }
            return b.priority - a.priority;
          }
          return b.matchCount - a.matchCount;
        });

      return {
        rules: rules.slice(0, 4)
      };
    },

    matchingRuleIds(thread: MailThread): string[] {
      const candidates = [
        { id: 'unread-automation', predicate: (t: MailThread) => t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t) },
        { id: 'security-codes', predicate: (t: MailThread) => MailSignalClassifier.isVerificationOrSecurityCode(t) },
        { id: 'read-automation', predicate: (t: MailThread) => !t.isUnread && MailSignalClassifier.isLowPriorityAutomation(t) },
        { id: 'marketing-digests', predicate: (t: MailThread) => MailSignalClassifier.isMarketingAutomation(t) },
        { id: 'bot-notifications', predicate: (t: MailThread) => MailSignalClassifier.isAutomatedSender(t) && !MailSignalClassifier.isVerificationOrSecurityCode(t) }
      ];
      return candidates.filter(c => c.predicate(thread)).map(c => c.id);
    }
  };

  const MailTriagePlanner = {
    build(
      accountId: string,
      sourceTitle: string,
      threads: MailThread[],
      now: Date,
      intent: 'mailboxTriage' | 'automationCleanup',
      limit = 8
    ): MailTriagePlan {
      const items = threads
        .map(thread => {
          const rec = this.recommendation(thread, now, intent);
          return {
            item: {
              threadId: thread.id,
              subject: thread.subject,
              sender: thread.senderNames[0] || thread.senderEmail,
              recommendation: rec.kind,
              reason: rec.reason,
              priority: rec.priority,
              automationRuleIds: AutomationRulePreviewBuilder.matchingRuleIds(thread)
            },
            lastMessageAt: thread.lastMessageAt
          };
        })
        .sort((a, b) => {
          if (a.item.priority === b.item.priority) {
            return new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime();
          }
          return b.item.priority - a.item.priority;
        })
        .slice(0, limit)
        .map(x => x.item);

      const autoPreview = intent === 'automationCleanup' ? AutomationRulePreviewBuilder.build(threads) : null;

      return {
        accountId,
        sourceTitle,
        generatedAt: now.toISOString(),
        sourceThreadCount: threads.length,
        items,
        intent,
        automationRulePreview: autoPreview && autoPreview.rules.length > 0 ? autoPreview : null
      };
    },

    recommendation(
      thread: MailThread,
      now: Date,
      intent: 'mailboxTriage' | 'automationCleanup'
    ): { kind: TriageRecommendation; reason: string; priority: number } {
      const isAuto = MailSignalClassifier.isLowPriorityAutomation(thread);
      if (isAuto) {
        if (thread.isUnread) {
          return {
            kind: 'readNow',
            reason: intent === 'automationCleanup' ? 'Unread automated update' : 'Unread low-priority automation',
            priority: 78
          };
        }
        return {
          kind: 'markDoneCandidate',
          reason: intent === 'automationCleanup' ? 'Read automated update' : 'Likely automated update',
          priority: 52
        };
      }

      const isImportant = MailSignalClassifier.isImportantCandidate(thread);
      if (thread.isUnread && isImportant) {
        return { kind: 'reply', reason: 'Unread important thread', priority: 100 };
      }
      if (thread.hasAttachments && thread.isUnread) {
        return { kind: 'reviewAttachment', reason: 'Unread thread has an attachment', priority: 90 };
      }
      
      const ageHrs = Math.max(0, (now.getTime() - new Date(thread.lastMessageAt).getTime()) / 3600000);
      if (thread.isUnread && ageHrs >= 18) {
        return { kind: 'setReminder', reason: 'Unread for more than 18 hours', priority: 82 };
      }
      if (thread.isUnread) {
        return { kind: 'readNow', reason: 'Unread thread', priority: 75 };
      }
      if (thread.hasAttachments) {
        return { kind: 'reviewAttachment', reason: 'Attachment may need review', priority: 65 };
      }

      const subject = thread.subject.toLowerCase();
      const isLowSignal = isAuto ||
        subject.includes('receipt') ||
        subject.includes('invoice') ||
        subject.includes('newsletter') ||
        subject.includes('digest') ||
        subject.includes('notification');
      if (isLowSignal) {
        return { kind: 'markDoneCandidate', reason: 'Likely automated update', priority: 52 };
      }

      if (ageHrs >= 48) {
        return { kind: 'markDoneCandidate', reason: 'Read thread older than 48 hours', priority: 45 };
      }

      return { kind: 'readNow', reason: 'Visible thread', priority: 30 };
    }
  };

  const runAIAction = async (action: AIAction) => {
    if (!activeAccount) return;
    setAiPanelOpen(true);
    if (action === 'queue') {
      await runAITriagePlan();
      return;
    }

    setAiPanelLoading(true);
    const start = performance.now();
    const context = buildThreadContext(openedThread, openedThreadMessages, settings.ai);
    const tone = `Use a ${settings.ai.replyTone} tone.`;
    const notes = settings.ai.personalizationNotes ? `\nPersonalization notes: ${settings.ai.personalizationNotes}` : '';
    const prompts: Record<Exclude<AIAction, 'queue'>, { label: string; instruction: string }> = {
      summarize: { label: 'Summarize this thread', instruction: `Summarize this email thread in 3-5 crisp bullet points, then a single "Next step:" line.${notes}` },
      draftReply: { label: 'Draft a reply', instruction: `Write a complete reply to the latest message in this thread. ${tone} Return only the email body, no preamble or subject.${notes}` },
      rewrite: { label: 'Rewrite for clarity', instruction: `Rewrite the latest message to be clearer, well-structured, and polished. ${tone} Return only the rewritten text.${notes}` },
      translate: { label: 'Translate to English', instruction: `Translate the latest message of this thread into clear English. If it is already English, return clear formal English. Return only the translation.` },
    };
    const cfg = prompts[action];

    const userMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'user', text: cfg.label };
    const pending = [...activeAIMessages, userMsg];
    setActiveAIMessages(pending);

    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);
    let conv = activeAIConversation;
    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        title: cfg.label,
        accountId: targetAccountId,
        threadId: openedThread?.id || null,
        threadSubject: openedThread?.subject || null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };
      setActiveAIConversation(conv);
    }

    try {
      const response = await window.electronAPI.completeAI({
        action: 'chat',
        context,
        conversationHistory: pending,
        userInstruction: cfg.instruction
      }, aiProvider, aiModel || undefined);

      const assistantMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: response.text };
      const finalMsgs = [...pending, assistantMsg];
      setActiveAIMessages(finalMsgs);
      await window.electronAPI.saveConversation(conv, finalMsgs);
      loadAIConversations();
      setSpeedProof(prev => ({ ...prev, aiMs: Math.round(performance.now() - start) }));
    } catch (e) {
      console.error('AI action failed:', e);
      setActiveAIMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system', text: 'AI request failed. Check your provider keys in Settings → AI.' }]);
    } finally {
      setAiPanelLoading(false);
    }
  };

  const runAITriagePlan = async () => {
    if (!activeAccount || visibleThreads.length === 0) return;
    
    setAiPanelLoading(true);
    setAiPanelOpen(true);

    const isAutomationSplit = activeSplit === 'automation';
    const intent = isAutomationSplit ? 'automationCleanup' : 'mailboxTriage';
    const now = new Date();
    
    const plan = MailTriagePlanner.build(
      activeAccount.id === 'unified' ? 'unified' : activeAccount.email,
      activeSplit,
      visibleThreads,
      now,
      intent,
      8
    );

    const defaultSelected = new Set(
      plan.items
        .filter(item => item.recommendation === 'readNow' || item.recommendation === 'setReminder')
        .map(item => item.threadId)
    );
    setSelectedTriageThreadIds(defaultSelected);
    setTriagePlan(plan);
    setAiPanelLoading(false);
  };

  // Cache body repair action (capped at 25 visible threads)
  const triggerVisibleBodyRepair = async () => {
    if (!activeAccount || visibleThreads.length === 0) return;
    
    setSyncStatusText('Caching bodies...');
    setSyncHealth('syncing');

    const targets = visibleThreads.slice(0, 25);
    try {
      await Promise.all(targets.map(async t => {
        const msgs = await window.electronAPI.fetchThreadDetail(activeAccount.email, t.id);
        await window.electronAPI.saveMessages(msgs);
      }));
      await loadThreadsFromDB();
      setSyncHealth('ready');
      setSyncStatusText('Ready');
    } catch (e) {
      console.error('Body repair caching failed:', e);
      setSyncHealth('failed');
      setSyncStatusText('Cache repair failed');
    }
  };

  return (
    <AppStoreContext.Provider value={{
      theme, setTheme,
      accounts, activeAccount, setActiveAccount, onboardAccount, disconnectAccount,
      threads, visibleThreads, focusedThreadId, setFocusedThreadId, openedThread, openedThreadMessages, openThread,
      activeSplit, setActiveSplit, splitCounts,
      tabCategories, addTabCategory, toggleTabCategory, deleteTabCategory, updateTabCategoriesOrder,
      enablePreviewPane, setEnablePreviewPane,
      previewPaneWidth, setPreviewPaneWidth,
      customClassifierRules, addCustomClassifierRule, updateCustomClassifierRule, deleteCustomClassifierRule,
      searchQuery, setSearchQuery, searchCoverage,
      actionLog, executeMailAction, undoLastAction, snoozeThread, clearThreadReminder,
      activeDraft, setActiveDraft, draftsList, saveDraftLocally, startReply, startForward, updateDraftBody, sendDraftWithUndo, pendingSend, pendingSendSeconds, cancelPendingSend,
      addAttachmentToDraft, removeAttachmentFromDraft,
      syncHealth, syncStatusText, backfillProgress, triggerBackfillManual, isSyncing, triggerSyncManual,
      aiPanelOpen, setAiPanelOpen, aiProvider, setAiProvider: setAiProviderState, aiProviderDesc,
      aiConversations, activeAIConversation, activeAIMessages, startNewAIConversation, selectAIConversation, sendAIMessage,
      runAIAction, runAITriagePlan, triagePlan, setTriagePlan, aiPanelLoading,
      settingsOpen, setSettingsOpen, aiModel, setAiModel, customEnv, loadAIConfig, saveAIConfig, fetchModelsForProvider,
      modelsCache, verifyConnectionAndFetchModels,
      speedProof, triggerVisibleBodyRepair,
      settings, updateSettings, selectedTriageThreadIds, toggleTriagePlanItemSelection, selectAllApplicableTriagePlanItems,
      clearTriagePlanSelection, applySelectedTriagePlanItems, applyTriagePlanItem, triageQueueReadiness, triageActionPreview
    }}>
      {children}
    </AppStoreContext.Provider>
  );
};

export const useAppStore = () => {
  const context = useContext(AppStoreContext);
  if (!context) throw new Error('useAppStore must be used inside AppStoreProvider');
  return context;
};
