import { useState, useEffect, useCallback, useLayoutEffect, useRef } from 'react';
import { Account, MailThread, MailMessage, MailLabelDefinition, MailSyncCompletion, AIProviderPreference, AIProviderDescriptor, AIConversation, AIChatMessage, MailTriagePlan, AIAction, AppSettings, AIPromptShortcut, DailyBriefing, DailyBriefingBuildOptions, DailyBriefingItem, AgentPlan, AgentPlanItem, AgentPlanActionPreview, AgentPlanQueueReadiness, MailActionExecutionResult } from '../../../shared/types';
import { buildThreadContext } from '../../../shared/aiContext';
import { formatAIUserError } from '../../../shared/aiErrors';
import { resolveAIModelForPurpose } from '../../../shared/aiModelPurpose';
import { withAIRequestTimeout } from '../../../shared/aiRequest';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';
import { MailTriagePlanner } from '../../../shared/triagePlanner';
import { buildAITriageContext, buildAITriageInstruction, buildAITriagePlanFromResponse } from '../../../shared/aiTriage';
import { normalizeDailyBriefingSettings } from '../../../shared/dailyBriefing';
import { buildAgentPlanFromDailyBriefingItem, buildAgentPlanFromTriagePlan, mergeAgentPlanItem } from '../../../shared/agentPlan';
import {
  dailyBriefingRefreshWindowKey,
  filterAgentPlanItemsForOperatorScope,
  isOperatorRequestCurrent,
  normalizeOperatorHomeScopeId,
  type OperatorRequestToken,
} from '../../../shared/operatorHomeState';

interface UseAIStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openedThreadMessages: MailMessage[];
  visibleThreads: MailThread[];
  activeSplit: string;
  threads: MailThread[];
  labelDefinitions: MailLabelDefinition[];
  lastSuccessfulSync: MailSyncCompletion | null;
  openThread: (thread: MailThread | null) => Promise<void>;
  startReplyWithBody: (message: MailMessage, bodyPlain: string, replyAll?: boolean) => any;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any, payloadJson?: string | null) => Promise<MailActionExecutionResult>;
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
  labelDefinitions,
  lastSuccessfulSync,
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
  const [credentialsValidByAccount, setCredentialsValidByAccount] = useState<Record<string, boolean>>({});
  const [loadedOperatorScope, setLoadedOperatorScope] = useState<string | null>(null);
  const [lastAutoRefreshWindow, setLastAutoRefreshWindow] = useState<string | null>(null);
  const operatorScopeId = activeAccount
    ? normalizeOperatorHomeScopeId(activeAccount.id === 'unified' ? 'unified' : activeAccount.email)
    : null;
  const currentOperatorScopeRef = useRef<string | null>(operatorScopeId);
  const operatorScopeGenerationRef = useRef(0);
  const dailyBriefingRequestGenerationRef = useRef(0);
  const triageRequestGenerationRef = useRef(0);
  const aiChatRequestGenerationRef = useRef(0);
  const aiChatInFlightRef = useRef(false);
  const autoRefreshInFlightRef = useRef<string | null>(null);
  const lastAutoRefreshAttemptRef = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (currentOperatorScopeRef.current === operatorScopeId) return;
    currentOperatorScopeRef.current = operatorScopeId;
    operatorScopeGenerationRef.current += 1;
    dailyBriefingRequestGenerationRef.current += 1;
    triageRequestGenerationRef.current += 1;
    aiChatRequestGenerationRef.current += 1;
    aiChatInFlightRef.current = false;
    setAiPanelLoading(false);
    setActiveAIConversation(null);
    setActiveAIMessages([]);
    autoRefreshInFlightRef.current = null;
    lastAutoRefreshAttemptRef.current = null;
  }, [operatorScopeId]);

  // Sync provider and model from settings on load/change
  useEffect(() => {
    if (!settings?.ai) return;
    setAiProviderState(current => {
      if (current === settings.ai.provider) return current;
      setAiModel('');
      setAiProviderDesc(null);
      return settings.ai.provider;
    });
  }, [settings?.ai?.provider]);

  const setAiProvider = useCallback((pref: AIProviderPreference) => {
    setAiProviderState(pref);
    setAiModel('');
    setAiProviderDesc(null);
  }, []);

  // Credential readiness is per account so restored Unified queues cannot
  // accidentally treat every remote action as connected.
  useEffect(() => {
    let active = true;
    const connectedAccounts = accounts.filter(account => account.email && account.id !== 'unified');
    void Promise.all(connectedAccounts.map(async account => [
      account.email.trim().toLowerCase(),
      await window.electronAPI.verifyTokenExists(account.email),
    ] as const)).then(entries => {
      if (active) setCredentialsValidByAccount(Object.fromEntries(entries));
    }).catch(error => {
      console.warn('Failed to verify account credentials for Operator Home:', error);
      if (active) setCredentialsValidByAccount({});
    });
    return () => {
      active = false;
    };
  }, [accounts]);

  // Each account (and Unified) owns an independent durable Operator Home
  // snapshot. Clear old-scope state before async restore to prevent cross-account
  // persistence when the account selector changes quickly.
  useEffect(() => {
    let active = true;
    const scopeGeneration = operatorScopeGenerationRef.current;
    setLoadedOperatorScope(null);
    setAgentPlan(null);
    setSelectedAgentPlanItemIds(new Set());
    setDailyBriefing(null);
    setLastAutoRefreshWindow(null);
    setDailyBriefingLoading(false);
    setAiPanelLoading(false);
    if (!operatorScopeId) return () => {
      active = false;
    };

    const restore = async () => {
      for (let attempt = 1; attempt <= 3; attempt += 1) {
        try {
          const snapshot = await window.electronAPI.getOperatorHomeState(operatorScopeId);
          if (!active
            || currentOperatorScopeRef.current !== operatorScopeId
            || operatorScopeGenerationRef.current !== scopeGeneration) return;
          setAgentPlan(snapshot?.agentPlan || null);
          setSelectedAgentPlanItemIds(new Set(snapshot?.selectedAgentPlanItemIds || []));
          setDailyBriefing(snapshot?.dailyBriefing || null);
          setLastAutoRefreshWindow(snapshot?.lastAutoRefreshWindow || null);
          setLoadedOperatorScope(operatorScopeId);
          return;
        } catch (error) {
          if (!active
            || currentOperatorScopeRef.current !== operatorScopeId
            || operatorScopeGenerationRef.current !== scopeGeneration) return;
          if (attempt === 3) {
            // Keep the scope unhydrated so the autosave effect cannot replace a
            // durable snapshot with the cleared in-memory defaults.
            console.error('Failed to restore Operator Home state:', error);
            return;
          }
          await new Promise(resolve => globalThis.setTimeout(resolve, attempt * 200));
        }
      }
    };
    void restore();

    return () => {
      active = false;
    };
  }, [operatorScopeId]);

  // Persist all review decisions and briefing dismissals after hydration. A
  // short debounce coalesces plan and selection changes from the same action.
  useEffect(() => {
    if (!operatorScopeId || loadedOperatorScope !== operatorScopeId) return;
    const timeout = globalThis.setTimeout(() => {
      void window.electronAPI.saveOperatorHomeState({
        scopeId: operatorScopeId,
        agentPlan,
        selectedAgentPlanItemIds: Array.from(selectedAgentPlanItemIds),
        dailyBriefing,
        lastAutoRefreshWindow,
        updatedAt: new Date().toISOString(),
      }).catch(error => {
        console.error('Failed to persist Operator Home state:', error);
      });
    }, 120);
    return () => globalThis.clearTimeout(timeout);
  }, [agentPlan, dailyBriefing, lastAutoRefreshWindow, loadedOperatorScope, operatorScopeId, selectedAgentPlanItemIds]);

  // Resolve active AI provider descriptors
  useEffect(() => {
    let active = true;
    window.electronAPI.getAIProviderDescriptor(aiProvider).then(desc => {
      if (active) setAiProviderDesc(desc);
    });
    return () => {
      active = false;
    };
  }, [aiProvider]);

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
    aiChatRequestGenerationRef.current += 1;
    aiChatInFlightRef.current = false;
    setAiPanelLoading(false);
    setActiveAIConversation(null);
    setActiveAIMessages([]);
  };

  const selectAIConversation = async (conv: AIConversation) => {
    const scopeId = operatorScopeId;
    const scopeGeneration = operatorScopeGenerationRef.current;
    const requestGeneration = ++aiChatRequestGenerationRef.current;
    aiChatInFlightRef.current = false;
    setAiPanelLoading(false);
    const msgs = await window.electronAPI.getConversationMessages(conv.id);
    if (scopeId !== currentOperatorScopeRef.current
      || scopeGeneration !== operatorScopeGenerationRef.current
      || requestGeneration !== aiChatRequestGenerationRef.current) return;
    setActiveAIConversation(conv);
    setActiveAIMessages(msgs);
  };

  const sendAIMessage = async (text: string) => {
    if (!activeAccount || !operatorScopeId || aiChatInFlightRef.current) return;

    const requestToken: OperatorRequestToken = {
      scopeId: operatorScopeId,
      scopeGeneration: operatorScopeGenerationRef.current,
      requestGeneration: ++aiChatRequestGenerationRef.current,
    };
    const requestIsCurrent = () => isOperatorRequestCurrent(
      requestToken,
      currentOperatorScopeRef.current,
      operatorScopeGenerationRef.current,
      aiChatRequestGenerationRef.current,
    );
    const proposalAccountIds = activeAccount.id === 'unified'
      ? accounts.map(account => account.email)
      : [activeAccount.email];

    const start = performance.now();
    aiChatInFlightRef.current = true;
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
      const response = await withAIRequestTimeout(window.electronAPI.completeAI({
        action: 'chat',
        context: openedThread
          ? buildThreadContext(openedThread, openedThreadMessages, settings.ai)
          : 'No thread open.',
        conversationHistory: newMsgs,
        userInstruction: text,
        toolPolicy: {
          enabled: settings.ai.externalToolsEnabled,
          allowMailboxSearch: true,
          allowCalendarSearch: true,
          allowActionProposals: true,
          mailboxAccountIds: proposalAccountIds,
          calendarAccountIds: proposalAccountIds,
        },
      }, aiProvider, resolveAIModelForPurpose('interactive', {
        interactiveModel: settings.ai.globalDefaultModel,
      }, aiModel)));
      if (!requestIsCurrent()) return;

      const assistantMsg: AIChatMessage = {
        id: crypto.randomUUID(),
        role: 'assistant',
        text: response.text,
        sources: response.sources,
      };

      const finalMsgs = [...newMsgs, assistantMsg];
      setActiveAIMessages(finalMsgs);
      if (settings.ai.savePromptHistory) {
        await window.electronAPI.saveConversation(conv, finalMsgs);
        if (!requestIsCurrent()) return;
        loadAIConversations();
      }
      if (!requestIsCurrent()) return;
      if (response.proposedActions && response.proposedActions.length > 0) {
        const scoped = filterAgentPlanItemsForOperatorScope(
          response.proposedActions,
          requestToken.scopeId,
          proposalAccountIds,
        );
        if (scoped.accepted.length > 0) addAgentPlanItems(scoped.accepted);
        if (scoped.rejected.length > 0) {
          emitToast({
            type: 'warning',
            message: `${scoped.rejected.length} proposal${scoped.rejected.length === 1 ? ' was' : 's were'} rejected because the account is outside the current operator scope.`,
          });
        }
        if (scoped.accepted.length > 0) {
          emitToast({
            type: 'success',
            message: `Added ${scoped.accepted.length} AI proposal${scoped.accepted.length === 1 ? '' : 's'} to the Review Queue.`,
          });
        }
      }
      for (const warning of response.proposalWarnings || []) {
        emitToast({ type: 'warning', message: warning });
      }

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
    } catch (e) {
      if (!requestIsCurrent()) return;
      console.error('AI chat completion failed:', e);
      emitToast({ type: 'error', message: formatAIUserError(e) });
    } finally {
      if (requestIsCurrent()) {
        aiChatInFlightRef.current = false;
        setAiPanelLoading(false);
      }
    }
  };

  const agentPlanActionPreview = useCallback((item: AgentPlanItem): AgentPlanActionPreview => {
    const isSelected = selectedAgentPlanItemIds.has(item.id);
    const threadExists = threads.some(thread => thread.accountId === item.accountId && thread.id === item.threadId);
    const normalizedItemAccountId = item.accountId.trim().toLowerCase();
    const accountLabels = labelDefinitions.filter(label => label.accountId.trim().toLowerCase() === normalizedItemAccountId);
    const targetLabelExists = Boolean(item.payload?.labelId)
      && accountLabels.some(label => label.id === item.payload?.labelId);
    const scope: AgentPlanActionPreview['scope'] =
      item.action === 'markRead' || item.action === 'archive' || item.action === 'applyLabel' || item.action === 'unsubscribe'
        ? 'gmail'
        : item.action === 'openThread'
          ? 'focus'
          : 'local';

    let eligibility: AgentPlanActionPreview['eligibility'] = 'ready';
    if (!threadExists) {
      eligibility = 'threadMissing';
    } else if (item.action === 'applyLabel' && (
      !item.payload?.labelId
      || !targetLabelExists
    )) {
      eligibility = 'labelMissing';
    } else if (scope === 'gmail' && credentialsValidByAccount[normalizedItemAccountId] !== true) {
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
  }, [credentialsValidByAccount, labelDefinitions, selectedAgentPlanItemIds, threads]);

  const agentPlanQueueReadiness: AgentPlanQueueReadiness | null = (() => {
    if (!agentPlan) return null;
    const selected = agentPlan.items
      .map(item => ({ item, preview: agentPlanActionPreview(item) }))
      .filter(({ preview }) => selectedAgentPlanItemIds.has(preview.itemId));
    if (selected.length === 0) return null;

    const executable = selected.filter(({ item, preview }) => (
      preview.eligibility === 'ready' && item.selectionPolicy !== 'manualOnly'
    ));
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
    accountId: item.accountId,
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
    provenance: item.provenance || null,
    sourceSnapshot: item.sourceSnapshot || null,
    ...(item.provenance?.origin === 'aiAssistant'
      && (item.action === 'archive' || item.action === 'applyLabel' || item.action === 'setReminder')
      ? { proposalValidationItem: item }
      : {}),
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
    if (item.provenance?.origin === 'aiAssistant') {
      const validation = await window.electronAPI.validateAgentActionProposal(item);
      if (!validation.valid) {
        emitToast({ type: 'warning', message: validation.message });
        return;
      }
    }

    try {
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
      const draft = startReplyWithBody(sourceMessage, item.payload?.bodyPlain || '');
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
    } catch (error) {
      emitToast({
        type: 'warning',
        message: error instanceof Error ? error.message : 'The reviewed action could not be applied.',
      });
      return;
    }

    rejectAgentPlanItem(item.id);
    emitToast({ type: 'success', message: 'Approved action applied.' });
  };

  const applySelectedAgentPlanItems = async () => {
    if (!agentPlan || selectedAgentPlanItemIds.size === 0) return;
    const executableItems = agentPlan.items.filter(item => (
      selectedAgentPlanItemIds.has(item.id)
      && item.selectionPolicy !== 'manualOnly'
      && agentPlanActionPreview(item).eligibility === 'ready'
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
    if (!activeAccount || !operatorScopeId) {
      emitToast({ type: 'warning', message: 'Connect an account before using AI actions.' });
      return;
    }
    if (requiresThread && !openedThread) {
      emitToast({ type: 'warning', message: 'Open a thread before running this AI shortcut.' });
      return;
    }
    if (aiChatInFlightRef.current) return;

    const requestToken: OperatorRequestToken = {
      scopeId: operatorScopeId,
      scopeGeneration: operatorScopeGenerationRef.current,
      requestGeneration: ++aiChatRequestGenerationRef.current,
    };
    const requestIsCurrent = () => isOperatorRequestCurrent(
      requestToken,
      currentOperatorScopeRef.current,
      operatorScopeGenerationRef.current,
      aiChatRequestGenerationRef.current,
    );

    aiChatInFlightRef.current = true;
    setAiPanelLoading(true);
    const start = performance.now();
    const notes = settings.ai.personalizationNotes ? `\nPersonalization notes: ${settings.ai.personalizationNotes}` : '';
    const context = requiresThread
      ? buildThreadContext(openedThread, openedThreadMessages, settings.ai)
      : 'No selected mail context. This reusable prompt shortcut is not thread-scoped; answer the user directly from the instruction and conversation history.';

    const userMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'user', text: label };
    const targetThreadId = requiresThread ? openedThread?.id || null : null;
    const targetAccountId = requiresThread && openedThread
      ? openedThread.accountId
      : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);
    const canReuseConversation = activeAIConversation?.threadId === targetThreadId
      && activeAIConversation.accountId === targetAccountId;
    const baseMessages = canReuseConversation ? activeAIMessages : [];
    const pending = [...baseMessages, userMsg];
    setActiveAIMessages(pending);

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
      const response = await withAIRequestTimeout(window.electronAPI.completeAI({
        action: 'chat',
        context,
        conversationHistory: pending,
        userInstruction: `${instruction}${notes}`,
        toolPolicy: {
          enabled: settings.ai.externalToolsEnabled,
          allowMailboxSearch: true,
          allowCalendarSearch: true,
          calendarAccountIds: activeAccount.id === 'unified' ? accounts.map(account => account.email) : [activeAccount.email],
        },
      }, aiProvider, resolveAIModelForPurpose('interactive', {
        interactiveModel: settings.ai.globalDefaultModel,
      }, aiModel)));
      if (!requestIsCurrent()) return;

      const assistantMsg: AIChatMessage = { id: crypto.randomUUID(), role: 'assistant', text: response.text, sources: response.sources };
      const finalMsgs = [...pending, assistantMsg];
      setActiveAIMessages(finalMsgs);
      if (settings.ai.savePromptHistory) {
        await window.electronAPI.saveConversation(conv, finalMsgs);
        if (!requestIsCurrent()) return;
        loadAIConversations();
      }
      if (!requestIsCurrent()) return;

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
    } catch (e) {
      if (!requestIsCurrent()) return;
      console.error('AI action failed:', e);
      setActiveAIMessages(prev => [...prev, { id: crypto.randomUUID(), role: 'system', text: formatAIUserError(e) }]);
    } finally {
      if (requestIsCurrent()) {
        aiChatInFlightRef.current = false;
        setAiPanelLoading(false);
      }
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
    if (!activeAccount || !operatorScopeId) {
      setTriagePlan(null);
      emitToast({ type: 'warning', message: 'Connect an account before building a triage queue.' });
      return;
    }
    const requestToken: OperatorRequestToken = {
      scopeId: operatorScopeId,
      scopeGeneration: operatorScopeGenerationRef.current,
      requestGeneration: ++triageRequestGenerationRef.current,
    };
    const requestIsCurrent = () => isOperatorRequestCurrent(
      requestToken,
      currentOperatorScopeRef.current,
      operatorScopeGenerationRef.current,
      triageRequestGenerationRef.current,
    );
    if (visibleThreads.length === 0) {
      setTriagePlan(null);
      emitToast({ type: 'info', message: 'No visible messages to triage in this tab.' });
      return;
    }
    
    setAiPanelLoading(true);

    const visibleThreadsSnapshot = [...visibleThreads];
    const activeSplitSnapshot = activeSplit;
    const isAutomationSplit = activeSplitSnapshot === 'automation';
    const intent = isAutomationSplit ? 'automationCleanup' : 'mailboxTriage';
    const now = new Date();
    
    const fallbackPlan = MailTriagePlanner.build(
      operatorScopeId,
      activeSplitSnapshot,
      visibleThreadsSnapshot,
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
          context: buildAITriageContext(visibleThreadsSnapshot),
          conversationHistory: [],
          userInstruction: buildAITriageInstruction(intent),
        }, aiProvider, resolveAIModelForPurpose('interactive', {
          interactiveModel: settings.ai.globalDefaultModel,
        }, aiModel));
        if (!requestIsCurrent()) return;

        plan = buildAITriagePlanFromResponse({
          accountId: fallbackPlan.accountId,
          sourceTitle: fallbackPlan.sourceTitle,
          generatedAt: now.toISOString(),
          sourceThreadCount: fallbackPlan.sourceThreadCount,
          intent,
          automationRulePreview: fallbackPlan.automationRulePreview || null,
          responseText: response.text,
          threads: visibleThreadsSnapshot,
        });
        usedAI = true;
      }
    } catch (error) {
      if (!requestIsCurrent()) return;
      console.warn('AI triage failed; using deterministic fallback:', error);
    } finally {
      if (requestIsCurrent()) setAiPanelLoading(false);
    }

    if (!requestIsCurrent()) return;
    setTriagePlan(plan);
    const reviewPlan = buildAgentPlanFromTriagePlan({ plan, threads: visibleThreadsSnapshot, aiAssisted: usedAI });
    setAgentPlan(prev => reviewPlan.items.reduce((acc, item) => mergeAgentPlanItem(acc, item), prev));
    setSelectedAgentPlanItemIds(prev => {
      const next = new Set(prev);
      for (const item of reviewPlan.items) {
        if (item.selectionPolicy === 'autoSelected') next.add(item.id);
      }
      return next;
    });
    emitToast({ type: 'success', message: `${usedAI ? 'AI' : 'Fast'} review queue ready for ${reviewPlan.items.length} actions.` });
  };

  const runDailyBriefing = useCallback(async (
    options: DailyBriefingBuildOptions = {},
    behavior: { openPanel?: boolean; silent?: boolean; preserveOnError?: boolean; autoRefreshWindowKey?: string } = {}
  ): Promise<boolean> => {
    if (behavior.openPanel !== false) {
      setAiPanelOpen(true);
    }
    if (!activeAccount || !operatorScopeId) {
      setDailyBriefing(null);
      emitToast({ type: 'warning', message: 'Connect an account before building a daily briefing.' });
      return false;
    }
    if (!settings.ai.dailyBriefing.enabled) {
      setDailyBriefing(null);
      emitToast({ type: 'info', message: 'Daily Briefing is disabled in AI settings.' });
      return false;
    }

    const requestToken: OperatorRequestToken = {
      scopeId: operatorScopeId,
      scopeGeneration: operatorScopeGenerationRef.current,
      requestGeneration: ++dailyBriefingRequestGenerationRef.current,
    };
    const requestIsCurrent = () => isOperatorRequestCurrent(
      requestToken,
      currentOperatorScopeRef.current,
      operatorScopeGenerationRef.current,
      dailyBriefingRequestGenerationRef.current,
    );
    const targetAccounts = activeAccount.id === 'unified' ? [...accounts] : [activeAccount];
    setDailyBriefingLoading(true);
    const start = performance.now();
    try {
      const briefingSettings = normalizeDailyBriefingSettings({ ...settings.ai.dailyBriefing, ...options });
      const requestOptions: DailyBriefingBuildOptions = {
        ...briefingSettings,
        nowIso: options.nowIso || new Date().toISOString(),
      };
      const briefings = await Promise.all(
        targetAccounts
          .filter(account => account.email)
          .map(account => window.electronAPI.buildDailyBriefing(account.email, requestOptions))
      );
      if (!requestIsCurrent()) return false;

      const briefing = activeAccount.id === 'unified'
        ? mergeDailyBriefings('unified', briefings, briefingSettings)
        : briefings[0] || null;

      setDailyBriefing(briefing);
      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
      if (behavior.autoRefreshWindowKey && briefing) {
        try {
          await window.electronAPI.finalizeOperatorHomeAutoRefreshWindow(
            operatorScopeId,
            behavior.autoRefreshWindowKey,
            briefing,
          );
          if (requestIsCurrent()) setLastAutoRefreshWindow(behavior.autoRefreshWindowKey);
        } catch (error) {
          console.warn('Failed to finalize Daily Briefing refresh window:', error);
        }
      }
      if (!requestIsCurrent()) return false;
      if (!behavior.silent) {
        emitToast({
          type: briefing && briefing.items.length > 0 ? 'success' : 'info',
          message: briefing && briefing.items.length > 0
            ? `Daily briefing ready with ${briefing.items.length} item${briefing.items.length === 1 ? '' : 's'}.`
            : 'Daily briefing found no current items.',
        });
      }
      return true;
    } catch (error) {
      if (!requestIsCurrent()) return false;
      console.error('Daily briefing failed:', error);
      if (!behavior.preserveOnError) setDailyBriefing(null);
      if (!behavior.silent) emitToast({ type: 'error', message: formatAIUserError(error) });
      return false;
    } finally {
      if (requestIsCurrent()) setDailyBriefingLoading(false);
    }
  }, [accounts, activeAccount, operatorScopeId, setSpeedProof, settings.ai.dailyBriefing]);

  // Refresh only after the matching Gmail sync has been persisted and the
  // renderer cache reloaded. The window is finalized by runDailyBriefing only
  // after a successful local build, so failures remain retryable on the next
  // successful sync completion. Semantic search stays off on this path.
  useEffect(() => {
    if (!operatorScopeId || loadedOperatorScope !== operatorScopeId) return;
    if (!activeAccount || !settings.ai.dailyBriefing.enabled) return;
    if (activeAccount.id === 'unified' && accounts.length === 0) return;
    if (!lastSuccessfulSync || dailyBriefingLoading) return;

    const targetAccountIds = (activeAccount.id === 'unified' ? accounts : [activeAccount])
      .map(account => account.email.trim().toLowerCase())
      .filter(Boolean);
    const completedAccountIds = new Set(lastSuccessfulSync.accountIds.map(accountId => accountId.trim().toLowerCase()));
    if (targetAccountIds.length === 0 || !targetAccountIds.every(accountId => completedAccountIds.has(accountId))) return;

    const now = new Date();
    const windowKey = dailyBriefingRefreshWindowKey(now, settings.ai.dailyBriefing.defaultReminderHour);
    if (lastAutoRefreshWindow === windowKey) return;
    const attemptKey = `${operatorScopeId}:${windowKey}:${lastSuccessfulSync.revision}`;
    if (autoRefreshInFlightRef.current || lastAutoRefreshAttemptRef.current === attemptKey) return;
    autoRefreshInFlightRef.current = attemptKey;
    lastAutoRefreshAttemptRef.current = attemptKey;

    void runDailyBriefing(
        { useSemanticSearch: false, nowIso: now.toISOString() },
        { openPanel: false, silent: true, preserveOnError: true, autoRefreshWindowKey: windowKey },
      ).finally(() => {
        if (autoRefreshInFlightRef.current === attemptKey) {
          autoRefreshInFlightRef.current = null;
        }
      });
  }, [
    accounts.length,
    activeAccount,
    dailyBriefingLoading,
    lastAutoRefreshWindow,
    lastSuccessfulSync,
    loadedOperatorScope,
    operatorScopeId,
    runDailyBriefing,
    settings.ai.dailyBriefing.defaultReminderHour,
    settings.ai.dailyBriefing.enabled,
  ]);

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
