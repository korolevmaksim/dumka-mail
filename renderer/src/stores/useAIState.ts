import { useState, useEffect, useCallback } from 'react';
import { Account, MailThread, MailMessage, AIProviderPreference, AIProviderDescriptor, AIConversation, AIChatMessage, MailTriagePlan, AIAction, AppSettings, AIPromptShortcut, DailyBriefing, DailyBriefingBuildOptions, DailyBriefingItem, AgentPlan, AgentPlanItem, AgentPlanActionPreview, AgentPlanQueueReadiness } from '../../../shared/types';
import { buildThreadContext } from '../../../shared/aiContext';
import { formatAIUserError } from '../../../shared/aiErrors';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';
import { MailTriagePlanner } from '../../../shared/triagePlanner';
import { buildAITriageContext, buildAITriageInstruction, buildAITriagePlanFromResponse } from '../../../shared/aiTriage';
import { normalizeDailyBriefingSettings } from '../../../shared/dailyBriefing';
import { buildAgentPlanFromDailyBriefingItem, buildAgentPlanFromTriagePlan, mergeAgentPlanItem } from '../../../shared/agentPlan';

interface UseAIStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openedThreadMessages: MailMessage[];
  visibleThreads: MailThread[];
  activeSplit: string;
  threads: MailThread[];
  openThread: (thread: MailThread | null) => Promise<void>;
  startReplyWithBody: (message: MailMessage, bodyPlain: string, replyAll?: boolean) => any;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any, payloadJson?: string | null) => Promise<void>;
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
  openThread,
  startReplyWithBody,
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
  const [agentPlan, setAgentPlan] = useState<AgentPlan | null>(null);
  const [dailyBriefing, setDailyBriefing] = useState<DailyBriefing | null>(null);
  const [dailyBriefingLoading, setDailyBriefingLoading] = useState<boolean>(false);
  const [aiPanelLoading, setAiPanelLoading] = useState<boolean>(false);
  const [aiModel, setAiModel] = useState<string>('');

  const [selectedAgentPlanItemIds, setSelectedAgentPlanItemIds] = useState<Set<string>>(new Set());
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

  const agentPlanActionPreview = useCallback((item: AgentPlanItem): AgentPlanActionPreview => {
    const isSelected = selectedAgentPlanItemIds.has(item.id);
    const threadExists = threads.some(thread => thread.accountId === item.accountId && thread.id === item.threadId);
    const scope: AgentPlanActionPreview['scope'] =
      item.action === 'markRead' || item.action === 'archive' || item.action === 'applyLabel' || item.action === 'unsubscribe'
        ? 'gmail'
        : item.action === 'openThread'
          ? 'focus'
          : 'local';

    let eligibility: AgentPlanActionPreview['eligibility'] = 'ready';
    if (!threadExists) {
      eligibility = 'threadMissing';
    } else if (item.action === 'applyLabel' && !item.payload?.labelId) {
      eligibility = 'labelMissing';
    } else if (scope === 'gmail' && !activeAccountCredentialsValid) {
      eligibility = 'requiresReconnect';
    } else if (scope === 'focus') {
      eligibility = 'focusOnly';
    }

    return {
      itemId: item.id,
      action: item.action,
      isSelected,
      eligibility,
      scope,
      selectionPolicy: item.selectionPolicy,
      riskLevel: item.riskLevel,
    };
  }, [activeAccountCredentialsValid, selectedAgentPlanItemIds, threads]);

  const agentPlanQueueReadiness: AgentPlanQueueReadiness | null = (() => {
    if (!agentPlan) return null;
    const selected = agentPlan.items
      .map(item => ({ item, preview: agentPlanActionPreview(item) }))
      .filter(({ preview }) => selectedAgentPlanItemIds.has(preview.itemId));
    if (selected.length === 0) return null;

    const executable = selected.filter(({ preview }) => preview.eligibility === 'ready');
    const blocked = selected.length - executable.length;
    const gmailCount = executable.filter(({ preview }) => preview.scope === 'gmail').length;
    const localCount = executable.filter(({ preview }) => preview.scope === 'local').length;
    const focusCount = selected.filter(({ preview }) => preview.scope === 'focus').length;
    const parts: string[] = [];
    if (gmailCount > 0) parts.push(`${gmailCount} Gmail action${gmailCount === 1 ? '' : 's'} ready`);
    if (localCount > 0) parts.push(`${localCount} local action${localCount === 1 ? '' : 's'} ready`);
    if (focusCount > 0) parts.push(`${focusCount} focus-only`);
    if (blocked > 0) parts.push(`${blocked} blocked`);

    return {
      summary: parts.join(' · '),
      level: blocked > 0 ? 'warning' : 'ready',
      executableActionCount: executable.length,
      blockedActionCount: blocked,
      canApplySelected: executable.length > 0,
      applyButtonTitle: executable.length > 0 ? `Approve ${executable.length}` : 'Approve 0',
    };
  })();

  const toggleAgentPlanItemSelection = (itemId: string) => {
    setSelectedAgentPlanItemIds(prev => {
      const copy = new Set(prev);
      if (copy.has(itemId)) {
        copy.delete(itemId);
      } else {
        copy.add(itemId);
      }
      return copy;
    });
  };

  const selectAllApplicableAgentPlanItems = () => {
    if (!agentPlan) return;
    const applicableIds = agentPlan.items
      .filter(item => item.action !== 'openThread')
      // manualOnly items (draft replies, unsubscribe) must be approved one by
      // one and never get swept into a bulk selection.
      .filter(item => item.selectionPolicy !== 'manualOnly')
      .filter(item => agentPlanActionPreview(item).eligibility === 'ready')
      .map(item => item.id);
    setSelectedAgentPlanItemIds(new Set(applicableIds));
  };

  const clearAgentPlanSelection = () => {
    setSelectedAgentPlanItemIds(new Set());
  };

  const rejectAgentPlanItem = (itemId: string) => {
    setSelectedAgentPlanItemIds(prev => {
      const copy = new Set(prev);
      copy.delete(itemId);
      return copy;
    });
    setAgentPlan(prev => {
      if (!prev) return null;
      const items = prev.items.filter(item => item.id !== itemId);
      return {
        ...prev,
        items,
        coverage: {
          ...prev.coverage,
          proposedActionCount: items.length,
        },
      };
    });
  };

  const payloadForAgentPlanItem = (item: AgentPlanItem, extra: Record<string, unknown> = {}) => JSON.stringify({
    source: 'agentReviewQueue',
    planId: agentPlan?.id || null,
    itemId: item.id,
    action: item.action,
    riskLevel: item.riskLevel,
    confidence: item.confidence,
    reason: item.reason,
    citation: {
      messageId: item.citation.messageId || null,
      evidence: item.citation.evidence,
    },
    ...extra,
  });

  const latestMessageForAgentItem = async (item: AgentPlanItem): Promise<MailMessage | null> => {
    const messages = await window.electronAPI.listMessagesForThread(item.accountId, item.threadId);
    return (item.payload?.sourceMessageId
      ? messages.find(message => message.id === item.payload?.sourceMessageId)
      : null)
      || [...messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)).at(-1)
      || null;
  };

  const applyAgentPlanItem = async (item: AgentPlanItem) => {
    const thread = threads.find(thread => thread.accountId === item.accountId && thread.id === item.threadId);
    if (!thread) {
      emitToast({ type: 'warning', message: 'Source thread is no longer in the local cache.' });
      return;
    }

    const preview = agentPlanActionPreview(item);
    if (preview.eligibility === 'requiresReconnect') {
      emitToast({ type: 'warning', message: 'Reconnect Gmail before approving this remote action.' });
      return;
    }
    if (preview.eligibility === 'labelMissing') {
      emitToast({ type: 'warning', message: 'Choose a label before approving this action.' });
      return;
    }

    if (item.action === 'openThread') {
      await openThread(thread);
    } else if (item.action === 'markRead') {
      await executeMailAction('markRead', item.threadId, null, undefined, payloadForAgentPlanItem(item));
    } else if (item.action === 'archive') {
      await executeMailAction('markDone', item.threadId, null, undefined, payloadForAgentPlanItem(item));
    } else if (item.action === 'setReminder') {
      const reminderAt = item.payload?.reminderAt || (() => {
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        tomorrow.setHours(9, 0, 0, 0);
        return tomorrow.toISOString();
      })();
      await executeMailAction('setReminder', item.threadId, null, undefined, payloadForAgentPlanItem(item, { reminderAt }));
    } else if (item.action === 'applyLabel') {
      await executeMailAction(
        'applyLabel',
        item.threadId,
        null,
        undefined,
        payloadForAgentPlanItem(item, { labelId: item.payload?.labelId || null })
      );
    } else if (item.action === 'unsubscribe') {
      await executeMailAction(
        'unsubscribeSender',
        item.threadId,
        null,
        // Forward the reviewed message id so the main process executes exactly
        // the unsubscribe method that was shown at approval time.
        async (actionId: string) => window.electronAPI.unsubscribeThread(
          item.accountId,
          item.threadId,
          actionId,
          item.payload?.sourceMessageId || undefined,
        ),
        payloadForAgentPlanItem(item, { accountId: item.accountId })
      );
    } else if (item.action === 'draftReply') {
      const sourceMessage = await latestMessageForAgentItem(item);
      if (!sourceMessage) {
        emitToast({ type: 'warning', message: 'No source message found for this plan item.' });
        return;
      }
      await openThread(thread);
      const draft = startReplyWithBody(sourceMessage, '');
      if (draft) {
        await executeMailAction(
          'applyAIDraftPreview',
          item.threadId,
          draft.id,
          async () => null,
          payloadForAgentPlanItem(item, { draftId: draft.id })
        );
      }
    }

    rejectAgentPlanItem(item.id);
    emitToast({ type: 'success', message: 'Approved action applied.' });
  };

  const applySelectedAgentPlanItems = async () => {
    if (!agentPlan || selectedAgentPlanItemIds.size === 0) return;
    const executableItems = agentPlan.items.filter(item => (
      selectedAgentPlanItemIds.has(item.id) && agentPlanActionPreview(item).eligibility === 'ready'
    ));

    for (const item of executableItems) {
      await applyAgentPlanItem(item);
    }
    setSelectedAgentPlanItemIds(new Set());
  };

  const addDailyBriefingItemToAgentPlan = (item: DailyBriefingItem, labelId?: string | null) => {
    if (!dailyBriefing) return;
    const nextItem = buildAgentPlanFromDailyBriefingItem({ briefing: dailyBriefing, item, labelId }).items[0];
    setAgentPlan(prev => mergeAgentPlanItem(prev, nextItem));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      if (nextItem.selectionPolicy === 'autoSelected') next.add(nextItem.id);
      return next;
    });
    setAiPanelOpen(true);
    emitToast({ type: 'success', message: 'Added to Agent Review Queue.' });
  };

  const addAgentPlanItems = (items: AgentPlanItem[]) => {
    if (items.length === 0) return;
    setAgentPlan(prev => items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      for (const item of items) {
        if (item.selectionPolicy === 'autoSelected') next.add(item.id);
      }
      return next;
    });
    setAiPanelOpen(true);
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

    setTriagePlan(plan);
    const reviewPlan = buildAgentPlanFromTriagePlan({ plan, threads: visibleThreads, aiAssisted: usedAI });
    setAgentPlan(prev => reviewPlan.items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      for (const item of reviewPlan.items) {
        if (item.selectionPolicy === 'autoSelected') next.add(item.id);
      }
      return next;
    });
    setAiPanelLoading(false);
    emitToast({ type: 'success', message: `${usedAI ? 'AI' : 'Fast'} review queue ready for ${reviewPlan.items.length} actions.` });
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
    agentPlan,
    setAgentPlan,
    dailyBriefing,
    setDailyBriefing,
    dailyBriefingLoading,
    aiPanelLoading,
    aiModel,
    setAiModel,
    selectedAgentPlanItemIds,
    agentPlanQueueReadiness,
    agentPlanActionPreview,
    startNewAIConversation,
    selectAIConversation,
    sendAIMessage,
    runAIAction,
    runAIPromptShortcut,
    runAITriagePlan,
    runDailyBriefing,
    dismissDailyBriefingItem,
    addDailyBriefingItemToAgentPlan,
    addAgentPlanItems,
    toggleAgentPlanItemSelection,
    selectAllApplicableAgentPlanItems,
    clearAgentPlanSelection,
    applySelectedAgentPlanItems,
    applyAgentPlanItem,
    rejectAgentPlanItem,
    loadAIConversations
  };
}
