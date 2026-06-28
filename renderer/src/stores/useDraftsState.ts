import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, MailThread, MailMessage, Draft, AppSettings } from '../../../shared/types';
import { startReply as buildReplySeed, startForward as buildForwardSeed } from '../../../shared/compose';
import { emitToast } from '../lib/toastBus';

interface UseDraftsStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openThread: (thread: MailThread | null) => Promise<void>;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any) => Promise<void>;
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
  const [draftsList, setDraftsList] = useState<Draft[]>([]);
  const [pendingSend, setPendingSend] = useState<boolean>(false);
  const [pendingSendSeconds, setPendingSendSeconds] = useState<number>(0);
  
  const pendingSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDraftRef = useRef<Draft | null>(null);

  const loadDrafts = useCallback(async () => {
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
  }, [activeAccount, accounts]);

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  const saveDraftLocally = async (body: string, toStr: string, subject: string) => {
    if (!activeAccount) return;

    const toRecipients = toStr ? toStr.split(',').map(e => ({ name: '', email: e.trim() })) : [];
    const targetAccountId = openedThread ? openedThread.accountId : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);

    const draft: Draft = {
      id: activeDraft?.id || crypto.randomUUID(),
      accountId: targetAccountId,
      threadId: openedThread?.id || null,
      to: toRecipients,
      cc: [],
      bcc: [],
      subject: subject || (openedThread ? `Re: ${openedThread.subject}` : ''),
      bodyPlain: body,
      attachments: activeDraft?.attachments || [],
      updatedAt: new Date().toISOString()
    };

    await window.electronAPI.saveDraft(draft);
    setActiveDraft(draft);
    loadDrafts();
  };

  const startReply = (message: MailMessage, replyAll = false) => {
    if (!activeAccount) return;
    const selfEmail = activeAccount.id === 'unified'
      ? (accounts.find(a => a.email === message.accountId)?.email || message.accountId)
      : activeAccount.email;
    const seed = buildReplySeed(message, selfEmail, replyAll || settings.compose.alwaysReplyAll);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: message.threadId,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: seed.body,
      attachments: [],
      replyMessageId: seed.replyMessageId || null,
      replyReferences: seed.replyReferences || null,
      updatedAt: new Date().toISOString()
    };
    window.electronAPI.saveDraft(draft).catch(e => console.error('saveDraft (reply) failed', e));
    setActiveDraft(draft);
    loadDrafts();
  };

  const startForward = (message: MailMessage) => {
    if (!activeAccount) return;
    const seed = buildForwardSeed(message);
    const draft: Draft = {
      id: crypto.randomUUID(),
      accountId: message.accountId,
      threadId: null,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: seed.body,
      attachments: [],
      updatedAt: new Date().toISOString()
    };
    openThread(null);
    window.electronAPI.saveDraft(draft).catch(e => console.error('saveDraft (forward) failed', e));
    setActiveDraft(draft);
    loadDrafts();
  };

  const updateDraftBody = (body: string) => {
    if (!activeDraft) return;
    const updated: Draft = { ...activeDraft, bodyPlain: body, updatedAt: new Date().toISOString() };
    setActiveDraft(updated);
    window.electronAPI.saveDraft(updated).catch(e => console.error('saveDraft (body) failed', e));
  };

  const addAttachmentToDraft = async () => {
    if (!activeDraft) return;
    const attachment = await window.electronAPI.uploadAttachment();
    if (!attachment) return;
    const updatedDraft: Draft = {
      ...activeDraft,
      attachments: [...(activeDraft.attachments || []), attachment],
      updatedAt: new Date().toISOString()
    };
    await window.electronAPI.saveDraft(updatedDraft);
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const removeAttachmentFromDraft = async (attId: string) => {
    if (!activeDraft) return;
    const updatedDraft: Draft = {
      ...activeDraft,
      attachments: (activeDraft.attachments || []).filter(a => a.id !== attId),
      updatedAt: new Date().toISOString()
    };
    await window.electronAPI.saveDraft(updatedDraft);
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

  const sendDraftWithUndo = async () => {
    if (!activeDraft || !activeAccount) return;
    if (pendingSend) return;

    const draftToSend = activeDraft;
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
          const res = await window.electronAPI.sendDraft(draft.accountId, draft, actionId);
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
    draftsList,
    pendingSend,
    pendingSendSeconds,
    loadDrafts,
    saveDraftLocally,
    startReply,
    startForward,
    updateDraftBody,
    addAttachmentToDraft,
    removeAttachmentFromDraft,
    discardDraft,
    sendDraftWithUndo,
    cancelPendingSend
  };
}
