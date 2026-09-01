import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, MailThread, MailMessage, Draft, AppSettings, MailActionExecutionResult, MailActionLog } from '../../../shared/types';
import { startReply as buildReplySeed, startForward as buildForwardSeed, validateDraft } from '../../../shared/compose';
import { buildInitialDraftBodyWithSignature, compileDraftBodyHtml, htmlFragmentToPlainText, plainTextToHtmlFragment } from '../../../shared/draftHtml';
import { emitToast } from '../lib/toastBus';
import { cancelPendingMailAction } from '../lib/cancelPendingMailAction';
import { presentMailActionFeedback } from '../lib/presentMailAction';
import { replyDraftPlaceholderValidationMessage } from '../../../shared/replyPipeline';
import { filesToAttachments } from '../lib/composeHtmlHelpers';
import { createRfcMessageId } from '../../../shared/rfcMessageId';
import {
  DRAFT_AUTOSAVE_DEBOUNCE_MS,
  DRAFT_DISCARD_UNDO_MS,
  draftSaveStatusLabel,
  findReusableThreadDraft,
  shouldPersistDraftWrite,
  undoSendScheduledAt,
  undoSendWorkerScheduledAt,
  visibleDrafts,
  type DraftPersistReason,
  type DraftSaveStatus,
} from '../../../shared/draftLifecycle';

interface UseDraftsStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  openThread: (thread: MailThread | null) => Promise<void>;
  executeMailAction: (kind: any, threadId?: string | null, draftId?: string | null, customAction?: any, payloadJson?: string | null) => Promise<MailActionExecutionResult>;
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
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle');
  const [discardedDraftIds, setDiscardedDraftIds] = useState<string[]>([]);

  const pendingSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingDraftRef = useRef<Draft | null>(null);
  const pendingSendActionRef = useRef<MailActionLog | null>(null);
  const activeDraftRef = useRef<Draft | null>(activeDraft);
  activeDraftRef.current = activeDraft;
  const pendingWriteRef = useRef<Draft | null>(null);
  const writeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const writeInFlightRef = useRef<Promise<void> | null>(null);
  const discardTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const keepDraftsAcrossLaunches = settings.general.keepDraftsAcrossLaunches;
  const autoSaveDrafts = settings.compose.autoSaveDrafts;

  const persistDraftNow = async (draft: Draft, reason: DraftPersistReason): Promise<boolean> => {
    if (!shouldPersistDraftWrite({ keepDraftsAcrossLaunches, autoSaveDrafts, reason })) {
      return false;
    }
    setDraftSaveStatus('saving');
    try {
      await window.electronAPI.saveDraft(draft);
      if (pendingWriteRef.current && pendingWriteRef.current.id === draft.id
        && pendingWriteRef.current.updatedAt !== draft.updatedAt) {
        return true;
      }
      setDraftSaveStatus('saved');
      return true;
    } catch (error) {
      console.error(`saveDraft (${reason}) failed`, error);
      setDraftSaveStatus('error');
      emitToast({ type: 'error', message: 'Draft could not be saved.' });
      return false;
    }
  };

  const flushDraftPersistence = async (): Promise<void> => {
    if (writeTimerRef.current) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
    }
    if (writeInFlightRef.current) await writeInFlightRef.current;
    const draft = pendingWriteRef.current || activeDraftRef.current;
    if (!draft) return;
    const reason: DraftPersistReason = pendingWriteRef.current ? 'autosave' : 'explicit';
    const persistReason = shouldPersistDraftWrite({ keepDraftsAcrossLaunches, autoSaveDrafts, reason })
      ? reason
      : 'explicit';
    if (!shouldPersistDraftWrite({ keepDraftsAcrossLaunches, autoSaveDrafts, reason: persistReason })) {
      return;
    }
    pendingWriteRef.current = null;
    const write = persistDraftNow(draft, persistReason).then(() => undefined);
    writeInFlightRef.current = write;
    await write;
    writeInFlightRef.current = null;
    if (pendingWriteRef.current) await flushDraftPersistence();
  };

  const queueDraftWrite = (draft: Draft, reason: DraftPersistReason) => {
    if (!shouldPersistDraftWrite({ keepDraftsAcrossLaunches, autoSaveDrafts, reason })) {
      if (reason === 'autosave') setDraftSaveStatus('unsaved');
      return;
    }
    pendingWriteRef.current = draft;
    if (reason === 'autosave') {
      setDraftSaveStatus('unsaved');
      if (writeTimerRef.current) clearTimeout(writeTimerRef.current);
      writeTimerRef.current = setTimeout(() => {
        writeTimerRef.current = null;
        void flushDraftPersistence();
      }, DRAFT_AUTOSAVE_DEBOUNCE_MS);
      return;
    }
    void flushDraftPersistence();
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
    const unsubscribe = window.electronAPI.onFlushDrafts(() => {
      void flushDraftPersistence().finally(() => {
        window.electronAPI.notifyDraftsFlushed();
      });
    });
    return unsubscribe;
  }, [autoSaveDrafts, keepDraftsAcrossLaunches]);

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
    setDraftSaveStatus('unsaved');
    setComposeLayout('floating');
    queueDraftWrite(draft, 'create');
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

    await persistDraftNow(draft, 'explicit');
    setActiveDraft(draft);
    setComposeLayout('inline');
    loadDrafts();
  };

  const startReply = (message: MailMessage, replyAll = false) => {
    if (!activeAccount) return;
    const reusable = (
      activeDraftRef.current
      && activeDraftRef.current.accountId === message.accountId
      && activeDraftRef.current.threadId === message.threadId
      && !activeDraftRef.current.sendAt
      && !discardedDraftIds.includes(activeDraftRef.current.id)
    ) ? activeDraftRef.current : findReusableThreadDraft(
      visibleDrafts(draftsList, new Set(discardedDraftIds)),
      message.accountId,
      message.threadId,
    );
    if (reusable) {
      setActiveDraft(reusable);
      setDraftSaveStatus('saved');
      setComposeLayout('inline');
      return;
    }
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
    queueDraftWrite(draft, 'create');
    setActiveDraft(draft);
    setComposeLayout('inline');
    loadDrafts();
  };

  const startReplyWithBody = (message: MailMessage, bodyPlain: string, replyAll = false): Draft | null => {
    if (!activeAccount) return null;
    const reusable = findReusableThreadDraft(
      visibleDrafts(
        [activeDraftRef.current, ...draftsList].filter((item): item is Draft => Boolean(item)),
        new Set(discardedDraftIds),
      ),
      message.accountId,
      message.threadId,
    );
    const selfEmail = activeAccount.id === 'unified'
      ? (accounts.find(a => a.email === message.accountId)?.email || message.accountId)
      : activeAccount.email;
    const seed = buildReplySeed(message, selfEmail, replyAll || settings.compose.alwaysReplyAll);
    const responsePlain = bodyPlain.trim();
    const combinedBodyPlain = responsePlain ? `${responsePlain}${seed.body}` : seed.body;
    const combinedBodyHtml = `${responsePlain ? plainTextToHtmlFragment(responsePlain) : ''}${seed.bodyHtml || ''}`;
    const initialBody = buildInitialDraftBodyWithSignature(combinedBodyPlain, settings.compose, settings.profile, message.accountId, combinedBodyHtml);
    const draft: Draft = {
      id: reusable?.id || crypto.randomUUID(),
      accountId: message.accountId,
      threadId: message.threadId,
      to: seed.to,
      cc: seed.cc,
      bcc: [],
      subject: seed.subject,
      bodyPlain: initialBody.bodyPlain,
      bodyHtml: initialBody.bodyHtml,
      attachments: reusable?.attachments || [],
      replyMessageId: seed.replyMessageId || null,
      replyReferences: seed.replyReferences || null,
      rfcMessageId: reusable?.rfcMessageId || null,
      updatedAt: new Date().toISOString()
    };
    queueDraftWrite(draft, 'explicit');
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
    queueDraftWrite(draft, 'create');
    setActiveDraft(draft);
    setComposeLayout('floating');
    loadDrafts();
  };

  const updateDraft = (patch: Partial<Draft>) => {
    if (!activeDraft) return;
    const updated: Draft = { ...activeDraft, ...patch, updatedAt: new Date().toISOString() };
    setActiveDraft(updated);
    queueDraftWrite(updated, 'autosave');
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
    queueDraftWrite(updated, 'autosave');
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
    await persistDraftNow(updatedDraft, 'explicit');
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
      await persistDraftNow(updatedDraft, 'explicit');
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
    await persistDraftNow(updatedDraft, 'explicit');
    setActiveDraft(updatedDraft);
    loadDrafts();
  };

  const restoreDiscardedDraft = (draft: Draft) => {
    const timer = discardTimersRef.current.get(draft.id);
    if (timer) {
      clearTimeout(timer);
      discardTimersRef.current.delete(draft.id);
    }
    setDiscardedDraftIds(current => current.filter(id => id !== draft.id));
    setActiveDraft(draft);
    setComposeLayout(draft.threadId ? 'inline' : 'floating');
  };

  const discardDraft = async (draftId: string) => {
    const draft = (activeDraft?.id === draftId ? activeDraft : draftsList.find(item => item.id === draftId)) || null;
    if (writeTimerRef.current && pendingWriteRef.current?.id === draftId) {
      clearTimeout(writeTimerRef.current);
      writeTimerRef.current = null;
      pendingWriteRef.current = null;
    }
    if (activeDraft?.id === draftId) {
      setActiveDraft(null);
      setDraftSaveStatus('idle');
    }
    setDiscardedDraftIds(current => current.includes(draftId) ? current : [...current, draftId]);
    const existingTimer = discardTimersRef.current.get(draftId);
    if (existingTimer) clearTimeout(existingTimer);
    discardTimersRef.current.set(draftId, setTimeout(() => {
      discardTimersRef.current.delete(draftId);
      void window.electronAPI.deleteDraft(draftId).catch(error => {
        console.error('Failed to delete draft:', error);
      });
      setDiscardedDraftIds(current => current.filter(id => id !== draftId));
      loadDrafts();
    }, DRAFT_DISCARD_UNDO_MS));
    emitToast({
      type: 'success',
      message: 'Draft discarded.',
      actionLabel: 'Undo',
      duration: DRAFT_DISCARD_UNDO_MS,
      onAction: draft ? () => restoreDiscardedDraft(draft) : undefined,
    });
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

    const rfcMessageId = activeDraft.rfcMessageId || createRfcMessageId();
    const scheduledDraft: Draft = {
      ...activeDraft,
      rfcMessageId,
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
      payloadJson: JSON.stringify({ sendAt, rfcMessageId }),
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

    await flushDraftPersistence();
    const rfcMessageId = draftToSend.rfcMessageId || createRfcMessageId();
    pendingDraftRef.current = { ...draftToSend, rfcMessageId };

    const sendPreparedDraft = async (draft: Draft, actionId: string) => {
      const draftForSend = {
        ...draft,
        rfcMessageId,
        sendAt: null,
        bodyHtml: compileDraftBodyHtml(draft.bodyPlain, settings.compose, draft.accountId, draft.bodyHtml),
      };
      await window.electronAPI.saveDraft(draftForSend);
      const res = await window.electronAPI.sendDraft(draft.accountId, draftForSend, actionId);
      if (res && !res.offline) {
        await window.electronAPI.deleteDraft(draft.id);
      }
      return res;
    };

    const performSend = async () => {
      if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
      pendingSendTimerRef.current = null;
      setPendingSend(false);
      setPendingSendSeconds(0);
      const draft = pendingDraftRef.current;
      const parked = pendingSendActionRef.current;
      pendingDraftRef.current = null;
      pendingSendActionRef.current = null;
      if (!draft) return;
      try {
        if (parked) {
          const latest = (await window.electronAPI.listActionLog(parked.accountId)).find(log => log.id === parked.id);
          if (!latest || (latest.status !== 'pending_sync' && latest.status !== 'queued')) {
            return;
          }
          const res = await sendPreparedDraft(draft, parked.id);
          if (!res?.offline) {
            await window.electronAPI.saveActionLog({
              ...parked,
              status: 'completed',
              completedAt: new Date().toISOString(),
              payloadJson: parked.payloadJson,
            });
          }
          const result = presentMailActionFeedback({
            result: { accepted: true, offline: Boolean(res?.offline), actionId: parked.id },
            kind: 'send',
          });
          loadDrafts();
          if (result.offline) return;
          if (draft.threadId === openedThread?.id) openThread(null);
          return;
        }
        const result = await executeMailAction('send', draft.threadId || openedThread?.id, draft.id, async (sendActionId: string) => {
          return sendPreparedDraft(draft, sendActionId);
        }, JSON.stringify({ accountId: draft.accountId, rfcMessageId }));
        loadDrafts();
        if (!result.accepted) {
          setActiveDraft(draft);
          return;
        }
        if (result.offline) return;
        if (draft.threadId === openedThread?.id) openThread(null);
      } catch (e) {
        console.error('Failed to send draft:', e);
        setActiveDraft(draft);
        emitToast({ type: 'error', message: 'Failed to send message.' });
      }
    };

    const delaySec = Math.max(0, Math.round(settings.compose.sendUndoDelay ?? 10));
    setActiveDraft(null);
    setDraftSaveStatus('idle');

    if (delaySec === 0) {
      await performSend();
      return;
    }

    const scheduledAt = undoSendScheduledAt(delaySec);
    const workerScheduledAt = undoSendWorkerScheduledAt(delaySec);
    const actionId = crypto.randomUUID();
    const scheduledDraft: Draft = {
      ...draftToSend,
      rfcMessageId,
      sendAt: scheduledAt,
      updatedAt: new Date().toISOString(),
    };
    const log: MailActionLog = {
      id: actionId,
      accountId: scheduledDraft.accountId,
      threadId: scheduledDraft.threadId || openedThread?.id || null,
      draftId: scheduledDraft.id,
      kind: 'send',
      status: 'pending_sync',
      createdAt: new Date().toISOString(),
      scheduledAt: workerScheduledAt,
      payloadJson: JSON.stringify({ sendAt: scheduledAt, rfcMessageId, undoSend: true }),
    };
    pendingSendActionRef.current = log;
    pendingDraftRef.current = scheduledDraft;
    await persistDraftNow(scheduledDraft, 'send');
    await window.electronAPI.saveActionLog(log);
    loadDrafts();

    setPendingSend(true);
    setPendingSendSeconds(delaySec);
    pendingSendIntervalRef.current = setInterval(() => {
      setPendingSendSeconds(s => (s > 1 ? s - 1 : 0));
    }, 1000);
    pendingSendTimerRef.current = setTimeout(() => {
      void performSend();
    }, delaySec * 1000);
  };

  const cancelPendingSend = async () => {
    const parked = pendingSendActionRef.current;
    const draft = pendingDraftRef.current;
    if (parked) {
      const cancelled = await cancelPendingMailAction(parked);
      if (!cancelled) {
        emitToast({ type: 'error', message: 'Could not cancel send. The message may still go out.' });
        return;
      }
    }
    if (pendingSendTimerRef.current) { clearTimeout(pendingSendTimerRef.current); pendingSendTimerRef.current = null; }
    if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
    setPendingSend(false);
    setPendingSendSeconds(0);
    pendingSendActionRef.current = null;
    pendingDraftRef.current = null;
    if (draft) {
      const restored = { ...draft, sendAt: null, updatedAt: new Date().toISOString() };
      void persistDraftNow(restored, 'send');
      setActiveDraft(restored);
    }
  };

  return {
    activeDraft,
    setActiveDraft,
    composeLayout,
    setComposeLayout,
    draftsList: visibleDrafts(draftsList, new Set(discardedDraftIds)),
    draftSaveStatus,
    draftSaveStatusLabel: draftSaveStatusLabel(draftSaveStatus),
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
