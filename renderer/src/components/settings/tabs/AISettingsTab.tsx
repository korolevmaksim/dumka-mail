import { useState, useEffect } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { CheckCircle, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { Toggle } from '../SettingsControls';
import { emitToast } from '../../../lib/toastBus';
import { AI_SECRET_STORED_PLACEHOLDER } from '../../../../../shared/types';
import { ConfigurableAIProvider, getAIProviderConfig, isConfigurableAIProvider } from '../../../../../shared/aiProviders';
import { AIPromptShortcutsPanel } from '../AIPromptShortcutsPanel';

type FormKeys = Record<string, string>;
type VerifyStatus = Record<string, { status: 'idle' | 'verifying' | 'success' | 'error'; error?: string }>;

const isStoredSecretPlaceholder = (value?: string) => value === AI_SECRET_STORED_PLACEHOLDER;

const getConfigurableProvider = (provider: string): ConfigurableAIProvider | null => {
  return isConfigurableAIProvider(provider) ? provider : null;
};

export function AISettingsTab() {
  const store = useAppStore();
  const [formKeys, setFormKeys] = useState<FormKeys>({});
  const [verifyStatus, setVerifyStatus] = useState<VerifyStatus>({});
  const [savedStatus, setSavedStatus] = useState(false);

  useEffect(() => {
    setFormKeys({
      OPENAI_API_KEY: store.customEnv['OPENAI_API_KEY'] || '',
      OPENAI_BASE_URL: store.customEnv['OPENAI_BASE_URL'] || '',
      OPENAI_MODEL: store.customEnv['OPENAI_MODEL'] || '',
      OPENAI_REASONING_EFFORT: store.customEnv['OPENAI_REASONING_EFFORT'] || 'disabled',
      ANTHROPIC_API_KEY: store.customEnv['ANTHROPIC_API_KEY'] || '',
      ANTHROPIC_BASE_URL: store.customEnv['ANTHROPIC_BASE_URL'] || '',
      ANTHROPIC_MODEL: store.customEnv['ANTHROPIC_MODEL'] || '',
      ANTHROPIC_THINKING_EFFORT: store.customEnv['ANTHROPIC_THINKING_EFFORT'] || 'disabled',
      GEMINI_API_KEY: store.customEnv['GEMINI_API_KEY'] || '',
      GEMINI_BASE_URL: store.customEnv['GEMINI_BASE_URL'] || '',
      GEMINI_MODEL: store.customEnv['GEMINI_MODEL'] || '',
      GEMINI_THINKING_LEVEL: store.customEnv['GEMINI_THINKING_LEVEL'] || 'disabled',
      OPENROUTER_API_KEY: store.customEnv['OPENROUTER_API_KEY'] || '',
      OPENROUTER_BASE_URL: store.customEnv['OPENROUTER_BASE_URL'] || '',
      OPENROUTER_MODEL: store.customEnv['OPENROUTER_MODEL'] || '',
      OPENROUTER_REASONING_EFFORT: store.customEnv['OPENROUTER_REASONING_EFFORT'] || 'disabled',
      OPENROUTER_REFERER: store.customEnv['OPENROUTER_REFERER'] || '',
      OPENROUTER_APP_TITLE: store.customEnv['OPENROUTER_APP_TITLE'] || 'Dumka Mail',
      DEEPSEEK_API_KEY: store.customEnv['DEEPSEEK_API_KEY'] || '',
      DEEPSEEK_BASE_URL: store.customEnv['DEEPSEEK_BASE_URL'] || '',
      DEEPSEEK_MODEL: store.customEnv['DEEPSEEK_MODEL'] || '',
      DEEPSEEK_THINKING: store.customEnv['DEEPSEEK_THINKING'] || 'disabled',
      DEEPSEEK_REASONING_EFFORT: store.customEnv['DEEPSEEK_REASONING_EFFORT'] || 'disabled',
      OPENAI_COMPATIBLE_API_KEY: store.customEnv['OPENAI_COMPATIBLE_API_KEY'] || '',
      OPENAI_COMPATIBLE_BASE_URL: store.customEnv['OPENAI_COMPATIBLE_BASE_URL'] || '',
      OPENAI_COMPATIBLE_MODEL: store.customEnv['OPENAI_COMPATIBLE_MODEL'] || '',
      PMC_AI_PROVIDER: store.customEnv['PMC_AI_PROVIDER'] || 'automatic'
    });
  }, [store.customEnv]);

  const handleUpdateSetting = async (key: string, value: string) => {
    setFormKeys(prev => ({ ...prev, [key]: value }));
    await store.saveAIConfig({ [key]: value });
  };

  const handleSecretBlur = async (key: string, value: string) => {
    const trimmed = value.trim();
    if (!trimmed || isStoredSecretPlaceholder(trimmed)) return;
    await store.saveAIConfig({ [key]: trimmed });
  };

  const handleVerify = async (provider: string) => {
    const configurableProvider = getConfigurableProvider(provider);
    if (!configurableProvider) return;

    const providerConfig = getAIProviderConfig(configurableProvider);
    const keyField = providerConfig.apiKeyEnv;
    const urlField = providerConfig.baseUrlEnv;
    
    const key = formKeys[keyField] || '';
    const baseUrl = formKeys[urlField] || '';
    
    if (providerConfig.requiresApiKeyForModels && !key) {
      emitToast({ type: 'warning', message: 'Please enter an API key first.' });
      return;
    }
    if (providerConfig.requiresBaseUrlForModels && !baseUrl) {
      emitToast({ type: 'warning', message: 'Please enter a Base URL first.' });
      return;
    }

    setVerifyStatus(prev => ({ ...prev, [provider]: { status: 'verifying' } }));
    try {
      const models = await store.verifyConnectionAndFetchModels(provider, key, baseUrl);
      const settingsToSave: Record<string, string> = {
        [keyField]: key,
        [urlField]: baseUrl,
      };
      if (provider === 'openRouter') {
        settingsToSave.OPENROUTER_REFERER = formKeys.OPENROUTER_REFERER || '';
        settingsToSave.OPENROUTER_APP_TITLE = formKeys.OPENROUTER_APP_TITLE || 'Dumka Mail';
      }
      await store.saveAIConfig(settingsToSave);
      setVerifyStatus(prev => ({ 
        ...prev, 
        [provider]: { status: 'success' } 
      }));
      
      const modelField = providerConfig.modelEnv;
      if (!formKeys[modelField] && models.length > 0) {
        await handleUpdateSetting(modelField, models[0]);
      }
    } catch (err: any) {
      console.error(err);
      setVerifyStatus(prev => ({ 
        ...prev, 
        [provider]: { status: 'error', error: err.message || String(err) } 
      }));
    }
  };

  const handleSaveAIKeys = async () => {
    const credentialsOnly = {
      OPENAI_API_KEY: formKeys.OPENAI_API_KEY || '',
      OPENAI_BASE_URL: formKeys.OPENAI_BASE_URL || '',
      ANTHROPIC_API_KEY: formKeys.ANTHROPIC_API_KEY || '',
      ANTHROPIC_BASE_URL: formKeys.ANTHROPIC_BASE_URL || '',
      GEMINI_API_KEY: formKeys.GEMINI_API_KEY || '',
      GEMINI_BASE_URL: formKeys.GEMINI_BASE_URL || '',
      OPENROUTER_API_KEY: formKeys.OPENROUTER_API_KEY || '',
      OPENROUTER_BASE_URL: formKeys.OPENROUTER_BASE_URL || '',
      OPENROUTER_REFERER: formKeys.OPENROUTER_REFERER || '',
      OPENROUTER_APP_TITLE: formKeys.OPENROUTER_APP_TITLE || 'Dumka Mail',
      DEEPSEEK_API_KEY: formKeys.DEEPSEEK_API_KEY || '',
      DEEPSEEK_BASE_URL: formKeys.DEEPSEEK_BASE_URL || '',
      OPENAI_COMPATIBLE_API_KEY: formKeys.OPENAI_COMPATIBLE_API_KEY || '',
      OPENAI_COMPATIBLE_BASE_URL: formKeys.OPENAI_COMPATIBLE_BASE_URL || '',
    };
    await store.saveAIConfig(credentialsOnly);
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const renderReasoningSelect = (key: string, options: Array<[string, string]>) => (
    <div className="flex flex-col gap-1 mt-1 max-w-[280px]">
      <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Thinking / Reasoning Level:</label>
      <select
        value={formKeys[key] || 'disabled'}
        onChange={(e) => handleUpdateSetting(key, e.target.value)}
        className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
      >
        {options.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
  );

  const renderThinkingConfig = (provider: string) => {
    if (provider === 'openAI') return renderReasoningSelect('OPENAI_REASONING_EFFORT', [['disabled', 'Disabled / None'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High']]);
    if (provider === 'anthropic') return renderReasoningSelect('ANTHROPIC_THINKING_EFFORT', [['disabled', 'Disabled'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High (Default)'], ['max', 'Max']]);
    if (provider === 'gemini') return renderReasoningSelect('GEMINI_THINKING_LEVEL', [['disabled', 'Disabled'], ['LOW', 'Low'], ['MEDIUM', 'Medium'], ['HIGH', 'High']]);
    if (provider === 'openRouter') return renderReasoningSelect('OPENROUTER_REASONING_EFFORT', [['disabled', 'Disabled'], ['minimal', 'Minimal'], ['low', 'Low'], ['medium', 'Medium'], ['high', 'High'], ['xhigh', 'XHigh'], ['max', 'Max']]);
    if (provider === 'deepSeek') {
      return (
        <div className="flex flex-col gap-2 mt-1 max-w-[280px]">
          <div className="flex flex-col gap-1">
            <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Thinking Mode:</label>
            <select
              value={formKeys.DEEPSEEK_THINKING || 'disabled'}
              onChange={(e) => handleUpdateSetting('DEEPSEEK_THINKING', e.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="disabled">Disabled</option>
              <option value="enabled">Enabled</option>
            </select>
          </div>
          {formKeys.DEEPSEEK_THINKING === 'enabled' && (
            <div className="flex flex-col gap-1">
              <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Reasoning Effort:</label>
              <select
                value={formKeys.DEEPSEEK_REASONING_EFFORT || 'disabled'}
                onChange={(e) => handleUpdateSetting('DEEPSEEK_REASONING_EFFORT', e.target.value)}
                className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
              >
                <option value="disabled">Default / Standard</option>
                <option value="high">High</option>
                <option value="max">Max</option>
              </select>
            </div>
          )}
        </div>
      );
    }
    return null;
  };

  const renderProviderVerificationAndModel = (provider: string) => {
    const configurableProvider = getConfigurableProvider(provider);
    if (!configurableProvider) return null;

    const providerConfig = getAIProviderConfig(configurableProvider);
    const modelField = providerConfig.modelEnv;
    const statusObj = verifyStatus[provider] || { status: 'idle' };
    const cachedModels = store.modelsCache[provider] || [];
    const hasCached = cachedModels.length > 0;

    return (
      <div className="flex flex-col gap-2 mt-1.5 bg-[var(--rail-bg)] border border-[var(--border)] rounded p-2.5">
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={() => handleVerify(provider)}
            disabled={statusObj.status === 'verifying'}
            className="flex items-center gap-1 px-2.5 py-1 border border-[var(--border)] text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded cursor-pointer transition-colors disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] active:translate-y-px"
          >
            <RefreshCw className={`w-3 h-3 ${statusObj.status === 'verifying' ? 'animate-spin' : ''}`} />
            {statusObj.status === 'verifying' 
              ? 'Verifying…' 
              : (hasCached ? 'Update Models List' : 'Verify & Fetch Models')}
          </button>

          {statusObj.status === 'success' && (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--success)] font-medium flex items-center gap-0.5">
              <Check className="w-3.5 h-3.5" /> Verified
            </span>
          )}
          {statusObj.status === 'error' && (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--danger)] font-medium flex items-start gap-1">
              <AlertCircle className="w-3 h-3 shrink-0 mt-0.5" />
              <span className="max-w-[300px] leading-tight truncate">{statusObj.error}</span>
            </span>
          )}
        </div>

        {hasCached && (
          <div className="flex flex-col gap-1 mt-1 max-w-[280px]">
            <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Default Model:</label>
            <select
              value={formKeys[modelField] || ''}
              onChange={(e) => handleUpdateSetting(modelField, e.target.value)}
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
            >
              <option value="">-- Select Model --</option>
              {cachedModels.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        )}

        {renderThinkingConfig(provider)}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-5 max-w-[600px] select-text">
      <div>
        <h2 className="text-[calc(14px*var(--font-scale))] font-semibold text-[var(--text-primary)] mb-1">AI Configuration</h2>
        <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">Setup model default providers, verify keys, and adjust response behaviors.</p>
      </div>

      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">AI Provider Preference</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Active model orchestration driver</span>
          </div>
          <select
            value={formKeys.PMC_AI_PROVIDER || 'automatic'}
            onChange={(e) => {
              const val = e.target.value;
              setFormKeys(prev => ({ ...prev, PMC_AI_PROVIDER: val }));
              store.updateSettings(s => { s.ai.provider = val as any; });
              store.setAiProvider(val as any);
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="automatic">Automatic</option>
            <option value="openAI">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
            <option value="openRouter">OpenRouter</option>
            <option value="deepSeek">DeepSeek</option>
            <option value="openAICompatible">Local OpenCompatible</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Global Default Model</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Target model for triage generation and summaries</span>
          </div>
          <input
            type="text"
            placeholder="e.g. gpt-5.4-mini, gemini-3.5-flash"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.ai.globalDefaultModel}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.ai.globalDefaultModel = val; });
            }}
          />
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">Response Tone</span>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Tone mode for draft suggestions</span>
          </div>
          <select
            value={store.settings.ai.replyTone}
            onChange={(e) => {
              const val = e.target.value as any;
              store.updateSettings(s => { s.ai.replyTone = val; });
            }}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="direct">Direct</option>
            <option value="concise">Concise</option>
            <option value="warm">Warm</option>
            <option value="formal">Formal</option>
          </select>
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        <div className="flex flex-col gap-1">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Personalization Notes:</span>
          <textarea
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none min-h-[50px] resize-none leading-normal"
            placeholder="e.g. Keep suggestions direct. Prefer short, high-signal comments."
            value={store.settings.ai.personalizationNotes}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.ai.personalizationNotes = val; });
            }}
          />
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]" />

        {[
          { key: 'allowMailBodyContext', title: 'Include Email bodies in AI Context', desc: 'Allows sending mail message plain text for summaries' },
          { key: 'savePromptHistory', title: 'Save Local Prompt History', desc: 'Log previous inputs in conversation list' },
          { key: 'suggestDrafts', title: 'Generate Suggest Drafts', desc: 'Show draft reply buttons inside thread details' },
          { key: 'suggestAutoArchive', title: 'Suggest Auto-Archive Rules', desc: 'Highlight low-priority alerts cleanup' },
          { key: 'suggestLabels', title: 'Suggest Labels', desc: 'Perform labeling suggestions' },
          { key: 'translationEnabled', title: 'Enable Realtime Translation', desc: 'Support translating foreign mail threads' },
        ].map(item => (
          <div key={item.key} className="flex items-center justify-between py-0.5">
            <div className="flex flex-col gap-0.5">
              <span className="text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{item.title}</span>
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">{item.desc}</span>
            </div>
            <Toggle
              checked={(store.settings.ai as any)[item.key]}
              onChange={(val) => store.updateSettings(s => { (s.ai as any)[item.key] = val; })}
            />
          </div>
        ))}
      </div>

      <AIPromptShortcutsPanel />

      {/* Provider configurations (Keys) */}
      <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
        <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Credentials & Endpoint Configuration</span>
        
        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">OpenAI</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENAI_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.OPENAI_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('OPENAI_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENAI_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Custom Base URL (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENAI_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENAI_BASE_URL: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('openAI')}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40 mt-1" />

        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">Anthropic</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.ANTHROPIC_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.ANTHROPIC_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('ANTHROPIC_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, ANTHROPIC_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Custom Base URL (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.ANTHROPIC_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, ANTHROPIC_BASE_URL: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('anthropic')}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40 mt-1" />

        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">Google Gemini</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.GEMINI_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.GEMINI_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('GEMINI_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, GEMINI_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Custom Base URL (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.GEMINI_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, GEMINI_BASE_URL: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('gemini')}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40 mt-1" />

        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">OpenRouter</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENROUTER_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.OPENROUTER_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('OPENROUTER_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENROUTER_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Base URL (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENROUTER_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENROUTER_BASE_URL: e.target.value }))}
            />
            <input
              type="text"
              placeholder="HTTP Referer (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENROUTER_REFERER || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENROUTER_REFERER: e.target.value }))}
            />
            <input
              type="text"
              placeholder="App title"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENROUTER_APP_TITLE || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENROUTER_APP_TITLE: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('openRouter')}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40 mt-1" />

        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">DeepSeek</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.DEEPSEEK_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.DEEPSEEK_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('DEEPSEEK_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, DEEPSEEK_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Custom Base URL (optional)"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.DEEPSEEK_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, DEEPSEEK_BASE_URL: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('deepSeek')}
        </div>

        <div className="w-full h-[1px] bg-[var(--border)]/40 mt-1" />

        <div className="flex flex-col gap-3">
          <span className="text-[calc(10px*var(--font-scale))] font-bold text-[var(--text-primary)]">OpenAI-Compatible (Local Ollama / LM Studio)</span>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="password"
              placeholder="API Key"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENAI_COMPATIBLE_API_KEY || ''}
              onFocus={(e) => {
                if (isStoredSecretPlaceholder(formKeys.OPENAI_COMPATIBLE_API_KEY)) e.currentTarget.select();
              }}
              onBlur={(e) => void handleSecretBlur('OPENAI_COMPATIBLE_API_KEY', e.currentTarget.value)}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENAI_COMPATIBLE_API_KEY: e.target.value }))}
            />
            <input
              type="text"
              placeholder="Endpoint URL"
              className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
              value={formKeys.OPENAI_COMPATIBLE_BASE_URL || ''}
              onChange={(e) => setFormKeys(prev => ({ ...prev, OPENAI_COMPATIBLE_BASE_URL: e.target.value }))}
            />
          </div>
          {renderProviderVerificationAndModel('openAICompatible')}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={handleSaveAIKeys}
            className="px-4 py-1.5 bg-[var(--accent)] text-white rounded font-medium text-[calc(11px*var(--font-scale))] cursor-pointer hover:bg-[var(--accent)]/95 transition-colors"
          >
            Save API Configuration
          </button>
          {savedStatus && (
            <span className="text-[calc(10px*var(--font-scale))] text-[var(--success)] font-medium flex items-center gap-1">
              <CheckCircle className="w-3.5 h-3.5" /> API Keys saved successfully
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
