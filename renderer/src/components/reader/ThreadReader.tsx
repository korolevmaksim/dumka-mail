// Reading area for an open thread (extracted from App.tsx): header with the
// four labelled actions and the More menu, the scrolling message list, and the
// reply dock pinned to the bottom.
import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import {
  ArchiveRestore, Bell, BellOff, CalendarCheck, CalendarClock, CalendarPlus, CalendarX, ChevronDown, ChevronUp,
  FileCode, Forward, Inbox, MailMinus, MailOpen, OctagonAlert, Printer, ReplyAll, Tags, Trash2, X, Layers, Link2,
} from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { useInviteRsvp } from '../../hooks/useInviteRsvp';
import { ThreadMessageList } from '../ThreadMessageList';
import { AgenticThreadPanel } from '../AgenticThreadPanel';
import { ThreadLabelMoveMenu } from '../ThreadLabelMoveMenu';
import { UnsubscribeConfirmSheet } from '../UnsubscribeConfirmSheet';
import { RawMessageModal } from '../MessageCard';
import { ThreadSummary } from './ThreadSummary';
import { ThreadHeader } from './ThreadHeader';
import { ReplyDock } from './ReplyDock';
import type { ActionMenuItem } from './ActionMenu';
import { hintLabel, actionKeyHints } from '../../lib/actionKeyHints';
import { activeReplyDock } from '../../lib/replyDockBridge';
import { buildLabelTree, flattenLabelTree, labelDefinitionsForAccount } from '../../../../shared/labels';
import { messageCounterparty } from '../../../../shared/threadCounterparty';
import { resolveInboxDecision } from '../../../../shared/inboxSections';
import { threadNeedsInviteAnswer } from '../../../../shared/inviteRsvp';
import { unsubscribeTargetFromCandidate, type UnsubscribeTarget } from '../../../../shared/unsubscribeConfirm';
import type { MailThread } from '../../../../shared/types';

/** Threads longer than this get the agent summary above the messages (SPEC §3). */
const SUMMARY_MIN_MESSAGES = 6;

export function readerMaxWidth(option?: string): string {
  switch (option) {
    case 'full': return '100%';
    case 'wide': return '1000px';
    case 'narrow': return '600px';
    case 'standard':
    default:
      return '800px';
  }
}

export interface ThreadFindState {
  open: boolean;
  query: string;
  matchesCount: number;
  activeIndex: number;
  setQuery: (query: string) => void;
  next: () => void;
  prev: () => void;
  close: () => void;
}

interface ThreadReaderProps {
  thread: MailThread;
  readerReplacesList: boolean;
  find: ThreadFindState;
  onOpenReminder: (thread: MailThread) => void;
  onOpenMoveToSection: (thread: MailThread) => void;
}

export function ThreadReader({ thread, readerReplacesList, find, onOpenReminder, onOpenMoveToSection }: ThreadReaderProps) {
  const store = useAppStore();
  const rsvp = useInviteRsvp();
  const [labelMenuOpen, setLabelMenuOpen] = useState(false);
  const [unsubscribeTargets, setUnsubscribeTargets] = useState<UnsubscribeTarget[] | null>(null);
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [rawMessageId, setRawMessageId] = useState<string | null>(null);

  const threadKey = `${thread.accountId}:${thread.id}`;
  const messagesReady = store.openedThreadMessagesStatus === 'ready' && store.openedThreadMessagesKey === threadKey;
  const messages = useMemo(
    () => (messagesReady
      ? store.openedThreadMessages.filter(message => message.threadId === thread.id && message.accountId === thread.accountId)
      : []),
    [messagesReady, store.openedThreadMessages, thread.accountId, thread.id],
  );
  const lastMessage = messages.length > 0 ? messages[messages.length - 1] : null;
  const counterparty = useMemo(
    () => (messagesReady ? messageCounterparty(messages, thread.accountId) : null),
    [messages, messagesReady, thread.accountId],
  );
  const decision = store.sectionOfThread(thread)
    ?? resolveInboxDecision(thread, { accountEmail: thread.accountId }, store.threadDecisions[thread.accountId]?.[thread.id]).decision;

  useEffect(() => {
    setLabelMenuOpen(false);
    setRawMessageId(null);
  }, [threadKey]);

  useEffect(() => {
    if (!labelMenuOpen) return;
    const close = () => setLabelMenuOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [labelMenuOpen]);

  const userLabelNodes = useMemo(
    () => flattenLabelTree(buildLabelTree(
      labelDefinitionsForAccount(store.labelDefinitions, thread.accountId).filter(label => label.type !== 'system'),
    )),
    [store.labelDefinitions, thread.accountId],
  );

  const inInbox = thread.labelIds.some(label => label.toUpperCase() === 'INBOX');
  const needsAnswer = threadNeedsInviteAnswer(thread);
  const calendarConnected = needsAnswer ? rsvp.calendarConnected(thread.accountId) : null;
  const rsvpBusy = rsvp.isBusy(thread);
  const unsubscribeTarget = unsubscribeTargetFromCandidate(store.threadAgentInsights?.unsubscribeCandidate);

  const reply = (replyAll = false) => {
    if (!lastMessage) return;
    if (!replyAll && activeReplyDock()?.reply()) return;
    store.startReply(lastMessage, replyAll);
  };

  const runLabelAction = (kind: 'moveToLabel' | 'applyLabel' | 'removeLabel', labelId: string) => {
    setLabelMenuOpen(false);
    if (kind === 'removeLabel') {
      void store.executeMailAction('removeLabel', thread.id, null, undefined, JSON.stringify({ labelId }));
      return;
    }
    void store.moveThreadToLabel(labelId, thread.id, kind === 'moveToLabel');
  };

  const hints = useMemo(() => actionKeyHints(store.settings.shortcuts), [store.settings.shortcuts]);
  const moreItems: ActionMenuItem[] = [
    { id: 'replyAll', label: 'Reply all', shortcut: hintLabel(hints.replyAll), icon: ReplyAll, disabled: !lastMessage, onSelect: () => reply(true) },
    { id: 'forward', label: 'Forward', shortcut: hintLabel(hints.forward), icon: Forward, disabled: !lastMessage, onSelect: () => { if (lastMessage) store.startForward(lastMessage); } },
    ...(needsAnswer
      ? (calendarConnected === false
        ? [{ id: 'connectCalendar', label: 'Connect Calendar to answer', icon: Link2, separatorBefore: true, onSelect: () => rsvp.connectCalendar(thread.accountId) }]
        : [
            { id: 'acceptInvite', label: 'Accept invitation', shortcut: hintLabel(hints.acceptInvite), icon: CalendarCheck, separatorBefore: true, disabled: rsvpBusy, onSelect: () => void rsvp.answer(thread, 'accepted') },
            { id: 'maybeInvite', label: 'Maybe', icon: CalendarClock, disabled: rsvpBusy, onSelect: () => void rsvp.answer(thread, 'tentative', { archive: false }) },
            { id: 'declineInvite', label: 'Decline invitation', shortcut: hintLabel(hints.declineInvite), icon: CalendarX, disabled: rsvpBusy, onSelect: () => void rsvp.answer(thread, 'declined') },
          ])
      : []),
    { id: 'calendarEvent', label: 'Create calendar event', icon: CalendarPlus, separatorBefore: true, onSelect: () => store.startCalendarEventFromThread(thread) },
    { id: 'print', label: 'Print', icon: Printer, onSelect: () => window.print() },
    { id: 'label', label: 'Move or apply label…', icon: Tags, onSelect: () => setLabelMenuOpen(true) },
    ...(store.mailboxView === 'inbox' && inInbox
      ? [{ id: 'moveToSection', label: 'Move to another section…', shortcut: hintLabel(hints.moveToSection), icon: Layers, onSelect: () => onOpenMoveToSection(thread) }]
      : []),
    {
      id: 'toggleRead',
      label: thread.isUnread ? 'Mark as read' : 'Mark as unread',
      shortcut: hintLabel(hints.toggleRead),
      icon: MailOpen,
      onSelect: () => void store.executeMailAction(thread.isUnread ? 'markRead' : 'markUnread', thread.id),
    },
    store.mailboxView === 'muted'
      ? { id: 'unmute', label: 'Unmute', icon: Bell, separatorBefore: true, onSelect: () => void store.unmuteThread(thread.id) }
      : { id: 'mute', label: 'Ignore (mute)', shortcut: hintLabel(hints.mute), icon: BellOff, separatorBefore: true, onSelect: () => void store.muteThread(thread.id) },
    ...(unsubscribeTarget
      ? [{ id: 'unsubscribe', label: 'Unsubscribe…', icon: MailMinus, onSelect: () => setUnsubscribeTargets([unsubscribeTarget]) }]
      : []),
    store.mailboxView === 'spam'
      ? { id: 'notSpam', label: 'Not spam', icon: Inbox, onSelect: () => void store.executeMailAction('restoreFromSpam', thread.id) }
      : { id: 'spam', label: 'Move to Spam', shortcut: hintLabel(hints.spam), icon: OctagonAlert, onSelect: () => void store.executeMailAction('reportSpam', thread.id) },
    store.mailboxView === 'trash'
      ? { id: 'restoreTrash', label: 'Restore from Trash', icon: ArchiveRestore, onSelect: () => void store.executeMailAction('restoreFromTrash', thread.id) }
      : { id: 'trash', label: 'Move to Trash', shortcut: hintLabel(hints.trash), icon: Trash2, tone: 'danger' as const, onSelect: () => void store.executeMailAction('moveToTrash', thread.id) },
    { id: 'showOriginal', label: 'Show original', icon: FileCode, separatorBefore: true, disabled: !lastMessage, onSelect: () => setRawMessageId(lastMessage?.id ?? null) },
    {
      id: 'close',
      label: store.returnWorkspaceView === 'today' ? 'Back to Today' : 'Close conversation',
      shortcut: 'Esc',
      icon: X,
      onSelect: () => void store.closeOpenedThread(),
    },
  ];

  const rawMessage = rawMessageId ? messages.find(message => message.id === rawMessageId) || null : null;

  const onFindKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) find.prev();
      else find.next();
    }
  };

  const maxWidth = readerMaxWidth(store.settings.appearance.readerMaxWidth);

  return (
    <div
      className="dm-thread-reader panel-surface relative flex min-w-0 flex-1 flex-col overflow-hidden bg-[var(--panel-bg)]"
      data-thread-reader
      style={{ ['--reader-max-width' as string]: maxWidth }}
    >
      {find.open && (
        <div className="dm-overlay print-hidden absolute right-6 top-4 z-20 flex items-center gap-2 rounded-lg border border-[var(--strong-border)] bg-[var(--panel-bg)] px-3 py-1.5 shadow-xl select-none animate-fade-in motion-reduce:animate-none">
          <input
            id="thread-search-input"
            type="text"
            placeholder="Find in email…"
            aria-label="Find in email"
            value={find.query}
            onChange={(event) => find.setQuery(event.target.value)}
            onKeyDown={onFindKeyDown}
            className="w-48 border-0 bg-transparent text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder-[var(--text-tertiary)]"
          />
          {find.query && (
            <span className="shrink-0 border-r border-[var(--border)] px-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-tertiary)]" role="status">
              {find.matchesCount > 0 ? `${find.activeIndex + 1} of ${find.matchesCount}` : '0 of 0'}
            </span>
          )}
          <div className="flex shrink-0 items-center gap-0.5">
            <button type="button" onClick={find.prev} title="Previous match (Shift+Enter)" aria-label="Previous match" className="cursor-pointer rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]">
              <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={find.next} title="Next match (Enter)" aria-label="Next match" className="cursor-pointer rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]">
              <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={find.close} title="Close find" aria-label="Close find" className="cursor-pointer rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]">
              <X aria-hidden="true" className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      )}

      <div className="shrink-0 px-6 pb-3 pt-5">
        <div className="mx-auto w-full" style={{ maxWidth }}>
          <ThreadHeader
            subject={thread.subject}
            counterparty={counterparty}
            identityLoading={!messagesReady}
            messageCount={messages.length}
            showBack={readerReplacesList}
            backLabel={store.returnWorkspaceView === 'today' ? 'Back to Today' : 'Back to List'}
            onBack={() => void store.closeOpenedThread()}
            onReply={() => reply(false)}
            canReply={Boolean(lastMessage)}
            onArchive={() => void store.executeMailAction('markDone', thread.id)}
            canArchive={inInbox}
            onLater={() => onOpenReminder(thread)}
            reminderAt={thread.reminderAt}
            hints={hints}
            moreItems={moreItems}
          >
            {labelMenuOpen && (
              <ThreadLabelMoveMenu
                nodes={userLabelNodes}
                onSyncLabels={() => void store.syncLabels(thread.accountId)}
                onMove={(labelId) => runLabelAction('moveToLabel', labelId)}
                onApply={(labelId) => runLabelAction('applyLabel', labelId)}
                onRemove={(labelId) => runLabelAction('removeLabel', labelId)}
                onClose={() => setLabelMenuOpen(false)}
                currentLabelIds={thread.labelIds}
                className="absolute right-0 top-9"
              />
            )}
          </ThreadHeader>
        </div>
      </div>

      <div id="thread-reader-pane" className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-4">
        <div className="mx-auto flex w-full flex-col" style={{ maxWidth }}>
          {messagesReady && messages.length >= SUMMARY_MIN_MESSAGES && <ThreadSummary thread={thread} />}
          <AgenticThreadPanel />
          <ThreadMessageList
            threadKey={threadKey}
            messages={store.openedThreadMessages}
            status={store.openedThreadMessagesStatus}
            defaultLoadImages={store.settings.privacy.loadRemoteImages}
            collapseReadMessages={store.settings.inbox.collapseReadThreads}
          />
        </div>
      </div>

      <ReplyDock thread={thread} messages={messages} decision={decision} />

      {rawMessage && (
        <RawMessageModal
          accountId={rawMessage.accountId}
          messageId={rawMessage.id}
          msg={rawMessage}
          onClose={() => setRawMessageId(null)}
        />
      )}
      {unsubscribeTargets && (
        <UnsubscribeConfirmSheet
          targets={unsubscribeTargets}
          busy={unsubscribing}
          onConfirm={(options) => {
            setUnsubscribing(true);
            void store.unsubscribeSenders(unsubscribeTargets, options).finally(() => {
              setUnsubscribing(false);
              setUnsubscribeTargets(null);
            });
          }}
          onCancel={() => setUnsubscribeTargets(null)}
        />
      )}
    </div>
  );
}
