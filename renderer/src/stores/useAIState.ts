import { useState, useEffect, useCallback } from 'react';
import { Account, MailThread, MailMessage, AIProviderPreference, AIProviderDescriptor, AIConversation, AIChatMessage, MailTriagePlan, MailTriagePlanItem, MailTriageActionPreview, AIAction, AppSettings, AIPromptShortcut, DailyBriefing, DailyBriefingBuildOptions, DailyBriefingItem } from '../../../shared/types';
import { buildThreadContext } from '../../../shared/aiContext';
import { formatAIUserError } from '../../../shared/aiErrors';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';
import { MailTriagePlanner } from '../../../shared/triagePlanner';
import { buildAITriageContext, buildAITriageInstruction, buildAITriagePlanFromResponse } from '../../../shared/aiTriage';
import { normalizeDailyBriefingSettings } from '../../../shared/dailyBriefing';

interface UseAIStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openedThreadMessages: MailMessage[];
  visibleThreads: MailThread[];
  activeSplit: string;
  threads: MailThread[];
  setThreads: React.Dispatch<React.SetStateAction<MailThread[]>>;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any) => Promise<void>;
  setSpeedProof: React.Dispatch<React.SetStateAction<SpeedProof>>;
}

function mergeDailyBriefings(accountId: string, briefings: DailyBriefing[], settings: AppSettings['ai']['dailyBriefing']): DailyBriefing {
  const normalizedSettings = normalizeDailyBriefingSettings(settings);
  const generatedAt = new Date().toISOString();
  const items = briefings
    .flatMap(briefing => briefing.items)
    .sort((a, b) => {
      if (a.priority === b.priority) return new Date(b.receivedAt).getTime() - new Date(a.receivedAt).getTime();
      return b.priority - a.priority;
    })
    .slice(0, normalizedSettings.maxItems);

  return {
    id: `daily:${accountId}:${generatedAt}`,
    accountId,
    title: accountId === 'unified' ? 'Unified Daily Briefing' : 'Daily Briefing',
    generatedAt,
    items,
    settings: normalizedSettings,
    coverage: {
      accountId,
      generatedAt,
      lookbackHours: normalizedSettings.lookbackHours,
      candidateThreadCount: briefings.reduce((sum, briefing) => sum + briefing.coverage.candidateThreadCount, 0),
      includedItemCount: items.length,
      semanticSearchEnabled: briefings.some(briefing => briefing.coverage.semanticSearchEnabled),
      semanticMatches: briefings.reduce((sum, briefing) => sum + briefing.coverage.semanticMatches, 0),
      bodyContextIncluded: briefings.some(briefing => briefing.coverage.bodyContextIncluded),
      warnings: briefings.flatMap(briefing => briefing.coverage.warnings),
    },
  };
}

export function useAIState({
  settings,
  accounts,
  activeAccount,
  openedThread,
  openedThreadMessages,
  visibleThreads,
  activeSplit,
  threads,
  setThreads,
  executeMailAction,
  setSpeedProof,
}: UseAIStateProps) {
  const [aiPanelOpen, setAiPanelOpen] = useState<boolean>(false);
  const [aiProvider, setAiProviderState] = useState<AIProviderPreference>('automatic');
  const [aiProviderDesc, setAiProviderDesc] = useState<AIProviderDescriptor | null>(null);
  const [aiConversations, setAiConversations] = useState<AIConversation[]>([]);
  const [activeAIConversation, setActiveAIConversation] = useState<AIConversation | null>(null);
  const [activeAIMessages, setActiveAIMessages] = useState<AIChatMessage[]>([]);
  const [triagePlan, setTriagePlan] = useState<MailTriagePlan | null>(null);
  const [dailyBriefing, setDailyBriefing] = useState<DailyBriefing | null>(null);
  const [dailyBriefingLoading, setDailyBriefingLoading] = useState<boolean>(false);
  const [aiPanelLoading, setAiPanelLoading] = useState<boolean>(false);
  const [aiModel, setAiModel] = useState<string>('');
  
  const [selectedTriageThreadIds, setSelectedTriageThreadIds] = useState<Set<string>>(new Set());
  const [activeAccountCredentialsValid, setActiveAccountCredentialsValid] = useState<boolean>(true);

  // Sync provider and model from settings on load/change
  useEffect(() => {
    if (settings?.ai) {
      setAiProviderState(settings.ai.provider);
    }
  }, [settings?.ai?.provider]);

  const setAiProvider = useCallback((pref: AIProviderPreference) => {
    setAiProviderState(pref);
    setAiModel('');
    setAiProviderDesc(null);
  }, []);

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

  // Resolve active AI provider descriptors
  useEffect(() => {
    window.electronAPI.getAIProviderDescriptor(aiProvider, aiModel || undefined).then(setAiProviderDesc);
  }, [aiProvider, aiModel]);

  // Synchronize model with provider default on provider change
  useEffect(() => {
    if (aiProviderDesc) {
      setAiModel(aiProviderDesc.model);
    }
  }, [aiProviderDesc]);

  const loadAIConversations = useCallback(async () => {
    if (!settings.ai.savePromptHistory) {
      setAiConversations([]);
      return;
    }
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
  }, [activeAccount, accounts, settings.ai.savePromptHistory]);

  useEffect(() => {
    loadAIConversations();
  }, [loadAIConversations]);

  const startNewAIConversation = () => {
    setActiveAIConversation(null);
    setActiveAIMessages([]);
  };

  const selectAIConversation = async (conv: AIConversation) => {
    setActiveAIConversation(conv);
    const msgs = await window.electronAPI.getConversationMessages(conv.id);
    setActiveAIMessages(msgs);
  };

  const persistAIConversation = async (conv: AIConversation, messages: AIChatMessage[]) => {
    if (!settings.ai.savePromptHistory) return;
    await window.electronAPI.saveConversation(conv, messages);
    loadAIConversations();
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

    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);

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
          ? buildThreadContext(openedThread, openedThreadMessages, settings.ai)
          : 'No thread open.',
        conversationHistory: newMsgs,
        userInstruction: text,
        toolPolicy: {
          enabled: settings.ai.externalToolsEnabled,
        },
      }, aiProvider, aiModel || undefined);

      const assistantMsg: AIChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: response.text
      };

      const finalMsgs = [...newMsgs, assistantMsg];
      setActiveAIMessages(finalMsgs);
      await persistAIConversation(conv, finalMsgs);

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
    } catch (e) {
      console.error('AI chat completion failed:', e);
      emitToast({ type: 'error', message: formatAIUserError(e) });
    } finally {
      setAiPanelLoading(false);
    }
  };

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
        return { ...prev, items: prev.items.filter(i => i.threadId !== item.threadId) };
      });
    } else if (item.recommendation === 'markDoneCandidate') {
      await executeMailAction('markDone', item.threadId);
      setTriagePlan(prev => {
        if (!prev) return null;
        return { ...prev, items: prev.items.filter(i => i.threadId !== item.threadId) };
      });
    } else if (item.recommendation === 'setReminder') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(9, 0, 0, 0);
      await window.electronAPI.saveReminder(activeAccount.email, item.threadId, tomorrow.toISOString());
      setThreads(prev => prev.map(t => t.id === item.threadId ? { ...t, reminderAt: tomorrow.toISOString() } : t));
      
      setTriagePlan(prev => {
        if (!prev) return null;
        return { ...prev, items: prev.items.filter(i => i.threadId !== item.threadId) };
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

  const runAIInstruction = async ({
    label,
    instruction,
    requiresThread,
  }: {
    label: string;
    instruction: string;
    requiresThread: boolean;
  }) => {
    setAiPanelOpen(true);
    if (!activeAccount) {
      emitToast({ type: 'warning', message: 'Connect an account before using AI actions.' });
      return;
    }
    if (requiresThread && !openedThread) {
      emitToast({ type: 'warning', message: 'Open a thread before running this AI shortcut.' });
      return;
    }

    setAiPanelLoading(true);
    const start = performance.now();
    const notes = settings.ai.personalizationNotes ? `\nPersonalization notes: ${settings.ai.personalizationNotes}` : '';
    const context = requiresThread
      ? buildThreadContext(openedThread, openedThreadMessages, settings.ai)
      : 'No selected mail context. This reusable prompt shortcut is not thread-scoped; answer the user directly from the instruction and conversation history.';

    const userMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'user', text: label };
    const targetThreadId = requiresThread ? openedThread?.id || null : null;
    const canReuseConversation = activeAIConversation?.threadId === targetThreadId;
    const baseMessages = canReuseConversation ? activeAIMessages : [];
    const pending = [...baseMessages, userMsg];
    setActiveAIMessages(pending);

    const targetAccountId = requiresThread && openedThread
      ? openedThread.accountId
      : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);
    let conv = canReuseConversation ? activeAIConversation : null;
    if (!conv) {
      conv = {
        id: crypto.randomUUID(),
        title: label,
        accountId: targetAccountId,
        threadId: targetThreadId,
        threadSubject: requiresThread ? openedThread?.subject || null : null,
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
        userInstruction: `${instruction}${notes}`,
        toolPolicy: {
          enabled: settings.ai.externalToolsEnabled,
        },
      }, aiProvider, aiModel || undefined);

      const assistantMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: response.text };
      const finalMsgs = [...pending, assistantMsg];
      setActiveAIMessages(finalMsgs);
      await persistAIConversation(conv, finalMsgs);

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
    } catch (e) {
      console.error('AI action failed:', e);
      setActiveAIMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system', text: formatAIUserError(e) }]);
    } finally {
      setAiPanelLoading(false);
    }
  };

  const runAIAction = async (action: AIAction) => {
    if (action === 'queue') {
      await runAITriagePlan();
      return;
    }

    const tone = `Use a ${settings.ai.replyTone} tone.`;
    const prompts: Record<Exclude<AIAction, 'queue'>, { label: string; instruction: string }> = {
      summarize: { label: 'Summarize this thread', instruction: 'Summarize this email thread in 3-5 crisp bullet points, then a single "Next step:" line.' },
      draftReply: { label: 'Draft a reply', instruction: `Write a complete reply to the latest message in this thread. ${tone} Return only the email body, no preamble or subject.` },
      rewrite: { label: 'Rewrite for clarity', instruction: `Rewrite the latest message to be clearer, well-structured, and polished. ${tone} Return only the rewritten text.` },
      translate: { label: 'Translate to English', instruction: 'Translate the latest message of this thread into clear English. If it is already English, return clear formal English. Return only the translation.' },
    };
    const cfg = prompts[action];
    await runAIInstruction({
      label: cfg.label,
      instruction: cfg.instruction,
      requiresThread: true,
    });
  };

  const runAIPromptShortcut = async (shortcut: AIPromptShortcut) => {
    await runAIInstruction({
      label: shortcut.title,
      instruction: shortcut.instruction,
      requiresThread: shortcut.requiresThread,
    });
  };

  const runAITriagePlan = async () => {
    setAiPanelOpen(true);
    if (!activeAccount) {
      setTriagePlan(null);
      emitToast({ type: 'warning', message: 'Connect an account before building a triage queue.' });
      return;
    }
    if (visibleThreads.length === 0) {
      setTriagePlan(null);
      emitToast({ type: 'info', message: 'No visible messages to triage in this tab.' });
      return;
    }
    
    setAiPanelLoading(true);

    const isAutomationSplit = activeSplit === 'automation';
    const intent = isAutomationSplit ? 'automationCleanup' : 'mailboxTriage';
    const now = new Date();
    
    const fallbackPlan = MailTriagePlanner.build(
      activeAccount.id === 'unified' ? 'unified' : activeAccount.email,
      activeSplit,
      visibleThreads,
      now,
      intent,
      8
    );

    let plan = fallbackPlan;
    let usedAI = false;
    const canUseAI = aiProvider !== 'disabled' && aiProviderDesc?.preference !== 'disabled';

    try {
      if (canUseAI) {
        const response = await window.electronAPI.completeAI({
          action: 'triage',
          context: buildAITriageContext(visibleThreads),
          conversationHistory: [],
          userInstruction: buildAITriageInstruction(intent),
        }, aiProvider, aiModel || undefined);

        plan = buildAITriagePlanFromResponse({
          accountId: fallbackPlan.accountId,
          sourceTitle: fallbackPlan.sourceTitle,
          generatedAt: now.toISOString(),
          sourceThreadCount: fallbackPlan.sourceThreadCount,
          intent,
          automationRulePreview: fallbackPlan.automationRulePreview || null,
          responseText: response.text,
          threads: visibleThreads,
        });
        usedAI = true;
      }
    } catch (error) {
      console.warn('AI triage failed; using deterministic fallback:', error);
    }

    const defaultSelected = new Set(
      plan.items
        .filter(item => item.recommendation === 'readNow' || item.recommendation === 'setReminder')
        .map(item => item.threadId)
    );
    setSelectedTriageThreadIds(defaultSelected);
    setTriagePlan(plan);
    setAiPanelLoading(false);
    emitToast({ type: 'success', message: `${usedAI ? 'AI' : 'Fast'} triage plan ready for ${plan.items.length} messages.` });
  };

  const runDailyBriefing = async (options: DailyBriefingBuildOptions = {}) => {
    setAiPanelOpen(true);
    if (!activeAccount) {
      setDailyBriefing(null);
      emitToast({ type: 'warning', message: 'Connect an account before building a daily briefing.' });
      return;
    }
    if (!settings.ai.dailyBriefing.enabled) {
      setDailyBriefing(null);
      emitToast({ type: 'info', message: 'Daily Briefing is disabled in AI settings.' });
      return;
    }

    setDailyBriefingLoading(true);
    const start = performance.now();
    try {
      const briefingSettings = normalizeDailyBriefingSettings({ ...settings.ai.dailyBriefing, ...options });
      const requestOptions: DailyBriefingBuildOptions = {
        ...briefingSettings,
        nowIso: options.nowIso || new Date().toISOString(),
      };
      const targetAccounts = activeAccount.id === 'unified' ? accounts : [activeAccount];
      const briefings = await Promise.all(
        targetAccounts
          .filter(account => account.email)
          .map(account => window.electronAPI.buildDailyBriefing(account.email, requestOptions))
      );

      const briefing = activeAccount.id === 'unified'
        ? mergeDailyBriefings('unified', briefings, briefingSettings)
        : briefings[0] || null;

      setDailyBriefing(briefing);
      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
      emitToast({
        type: briefing && briefing.items.length > 0 ? 'success' : 'info',
        message: briefing && briefing.items.length > 0
          ? `Daily briefing ready with ${briefing.items.length} item${briefing.items.length === 1 ? '' : 's'}.`
          : 'Daily briefing found no current items.',
      });
    } catch (error) {
      console.error('Daily briefing failed:', error);
      setDailyBriefing(null);
      emitToast({ type: 'error', message: formatAIUserError(error) });
    } finally {
      setDailyBriefingLoading(false);
    }
  };

  const dismissDailyBriefingItem = (itemOrThreadId: DailyBriefingItem | string) => {
    const threadId = typeof itemOrThreadId === 'string' ? itemOrThreadId : itemOrThreadId.threadId;
    setDailyBriefing(prev => {
      if (!prev) return null;
      const items = prev.items.filter(item => item.threadId !== threadId);
      return {
        ...prev,
        items,
        coverage: {
          ...prev.coverage,
          includedItemCount: items.length,
        },
      };
    });
  };

  return {
    aiPanelOpen,
    setAiPanelOpen,
    aiProvider,
    setAiProvider,
    aiProviderDesc,
    aiConversations,
    activeAIConversation,
    activeAIMessages,
    triagePlan,
    setTriagePlan,
    dailyBriefing,
    setDailyBriefing,
    dailyBriefingLoading,
    aiPanelLoading,
    aiModel,
    setAiModel,
    selectedTriageThreadIds,
    setSelectedTriageThreadIds,
    triageQueueReadiness,
    triageActionPreview,
    startNewAIConversation,
    selectAIConversation,
    sendAIMessage,
    runAIAction,
    runAIPromptShortcut,
    runAITriagePlan,
    runDailyBriefing,
    dismissDailyBriefingItem,
    toggleTriagePlanItemSelection,
    selectAllApplicableTriagePlanItems,
    clearTriagePlanSelection,
    applySelectedTriagePlanItems,
    applyTriagePlanItem,
    loadAIConversations
  };
}
