import { useState, useEffect, useCallback } from 'react';
import { AppSettings, CustomClassifierRule, TabCategory, MCPServerConfig, MailCategoryRule } from '../../../shared/types';
import { DEFAULT_SETTINGS, DEFAULT_CATEGORIES, mergeSettings } from './AppStore';

export function useSettingsState() {
  const [settings, setSettingsState] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [theme, setThemeState] = useState<'light' | 'dark' | 'system'>('system');
  const [enablePreviewPane, setEnablePreviewPaneState] = useState<boolean>(true);
  const [previewPaneWidth, setPreviewPaneWidthState] = useState<number>(320);
  const [customClassifierRules, setCustomClassifierRulesState] = useState<CustomClassifierRule[]>([]);
  const [tabCategories, setTabCategoriesState] = useState<TabCategory[]>(DEFAULT_CATEGORIES);
  const [modelsCache, setModelsCache] = useState<Record<string, string[]>>({});
  const [settingsOpen, setSettingsOpen] = useState<boolean>(false);
  const [customEnv, setCustomEnv] = useState<Record<string, string>>({});

  const setEnablePreviewPane = (val: boolean) => {
    setEnablePreviewPaneState(val);
    window.electronAPI.setSetting('enablePreviewPane', String(val)).catch(err => {
      console.error('Failed to save enablePreviewPane to SQLite:', err);
    });
  };

  const setPreviewPaneWidth = (val: number) => {
    setPreviewPaneWidthState(val);
    window.electronAPI.setSetting('previewPaneWidth', String(val)).catch(err => {
      console.error('Failed to save previewPaneWidth to SQLite:', err);
    });
  };

  const syncToSettings = (newCats: TabCategory[], newRules: CustomClassifierRule[]) => {
    updateSettings(s => {
      const builtInCats = newCats.filter(c => c.isSystem);
      s.inbox.categories.builtIn = builtInCats.map(bc => {
        const existing = s.inbox.categories.builtIn.find(x => x.id === bc.id);
        const extraRules = newRules
          .filter(r => r.targetCategory === bc.id)
          .map(r => ({
            id: r.id,
            field: (r.field === 'from' ? 'from' : 'subject') as 'from' | 'subject',
            operation: r.condition,
            value: r.value,
            isNegated: false,
            accountId: r.accountId
          } as MailCategoryRule));
        return {
          id: bc.id,
          title: bc.displayName,
          isEnabled: bc.active,
          matchMode: existing?.matchMode || 'any',
          extraRules
        };
      });

      const customCats = newCats.filter(c => !c.isSystem);
      s.inbox.categories.custom = customCats.map(cc => {
        const existing = s.inbox.categories.custom.find(x => x.id === cc.id);
        const rules = newRules
          .filter(r => r.targetCategory === cc.id)
          .map(r => ({
            id: r.id,
            field: (r.field === 'from' ? 'from' : 'subject') as 'from' | 'subject',
            operation: r.condition,
            value: r.value,
            isNegated: false,
            accountId: r.accountId
          } as MailCategoryRule));
        return {
          id: cc.id,
          title: cc.displayName,
          isEnabled: cc.active,
          matchMode: existing?.matchMode || 'any',
          rules,
          accountId: cc.accountId
        };
      });
    });
  };

  const saveRules = (rules: CustomClassifierRule[]) => {
    setCustomClassifierRulesState(rules);
    window.electronAPI.setSetting('customClassifierRules', JSON.stringify(rules)).catch(err => {
      console.error('Failed to save customClassifierRules to SQLite:', err);
    });
    syncToSettings(tabCategories, rules);
  };

  const saveTabCategories = (categories: TabCategory[]) => {
    setTabCategoriesState(categories);
    window.electronAPI.setSetting('tabCategories', JSON.stringify(categories)).catch(err => {
      console.error('Failed to save tabCategories to SQLite:', err);
    });
    syncToSettings(categories, customClassifierRules);
  };

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
        active: c.isEnabled,
        accountId: c.accountId
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
            active: b.isEnabled,
            accountId: r.accountId
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
            active: c.isEnabled,
            accountId: r.accountId
          });
        });
      });
      setCustomClassifierRulesState(rules);
      
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
              const customCats: any[] = [];
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
                const rule = {
                  id: r.id,
                  field: (r.field === 'from' ? 'from' : 'subject') as 'from' | 'subject',
                  operation: r.condition,
                  value: r.value,
                  isNegated: false,
                  accountId: r.accountId
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
          active: c.isEnabled,
          accountId: c.accountId
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
              active: b.isEnabled,
              accountId: r.accountId
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
              active: c.isEnabled,
              accountId: r.accountId
            });
          });
        });
        setCustomClassifierRulesState(legacyRules);

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

  const addTabCategory = (displayName: string, colorHex?: string, accountId?: string) => {
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]/g, '-');
    const id = `${slug}-${Math.random().toString(36).substring(2, 6)}`;
    const newCategory: TabCategory = {
      id,
      displayName,
      isSystem: false,
      colorHex: colorHex || '#8b5cf6',
      active: true,
      accountId: accountId || 'global'
    };
    saveTabCategories([...tabCategories, newCategory]);
  };

  const toggleTabCategory = (id: string, active: boolean) => {
    if (id === 'other') return;
    const updated = tabCategories.map(c => c.id === id ? { ...c, active } : c);
    saveTabCategories(updated);
  };

  const deleteTabCategory = (id: string) => {
    const category = tabCategories.find(c => c.id === id);
    if (!category || category.isSystem) return;
    
    const updatedCats = tabCategories.filter(c => c.id !== id);
    const updatedRules = customClassifierRules.map(rule => 
      rule.targetCategory === id ? { ...rule, targetCategory: 'other' } : rule
    );

    setTabCategoriesState(updatedCats);
    window.electronAPI.setSetting('tabCategories', JSON.stringify(updatedCats)).catch(err => {
      console.error('Failed to save tabCategories to SQLite:', err);
    });

    setCustomClassifierRulesState(updatedRules);
    window.electronAPI.setSetting('customClassifierRules', JSON.stringify(updatedRules)).catch(err => {
      console.error('Failed to save customClassifierRules to SQLite:', err);
    });

    syncToSettings(updatedCats, updatedRules);
  };

  const updateTabCategoriesOrder = (categories: TabCategory[]) => {
    saveTabCategories(categories);
  };

  const setTheme = (t: 'light' | 'dark' | 'system') => {
    setThemeState(t);
    window.electronAPI.setSetting('theme', t).catch(err => {
      console.error('Failed to save theme to SQLite:', err);
    });
    updateSettings(s => {
      s.appearance.theme = t;
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

  // Apply layout density
  useEffect(() => {
    document.documentElement.setAttribute('data-density', settings.appearance.density);
  }, [settings.appearance.density]);

  // Apply runtime accent color
  useEffect(() => {
    const hex = settings.appearance.accentColorHex;
    const valid = /^#[0-9a-fA-F]{6}$/.test(hex);
    document.documentElement.style.setProperty('--accent', valid ? hex : '#668FEA');
  }, [settings.appearance.accentColorHex]);

  // Apply translucent panels
  useEffect(() => {
    document.documentElement.setAttribute('data-translucent', String(settings.appearance.useTranslucentPanels));
  }, [settings.appearance.useTranslucentPanels]);

  // Apply font scale
  useEffect(() => {
    const raw = settings.appearance.fontScale ?? 1.0;
    const scale = Math.min(1.2, Math.max(0.85, raw));
    document.documentElement.style.setProperty('--font-scale', String(scale));
  }, [settings.appearance.fontScale]);

  const loadAIConfig = useCallback(async () => {
    const config = await window.electronAPI.loadAIConfig();
    setCustomEnv(config);
  }, []);

  useEffect(() => {
    loadAIConfig();
  }, [loadAIConfig]);

  const saveAIConfig = async (config: Record<string, string>) => {
    await window.electronAPI.saveAIConfig(config);
    setCustomEnv(config);
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

  const verifyMCPServer = async (config: MCPServerConfig): Promise<{ success: boolean; toolsCount?: number; error?: string }> => {
    return await window.electronAPI.verifyMCPServer(config);
  };

  return {
    settings,
    theme,
    enablePreviewPane,
    previewPaneWidth,
    customClassifierRules,
    tabCategories,
    modelsCache,
    settingsOpen,
    customEnv,
    setSettingsState,
    setThemeState,
    setEnablePreviewPaneState,
    setPreviewPaneWidthState,
    setCustomClassifierRulesState,
    setTabCategoriesState,
    setModelsCache,
    setSettingsOpen,
    setCustomEnv,
    setEnablePreviewPane,
    setPreviewPaneWidth,
    updateSettings,
    addCustomClassifierRule,
    updateCustomClassifierRule,
    deleteCustomClassifierRule,
    addTabCategory,
    toggleTabCategory,
    deleteTabCategory,
    updateTabCategoriesOrder,
    setTheme,
    loadAIConfig,
    saveAIConfig,
    verifyConnectionAndFetchModels,
    verifyMCPServer
  };
}
