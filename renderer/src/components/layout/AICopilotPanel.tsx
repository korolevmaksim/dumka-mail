import { AI_NO_PROVIDER_PROMPT, isAIProviderUnavailable } from '../../../../shared/aiErrors';
import { requestSettingsTab } from '../../lib/settingsNavigation';
import { useState, useRef, useEffect, useLayoutEffect, useCallback, useMemo, type MouseEvent as ReactMouseEvent } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { useEscapeLayer } from '../../hooks/useEscapeLayer';
import { useChatStream } from '../../stores/chatStreamStore';
import {
  Sparkles, Pin, PinOff, Plus, X, Send,
  SlidersHorizontal, ChevronDown, ExternalLink, MailSearch,
} from 'lucide-react';
import type { AIProviderPreference, MailboxSearchSource, MailThread } from '../../../../shared/types';
import { ConfigurableAIProvider, getAIProviderConfig, isConfigurableAIProvider, resolveConfiguredProviderModel } from '../../../../shared/aiProviders';
import { isAIProviderPreference } from '../../../../shared/aiProviderPreference';
import { SearchableSelect } from '../common/SearchableSelect';
import { compileMarkdownToHtmlFragment } from '../../../../shared/markdown';
import {
  resolveAssistantModelProvider,
  resolveAssistantModelSummary,
  shouldFetchAssistantModelCatalog,
} from '../../lib/aiAssistantModelControls';

type ResizeMode = 'dockedWidth' | 'floatingSize' | null;

const MIN_AI_WIDTH = 300;
const MAX_AI_WIDTH = 560;
const MIN_AI_HEIGHT = 420;
const AI_INPUT_MAX_LINES = 4;
const AI_PANEL_WIDTH_SETTING_KEY = 'aiAssistantPanelWidth';
const DEFAULT_AI_PANEL_SIZE = { width: 340, height: 600 };

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function maxAIPanelWidth(): number {
  return Math.min(MAX_AI_WIDTH, window.innerWidth - 72);
}

function saveAIPanelWidth(width: number) {
  window.electronAPI.setSetting(AI_PANEL_WIDTH_SETTING_KEY, String(Math.round(width))).catch(err => {
    console.error('Failed to save AI assistant panel width to SQLite:', err);
  });
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

/**
 * The answer while it streams. Subscribes to the chat stream store on its
 * own, so a delta re-renders only this bubble (once per animation frame),
 * not the panel or anything else reading the global store.
 */
function StreamingAssistantBubble({
  messageId,
  committedIds,
  loading,
  onGrow,
}: {
  messageId: string | null;
  committedIds: ReadonlySet<string>;
  loading: boolean;
  onGrow: () => void;
}) {
  const stream = useChatStream();
  const visible = Boolean(messageId && stream.messageId === messageId && stream.text && !committedIds.has(messageId));
  useEffect(() => {
    if (visible) onGrow();
  }, [visible, stream.text, onGrow]);
  if (!visible) {
    return loading ? (
      <div role="status" className="flex items-center gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] self-start animate-pulse p-2">
        <Sparkles aria-hidden="true" className="w-3.5 h-3.5 text-[var(--ai-solid)]" /> Assistant is thinking…
      </div>
    ) : null;
  }
  return (
    <div aria-busy="true" className="flex flex-col gap-1 rounded-lg p-3 max-w-[90%] bg-[var(--border)]/30 self-start border border-[var(--border)]">
      <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">Assistant</span>
      <AIMessageContent role="assistant" text={stream.text} />
    </div>
  );
}

function AIMessageContent({ role, text }: { role: string; text: string }) {
  if (role !== 'assistant') {
    return (
      <p className={`text-[calc(11px*var(--font-scale))] whitespace-pre-wrap select-text ${role === 'system' ? 'text-[var(--warning-solid)]' : 'text-[var(--text-primary)]'}`}>
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
      <div className="flex items-center gap-1 text-[calc(11px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-tertiary)]">
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
            <span className="min-w-0 flex-1 truncate text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              {source.subject || '(No subject)'}
            </span>
            <ExternalLink className="h-3 w-3 shrink-0 text-[var(--text-tertiary)] group-hover:text-[var(--ai-solid)]" />
          </div>
          <div className="flex min-w-0 items-center gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            <span className="truncate">{source.sender}</span>
            {formatSourceDate(source.receivedAt || source.lastMessageAt) && (
              <>
                <span className="text-[var(--text-tertiary)]">·</span>
                <span className="shrink-0">{formatSourceDate(source.receivedAt || source.lastMessageAt)}</span>
              </>
            )}
          </div>
          {source.snippet && (
            <p className="line-clamp-2 text-[calc(11px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
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

interface AICopilotPanelProps {
  /**
   * The mail screen has no copilot column any more (SPEC §2): ⌘J opens the
   * assistant as a floating panel over the reading area, without a dock option.
   */
  floatingOnly?: boolean;
}

export function AICopilotPanel({ floatingOnly = false }: AICopilotPanelProps = {}) {
  const store = useAppStore();
  const [aiInput, setAiInput] = useState('');
  const [isAiUndocked, setIsAiUndocked] = useState(floatingOnly);
  const [aiPanelSize, setAiPanelSize] = useState(DEFAULT_AI_PANEL_SIZE);
  // Opens at the right edge, over the reading area: the list it talks about stays visible.
  const [aiPosition, setAiPosition] = useState(() => ({
    x: Math.max(96, window.innerWidth - DEFAULT_AI_PANEL_SIZE.width - 24),
    y: 60,
  }));
  const [isAiDragging, setIsAiDragging] = useState(false);
  const [resizeMode, setResizeMode] = useState<ResizeMode>(null);
  const [aiControlsOpen, setAiControlsOpen] = useState(false);
  const aiDragStartRef = useRef({ x: 0, y: 0 });
  const aiResizeStartRef = useRef({ x: 0, y: 0, ...DEFAULT_AI_PANEL_SIZE });
  const aiMessagesRef = useRef<HTMLDivElement>(null);
  const aiControlsRef = useRef<HTMLDivElement>(null);
  const aiInputRef = useRef<HTMLTextAreaElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  // The model controls popover is a layer inside the panel: Esc closes it first.
  useEscapeLayer(aiControlsOpen, () => setAiControlsOpen(false));

  // Closing the panel (Esc, ×, ⌘J) returns focus to where it was opened from
  // when focus was inside the panel, instead of dropping it on <body>.
  useEffect(() => {
    const panel = panelRef.current;
    const previous = document.activeElement instanceof HTMLElement && !panel?.contains(document.activeElement)
      ? document.activeElement
      : null;
    // Opening the panel is a request to ask something: put the cursor in the question field.
    const focusTimer = window.setTimeout(() => aiInputRef.current?.focus(), 0);
    return () => {
      window.clearTimeout(focusTimer);
      const active = document.activeElement;
      const focusWasInPanel = !active || active === document.body || Boolean(panel?.contains(active));
      if (previous && previous.isConnected && focusWasInPanel) previous.focus();
    };
  }, []);

  const submitAIInput = () => {
    if (!aiInput.trim() || store.aiPanelLoading) return;
    void store.sendAIMessage(aiInput);
    setAiInput('');
  };

  const openMailboxSource = async (source: MailboxSearchSource) => {
    const thread = store.threads.find(item => item.accountId === source.accountId && item.id === source.threadId)
      || fallbackThreadFromSource(source);
    store.setWorkspaceView('mail');
    await store.openThread(thread);
    if (!source.messageId) return;
    window.setTimeout(() => {
      const target = document.querySelector(`[data-message-id="${escapeCssValue(source.messageId || '')}"]`);
      target?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, 120);
  };

  useEffect(() => {
    let active = true;
    window.electronAPI.getSetting(AI_PANEL_WIDTH_SETTING_KEY).then(rawWidth => {
      if (!active || rawWidth === null) return;
      const parsedWidth = Number.parseInt(rawWidth, 10);
      if (!Number.isFinite(parsedWidth)) return;
      setAiPanelSize(prev => ({
        ...prev,
        width: clamp(parsedWidth, MIN_AI_WIDTH, maxAIPanelWidth()),
      }));
    }).catch(err => {
      console.error('Failed to load AI assistant panel width from SQLite:', err);
    });

    return () => {
      active = false;
    };
  }, []);

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
      const maxWidth = maxAIPanelWidth();

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

    const handleMouseUp = (e: globalThis.MouseEvent) => {
      const dx = e.clientX - aiResizeStartRef.current.x;
      const dy = e.clientY - aiResizeStartRef.current.y;
      const nextWidth = clamp(aiResizeStartRef.current.width + dx, MIN_AI_WIDTH, maxAIPanelWidth());
      if (resizeMode === 'dockedWidth') {
        setAiPanelSize(prev => ({ ...prev, width: nextWidth }));
      } else {
        setAiPanelSize({
          width: nextWidth,
          height: clamp(aiResizeStartRef.current.height + dy, MIN_AI_HEIGHT, window.innerHeight - 40),
        });
      }
      saveAIPanelWidth(nextWidth);
      setResizeMode(null);
    };

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

  // Follow the conversation, including a streaming answer (the streaming
  // bubble calls `scrollMessagesToEnd` as it grows).
  const lastMessage = store.activeAIMessages[store.activeAIMessages.length - 1];
  const scrollMessagesToEnd = useCallback(() => {
    const container = aiMessagesRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, []);
  useEffect(() => {
    scrollMessagesToEnd();
  }, [store.activeAIMessages.length, lastMessage?.text, scrollMessagesToEnd]);
  const committedMessageIds = useMemo(
    () => new Set(store.activeAIMessages.map(message => message.id)),
    [store.activeAIMessages],
  );

  useLayoutEffect(() => {
    const input = aiInputRef.current;
    if (!input) return;

    input.style.height = 'auto';
    const styles = window.getComputedStyle(input);
    const lineHeight = Number.parseFloat(styles.lineHeight) || 16;
    const paddingTop = Number.parseFloat(styles.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(styles.paddingBottom) || 0;
    const maxHeight = lineHeight * AI_INPUT_MAX_LINES + paddingTop + paddingBottom;
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? 'auto' : 'hidden';
  }, [aiInput]);

  const [modelList, setModelList] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const effectiveProvider = store.aiProvider === 'automatic' ? store.aiProviderDesc?.preference : store.aiProvider;
  const modelProvider = resolveAssistantModelProvider(store.aiProvider, store.aiProviderDesc);
  const modelProviderConfig = modelProvider ? getAIProviderConfig(modelProvider) : null;
  const cachedModels = modelProvider ? store.modelsCache[modelProvider] : undefined;
  const modelCatalogApiKey = modelProviderConfig ? store.customEnv[modelProviderConfig.apiKeyEnv] || '' : '';
  const modelCatalogBaseUrl = modelProviderConfig ? store.customEnv[modelProviderConfig.baseUrlEnv] || '' : '';
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
  const modelSummary = resolveAssistantModelSummary(modelProvider, configuredModel, store.aiProviderDesc);
  const controlsSummary = [
    providerLabel,
    modelSummary,
    thinkingControl ? `${thinkingLabel} thinking` : null,
  ].filter(Boolean).join(' · ');

  const noProvider = isAIProviderUnavailable(store.aiProviderDesc);
  const openAIConfiguration = () => {
    requestSettingsTab('ai');
    store.setCleanupOpen(false);
    store.setSettingsOpen(true);
  };

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
    if (store.aiModel !== configuredModel) {
      store.setAiModel(configuredModel);
    }
  }, [modelProvider, configuredModel, store.aiModel]);

  useEffect(() => {
    let active = true;
    if (!modelProvider) {
      setModelList([]);
      setLoadingModels(false);
      return;
    }

    if (cachedModels && cachedModels.length > 0) {
      setModelList(cachedModels);
      setLoadingModels(false);
      return;
    }

    if (!shouldFetchAssistantModelCatalog({ controlsOpen: aiControlsOpen, modelProvider, cachedModels })) {
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
        setModelList(configuredModel ? [configuredModel] : []);
      }
    }).catch(err => {
      if (!active) return;
      console.error(`Failed to load models for ${modelProvider}:`, err);
      setLoadingModels(false);
      setModelList(configuredModel ? [configuredModel] : []);
    });

    return () => { active = false; };
  }, [aiControlsOpen, modelProvider, cachedModels, modelCatalogApiKey, modelCatalogBaseUrl, configuredModel]);

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
      ref={panelRef}
      data-ask-dumka-panel
      role="region"
      aria-label="Ask Dumka"
      className={
        isAiUndocked
          ? "dm-ai-panel dm-overlay panel-surface absolute max-h-[85vh] border border-[var(--strong-border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden rounded-xl shadow-2xl z-50"
          : "dm-ai-panel panel-surface relative border-r border-[var(--border)] bg-[var(--panel-bg)] flex flex-col overflow-hidden h-full shrink-0"
      }
      style={isAiUndocked ? { 
        left: `${aiPosition.x}px`, 
        top: `${aiPosition.y}px`,
        width: `${aiPanelSize.width}px`,
        height: `${aiPanelSize.height}px`,
        boxShadow: store.settings.appearance.interfaceStyle === 'soft'
          ? 'var(--overlay-shadow)'
          : isAiDragging ? '0 25px 50px -12px rgb(0 0 0 / 0.5)' : '0 20px 25px -5px rgb(0 0 0 / 0.3)'
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
          <Sparkles className="w-4 h-4 text-[var(--ai-solid)]" /> Ask Dumka
          <kbd title="Ask Dumka" className="ml-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1 py-0.5 font-mono text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">⌘J</kbd>
        </div>
        
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          {!floatingOnly && <button 
            type="button"
            onClick={() => setIsAiUndocked(!isAiUndocked)}
            title={isAiUndocked ? "Dock to Left" : "Undock Panel"}
            aria-label={isAiUndocked ? "Dock to left" : "Undock panel"}
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer"
          >
            {isAiUndocked ? (
              <Pin className="w-4 h-4 text-[var(--text-primary)]" />
            ) : (
              <PinOff className="w-4 h-4 text-[var(--text-secondary)]" />
            )}
          </button>}
          <button 
            type="button"
            onClick={() => store.startNewAIConversation()}
            title="New Chat"
            aria-label="New chat"
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
          >
            <Plus aria-hidden="true" className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
          <button
            type="button"
            onClick={() => store.setAiPanelOpen(false)}
            title="Close Ask Dumka (Esc)"
            aria-label="Close Ask Dumka"
            className="p-1 rounded hover:bg-[var(--border)] cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
          >
            <X aria-hidden="true" className="w-4 h-4 text-[var(--text-secondary)]" />
          </button>
        </div>
      </div>

      {/* Compact model controls */}
      <div ref={aiControlsRef} className="relative border-b border-[var(--border)] bg-[var(--app-bg)] px-3 py-2">
        <button
          type="button"
          onClick={() => setAiControlsOpen(open => !open)}
          className="flex w-full min-w-0 items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
          aria-expanded={aiControlsOpen}
          aria-haspopup="dialog"
        >
          <SlidersHorizontal className="h-3.5 w-3.5 shrink-0 text-[var(--ai-solid)]" />
          <span className="min-w-0 flex-1 truncate">{controlsSummary || 'AI disabled'}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
        </button>
        {aiControlsOpen && (
          <div className="dm-overlay absolute left-3 right-3 top-[42px] z-50 rounded-lg border border-[var(--strong-border)] bg-[var(--raised-surface)] p-3 shadow-2xl">
            <div className="flex flex-col gap-2 text-[calc(11px*var(--font-scale))]">
              <label className="flex items-center justify-between gap-3">
                <span className="shrink-0 text-[var(--text-secondary)]">Provider</span>
                <select
                  value={store.aiProvider}
                  onChange={(e) => void updateProvider(e.target.value)}
                  className="min-w-0 flex-1 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer"
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
                    <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] animate-pulse">Loading…</span>
                  ) : (
                    <SearchableSelect
                      value={configuredModel || store.aiModel}
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
                    className="min-w-0 flex-1 bg-[var(--panel-bg)] border border-[var(--border)] rounded px-1.5 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none cursor-pointer focus:outline focus:outline-2 focus:outline-[var(--accent)]"
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

      {/* No usable model: one line instead of controls that cannot work. */}
      {noProvider && (
        <div className="border-b border-[var(--border)] bg-[var(--app-bg)] px-3 py-2.5">
          <button
            type="button"
            onClick={openAIConfiguration}
            className="flex w-full items-center gap-1.5 rounded-lg border border-dashed border-[var(--border)] px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--ai-accent)]/50 hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
          >
            <Sparkles className="h-3.5 w-3.5 shrink-0 text-[var(--ai-solid)]" />
            <span className="truncate">{AI_NO_PROVIDER_PROMPT}</span>
          </button>
        </div>
      )}

      {/* Chat Messages container */}
      <div ref={aiMessagesRef} className="flex-1 overflow-y-auto p-4 flex flex-col gap-3 bg-[var(--app-bg)]">
        {store.activeAIMessages.length === 0 ? (
          <div className="flex flex-col items-center justify-center flex-1 text-center py-20 text-[var(--text-secondary)] opacity-50 select-none">
            <Sparkles className="w-8 h-8 mb-2 text-[var(--ai-solid)]" />
            <p>{store.openedThread ? 'Ask about this conversation.' : 'Ask about your mail.'}</p>
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
              <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)]">
                {m.role === 'user' ? 'You' : m.role === 'system' ? 'System' : 'Assistant'}
              </span>
              <AIMessageContent role={m.role} text={m.text} />
              {m.role === 'system' && store.aiRequestFailure?.messageId === m.id && (
                <button
                  type="button"
                  onClick={() => store.retryLastAIRequest()}
                  disabled={store.aiPanelLoading}
                  className="self-start rounded border border-[var(--warning)]/40 px-2 py-0.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--warning)]/15 disabled:opacity-40"
                >
                  Retry
                </button>
              )}
              {m.role === 'assistant' && m.sources && m.sources.length > 0 && (
                <MailboxSourceCards sources={m.sources} onOpen={(source) => void openMailboxSource(source)} />
              )}
            </div>
          ))
        )}

        <StreamingAssistantBubble
          messageId={store.aiStreamingMessageId}
          committedIds={committedMessageIds}
          loading={store.aiPanelLoading}
          onGrow={scrollMessagesToEnd}
        />
      </div>

      {/* AI input Form */}
      <div className="p-3 border-t border-[var(--border)] bg-[var(--rail-bg)]">
        {/* What the answer is based on: never left to be guessed. */}
        <p
          data-ask-context={store.openedThread ? 'conversation' : 'mailbox'}
          className="mb-2 flex min-w-0 items-baseline gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]"
        >
          <span className="shrink-0 font-semibold text-[var(--text-primary)]">{store.openedThread ? 'About this conversation' : 'About your mailbox'}</span>
          <span className="min-w-0 truncate" title={store.openedThread ? store.openedThread.subject : undefined}>
            {store.openedThread
              ? (store.openedThread.subject.trim() || '(no subject)')
              : 'Searches the mail stored on this Mac.'}
          </span>
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitAIInput();
          }}
          className="flex items-end gap-1.5"
        >
          <textarea
            ref={aiInputRef}
            aria-label="Ask Dumka"
            disabled={store.aiPanelLoading}
            rows={1}
            placeholder="Ask Dumka…"
            className="min-h-[34px] flex-1 resize-none bg-[var(--panel-bg)] border border-[var(--control-border)] rounded px-2.5 py-1.5 outline-none focus:outline focus:outline-2 focus:outline-[var(--ai-accent)] focus:outline-offset-1 text-[calc(12px*var(--font-scale))] leading-[1.35] text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            value={aiInput}
            onChange={(e) => setAiInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return;
              e.preventDefault();
              submitAIInput();
            }}
          />
          <button 
            type="submit" 
            aria-label="Send message"
            title="Send message"
            disabled={store.aiPanelLoading || !aiInput.trim()}
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center bg-[var(--ai-fill)] text-[var(--on-accent)] rounded cursor-pointer hover:bg-[var(--ai-accent)]/95 disabled:cursor-not-allowed disabled:opacity-50"
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
