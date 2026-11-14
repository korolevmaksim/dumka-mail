import { useState, useEffect, useCallback, useRef } from 'react';
import { Account, MailThread, MailMessage, Draft, AppSettings, MailActionExecutionResult, MailActionLog } from '../../../shared/types';
import { formatDateTime } from '../../../shared/dateFormat';
import { startReply as buildReplySeed, startForward as buildForwardSeed, replySubject, validateDraft } from '../../../shared/compose';
import { buildInitialDraftBodyWithSignature, buildWrittenReplyDraftBody, compileDraftBodyHtml, htmlFragmentToPlainText } from '../../../shared/draftHtml';
import { emitToast } from '../lib/toastBus';
import { cancelPendingMailAction } from '../lib/cancelPendingMailAction';
import { presentMailActionFeedback } from '../lib/presentMailAction';
import { replyDraftPlaceholderValidationMessage } from '../../../shared/replyPipeline';
import { filesToAttachments } from '../lib/composeHtmlHelpers';
import { createRfcMessageId } from '../../../shared/rfcMessageId';
import { resolveAccountSetting } from '../../../shared/accountSettings';
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
import {
  archiveAfterSendFailedMessage,
  deliverThenRecord,
  deliveryEvent,
  resolveAfterSend,
  restoredDraftPlacement,
  restoredSendMessage,
  shouldArchiveOnSend,
  shouldCloseReaderAfterSend,
  stepPendingSend,
  type PendingSendEvent,
  type PendingSendPhase,
  type PendingSendRestoreCause,
  type SendIntent,
} from '../../../shared/sendFlow';

interface PendingSendArchive {
  thread: MailThread;
  result: Promise<MailActionExecutionResult | null>;
}

interface PendingSendEntry {
  /** The draft as it will be sent (carries its RFC Message-ID). */
  draft: Draft;
  /** The parked undo-send action; null when there is no undo window. */
  action: MailActionLog | null;
  /** Set when this send archived its thread at send time. */
  archive: PendingSendArchive | null;
  fallbackThreadId: string | null;
  /** Resolves once the scheduled draft and its parked action are written (or the write failed). */
  persisted?: Promise<void>;
  /** Where this send is in its lifecycle; changed only through `advancePendingSend`. */
  phase: PendingSendPhase;
  /** Called once, only when the send was accepted (sent, or parked offline for sync). */
  onSent?: () => void;
  /** The failure was already reported (by executeMailAction). */
  failureAnnounced?: boolean;
}

export interface SendDraftOptions {
  intent?: SendIntent;
  /** Positive evidence that the message went out (never fired for a cancelled or failed send). */
  onSent?: () => void;
}

interface UseDraftsStateProps {
  settings: AppSettings;
  accounts: Account[];
  activeAccount: Account | null;
  openedThread: MailThread | null;
  threads: MailThread[];
  openThread: (thread: MailThread | null) => Promise<void>;
  executeMailAction: (kind: MailActionLog['kind'], threadId?: string | null, draftId?: string | null, customAction?: any, payloadJson?: string | null) => Promise<MailActionExecutionResult>;
}

export function useDraftsState({
  settings,
  accounts,
  activeAccount,
  openedThread,
  threads,
  openThread,
  executeMailAction,
}: UseDraftsStateProps) {
  const [activeDraft, setActiveDraft] = useState<Draft | null>(null);
  const [composeLayout, setComposeLayout] = useState<'inline' | 'floating'>('floating');
  const [draftsList, setDraftsList] = useState<Draft[]>([]);
  const [pendingSend, setPendingSend] = useState<boolean>(false);
  const [pendingSendSeconds, setPendingSendSeconds] = useState<number>(0);
  const [draftSaveStatus, setDraftSaveStatus] = useState<DraftSaveStatus>('idle');
  const [draftBodySeed, setDraftBodySeed] = useState(0);
  const [discardedDraftIds, setDiscardedDraftIds] = useState<string[]>([]);

  const pendingSendTimerRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const pendingSendRef = useRef<PendingSendEntry | null>(null);
  const activeDraftRef = useRef<Draft | null>(activeDraft);
  const openedThreadRef = useRef<MailThread | null>(openedThread);
  openedThreadRef.current = openedThread;
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
    if (writeInFlightRef.current === write) writeInFlightRef.current = null;
    void loadDrafts();
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

  const replaceActiveDraft = (incoming: Draft | null) => {
    const current = activeDraftRef.current;
    const draft = incoming && current && current.id === incoming.id && current.updatedAt > incoming.updatedAt
      ? current
      : incoming;
    const pending = pendingWriteRef.current;
    if (pending && pending.id !== draft?.id) {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      pendingWriteRef.current = null;
      const persistReason: DraftPersistReason = shouldPersistDraftWrite({
        keepDraftsAcrossLaunches,
        autoSaveDrafts,
        reason: 'autosave',
      }) ? 'autosave' : 'explicit';
      const write = persistDraftNow(pending, persistReason).then(() => undefined);
      writeInFlightRef.current = write;
      void write.finally(() => {
        if (writeInFlightRef.current === write) writeInFlightRef.current = null;
        void loadDrafts();
      });
    }
    activeDraftRef.current = draft;
    if (draft && pendingWriteRef.current?.id === draft.id) {
      pendingWriteRef.current = draft;
    }
    setActiveDraft(draft);
  };

  const getActiveDraft = useCallback(() => activeDraftRef.current, []);

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

    replaceActiveDraft(draft);
    setDraftSaveStatus('unsaved');
    setComposeLayout('floating');
    queueDraftWrite(draft, 'create');
    return draft;
  };

  const saveDraftLocally = async (body: string, toStr: string, subject: string, targetThread?: MailThread | null) => {
    if (!activeAccount) return;

    const thread = targetThread === undefined ? openedThreadRef.current : targetThread;
    const toRecipients = toStr ? toStr.split(',').map(e => ({ name: '', email: e.trim() })) : [];
    const targetAccountId = thread ? thread.accountId : (activeAccount.id === 'unified' ? accounts[0]?.email : activeAccount.email);
    if (!targetAccountId) return;
    const initialBody = buildInitialDraftBodyWithSignature(body, settings.compose, settings.profile, targetAccountId);

    const active = activeDraftRef.current;
    const current = thread
      ? ((active
          && active.accountId === targetAccountId
          && active.threadId === thread.id
          && !active.sendAt
          && !discardedDraftIds.includes(active.id))
        ? active
        : findReusableThreadDraft(
            visibleDrafts(draftsList, new Set(discardedDraftIds)),
            targetAccountId,
            thread.id,
          ))
      : null;
    const reuseCurrent = Boolean(current);
    const keepCurrentBody = Boolean(reuseCurrent && current && !body.trim());
    const draft: Draft = {
      id: reuseCurrent && current ? current.id : crypto.randomUUID(),
      accountId: targetAccountId,
      threadId: thread?.id || null,
      to: reuseCurrent && current ? current.to : toRecipients,
      cc: reuseCurrent && current ? current.cc : [],
      bcc: reuseCurrent && current ? current.bcc : [],
      subject: reuseCurrent && current
        ? current.subject
        : (subject || (thread ? replySubject(thread.subject) : '')),
      bodyPlain: keepCurrentBody && current ? current.bodyPlain : initialBody.bodyPlain,
      bodyHtml: keepCurrentBody && current ? (current.bodyHtml ?? null) : initialBody.bodyHtml,
      attachments: reuseCurrent && current ? current.attachments : [],
      replyMessageId: reuseCurrent && current ? current.replyMessageId : null,
      replyReferences: reuseCurrent && current ? current.replyReferences : null,
      rfcMessageId: reuseCurrent && current ? current.rfcMessageId : null,
      updatedAt: new Date().toISOString()
    };

    await persistDraftNow(draft, 'explicit');
    replaceActiveDraft(draft);
    if (!keepCurrentBody) setDraftBodySeed(seed => seed + 1);
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
      replaceActiveDraft(reusable);
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
    replaceActiveDraft(draft);
    queueDraftWrite(draft, 'create');
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
    // Reply text first, then the signature, then the quote (never the signature above the reply).
    const initialBody = buildWrittenReplyDraftBody(bodyPlain, seed.body, seed.bodyHtml, settings.compose, settings.profile, message.accountId);
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
    replaceActiveDraft(draft);
    setDraftBodySeed(seed => seed + 1);
    queueDraftWrite(draft, 'explicit');
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
    replaceActiveDraft(draft);
    queueDraftWrite(draft, 'create');
    setComposeLayout('floating');
    loadDrafts();
  };

  const updateDraft = (patch: Partial<Draft>) => {
    const current = activeDraftRef.current;
    if (!current) return;
    const updated: Draft = { ...current, ...patch, updatedAt: new Date().toISOString() };
    activeDraftRef.current = updated;
    pendingWriteRef.current = updated;
    queueDraftWrite(updated, 'autosave');
    const needsComposerRender = 'to' in patch
      || 'cc' in patch
      || 'bcc' in patch
      || 'attachments' in patch
      || 'accountId' in patch
      || 'threadId' in patch
      || 'sendAt' in patch;
    if (needsComposerRender) {
      setActiveDraft(updated);
      return;
    }
    setDraftSaveStatus(status => (status === 'saving' ? status : 'unsaved'));
  };

  const updateDraftBody = (body: string, bodyHtml?: string | null) => {
    const current = activeDraftRef.current;
    if (!current) return;
    const updated: Draft = {
      ...current,
      bodyPlain: body,
      bodyHtml: bodyHtml === undefined ? current.bodyHtml || null : bodyHtml,
      updatedAt: new Date().toISOString()
    };
    activeDraftRef.current = updated;
    pendingWriteRef.current = updated;
    queueDraftWrite(updated, 'autosave');
    setDraftSaveStatus(status => (status === 'saving' ? status : 'unsaved'));
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
    if (pendingWriteRef.current?.id === updatedDraft.id) pendingWriteRef.current = updatedDraft;
    replaceActiveDraft(updatedDraft);
    await persistDraftNow(updatedDraft, 'explicit');
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
      if (pendingWriteRef.current?.id === updatedDraft.id) pendingWriteRef.current = updatedDraft;
      replaceActiveDraft(updatedDraft);
      await persistDraftNow(updatedDraft, 'explicit');
      loadDrafts();
    } catch (error: unknown) {
      emitToast({
        type: 'error',
        message: error instanceof Error ? error.message : 'Failed to attach dropped files.',
      });
    }
  };

  const removeAttachmentFromDraft = async (attId: string) => {
    const current = activeDraftRef.current;
    if (!current) return;
    const updatedDraft: Draft = {
      ...current,
      attachments: (current.attachments || []).filter(a => a.id !== attId),
      updatedAt: new Date().toISOString()
    };
    if (pendingWriteRef.current?.id === updatedDraft.id) pendingWriteRef.current = updatedDraft;
    replaceActiveDraft(updatedDraft);
    await persistDraftNow(updatedDraft, 'explicit');
    loadDrafts();
  };

  const restoreDiscardedDraft = (draft: Draft) => {
    const timer = discardTimersRef.current.get(draft.id);
    if (timer) {
      clearTimeout(timer);
      discardTimersRef.current.delete(draft.id);
    }
    setDiscardedDraftIds(current => current.filter(id => id !== draft.id));
    replaceActiveDraft(draft);
    setComposeLayout(draft.threadId ? 'inline' : 'floating');
  };

  const discardDraft = async (draftId: string) => {
    const draft = (activeDraftRef.current?.id === draftId
      ? activeDraftRef.current
      : draftsList.find(item => item.id === draftId)) || null;
    if (pendingWriteRef.current?.id === draftId) {
      if (writeTimerRef.current) {
        clearTimeout(writeTimerRef.current);
        writeTimerRef.current = null;
      }
      pendingWriteRef.current = null;
    }
    if (activeDraftRef.current?.id === draftId) {
      replaceActiveDraft(null);
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

  const executeMailActionRef = useRef(executeMailAction);
  executeMailActionRef.current = executeMailAction;
  const threadsRef = useRef<MailThread[]>(threads);
  threadsRef.current = threads;
  const openThreadRef = useRef(openThread);
  openThreadRef.current = openThread;

  const clearPendingSendTimers = () => {
    if (pendingSendTimerRef.current) { clearTimeout(pendingSendTimerRef.current); pendingSendTimerRef.current = null; }
    if (pendingSendIntervalRef.current) { clearInterval(pendingSendIntervalRef.current); pendingSendIntervalRef.current = null; }
  };

  /** Detach the entry from the undo window (if it is still the pending one). */
  const releasePendingSend = (entry: PendingSendEntry): boolean => {
    if (pendingSendRef.current !== entry) return false;
    clearPendingSendTimers();
    pendingSendRef.current = null;
    setPendingSend(false);
    setPendingSendSeconds(0);
    return true;
  };

  /**
   * The only place an entry changes phase: the first event that decides
   * (timer, early commit, Undo, a failed write or delivery) wins, and the
   * effect it calls for runs exactly once.
   */
  const advancePendingSend = (entry: PendingSendEntry, event: PendingSendEvent): PendingSendPhase => {
    const step = stepPendingSend(entry.phase, event);
    if (step.phase === entry.phase && step.effect === 'none') return entry.phase;
    entry.phase = step.phase;
    // Once anything has decided, the undo window is over.
    if (step.phase !== 'waiting') releasePendingSend(entry);
    if (step.effect === 'deliver') {
      void deliverPendingSend(entry);
    } else if (step.effect === 'restore') {
      void restorePendingSend(entry, step.restoreCause ?? 'failed');
    } else if (step.effect === 'notifySent') {
      try {
        entry.onSent?.();
      } catch (error) {
        console.error('onSent callback failed:', error);
      }
    }
    return entry.phase;
  };

  // A new send (or schedule) while an undo window is open commits the pending
  // message right away: it loses its remaining undo time but is never dropped.
  const commitPendingSendNow = () => {
    const entry = pendingSendRef.current;
    if (!entry) return;
    advancePendingSend(entry, 'commitNow');
  };

  const findThread = (accountId: string, threadId: string): MailThread | null => {
    const opened = openedThreadRef.current;
    if (opened && opened.id === threadId && opened.accountId === accountId) return opened;
    return threadsRef.current.find(thread => thread.id === threadId && thread.accountId === accountId) || null;
  };

  const archiveThreadForSend = (thread: MailThread): PendingSendArchive => {
    // Same optimistic path as `E`: local label change, offline parking,
    // rollback on failure, and next-thread navigation. Silent on success (the
    // send banner is the feedback), but a failure is never silent.
    const result = executeMailActionRef.current(
      'markDone',
      thread.id,
      null,
      undefined,
      JSON.stringify({ accountId: thread.accountId, silent: true }),
    ).catch((error: unknown) => {
      console.error('Archive after send failed:', error);
      return null;
    });
    void result.then(outcome => {
      if (outcome?.accepted) return;
      emitToast({
        type: 'warning',
        message: archiveAfterSendFailedMessage(),
        actionLabel: 'Retry',
        duration: 8000,
        onAction: () => {
          void executeMailActionRef.current(
            'markDone',
            thread.id,
            null,
            undefined,
            JSON.stringify({ accountId: thread.accountId }),
          );
        },
      });
    });
    return { thread, result };
  };

  const undoArchiveForSend = async (archive: PendingSendArchive): Promise<void> => {
    const result = await archive.result;
    if (!result?.accepted) return;
    if (result.offline && result.actionId) {
      await cancelPendingMailAction({ id: result.actionId, accountId: archive.thread.accountId });
    }
    await executeMailActionRef.current(
      'restoreInbox',
      archive.thread.id,
      null,
      undefined,
      JSON.stringify({ accountId: archive.thread.accountId, silent: true }),
    );
  };

  const closeReaderIfStillOpen = (draft: Draft, archived: boolean) => {
    const opened = openedThreadRef.current;
    if (shouldCloseReaderAfterSend({
      sent: { accountId: draft.accountId, threadId: draft.threadId },
      opened: opened ? { accountId: opened.accountId, id: opened.id } : null,
      archived,
    })) {
      void openThreadRef.current(null);
    }
  };

  /**
   * Saves and sends the draft. Throws only when the message was not handed
   * over; removing the local draft afterwards is bookkeeping and only logged.
   */
  const sendPreparedDraft = async (draft: Draft, actionId: string) => {
    const draftForSend = {
      ...draft,
      sendAt: null,
      bodyHtml: compileDraftBodyHtml(draft.bodyPlain, settings.compose, draft.accountId, draft.bodyHtml),
    };
    await window.electronAPI.saveDraft(draftForSend);
    const outcome = await deliverThenRecord(
      () => window.electronAPI.sendDraft(draft.accountId, draftForSend, actionId),
      async (res) => {
        if (res && !res.offline) await window.electronAPI.deleteDraft(draft.id);
      },
    );
    if (!outcome.delivered) throw outcome.error;
    if (outcome.bookkeepingError) console.error('Message sent, but its local draft could not be removed:', outcome.bookkeepingError);
    return outcome.result;
  };

  /** Starts delivery; reports the outcome back through `advancePendingSend`. */
  const deliverPendingSend = async (entry: PendingSendEntry): Promise<void> => {
    // A send committed early (by a newer send) may still be writing its parked action.
    if (entry.persisted) await entry.persisted;
    // The write failed meanwhile: the entry was already restored.
    if (entry.phase !== 'sending') return;
    const { draft, action: parked, archive } = entry;
    // True from the moment the send call resolved: after that, no error may
    // count as a failed send (the draft would come back and could go out twice).
    let delivered = false;
    try {
      if (parked) {
        const latest = (await window.electronAPI.listActionLog(parked.accountId)).find(log => log.id === parked.id);
        if (!latest || (latest.status !== 'pending_sync' && latest.status !== 'queued')) {
          // Handled elsewhere (the background worker sends overdue undo-sends).
          if (latest?.status === 'completed') {
            advancePendingSend(entry, 'sendSucceeded');
          } else if (latest?.status === 'failed') {
            advancePendingSend(entry, 'sendFailed');
          } else {
            console.warn('Undo-send action is no longer in the log; not restoring the draft.', parked.id);
            advancePendingSend(entry, 'sendUnconfirmed');
          }
          loadDrafts();
          return;
        }
        const outcome = await deliverThenRecord(
          () => sendPreparedDraft(draft, parked.id),
          async (res) => {
            if (res?.offline) return;
            await window.electronAPI.saveActionLog({
              ...parked,
              status: 'completed',
              completedAt: new Date().toISOString(),
              payloadJson: parked.payloadJson,
            });
          },
        );
        if (!outcome.delivered) {
          console.error('Failed to send draft:', outcome.error);
          advancePendingSend(entry, 'sendFailed');
          return;
        }
        delivered = true;
        if (outcome.bookkeepingError) console.error('Message sent, but the action log could not be updated:', outcome.bookkeepingError);
        const offline = Boolean(outcome.result?.offline);
        advancePendingSend(entry, 'sendSucceeded');
        presentMailActionFeedback({
          result: { accepted: true, offline, actionId: parked.id },
          kind: 'send',
        });
        loadDrafts();
        if (offline) return;
        closeReaderIfStillOpen(draft, Boolean(archive));
        return;
      }
      const result = await executeMailActionRef.current('send', draft.threadId || entry.fallbackThreadId, draft.id, async (sendActionId: string) => {
        const res = await sendPreparedDraft(draft, sendActionId);
        delivered = true;
        return res;
      }, JSON.stringify({ accountId: draft.accountId, rfcMessageId: draft.rfcMessageId }));
      loadDrafts();
      const event = deliveryEvent({ delivered, accepted: result.accepted });
      if (event === 'sendFailed') {
        // executeMailAction already reported the failure.
        entry.failureAnnounced = true;
        advancePendingSend(entry, 'sendFailed');
        return;
      }
      if (!result.accepted) console.error('Message sent, but recording the send failed:', result.errorMessage);
      advancePendingSend(entry, 'sendSucceeded');
      if (result.offline) return;
      closeReaderIfStillOpen(draft, Boolean(archive));
    } catch (e) {
      const event = deliveryEvent({ delivered });
      if (event === 'sendSucceeded') {
        console.error('Message sent; a later step failed:', e);
      } else {
        console.error('Failed to send draft:', e);
      }
      advancePendingSend(entry, event);
    }
  };

  /**
   * Gives a draft back after Undo, a failed write or a failed delivery. The
   * editor only when it is free; a draft started since is never replaced, and
   * the returned one is saved to Drafts instead (with a toast saying so).
   * Placement is decided after every await, from the current editor state.
   */
  const restorePendingSend = async (entry: PendingSendEntry, cause: PendingSendRestoreCause): Promise<void> => {
    const restored: Draft = { ...entry.draft, sendAt: null, updatedAt: new Date().toISOString() };
    const placementNow = () => restoredDraftPlacement({ activeDraftId: activeDraftRef.current?.id, draftId: restored.id });

    if (entry.archive) {
      try {
        await undoArchiveForSend(entry.archive);
      } catch (error) {
        console.error('Could not move the thread back to the inbox:', error);
        emitToast({ type: 'error', message: 'The conversation could not be moved back to the inbox.' });
      }
    }

    // Undo of a send-and-archive goes back to its thread, but only if the
    // editor is still free (re-checked after the await below).
    let reopened = false;
    if (cause === 'cancelled' && entry.archive && placementNow() === 'editor') {
      const thread = entry.archive.thread;
      const inboxLabels = thread.labelIds.some(label => label.toUpperCase() === 'INBOX')
        ? thread.labelIds
        : [...thread.labelIds, 'INBOX'];
      await openThreadRef.current({ ...thread, labelIds: inboxLabels });
      reopened = true;
    }

    let placement = placementNow();
    if (placement === 'drafts') {
      const saved = await persistDraftNow(restored, 'send');
      loadDrafts();
      if (!saved) {
        // Never lose the text: if Drafts could not take it, the editor does
        // (replacing the active draft saves that one first). Re-read after the await.
        placement = placementNow() === 'alreadyOpen' ? 'alreadyOpen' : 'editor';
      }
    }

    // No await between reading the editor state and writing it from here on.
    const current = activeDraftRef.current;
    if (placement === 'alreadyOpen') {
      if (current && current.id === restored.id) {
        // The user reopened this very draft: keep their latest text, drop the send time.
        const cleared = { ...current, sendAt: null };
        replaceActiveDraft(cleared);
        void persistDraftNow(cleared, 'send');
      }
    } else if (placement === 'editor') {
      void persistDraftNow(restored, 'send');
      replaceActiveDraft(restored);
      // Show it where it can be seen: inline under its own thread, otherwise
      // in the floating composer (the reader may have moved on since).
      const opened = openedThreadRef.current;
      const ownThreadOpen = Boolean(restored.threadId && opened
        && opened.id === restored.threadId && opened.accountId === restored.accountId);
      setComposeLayout(reopened || ownThreadOpen ? 'inline' : 'floating');
    }

    const message = restoredSendMessage(cause, placement);
    // A failure executeMailAction already reported only needs the "where" when it is not in the editor.
    if (message && !(entry.failureAnnounced && placement !== 'drafts')) {
      emitToast({ type: cause === 'cancelled' ? 'info' : 'error', message, duration: 8000 });
    }
  };

  const scheduleDraftSend = async (date: Date) => {
    const currentDraft = activeDraftRef.current;
    if (!currentDraft || !activeAccount) return;

    const sendAt = date.toISOString();
    if (!Number.isFinite(date.getTime()) || date.getTime() <= Date.now()) {
      emitToast({ type: 'warning', message: 'Choose a future send time.' });
      return;
    }

    const validationError = validateDraftForSend(currentDraft);
    if (validationError) {
      emitToast({ type: 'warning', message: validationError });
      return;
    }

    commitPendingSendNow();

    const rfcMessageId = currentDraft.rfcMessageId || createRfcMessageId();
    const scheduledDraft: Draft = {
      ...currentDraft,
      rfcMessageId,
      sendAt,
      bodyHtml: compileDraftBodyHtml(currentDraft.bodyPlain, settings.compose, currentDraft.accountId, currentDraft.bodyHtml),
      updatedAt: new Date().toISOString(),
    };
    const log: MailActionLog = {
      id: crypto.randomUUID(),
      accountId: scheduledDraft.accountId,
      threadId: scheduledDraft.threadId || openedThreadRef.current?.id || null,
      draftId: scheduledDraft.id,
      kind: 'send',
      status: 'pending_sync',
      createdAt: new Date().toISOString(),
      scheduledAt: sendAt,
      payloadJson: JSON.stringify({ sendAt, rfcMessageId }),
    };

    await window.electronAPI.saveDraft(scheduledDraft);
    await window.electronAPI.saveActionLog(log);
    replaceActiveDraft(null);
    loadDrafts();
    emitToast({ type: 'success', message: `Message scheduled for ${formatDateTime(date)}.` });
  };

  /** Resolves true when the draft entered the send flow (false: validation kept it in the editor). */
  const sendDraftWithUndo = async (options: SendDraftOptions = {}): Promise<boolean> => {
    const currentDraft = activeDraftRef.current;
    if (!currentDraft || !activeAccount) return false;

    const draftToSend = currentDraft;
    const validationError = validateDraftForSend(draftToSend);
    if (validationError) {
      emitToast({ type: 'warning', message: validationError });
      return false;
    }

    // Never drop a second send during the undo window: the earlier message
    // goes out now and this one gets its own window.
    commitPendingSendNow();

    await flushDraftPersistence();
    const rfcMessageId = draftToSend.rfcMessageId || createRfcMessageId();
    const fallbackThreadId = openedThreadRef.current?.id || null;
    // Per-account "After sending a reply" (SPEC §8), inheriting compose.afterSend.
    const accountAfterSend = resolveAccountSetting(settings, draftToSend.accountId, 'afterSend').value;
    const afterSend = resolveAfterSend(accountAfterSend, options.intent ?? 'default');
    const replyThread = draftToSend.threadId ? findThread(draftToSend.accountId, draftToSend.threadId) : null;
    const archiveNow = shouldArchiveOnSend({
      afterSend,
      threadId: draftToSend.threadId,
      threadLabelIds: replyThread?.labelIds,
    });

    const delaySec = Math.max(0, Math.round(settings.compose.sendUndoDelay ?? 10));
    replaceActiveDraft(null);
    setDraftSaveStatus('idle');
    const archive = archiveNow && replyThread ? archiveThreadForSend(replyThread) : null;

    if (delaySec === 0) {
      const entry: PendingSendEntry = {
        draft: { ...draftToSend, rfcMessageId },
        action: null,
        archive,
        fallbackThreadId,
        phase: 'sending',
        onSent: options.onSent,
      };
      await deliverPendingSend(entry);
      return true;
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
      threadId: scheduledDraft.threadId || fallbackThreadId,
      draftId: scheduledDraft.id,
      kind: 'send',
      status: 'pending_sync',
      createdAt: new Date().toISOString(),
      scheduledAt: workerScheduledAt,
      payloadJson: JSON.stringify({ sendAt: scheduledAt, rfcMessageId, undoSend: true }),
    };
    let markPersisted: () => void = () => undefined;
    const persisted = new Promise<void>(resolve => { markPersisted = resolve; });
    const entry: PendingSendEntry = {
      draft: scheduledDraft,
      action: log,
      archive,
      fallbackThreadId,
      persisted,
      phase: 'waiting',
      onSent: options.onSent,
    };
    pendingSendRef.current = entry;
    // The thread is already archived and the editor cleared: a failed write
    // must undo both, or the message is neither sent nor anywhere to be found.
    let persistError: unknown = null;
    try {
      const saved = await persistDraftNow(scheduledDraft, 'send');
      if (!saved) throw new Error('The draft could not be saved before sending.');
      await window.electronAPI.saveActionLog(log);
    } catch (error) {
      persistError = error;
    } finally {
      markPersisted();
    }
    loadDrafts();
    if (persistError) {
      console.error('Could not prepare the undo-send:', persistError);
      advancePendingSend(entry, 'persistFailed');
      return true;
    }

    if (pendingSendRef.current !== entry || entry.phase !== 'waiting') {
      // Another send committed this one while it was being persisted.
      return true;
    }
    setPendingSend(true);
    setPendingSendSeconds(delaySec);
    pendingSendIntervalRef.current = setInterval(() => {
      setPendingSendSeconds(s => (s > 1 ? s - 1 : 0));
    }, 1000);
    pendingSendTimerRef.current = setTimeout(() => {
      advancePendingSend(entry, 'timerFired');
    }, delaySec * 1000);
    return true;
  };

  const cancelPendingSend = async () => {
    const entry = pendingSendRef.current;
    if (!entry) return;
    // Undo decides now: from here the timer and early commits are no-ops.
    if (advancePendingSend(entry, 'cancelRequested') !== 'cancelling') return;
    if (entry.persisted) await entry.persisted;
    // The write failed meanwhile: the draft has already been given back.
    if (entry.phase !== 'cancelling') return;
    if (entry.action) {
      const cancelled = await cancelPendingMailAction(entry.action);
      if (!cancelled) {
        emitToast({ type: 'error', message: "Couldn't cancel the send. The message is being sent." });
        advancePendingSend(entry, 'cancelFailed');
        return;
      }
    }
    advancePendingSend(entry, 'cancelSucceeded');
  };

  const closeDraftKeepingIt = async () => {
    const draft = activeDraftRef.current;
    if (!draft) return;
    await flushDraftPersistence();
    const persisted = shouldPersistDraftWrite({ keepDraftsAcrossLaunches, autoSaveDrafts, reason: 'explicit' });
    replaceActiveDraft(null);
    setDraftSaveStatus('idle');
    emitToast({ type: persisted ? 'success' : 'info', message: persisted ? 'Draft saved' : 'Draft closed' });
  };

  return {
    activeDraft,
    setActiveDraft: replaceActiveDraft,
    getActiveDraft,
    composeLayout,
    setComposeLayout,
    draftsList: visibleDrafts(draftsList, new Set(discardedDraftIds)),
    draftSaveStatus,
    draftBodySeed,
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
    cancelPendingSend,
    closeDraftKeepingIt,
  };
}
