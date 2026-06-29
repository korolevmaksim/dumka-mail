import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/AppStore';
import {
  Sparkles, Pin, PinOff, Plus, X, Send,
  ListChecks, Text, PenLine, Wand2, Languages,
  type LucideIcon
} from 'lucide-react';
import { AI_ACTIONS } from '../../../../shared/types';
import { ConfigurableAIProvider, getAIProviderConfig, isConfigurableAIProvider, resolveConfiguredProviderModel } from '../../../../shared/aiProviders';
import { AITriagePlanCard } from '../AITriagePlanCard';
import { SearchableSelect } from '../common/SearchableSelect';

const AI_ICON: Record<string, LucideIcon> = {
  ListChecks, Text, PenLine, Wand2, Languages,
};

const THINKING_CONTROLS: Partial<Record<ConfigurableAIProvider, {
  envKey: string;
  linkedEnv?: { key: string; enabledValue: string; disabledValue: string };
  options: { value: string; label: string }[];
}>> = {
  openAI: {
    envKey: 'OPENAI_REASONING_EFFORT',
    options: [
      { value: 'disabled', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
    ],
  },
  anthropic: {
    envKey: 'ANTHROPIC_THINKING_EFFORT',
    options: [
      { value: 'disabled', label: 'Off' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
  },
  gemini: {
    envKey: 'GEMINI_THINKING_LEVEL',
    options: [
      { value: 'disabled', label: 'Off' },
      { value: 'LOW', label: 'Low' },
      { value: 'MEDIUM', label: 'Medium' },
      { value: 'HIGH', label: 'High' },
    ],
  },
  openRouter: {
    envKey: 'OPENROUTER_REASONING_EFFORT',
    options: [
      { value: 'disabled', label: 'Off' },
      { value: 'minimal', label: 'Minimal' },
      { value: 'low', label: 'Low' },
      { value: 'medium', label: 'Medium' },
      { value: 'high', label: 'High' },
      { value: 'xhigh', label: 'XHigh' },
      { value: 'max', label: 'Max' },
    ],
  },
  deepSeek: {
    envKey: 'DEEPSEEK_REASONING_EFFORT',
    linkedEnv: { key: 'DEEPSEEK_THINKING', enabledValue: 'enabled', disabledValue: 'disabled' },
    options: [
      { value: 'disabled', label: 'Off' },
      { value: 'high', label: 'High' },
      { value: 'max', label: 'Max' },
    ],
  },
};

export function AICopilotPanel() {
  const store = useAppStore();
  const [aiInput, setAiInput] = useState('');
  const [isAiUndocked, setIsAiUndocked] = useState(false);
  const [aiPosition, setAiPosition] = useState({ x: 96, y: 60 });
  const [isAiDragging, setIsAiDragging] = useState(false);
  const aiDragStartRef = useRef({ x: 0, y: 0 });
  const aiMessagesRef = useRef<HTMLDivElement>(null);

  // Handle dragging logic
  useEffect(() => {
    if (!isAiDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      const newX = e.clientX - aiDragStartRef.current.x;
      const newY = e.clientY - aiDragStartRef.current.y;
      
      const maxX = window.innerWidth - 340;
      const maxY = window.innerHeight - 500;
      
      setAiPosition({
        x: Math.max(0, Math.min(newX, maxX)),
        y: Math.max(0, Math.min(newY, maxY))
      });
    };

    const handleMouseUp = () => {
      setIsAiDragging(false);
    };

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isAiDragging]);

  useEffect(() => {
    if (!store.triagePlan) return;
    aiMessagesRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [store.triagePlan?.generatedAt]);

  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const effectiveProvider = store.aiProvider === 'automatic' ? store.aiProviderDesc?.preference : store.aiProvider;
  const modelProvider = effectiveProvider && isConfigurableAIProvider(effectiveProvider) ? effectiveProvider : null;
  const thinkingControl = modelProvider ? THINKING_CONTROLS[modelProvider] : null;
  const configuredModel = modelProvider
    ? resolveConfiguredProviderModel(modelProvider, store.customEnv)
    : '';

  const updateThinkingLevel = async (value: string) => {
    if (!thinkingControl) return;
    const config: Record<string, string> = { [thinkingControl.envKey]: value };
    if (thinkingControl.linkedEnv) {
      config[thinkingControl.linkedEnv.key] = value === 'disabled'
        ? thinkingControl.linkedEnv.disabledValue
        : thinkingControl.linkedEnv.enabledValue;
    }
    await store.saveAIConfig(config);
  };

  const updateProvider = (provider: string) => {
    store.setAiProvider(provider as any);
    if (isConfigurableAIProvider(provider)) {
      store.setAiModel(resolveConfiguredProviderModel(provider, store.customEnv));
    }
  };

  const updateModel = async (model: string) => {
    store.setAiModel(model);
    if (!modelProvider) return;
    const providerConfig = getAIProviderConfig(modelProvider);
    await store.saveAIConfig({ [providerConfig.modelEnv]: model });
  };

  useEffect(() => {
    if (!modelProvider || !configuredModel) return;
    store.setAiModel(configuredModel);
  }, [modelProvider, configuredModel]);

  useEffect(() => {
    let active = true;
    if (!modelProvider) {
      setModelList([]);
      setLoadingModels(false);
      return;
    }

    const cachedModels = store.modelsCache[modelProvider] || [];
    if (cachedModels.length > 0) {
      setModelList(cachedModels);
      setLoadingModels(false);
      return;
    }
    
    setLoadingModels(true);
    store.fetchModelsForProvider(modelProvider).then(fetched => {
      if (!active) return;
      setLoadingModels(false);
      if (fetched && fetched.length > 0) {
        setModelList(fetched);
      } else {
        setModelList([getAIProviderConfig(modelProvider).defaultModel]);
      }
    }).catch(err => {
      if (!active) return;
      console.error(`Failed to load models for ${modelProvider}:`, err);
      setLoadingModels(false);
      setModelList([store.aiModel || getAIProviderConfig(modelProvider).defaultModel]);
    });

    return () => { active = false; };
  }, [modelProvider, store.customEnv, store.modelsCache, store.aiModel]);

  return (
    <div 
      className={
        isAiUndocked
          ? "panel-surface absolute w-[340px] h-[600px] max-h-[85vh] border border-[var(--strong-border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden rounded-xl shadow-2xl z-50"
          : "panel-surface w-[340px] border-r border-[var(--border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden h-full shrink-0"
      }
      style={isAiUndocked ? { 
        left: `${aiPosition.x}px`, 
        top: `${aiPosition.y}px`,
        boxShadow: isAiDragging ? '0 25px 50px -12px rgb(0 0 0 / 0.5)' : '0 20px 25px -5px rgb(0 0 0 / 0.3)'
      } : undefined}
    >
      
      {/* Panel Header */}
      <div 
        className={`flex items-center justify-between h-[48px] px-4 border-b border-[var(--border)] bg-[var(--rail-bg)] select-none ${isAiUndocked ? 'cursor-move' : ''}`}
        onMouseDown={(e) => {
          if (isAiUndocked) {
            e.preventDefault();
            setIsAiDragging(true);
            aiDragStartRef.current = {
              x: e.clientX - aiPosition.x,
              y: e.clientY - aiPosition.y
            };
          }
        }}
      >
        <div className="flex items-center gap-1.5 font-semibold text-[calc(13px*var(--font-scale))] text-[var(--text-primary)]">
          <Sparkles className="w-4 h-4 text-[var(--ai-accent)]" /> AI Assistant
        </div>
        
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button 
            onClick={() => setIsAiUndocked(!isAiUndocked)}
            title={isAiUndocked ? "Dock to Left" : "Undock Panel"}
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer"
          >
            {isAiUndocked ? (
              <Pin className="w-4 h-4 text-[var(--text-primary)]" />
            ) : (
              <PinOff className="w-4 h-4 text-[var(--text-secondary)]" />
            )}
          </button>
          <button 
            onClick={() => store.startNewAIConversation()}
            title="New Chat"
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer"
          >
            <Plus className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
          <button
            onClick={() => store.setAiPanelOpen(false)}
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer"
          >
            <X className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>
      </div>

      {/* Model provider picker */}
      <div className="flex flex-col gap-1.5 px-4 py-2 border-b border-[var(--border)] bg-[var(--app-bg)] text-[calc(10px*var(--font-scale))]">
        <div className="flex items-center justify-between">
          <span className="text-[var(--text-secondary)]">Provider:</span>
          <select
            value={store.aiProvider}
            onChange={(e) => updateProvider(e.target.value)}
            className="bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
          >
            <option value="automatic">Automatic</option>
            <option value="openAI">OpenAI</option>
            <option value="anthropic">Anthropic</option>
            <option value="gemini">Gemini</option>
            <option value="openRouter">OpenRouter</option>
            <option value="deepSeek">DeepSeek</option>
            <option value="openAICompatible">Local Compatible</option>
            <option value="disabled">Disabled</option>
          </select>
        </div>
        {modelProvider && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-[var(--text-secondary)]">Model:</span>
            {loadingModels ? (
              <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] animate-pulse">Loading…</span>
            ) : (
              <SearchableSelect
                value={store.aiModel || configuredModel}
                options={modelList}
                onChange={(model) => void updateModel(model)}
                placeholder="Search models"
                emptyLabel="No models found"
                className="w-[190px]"
              />
            )}
          </div>
        )}
        {thinkingControl && (
          <div className="flex items-center justify-between mt-1">
            <span className="text-[var(--text-secondary)]">Thinking:</span>
            <select
              value={store.customEnv[thinkingControl.envKey] || 'disabled'}
              onChange={(e) => void updateThinkingLevel(e.target.value)}
              className="bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] max-w-[160px] outline-none cursor-pointer focus:outline focus:outline-2 focus:outline-[var(--accent)]"
            >
              {thinkingControl.options.map(option => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* AI action buttons (AI-C1) */}
      <div className="grid grid-cols-2 gap-1.5 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--app-bg)]">
        {AI_ACTIONS.map((a) => {
          const Icon = AI_ICON[a.icon] || Sparkles;
          const queueUnavailable = a.id === 'queue' && (!store.activeAccount || store.visibleThreads.length === 0);
          const disabled = queueUnavailable || (a.requiresThread && !store.openedThread) || store.aiPanelLoading;
          const title = a.id === 'queue'
            ? (!store.activeAccount
              ? 'Connect an account first'
              : store.visibleThreads.length === 0
                ? 'No visible messages to triage in this tab'
                : `Build a triage plan for ${store.visibleThreads.length} visible messages`)
            : a.requiresThread && !store.openedThread
              ? 'Open a thread first'
              : a.label;
          return (
            <button
              key={a.id}
              disabled={disabled}
              onClick={() => store.runAIAction(a.id)}
              title={title}
              className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--ai-accent)]/50 hover:bg-[var(--ai-accent)]/8 transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
            >
              <Icon className="w-3.5 h-3.5 text-[var(--ai-accent)] shrink-0" />
              <span className="truncate">{a.label}</span>
            </button>
          );
        })}
      </div>

      {/* Chat Messages container */}
      <div ref={aiMessagesRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-[var(--app-bg)]">
        {/* Triage / Summarize plan badge */}
        {store.triagePlan && (
          <AITriagePlanCard />
        )}

        {store.activeAIMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center py-20 text-[var(--text-secondary)] opacity-50 select-none">
            <Sparkles className="w-8 h-8 mb-2 text-[var(--ai-accent)]" />
            <p>Start a conversation. AI can review open threads or help draft replies.</p>
          </div>
        ) : (
          store.activeAIMessages.map((m) => (
            <div
              key={m.id}
              className={`flex flex-col gap-1 rounded-lg p-3 max-w-[90%] ${
                m.role === 'user'
                  ? 'bg-[var(--accent)]/10 self-end border border-[var(--accent)]/20'
                  : m.role === 'system'
                    ? 'bg-[var(--warning)]/12 self-center border border-[var(--warning)]/25 w-full max-w-full'
                    : 'bg-[var(--border)]/30 self-start border border-[var(--border)]'
              }`}
            >
              <span className="text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">
                {m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Assistant'}
              </span>
              <p className={`text-[calc(11px*var(--font-scale))] whitespace-pre-wrap select-text ${m.role === 'system' ? 'text-[var(--warning)]' : 'text-[var(--text-primary)]'}`}>
                {m.text}
              </p>
            </div>
          ))
        )}

        {store.aiPanelLoading && (
          <div className="flex items-center gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] self-start animate-pulse p-2">
            <Sparkles className="w-3.5 h-3.5 text-[var(--ai-accent)]" /> Assistant is thinking…
          </div>
        )}
      </div>

      {/* AI input Form */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--rail-bg)]">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!aiInput.trim()) return;
            store.sendAIMessage(aiInput);
            setAiInput('');
          }}
          className="flex items-center gap-1.5"
        >
          <input
            type="text"
            placeholder="Ask assistant…"
            className="flex-1 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-2.5 py-1.5 outline-none focus:outline focus:outline-2 focus:outline-[var(--ai-accent)] focus:outline-offset-1 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
          />
          <button 
            type="submit" 
            className="p-1.5 bg-[var(--ai-accent)] text-white rounded cursor-pointer hover:bg-[var(--ai-accent)]/95"
          >
            <Send className="w-4 h-4" />
          </button>
        </form>
      </div>

    </div>
  );
}
