import { useState, useEffect } from 'react';
import { useAppStore } from '../../../stores/AppStore';
import { CheckCircle, RefreshCw, Check, AlertCircle } from 'lucide-react';
import { Toggle } from '../SettingsControls';
import { emitToast } from '../../../lib/toastBus';
import { AI_SECRET_STORED_PLACEHOLDER } from '../../../../../shared/types';

type FormKeys = Record<string, string>;
type VerifyStatus = Record<string, { status: 'idle' | 'verifying' | 'success' | 'error'; error?: string }>;

const isStoredSecretPlaceholder = (value?: string) => value === AI_SECRET_STORED_PLACEHOLDER;

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

  const handleVerify = async (provider: string) => {
    const keyField = provider === 'openAICompatible' ? 'OPENAI_COMPATIBLE_API_KEY' : `${provider.toUpperCase()}_API_KEY`;
    const urlField = provider === 'openAICompatible' ? 'OPENAI_COMPATIBLE_BASE_URL' : `${provider.toUpperCase()}_BASE_URL`;
    
    const key = formKeys[keyField] || '';
    const baseUrl = formKeys[urlField] || '';

    if (isStoredSecretPlaceholder(key)) {
      emitToast({ type: 'info', message: 'Stored Keychain keys are available to AI requests. Enter a new key to verify or replace it.' });
      return;
    }
    
    if (provider !== 'openAICompatible' && !key) {
      emitToast({ type: 'warning', message: 'Please enter an API key first.' });
      return;
    }
    if (provider === 'openAICompatible' && !baseUrl) {
      emitToast({ type: 'warning', message: 'Please enter a Base URL first.' });
      return;
    }

    setVerifyStatus(prev => ({ ...prev, [provider]: { status: 'verifying' } }));
    try {
      const models = await store.verifyConnectionAndFetchModels(provider, key, baseUrl);
      setVerifyStatus(prev => ({ 
        ...prev, 
        [provider]: { status: 'success' } 
      }));
      
      const modelField = provider === 'openAICompatible' ? 'OPENAI_COMPATIBLE_MODEL' : `${provider.toUpperCase()}_MODEL`;
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
      DEEPSEEK_API_KEY: formKeys.DEEPSEEK_API_KEY || '',
      DEEPSEEK_BASE_URL: formKeys.DEEPSEEK_BASE_URL || '',
      OPENAI_COMPATIBLE_API_KEY: formKeys.OPENAI_COMPATIBLE_API_KEY || '',
      OPENAI_COMPATIBLE_BASE_URL: formKeys.OPENAI_COMPATIBLE_BASE_URL || '',
    };
    await store.saveAIConfig(credentialsOnly);
    setSavedStatus(true);
    setTimeout(() => setSavedStatus(false), 2000);
  };

  const renderThinkingConfig = (provider: string) => {
    if (provider === 'openAI') {
      return (
        <div className="flex flex-col gap-1 mt-1 max-w-[280px]">
          <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Thinking / Reasoning Level:</label>
          <select
            value={formKeys.OPENAI_REASONING_EFFORT || 'disabled'}
            onChange={(e) => handleUpdateSetting('OPENAI_REASONING_EFFORT', e.target.value)}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="disabled">Disabled / None</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
          </select>
        </div>
      );
    }
    if (provider === 'anthropic') {
      return (
        <div className="flex flex-col gap-1 mt-1 max-w-[280px]">
          <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Thinking / Reasoning Level:</label>
          <select
            value={formKeys.ANTHROPIC_THINKING_EFFORT || 'disabled'}
            onChange={(e) => handleUpdateSetting('ANTHROPIC_THINKING_EFFORT', e.target.value)}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="disabled">Disabled</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High (Default)</option>
            <option value="max">Max</option>
          </select>
        </div>
      );
    }
    if (provider === 'gemini') {
      return (
        <div className="flex flex-col gap-1 mt-1 max-w-[280px]">
          <label className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-semibold">Thinking / Reasoning Level:</label>
          <select
            value={formKeys.GEMINI_THINKING_LEVEL || 'disabled'}
            onChange={(e) => handleUpdateSetting('GEMINI_THINKING_LEVEL', e.target.value)}
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="disabled">Disabled</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
          </select>
        </div>
      );
    }
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
    const modelField = provider === 'openAICompatible' ? 'OPENAI_COMPATIBLE_MODEL' : `${provider.toUpperCase()}_MODEL`;
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
            placeholder="e.g. gpt-4o-mini, gemini-2.5-flash"
            className="bg-[var(--app-bg)] border border-[var(--border)] rounded px-2.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none"
            value={store.settings.ai.globalDefaultModel}
            onChange={(e) => {
              const val = e.target.value;
              store.updateSettings(s => { s.ai.globalDefaultModel = val; });
              store.setAiModel(val);
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
