// Reply dock (SPEC §3): pinned to the bottom of the reading area, at most 45%
// of its height; the editor scrolls on its own and the footer row stays
// visible. Shows the agent's prepared draft (not focused; `R` edits it,
// `⌘↩` sends it as shown, always through the normal send-with-undo path).
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { AlertTriangle, LoaderCircle, Reply, ReplyAll, Send, Sparkles, X } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useAgentPrep } from '../../stores/useAgentPrep';
import { InlineReplyComposer } from '../layout/InlineReplyComposer';
import { registerReplyDock } from '../../lib/replyDockBridge';
import {
  AGENT_DRAFT_ID_LIMIT,
  createBoundedIdSet,
  resolveReplyDockMode,
  shouldOfferPreparedDraft,
  type ReplyDockMode,
} from '../../lib/replyDockState';
import { armNoReplyReminder } from '../../hooks/useNoReplyReminders';
import { findReusableThreadDraft } from '../../../../shared/draftLifecycle';
import { resolveAccountSetting } from '../../../../shared/accountSettings';
import { resolveAfterSend, sendButtonLabel, type SendIntent } from '../../../../shared/sendFlow';
import { messageCounterparty } from '../../../../shared/threadCounterparty';
import {
  DEFAULT_NO_REPLY_REMINDER_DAYS,
  NO_REPLY_REMINDER_DAY_OPTIONS,
  noReplyDaysLabel,
  noReplyReminderAt,
} from '../../../../shared/noReplyReminder';
import type { Decision, MailMessage, MailThread } from '../../../../shared/types';

/** Drafts that started as the agent's prepared text (label stays on while editing). Bounded: only recent ones matter. */
const agentDraftIds = createBoundedIdSet(AGENT_DRAFT_ID_LIMIT);

const STRIP_BUTTON = 'inline-flex h-7 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-[var(--strong-border)] px-2.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]';
const QUIET_BUTTON = 'inline-flex h-6 shrink-0 items-center gap-1 rounded-[var(--control-radius)] px-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]';

function Keys({ keys }: { keys: string[] }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {keys.map(key => (
        <kbd key={key} className="inline-flex min-w-[16px] items-center justify-center rounded border border-current/40 px-1 font-mono text-[calc(10px*var(--font-scale))] font-medium leading-[14px] opacity-80">{key}</kbd>
      ))}
    </span>
  );
}

interface ReplyDockProps {
  thread: MailThread;
  messages: MailMessage[];
  decision: Decision | null;
}

export function ReplyDock({ thread, messages, decision }: ReplyDockProps) {
  const store = useAppStore();
  const agent = useAgentPrep();
  const storeRef = useRef(store);
  storeRef.current = store;

  const [focusSignal, setFocusSignal] = useState(0);
  const [remindEnabled, setRemindEnabled] = useState(false);
  const [remindDays, setRemindDays] = useState<number>(DEFAULT_NO_REPLY_REMINDER_DAYS);
  const threadKey = `${thread.accountId}:${thread.id}`;

  useEffect(() => {
    setRemindEnabled(false);
    setRemindDays(DEFAULT_NO_REPLY_REMINDER_DAYS);
  }, [threadKey]);

  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const activeDraft = store.activeDraft;
  const draftIsThisThread = Boolean(activeDraft && activeDraft.threadId === thread.id && activeDraft.accountId === thread.accountId);
  const savedDraft = useMemo(
    () => findReusableThreadDraft(store.draftsList, thread.accountId, thread.id),
    [store.draftsList, thread.accountId, thread.id],
  );
  const agentDraft = agent.getAgentDraft(thread);

  const mode: ReplyDockMode = resolveReplyDockMode({
    hasMessages: Boolean(lastMessage),
    inlineDraftActive: draftIsThisThread && store.composeLayout === 'inline',
    floatingDraftActive: draftIsThisThread && store.composeLayout === 'floating',
    savedDraft: Boolean(savedDraft) && !draftIsThisThread,
    modelStatus: agent.modelStatus,
    decision,
    agentDraft,
  });
  const draftCameFromAgent = Boolean(activeDraft && agentDraftIds.has(activeDraft.id));
  const offerPrepared = shouldOfferPreparedDraft({ mode, modelStatus: agent.modelStatus, decision, agentDraft, draftCameFromAgent });

  // Ask for a prepared draft when a thread that needs a reply is opened.
  useEffect(() => {
    if (agent.modelStatus === 'none' || decision !== 'reply') return;
    // Once per opened thread (the hook is idempotent anyway).
    agent.requestAgentDraft(thread);
  }, [threadKey, decision, agent.modelStatus]);

  const recipient = useMemo(
    () => messageCounterparty(messages, thread.accountId),
    [messages, thread.accountId],
  );

  const accountAfterSend = resolveAccountSetting(store.settings, thread.accountId, 'afterSend').value;
  const primaryAfterSend = resolveAfterSend(accountAfterSend, 'default');
  const primaryLabel = sendButtonLabel(primaryAfterSend, true);
  const secondaryLabel = primaryAfterSend === 'archive' ? 'Send only' : 'Send and archive';

  // --- actions (read the latest state through refs: called from the keyboard bridge too) ---
  const stateRef = useRef({ mode, lastMessage, agentDraft, remindEnabled, remindDays, savedDraft });
  stateRef.current = { mode, lastMessage, agentDraft, remindEnabled, remindDays, savedDraft };

  const openPreparedForEditing = () => {
    const { lastMessage: last, agentDraft: prepared } = stateRef.current;
    if (!last || !prepared.bodyPlain.trim()) return null;
    const draft = storeRef.current.startReplyWithBody(last, prepared.bodyPlain);
    if (draft) agentDraftIds.add(draft.id);
    return draft;
  };

  const startManualReply = (replyAll = false) => {
    const last = stateRef.current.lastMessage;
    if (last) storeRef.current.startReply(last, replyAll);
  };

  const sendFromDock = async (intent: SendIntent) => {
    const current = storeRef.current;
    let draft = current.getActiveDraft();
    if (!draft || draft.threadId !== thread.id || draft.accountId !== thread.accountId) {
      if (stateRef.current.mode !== 'prepared') return;
      draft = openPreparedForEditing();
      if (!draft) return;
    }
    const { remindEnabled: remind, remindDays: days } = stateRef.current;
    const draftId = draft.id;
    const accountId = thread.accountId;
    const threadId = thread.id;
    // "Remind me if no reply" is armed only on positive evidence that the
    // message went out: `onSent` never fires for an undone or failed send.
    await current.sendDraftWithUndo({
      intent,
      onSent: remind
        ? () => {
          const sentAt = new Date();
          armNoReplyReminder({
            accountId,
            threadId,
            draftId,
            sentAt: sentAt.toISOString(),
            remindAt: noReplyReminderAt(sentAt, days).toISOString(),
          });
        }
        : undefined,
    });
  };
  const sendRef = useRef(sendFromDock);
  sendRef.current = sendFromDock;
  const openPreparedRef = useRef(openPreparedForEditing);
  openPreparedRef.current = openPreparedForEditing;

  useEffect(() => registerReplyDock({
    reply: () => {
      const { mode: currentMode, lastMessage: last } = stateRef.current;
      if (currentMode === 'editing') {
        setFocusSignal(value => value + 1);
        return true;
      }
      if (currentMode === 'prepared') {
        return Boolean(openPreparedRef.current());
      }
      if (currentMode === 'saved' && last) {
        // Reuses the saved draft; the composer focuses a newly shown draft.
        storeRef.current.startReply(last);
        return true;
      }
      return false;
    },
    send: (intent) => {
      const currentMode = stateRef.current.mode;
      if (currentMode !== 'editing' && currentMode !== 'prepared') return false;
      // Another draft (a new message in the floating composer) owns ⌘↩.
      const other = storeRef.current.getActiveDraft();
      if (other && (other.threadId !== thread.id || other.accountId !== thread.accountId)) return false;
      void sendRef.current(intent);
      return true;
    },
  }), [threadKey]);

  if (mode === 'hidden') return null;

  const remindControl = (
    <div className="flex shrink-0 items-center gap-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]" data-reply-remind>
      <label className="inline-flex cursor-pointer items-center gap-1.5">
        <input
          type="checkbox"
          checked={remindEnabled}
          onChange={(event) => setRemindEnabled(event.target.checked)}
          data-reply-remind-toggle
          className="h-3.5 w-3.5 cursor-pointer accent-[var(--accent)]"
        />
        <span>Remind me if no reply</span>
      </label>
      <label className="sr-only" htmlFor={`remind-days-${thread.id}`}>Remind after</label>
      <select
        id={`remind-days-${thread.id}`}
        value={remindDays}
        disabled={!remindEnabled}
        onChange={(event) => setRemindDays(Number(event.target.value))}
        data-reply-remind-days
        className="h-6 rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--raised-surface)] px-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
      >
        {NO_REPLY_REMINDER_DAY_OPTIONS.map(days => (
          <option key={days} value={days}>in {noReplyDaysLabel(days)}</option>
        ))}
      </select>
    </div>
  );

  const undoNote = (
    <span className="ml-auto hidden shrink-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)] lg:inline">
      Undo send for {Math.max(0, Math.round(store.settings.compose.sendUndoDelay ?? 10))} s. Esc keeps the draft.
    </span>
  );

  const preparedLabel = (
    <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 pb-1.5 text-[calc(11px*var(--font-scale))]" data-agent-draft-label>
      <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
      <span className="font-semibold text-[var(--ai-accent)]">Draft prepared by the agent</span>
      <span className="text-[var(--text-secondary)]">Nothing is sent until you press Send.</span>
    </div>
  );

  let body: ReactNode;
  switch (mode) {
    case 'editing': {
      const banner = offerPrepared ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1.5 text-[calc(11px*var(--font-scale))]" role="status" data-agent-draft-offer>
          <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
          <span className="text-[var(--text-secondary)]">The agent prepared a draft. Your text is kept.</span>
          <button
            type="button"
            onClick={() => {
              const draft = openPreparedForEditing();
              if (draft) setFocusSignal(value => value + 1);
            }}
            className={QUIET_BUTTON}
            data-agent-draft-use
          >
            Use prepared draft
          </button>
        </div>
      ) : draftCameFromAgent ? preparedLabel : null;
      body = (
        <InlineReplyComposer
          onSend={(intent) => void sendFromDock(intent)}
          banner={banner}
          footerExtra={<>{remindControl}{undoNote}</>}
          focusSignal={focusSignal}
        />
      );
      break;
    }
    case 'prepared':
      body = (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-x-2 gap-y-0.5 pb-1.5 text-[calc(11px*var(--font-scale))]" data-agent-draft-label>
            <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
            <span className="font-semibold text-[var(--ai-accent)]">Draft prepared by the agent</span>
            <span className="text-[var(--text-secondary)]">Nothing is sent until you press Send.</span>
            {recipient?.email && <span className="min-w-0 truncate text-[var(--text-tertiary)]">To: {recipient.email}</span>}
          </div>
          <div
            role="textbox"
            aria-readonly="true"
            aria-multiline="true"
            aria-label="Prepared reply. Press R or Enter to edit."
            tabIndex={0}
            data-agent-draft-text
            onClick={() => { openPreparedForEditing(); }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.metaKey && !event.ctrlKey) {
                event.preventDefault();
                event.stopPropagation();
                openPreparedForEditing();
              }
            }}
            className="min-h-[64px] flex-1 cursor-text overflow-y-auto whitespace-pre-wrap rounded-[var(--control-radius)] border border-[var(--strong-border)] bg-[var(--raised-surface)] px-4 py-3 text-[calc(13px*var(--font-scale))] leading-relaxed text-[var(--text-primary)] select-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            {agentDraft.bodyPlain}
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 select-none" data-reply-footer>
            <button
              type="button"
              onClick={() => void sendFromDock('default')}
              data-reply-send="primary"
              aria-keyshortcuts="Meta+Enter"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] bg-[var(--accent)] px-3 text-[calc(12px*var(--font-scale))] font-semibold text-white hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
            >
              <Send aria-hidden="true" className="h-3.5 w-3.5" />
              {primaryLabel}
              <Keys keys={['⌘', '↩']} />
            </button>
            <button
              type="button"
              onClick={() => void sendFromDock('alternate')}
              data-reply-send="secondary"
              aria-keyshortcuts="Meta+Shift+Enter"
              className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-[var(--strong-border)] px-3 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
            >
              {secondaryLabel}
              <Keys keys={['⌘', '⇧', '↩']} />
            </button>
            <button type="button" onClick={() => { openPreparedForEditing(); }} className={QUIET_BUTTON} data-agent-draft-edit aria-keyshortcuts="R">
              Edit <Keys keys={['R']} />
            </button>
            <button type="button" onClick={() => startManualReply()} className={QUIET_BUTTON}>
              Write my own
            </button>
            {remindControl}
            {undoNote}
          </div>
        </div>
      );
      break;
    case 'preparing':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]" role="status" data-agent-draft-loading>
          <LoaderCircle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin text-[var(--ai-accent)] motion-reduce:animate-none" />
          <span>Preparing a draft…</span>
          <button type="button" onClick={() => agent.cancelFor(thread)} className={QUIET_BUTTON} data-agent-draft-cancel>
            <X aria-hidden="true" className="h-3 w-3" /> Cancel
          </button>
          <span className="flex-1" />
          <button type="button" onClick={() => startManualReply()} className={STRIP_BUTTON} aria-keyshortcuts="R" data-reply-start>
            <Reply aria-hidden="true" className="h-3.5 w-3.5" /> Write it myself <Keys keys={['R']} />
          </button>
        </div>
      );
      break;
    case 'unavailable':
      body = (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center gap-2 pb-1.5 text-[calc(11px*var(--font-scale))]" role="status" data-agent-draft-error>
            <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
            <span className="font-semibold text-[var(--text-primary)]">Draft unavailable</span>
            <span className="text-[var(--text-secondary)]">The model did not answer. Your mail is not affected.</span>
            <button type="button" onClick={agent.retryModel} className={`${QUIET_BUTTON} border border-[var(--strong-border)]`} data-agent-draft-retry>
              Retry
            </button>
          </div>
          <button
            type="button"
            onClick={() => startManualReply()}
            aria-keyshortcuts="R"
            data-reply-start
            className="min-h-[56px] w-full flex-1 cursor-text rounded-[var(--control-radius)] border border-[var(--strong-border)] bg-[var(--raised-surface)] px-4 py-3 text-left text-[calc(13px*var(--font-scale))] text-[var(--text-tertiary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
          >
            Write your reply
          </button>
        </div>
      );
      break;
    case 'saved':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]" data-reply-saved>
          <span>Draft saved</span>
          <span aria-hidden="true">·</span>
          <button
            type="button"
            onClick={() => { if (lastMessage) store.startReply(lastMessage); }}
            aria-keyshortcuts="R"
            className={QUIET_BUTTON}
            data-reply-continue
          >
            <Keys keys={['R']} /> to continue
          </button>
        </div>
      );
      break;
    case 'floating':
      body = (
        <div className="flex flex-wrap items-center gap-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          <span>The reply is open in a separate window.</span>
          <button type="button" onClick={() => store.setComposeLayout('inline')} className={QUIET_BUTTON}>
            Show it here
          </button>
        </div>
      );
      break;
    case 'idle':
    default:
      body = (
        <div className="flex flex-wrap items-center gap-2" data-reply-idle>
          <button type="button" onClick={() => startManualReply()} className={STRIP_BUTTON} aria-keyshortcuts="R" data-reply-start>
            <Reply aria-hidden="true" className="h-3.5 w-3.5" /> Reply <Keys keys={['R']} />
          </button>
          <button type="button" onClick={() => startManualReply(true)} className={STRIP_BUTTON} aria-keyshortcuts="A">
            <ReplyAll aria-hidden="true" className="h-3.5 w-3.5" /> Reply all <Keys keys={['A']} />
          </button>
        </div>
      );
      break;
  }

  const expanded = mode === 'editing' || mode === 'prepared' || mode === 'unavailable';
  return (
    <section
      aria-label="Reply"
      data-reply-dock={mode}
      className={`dm-reply-dock print-hidden flex shrink-0 flex-col border-t border-[var(--border)] bg-[var(--panel-bg)] px-6 ${expanded ? 'max-h-[45%] min-h-0 py-3' : 'py-2'}`}
    >
      <div className="mx-auto flex min-h-0 w-full flex-1 flex-col" style={{ maxWidth: 'var(--reader-max-width, 800px)' }}>
        {body}
      </div>
    </section>
  );
}
