import { useState, useRef, useEffect, type MouseEvent as ReactMouseEvent } from 'react';
import { useAppStore } from '../../stores/AppStore';
import {
  Sparkles, Pin, PinOff, Plus, X, Send,
  ListChecks, Text, PenLine, Wand2, Languages,
  SlidersHorizontal, ChevronDown, SunMedium, ExternalLink, MailSearch,
  type LucideIcon
} from 'lucide-react';
import { AI_ACTIONS, type AIProviderPreference, type MailboxSearchSource, type MailThread } from '../../../../shared/types';
import { ConfigurableAIProvider, getAIProviderConfig, isConfigurableAIProvider, resolveConfiguredProviderModel } from '../../../../shared/aiProviders';
import { isAIProviderPreference } from '../../../../shared/aiProviderPreference';
import { DailyBriefingCard } from '../DailyBriefingCard';
import { AgentReviewQueueCard } from '../AgentReviewQueueCard';
import { SearchableSelect } from '../common/SearchableSelect';
import { compileMarkdownToHtmlFragment } from '../../../../shared/markdown';
import { AIPromptShortcutStrip } from './AIPromptShortcutStrip';

const AI_ICON: Record<string, LucideIcon> = {
  ListChecks, Text, PenLine, Wand2, Languages,
};

type ResizeMode = 'dockedWidth' | 'floatingSize' | null;

const MIN_AI_WIDTH = 300;
const MAX_AI_WIDTH = 560;
const MIN_AI_HEIGHT = 420;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

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

function AIMessageContent({ role, text }: { role: string; text: string }) {
  if (role !== 'assistant') {
    return (
      <p className={`text-[calc(11px*var(--font-scale))] whitespace-pre-wrap select-text ${role === 'system' ? 'text-[var(--warning)]' : 'text-[var(--text-primary)]'}`}>
        {text}
      </p>
    );
  }

  return (
    <div
      className="ai-markdown text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] select-text"
      dangerouslySetInnerHTML={{ __html: compileMarkdownToHtmlFragment(text) }}
    />
  );
}

function formatSourceDate(value?: string | null): string {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date);
}

function sourceKindLabel(source: MailboxSearchSource): string {
  if (source.sourceKind === 'hybrid') return 'Hybrid';
  if (source.sourceKind === 'semantic') return 'Semantic';
  return 'FTS';
}

function escapeCssValue(value: string): string {
  const css = (globalThis as any).CSS;
  if (css && typeof css.escape === 'function') return css.escape(value);
  return value.replace(/["\\]/g, '\\$&');
}

function fallbackThreadFromSource(source: MailboxSearchSource): MailThread {
  return {
    id: source.threadId,
    accountId: source.accountId,
    subject: source.subject,
    snippet: source.snippet,
    lastMessageAt: source.lastMessageAt || source.receivedAt || new Date(0).toISOString(),
    senderNames: [source.sender],
    senderEmail: source.senderEmail || source.sender,
    labelIds: [],
    hasAttachments: false,
    isUnread: false,
  };
}

function MailboxSourceCards({
  sources,
  onOpen,
}: {
  sources: MailboxSearchSource[];
  onOpen: (source: MailboxSearchSource) => void;
}) {
  if (sources.length === 0) return null;

  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <div className="flex items-center gap-1 text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
        <MailSearch className="h-3 w-3" />
        Mailbox Sources
      </div>
      {sources.map(source => (
        <button
          key={`${source.accountId}:${source.threadId}:${source.messageId || ''}`}
          type="button"
          onClick={() => onOpen(source)}
          title="Open source thread"
          className="group flex w-full min-w-0 flex-col gap-1 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] p-2 text-left transition-colors hover:border-[var(--ai-accent)]/50 hover:bg-[var(--ai-accent)]/8 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
        >
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="shrink-0 rounded border border-[var(--border)] px-1 py-0.5 text-[calc(8px*var(--font-scale))] font-semibold uppercase text-[var(--text-tertiary)]">
              {sourceKindLabel(source)}
            </span>
            <span className="min-w-0 flex-1 truncate text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              {source.subject || '(No subject)'}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--ai-accent)]" />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
            <span className="truncate">{source.sender}</span>
            {formatSourceDate(source.receivedAt || source.lastMessageAt) && (
              <>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span className="shrink-0">{formatSourceDate(source.receivedAt || source.lastMessageAt)}</span>
              </>
            )}
          </div>
          {source.snippet && (
            <p className="line-clamp-2 text-[calc(10px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
              {source.snippet}
            </p>
          )}
          {source.whyMatched && (
            <span className="text-[calc(8px*var(--font-scale))] text-[var(--text-tertiary)]">{source.whyMatched}</span>
          )}
        </button>
      ))}
      <p className="text-[calc(8px*var(--font-scale))] leading-snug text-[var(--text-tertiary)]">
        Searched the local cache. The AI provider saw only these bounded snippets/results, not the full mailbox by default.
      </p>
    </div>
  );
}

export function AICopilotPanel() {
  const store = useAppStore();
  const [aiInput, setAiInput] = useState('');
  const [isAiUndocked, setIsAiUndocked] = useState(false);
  const [aiPosition, setAiPosition] = useState({ x: 96, y: 60 });
  const [aiPanelSize, setAiPanelSize] = useState({ width: 340, height: 600 });
  const [isAiDragging, setIsAiDragging] = useState(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>(null);
  const [aiControlsOpen, setAiControlsOpen] = useState(false);
  const aiDragStartRef = useRef({ x: 0, y: 0 });
  const aiResizeStartRef = useRef({ x: 0, y: 0, width: 340, height: 600 });
  const aiMessagesRef = useRef<HTMLDivElement>(null);
  const aiControlsRef = useRef<HTMLDivElement>(null);

  const openMailboxSource = async (source: MailboxSearchSource) => {
    const thread = store.threads.find(item => item.accountId === source.accountId && item.id === source.threadId)
      || fallbackThreadFromSource(source);
    await store.openThread(thread);
    if (!source.messageId) return;
    window.setTimeout(() => {
      const target = document.querySelector(`[data-message-id="${escapeCssValue(source.messageId || '')}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
  };

  // Handle dragging logic
  useEffect(() => {
    if (!isAiDragging) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const newX = e.clientX - aiDragStartRef.current.x;
      const newY = e.clientY - aiDragStartRef.current.y;
      
      const maxX = window.innerWidth - aiPanelSize.width;
      const maxY = window.innerHeight - Math.min(aiPanelSize.height, window.innerHeight * 0.85);
      
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
  }, [isAiDragging, aiPanelSize.height, aiPanelSize.width]);

  useEffect(() => {
    if (!resizeMode) return;

    const handleMouseMove = (e: globalThis.MouseEvent) => {
      const dx = e.clientX - aiResizeStartRef.current.x;
      const dy = e.clientY - aiResizeStartRef.current.y;
      const maxWidth = Math.min(MAX_AI_WIDTH, window.innerWidth - 72);

      if (resizeMode === 'dockedWidth') {
        setAiPanelSize(prev => ({
          ...prev,
          width: clamp(aiResizeStartRef.current.width + dx, MIN_AI_WIDTH, maxWidth),
        }));
      } else {
        setAiPanelSize({
          width: clamp(aiResizeStartRef.current.width + dx, MIN_AI_WIDTH, maxWidth),
          height: clamp(aiResizeStartRef.current.height + dy, MIN_AI_HEIGHT, window.innerHeight - 40),
        });
      }
    };

    const handleMouseUp = () => setResizeMode(null);

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [resizeMode]);

  useEffect(() => {
    if (!aiControlsOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!aiControlsRef.current?.contains(event.target as Node)) {
        setAiControlsOpen(false);
      }
    };
    window.addEventListener('pointerdown', handlePointerDown);
    return () => window.removeEventListener('pointerdown', handlePointerDown);
  }, [aiControlsOpen]);

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
  const thinkingValue = thinkingControl ? store.customEnv[thinkingControl.envKey] || 'disabled' : '';
  const thinkingLabel = thinkingControl
    ? thinkingControl.options.find(option => option.value === thinkingValue)?.label || thinkingValue
    : '';
  const providerLabel = effectiveProvider && isConfigurableAIProvider(effectiveProvider)
    ? getAIProviderConfig(effectiveProvider).displayName
    : store.aiProvider === 'automatic'
      ? 'Automatic'
      : store.aiProvider === 'disabled'
        ? 'Disabled'
        : 'Compatible';
  const modelSummary = modelProvider
    ? store.aiModel || configuredModel || getAIProviderConfig(modelProvider).defaultModel
    : store.aiProviderDesc?.model || '';
  const controlsSummary = [
    providerLabel,
    modelSummary,
    thinkingControl ? `${thinkingLabel} thinking` : null,
  ].filter(Boolean).join(' · ');

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

  const updateProvider = async (providerValue: string) => {
    if (!isAIProviderPreference(providerValue)) return;

    const provider = providerValue as AIProviderPreference;
    store.setAiProvider(provider);
    await store.updateSettings(settings => {
      settings.ai.provider = provider;
    });
    await store.saveAIConfig({ PMC_AI_PROVIDER: provider });
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

  const startResize = (mode: Exclude<ResizeMode, null>, event: ReactMouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    aiResizeStartRef.current = {
      x: event.clientX,
      y: event.clientY,
      width: aiPanelSize.width,
      height: aiPanelSize.height,
    };
    setResizeMode(mode);
  };

  return (
    <div 
      className={
        isAiUndocked
          ? "panel-surface absolute max-h-[85vh] border border-[var(--strong-border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden rounded-xl shadow-2xl z-50"
          : "panel-surface relative border-r border-[var(--border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden h-full shrink-0"
      }
      style={isAiUndocked ? { 
        left: `${aiPosition.x}px`, 
        top: `${aiPosition.y}px`,
        width: `${aiPanelSize.width}px`,
        height: `${aiPanelSize.height}px`,
        boxShadow: isAiDragging ? '0 25px 50px -12px rgb(0 0 0 / 0.5)' : '0 20px 25px -5px rgb(0 0 0 / 0.3)'
      } : { width: `${aiPanelSize.width}px` }}
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
          <kbd title="Open AI Assistant" className="ml-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1 py-0.5 font-mono text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">⌘J</kbd>
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

      {/* Compact model controls */}
      <div ref={aiControlsRef} className="relative border-b border-[var(--border)] bg-[var(--app-bg)] px-3 py-2">
        <button
          type="button"
          onClick={() => setAiControlsOpen(open => !open)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-left text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
          aria-expanded={aiControlsOpen}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
          <span className="min-w-0 flex-1 truncate">{controlsSummary || 'AI disabled'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        </button>
        {aiControlsOpen && (
          <div className="absolute left-3 right-3 top-[42px] z-50 rounded-lg border border-[var(--strong-border)] bg-[var(--raised-surface)] p-3 shadow-2xl">
            <div className="flex flex-col gap-2 text-[calc(10px*var(--font-scale))]">
              <label className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-[var(--text-secondary)]">Provider</span>
                <select
                  value={store.aiProvider}
                  onChange={(e) => void updateProvider(e.target.value)}
                  className="min-w-0 flex-1 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
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
              </label>
              {modelProvider && (
                <div className="flex items-center justify-between gap-3">
                  <span className="shrink-0 text-[var(--text-secondary)]">Model</span>
                  {loadingModels ? (
                    <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] animate-pulse">Loading…</span>
                  ) : (
                    <SearchableSelect
                      value={store.aiModel || configuredModel}
                      options={modelList}
                      onChange={(model) => void updateModel(model)}
                      placeholder="Search models"
                      emptyLabel="No models found"
                      className="min-w-0 flex-1"
                    />
                  )}
                </div>
              )}
              {thinkingControl && (
                <label className="flex items-center justify-between gap-3">
                  <span className="shrink-0 text-[var(--text-secondary)]">Thinking</span>
                  <select
                    value={thinkingValue}
                    onChange={(e) => void updateThinkingLevel(e.target.value)}
                    className="min-w-0 flex-1 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer focus:outline focus:outline-2 focus:outline-[var(--accent)]"
                  >
                    {thinkingControl.options.map(option => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5 px-3 py-2.5 border-b border-[var(--border)] bg-[var(--app-bg)]">
        <button
          type="button"
          disabled={!store.activeAccount || store.dailyBriefingLoading || !store.settings.ai.dailyBriefing.enabled}
          onClick={() => void store.runDailyBriefing()}
          title={!store.activeAccount
            ? 'Connect an account first'
            : !store.settings.ai.dailyBriefing.enabled
              ? 'Enable Daily Briefing in AI settings'
              : 'Build a private daily briefing from local mail'}
          className="flex items-center justify-center gap-1.5 rounded-lg border border-[var(--ai-accent)]/35 bg-[var(--ai-accent)]/10 px-2 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] transition-colors hover:border-[var(--ai-accent)] hover:bg-[var(--ai-accent)]/15 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
        >
          <SunMedium className={`h-3.5 w-3.5 text-[var(--ai-accent)] ${store.dailyBriefingLoading ? 'animate-spin' : ''}`} />
          <span className="truncate">{store.dailyBriefingLoading ? 'Building Daily Briefing' : 'Daily Briefing'}</span>
        </button>

        {/* AI action buttons (AI-C1) */}
        <div className="grid grid-cols-2 gap-1.5">
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
      </div>

      <AIPromptShortcutStrip />

      {/* Chat Messages container */}
      <div ref={aiMessagesRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-[var(--app-bg)]">
        {/* Agent action approval queue */}
        {store.agentPlan && (
          <AgentReviewQueueCard />
        )}

        {store.dailyBriefing && (
          <DailyBriefingCard />
        )}

        {store.activeAIMessages.length === 0 && !store.agentPlan && !store.dailyBriefing ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center py-20 text-[var(--text-secondary)] opacity-50 select-none">
            <Sparkles className="w-8 h-8 mb-2 text-[var(--ai-accent)]" />
            <p>Start a conversation. AI can review open threads or help draft replies.</p>
          </div>
        ) : store.activeAIMessages.length > 0 ? (
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
              <AIMessageContent role={m.role} text={m.text} />
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <MailboxSourceCards sources={m.sources} onOpen={(source) => void openMailboxSource(source)} />
              )}
            </div>
          ))
        ) : null}

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

      {isAiUndocked ? (
        <div
          role="separator"
          aria-orientation="horizontal"
          title="Resize AI Assistant"
          onMouseDown={(event) => startResize('floatingSize', event)}
          className="absolute bottom-0 right-0 h-5 w-5 cursor-nwse-resize"
        >
          <div className="absolute bottom-1 right-1 h-2.5 w-2.5 border-b-2 border-r-2 border-[var(--strong-border)]" />
        </div>
      ) : (
        <div
          role="separator"
          aria-orientation="vertical"
          title="Resize AI Assistant"
          onMouseDown={(event) => startResize('dockedWidth', event)}
          className="absolute right-0 top-0 h-full w-1.5 cursor-col-resize hover:bg-[var(--ai-accent)]/20"
        />
      )}
    </div>
  );
}
