import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, MailThread, MailMessage, Draft, AppSettings, MailActionExecutionResult, MailActionLog } from '../../../shared/types';
import { startReply as buildReplySeed, startForward as buildForwardSeed, validateDraft } from '../../../shared/compose';
import { buildInitialDraftBodyWithSignature, compileDraftBodyHtml, htmlFragmentToPlainText, plainTextToHtmlFragment } from '../../../shared/draftHtml';
import { emitToast } from '../lib/toastBus';
import { replyDraftPlaceholderValidationMessage } from '../../../shared/replyPipeline';
import { filesToAttachments } from '../lib/composeHtmlHelpers';

interface UseDraftsStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openThread: (thread: MailThread | null) => Promise<void>;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any) => Promise<MailActionExecutionResult>;
}

export function useDraftsState({
  settings,
  accounts,
  activeAccount,
  openedThread,
  openThread,
  executeMailAction,
}: UseDraftsStateProps) {
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [composeLayout, setComposeLayout] = useState<'inline' | 'floating'>('floating');
  const [draftsList, setDraftsList] = useState<Draft[]>([]);
  const [pendingSend, setPendingSend] = useState<boolean>(false);
  const [pendingSendSeconds, setPendingSendSeconds] = useState<number>(0);
  
  const pendingSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDraftRef = useRef<Draft | null>(null);
  const activeDraftRef = useRef<Draft | null>(activeDraft);
  activeDraftRef.current = activeDraft;
  const shouldPersistDrafts = settings.general.keepDraftsAcrossLaunches;

  const persistDraft = (draft: Draft, context: string): Promise<void> => {
    if (!shouldPersistDrafts) return Promise.resolve();
    return window.electronAPI.saveDraft(draft).catch(e => {
      console.error(`saveDraft (${context}) failed`, e);
    });
  };

  const loadDrafts = useCallback(async () => {
    if (!settings.general.keepDraftsAcrossLaunches) {
      setDraftsList([]);
      return;
    }
    if (!activeAccount) return;
    if (activeAccount.id === 'unified') {
      const allDrafts: Draft[] = [];
      for (const acc of accounts) {
        const list = await window.electronAPI.listDrafts(acc.email);
        allDrafts.push(...list);
      }
      setDraftsList(allDrafts);
    } else {
      const list = await window.electronAPI.listDrafts(activeAccount.email);
      setDraftsList(list);
    }
  }, [activeAccount, accounts, settings.general.keepDraftsAcrossLaunches]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  useEffect(() => {
    if (settings.general.keepDraftsAcrossLaunches) return;

    let cancelled = false;
    const purgePersistedDrafts = async () => {
      if (!activeAccount) {
        setDraftsList([]);
        return;
      }

      const accountEmails = activeAccount.id === 'unified'
        ? accounts.map(account => account.email)
        : [activeAccount.email];
      const deletedDraftIds = new Set<string>();

      for (const email of accountEmails) {
        const drafts = await window.electronAPI.listDrafts(email);
        for (const draft of drafts) {
          if (deletedDraftIds.has(draft.id)) continue;
          deletedDraftIds.add(draft.id);
          await window.electronAPI.deleteDraft(draft.id);
        }
      }

      if (!cancelled) setDraftsList([]);
    };

    purgePersistedDrafts().catch(e => {
      console.error('Failed to clear persisted drafts after disabling draft restore:', e);
    });

    return () => {
      cancelled = true;
    };
  }, [activeAccount, accounts, settings.general.keepDraftsAcrossLaunches]);

  useEffect(() => {
    if (activeDraft && !activeDraft.threadId) {
      setComposeLayout('floating');
    }
  }, [activeDraft?.id, activeDraft?.threadId]);

  const resolveDraftAccountId = (preferredAccountId?: string | null): string | null => {
    if (preferredAccountId?.trim()) return preferredAccountId.trim();
    if (!activeAccount) return null;
    return activeAccount.id === 'unified'
      ? accounts[0]?.email || null
      : activeAccount.email;
  };

  const startNewDraft = (preferredAccountId?: string | null, seed: Partial<Pick<Draft, 'to' | 'cc' | 'bcc' | 'subject'>> = {}): Draft | null => {
    const accountId = resolveDraftAccountId(preferredAccountId);
    if (!accountId) return null;

    const initialBody = buildInitialDraftBodyWithSignature('', settings.compose, settings.profile, accountId);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId,
      threadId: null,
      to: seed.to || [],
      cc: seed.cc || [],
      bcc: seed.bcc || [],
      subject: seed.subject || '',
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: initialBody.bodyHtml,
      attachments: [],
      updatedAt: new Date().toISOString()
    };

    setActiveDraft(draft);
    setComposeLayout('floating');
    return draft;
  };

  const saveDraftLocally = async (body: string, toStr: string, subject: string) => {
    if (!activeAccount) return;

    const toRecipients = toStr ? toStr.split(',').map(e => ({ name: '', email: e.trim() })) : [];
    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);
    if (!targetAccountId) return;
    const initialBody = buildInitialDraftBodyWithSignature(body, settings.compose, settings.profile, targetAccountId);

    const draft: Draft = {
      id: activeDraft?.id || crypto.randomUUID(),
      accountId: targetAccountId,
      threadId: openedThread?.id || null,
      to: toRecipients,
      cc: activeDraft?.cc || [],
      bcc: activeDraft?.bcc || [],
      subject: subject || (openedThread ? `Re: ${openedThread.subject}` : ''),
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: activeDraft?.bodyHtml || initialBody.bodyHtml,
      attachments: activeDraft?.attachments || [],
      updatedAt: new Date().toISOString()
    };

    await persistDraft(draft, 'manual');
    setActiveDraft(draft);
    setComposeLayout('inline');
    loadDrafts();
  };

  const startReply = (message: MailMessage, replyAll = false) => {
    if (!activeAccount) return;
    const selfEmail = activeAccount.id === 'unified'
      ? (accounts.find(a => a.email === message.accountId)?.email || message.accountId)
      : activeAccount.email;
    const seed = buildReplySeed(message, selfEmail, replyAll || settings.compose.alwaysReplyAll);
    const initialBody = buildInitialDraftBodyWithSignature(seed.body, settings.compose, settings.profile, message.accountId, seed.bodyHtml);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: message.threadId,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: initialBody.bodyHtml,
      attachments: [],
      replyMessageId: seed.replyMessageId || null,
      replyReferences: seed.replyReferences || null,
      updatedAt: new Date().toISOString()
    };
    persistDraft(draft, 'reply');
    setActiveDraft(draft);
    setComposeLayout('inline');
    loadDrafts();
  };

  const startReplyWithBody = (message: MailMessage, bodyPlain: string, replyAll = false): Draft | null => {
    if (!activeAccount) return null;
    const selfEmail = activeAccount.id === 'unified'
      ? (accounts.find(a => a.email === message.accountId)?.email || message.accountId)
      : activeAccount.email;
    const seed = buildReplySeed(message, selfEmail, replyAll || settings.compose.alwaysReplyAll);
    const responsePlain = bodyPlain.trim();
    const combinedBodyPlain = responsePlain ? `${responsePlain}${seed.body}` : seed.body;
    const combinedBodyHtml = `${responsePlain ? plainTextToHtmlFragment(responsePlain) : ''}${seed.bodyHtml || ''}`;
    const initialBody = buildInitialDraftBodyWithSignature(combinedBodyPlain, settings.compose, settings.profile, message.accountId, combinedBodyHtml);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: message.threadId,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: initialBody.bodyHtml,
      attachments: [],
      replyMessageId: seed.replyMessageId || null,
      replyReferences: seed.replyReferences || null,
      updatedAt: new Date().toISOString()
    };
    persistDraft(draft, 'agent reply');
    setActiveDraft(draft);
    setComposeLayout('inline');
    loadDrafts();
    return draft;
  };

  const startForward = (message: MailMessage) => {
    if (!activeAccount) return;
    const seed = buildForwardSeed(message);
    const initialBody = buildInitialDraftBodyWithSignature(seed.body, settings.compose, settings.profile, message.accountId);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: null,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: initialBody.bodyHtml,
      attachments: [],
      updatedAt: new Date().toISOString()
    };
    openThread(null);
    persistDraft(draft, 'forward');
    setActiveDraft(draft);
    setComposeLayout('floating');
    loadDrafts();
  };

  const updateDraft = (patch: Partial<Draft>) => {
    if (!activeDraft) return;
    const updated: Draft = { ...activeDraft, ...patch, updatedAt: new Date().toISOString() };
    setActiveDraft(updated);
    persistDraft(updated, 'update');
  };

  const updateDraftBody = (body: string, bodyHtml?: string | null) => {
    if (!activeDraft) return;
    const updated: Draft = {
      ...activeDraft,
      bodyPlain: body,
      bodyHtml: bodyHtml === undefined ? activeDraft.bodyHtml || null : bodyHtml,
      updatedAt: new Date().toISOString()
    };
    setActiveDraft(updated);
    persistDraft(updated, 'body');
  };

  const addAttachmentToDraft = async () => {
    if (!activeDraft) return;
    const targetDraftId = activeDraft.id;
    const attachments = await window.electronAPI.uploadAttachments();
    if (attachments.length === 0) return;
    const currentDraft = activeDraftRef.current;
    if (!currentDraft || currentDraft.id !== targetDraftId) return;
    const updatedDraft: Draft = {
      ...currentDraft,
      attachments: [...(currentDraft.attachments || []), ...attachments],
      updatedAt: new Date().toISOString()
    };
    await persistDraft(updatedDraft, 'attachments');
    activeDraftRef.current = updatedDraft;
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const addDroppedFilesToDraft = async (files: readonly File[]) => {
    if (!activeDraft || files.length === 0) return;
    const targetDraftId = activeDraft.id;
    try {
      const attachments = await filesToAttachments(files);
      const currentDraft = activeDraftRef.current;
      if (!currentDraft || currentDraft.id !== targetDraftId) return;
      const updatedDraft: Draft = {
        ...currentDraft,
        attachments: [...(currentDraft.attachments || []), ...attachments],
        updatedAt: new Date().toISOString(),
      };
      await persistDraft(updatedDraft, 'dropped attachments');
      activeDraftRef.current = updatedDraft;
      setActiveDraft(updatedDraft);
      loadDrafts();
    } catch (error: unknown) {
      emitToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to attach dropped files.',
      });
    }
  };

  const removeAttachmentFromDraft = async (attId: string) => {
    if (!activeDraft) return;
    const updatedDraft: Draft = {
      ...activeDraft,
      attachments: (activeDraft.attachments || []).filter(a => a.id !== attId),
      updatedAt: new Date().toISOString()
    };
    await persistDraft(updatedDraft, 'remove attachment');
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const discardDraft = async (draftId: string) => {
    try {
      await window.electronAPI.deleteDraft(draftId);
    } catch (e) {
      console.error('Failed to delete draft:', e);
    }
    if (activeDraft?.id === draftId) {
      setActiveDraft(null);
    }
    loadDrafts();
  };

  const validateDraftForSend = (draftToValidate: Draft): string | null => {
    const placeholderError = replyDraftPlaceholderValidationMessage(draftToValidate.bodyPlain, draftToValidate.bodyHtml);
    if (placeholderError) return placeholderError;
    const attachmentBytes = (draftToValidate.attachments || []).reduce((sum, att) => sum + (att.sizeBytes || 0), 0);
    const validation = validateDraft({
      to: draftToValidate.to,
      cc: draftToValidate.cc,
      bcc: draftToValidate.bcc,
      subject: draftToValidate.subject,
      body: draftToValidate.bodyPlain || htmlFragmentToPlainText(draftToValidate.bodyHtml || ''),
      attachmentBytes,
    });

    return validation.valid ? null : validation.errors[0] || 'Fix draft before sending.';
  };

  const scheduleDraftSend = async (date: Date) => {
    if (!activeDraft || !activeAccount) return;
    if (pendingSend) return;

    const sendAt = date.toISOString();
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      emitToast({ type: 'warning', message: 'Choose a future send time.' });
      return;
    }

    const validationError = validateDraftForSend(activeDraft);
    if (validationError) {
      emitToast({ type: 'warning', message: validationError });
      return;
    }

    const scheduledDraft: Draft = {
      ...activeDraft,
      sendAt,
      bodyHtml: compileDraftBodyHtml(activeDraft.bodyPlain, settings.compose, activeDraft.accountId, activeDraft.bodyHtml),
      updatedAt: new Date().toISOString(),
    };
    const log: MailActionLog = {
      id: crypto.randomUUID(),
      accountId: scheduledDraft.accountId,
      threadId: scheduledDraft.threadId || openedThread?.id || null,
      draftId: scheduledDraft.id,
      kind: 'send',
      status: 'pending_sync',
      createdAt: new Date().toISOString(),
      scheduledAt: sendAt,
      payloadJson: JSON.stringify({ sendAt }),
    };

    await window.electronAPI.saveDraft(scheduledDraft);
    await window.electronAPI.saveActionLog(log);
    setActiveDraft(null);
    pendingDraftRef.current = null;
    loadDrafts();
    emitToast({ type: 'success', message: `Message scheduled for ${date.toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}.` });
  };

  const sendDraftWithUndo = async () => {
    if (!activeDraft || !activeAccount) return;
    if (pendingSend) return;

    const draftToSend = activeDraft;
    const validationError = validateDraftForSend(draftToSend);
    if (validationError) {
      emitToast({ type: 'warning', message: validationError });
      return;
    }

    pendingDraftRef.current = draftToSend;

    const performSend = async () => {
      if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
      pendingSendTimerRef.current = null;
      setPendingSend(false);
      setPendingSendSeconds(0);
      const draft = pendingDraftRef.current;
      pendingDraftRef.current = null;
      if (!draft) return;
      try {
        await executeMailAction('send', draft.threadId || openedThread?.id, draft.id, async (actionId: string) => {
          const draftForSend = {
            ...draft,
            sendAt: null,
            bodyHtml: compileDraftBodyHtml(draft.bodyPlain, settings.compose, draft.accountId, draft.bodyHtml)
          };
          await window.electronAPI.saveDraft(draftForSend);
          const res = await window.electronAPI.sendDraft(draft.accountId, draftForSend, actionId);
          if (res && !res.offline) {
            await window.electronAPI.deleteDraft(draft.id);
          }
          return res;
        });
        loadDrafts();
        if (draft.threadId === openedThread?.id) openThread(null);
        emitToast({ type: 'success', message: 'Message sent.' });
      } catch (e) {
        console.error('Failed to send draft:', e);
        emitToast({ type: 'error', message: 'Failed to send message.' });
      }
    };

    const delaySec = Math.max(0, Math.round(settings.compose.sendUndoDelay ?? 10));
    setActiveDraft(null);

    if (delaySec === 0) {
      await performSend();
      return;
    }

    setPendingSend(true);
    setPendingSendSeconds(delaySec);
    pendingSendIntervalRef.current = setInterval(() => {
      setPendingSendSeconds(s => (s > 1 ? s - 1 : 0));
    }, 1000);
    pendingSendTimerRef.current = setTimeout(performSend, delaySec * 1000);
  };

  const cancelPendingSend = () => {
    if (pendingSendTimerRef.current) { clearTimeout(pendingSendTimerRef.current); pendingSendTimerRef.current = null; }
    if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
    setPendingSend(false);
    setPendingSendSeconds(0);
    if (pendingDraftRef.current) setActiveDraft(pendingDraftRef.current);
    pendingDraftRef.current = null;
  };

  return {
    activeDraft,
    setActiveDraft,
    composeLayout,
    setComposeLayout,
    draftsList,
    pendingSend,
    pendingSendSeconds,
    loadDrafts,
    startNewDraft,
    saveDraftLocally,
    startReply,
    startReplyWithBody,
    startForward,
    updateDraft,
    updateDraftBody,
    addAttachmentToDraft,
    addDroppedFilesToDraft,
    removeAttachmentFromDraft,
    discardDraft,
    scheduleDraftSend,
    sendDraftWithUndo,
    cancelPendingSend
  };
}
