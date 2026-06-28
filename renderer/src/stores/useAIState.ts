import { useState, useEffect, useCallback } from 'react';
import { Account, MailThread, MailMessage, AIProviderPreference, AIProviderDescriptor, AIConversation, AIChatMessage, MailTriagePlan, MailTriagePlanItem, MailTriageActionPreview, AIAction, AppSettings } from '../../../shared/types';
import { buildThreadContext } from '../../../shared/aiContext';
import { emitToast } from '../lib/toastBus';
import { SpeedProof } from './useMailState';
import { MailTriagePlanner } from '../../../shared/triagePlanner';

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
  const [aiPanelLoading, setAiPanelLoading] = useState<boolean>(false);
  const [aiModel, setAiModel] = useState<string>('');
  
  const [selectedTriageThreadIds, setSelectedTriageThreadIds] = useState<Set<string>>(new Set());
  const [activeAccountCredentialsValid, setActiveAccountCredentialsValid] = useState<boolean>(true);

  // Sync provider and model from settings on load/change
  useEffect(() => {
    if (settings?.ai) {
      setAiProviderState(settings.ai.provider);
      setAiModel(settings.ai.globalDefaultModel);
    }
  }, [settings?.ai?.provider, settings?.ai?.globalDefaultModel]);

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

      setSpeedProof((prev: SpeedProof) => ({
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

      setSpeedProof((prev: SpeedProof) => ({
        ...prev,
        aiMs: Math.round(performance.now() - start)
      }));
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

  return {
    aiPanelOpen,
    setAiPanelOpen,
    aiProvider,
    setAiProvider: setAiProviderState,
    aiProviderDesc,
    aiConversations,
    activeAIConversation,
    activeAIMessages,
    triagePlan,
    setTriagePlan,
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
    runAITriagePlan,
    toggleTriagePlanItemSelection,
    selectAllApplicableTriagePlanItems,
    clearTriagePlanSelection,
    applySelectedTriagePlanItems,
    applyTriagePlanItem,
    loadAIConversations
  };
}
