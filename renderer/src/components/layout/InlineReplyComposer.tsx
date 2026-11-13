import { resolveAfterSend, sendButtonLabel, type SendIntent } from '../../../../shared/sendFlow';
import { resolveAccountSetting } from '../../../../shared/accountSettings';
import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bold,
  Braces,
  Calendar,
  CalendarClock,
  Clock,
  ExternalLink,
  Italic,
  Link,
  List,
  ListOrdered,
  MoreHorizontal,
  Paperclip,
  Send,
  Sparkles,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { escapeHtml } from '../../../../shared/draftHtml';
import { createSnippetTemplateId, renderDefaultSnippetHtml, renderSnippetTemplateHtml } from '../../../../shared/snippets';
import type { SnippetTemplate } from '../../../../shared/types';
import { SnoozeMenu } from '../SnoozeMenu';
import { ComposeTemplatesMenu } from '../compose/ComposeTemplatesMenu';
import { LinkPopover } from '../compose/LinkPopover';
import { RichTextEditor, RichTextEditorHandle } from '../compose/RichTextEditor';
import { SendLaterMenu } from '../compose/SendLaterMenu';
import { DraftPlaceholderWarning } from '../compose/DraftPlaceholderWarning';

function CalendarClockIcon() {
  return <CalendarClock aria-hidden="true" className="h-3.5 w-3.5" />;
}

interface ToolbarButtonProps {
  title: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}

function ToolbarButton({ title, onClick, children, active = false }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active || undefined}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] ${
        active
          ? 'bg-[var(--hover-row)] text-[var(--accent-ink)]'
          : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
      }`}
    >
      {children}
    </button>
  );
}

function recipientList(recipients: { email: string }[]): string {
  return recipients.map(recipient => recipient.email).filter(Boolean).join(', ');
}

function KeyHint({ keys }: { keys: string[] }) {
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {keys.map(key => (
        <kbd key={key} className="inline-flex min-w-[16px] items-center justify-center rounded border border-current/40 px-1 font-mono text-[calc(10px*var(--font-scale))] font-medium leading-[14px] opacity-80">
          {key}
        </kbd>
      ))}
    </span>
  );
}

export interface InlineReplyComposerProps {
  /** Routes Send through the reply dock (reminder, prepared-draft bookkeeping). */
  onSend?: (intent: SendIntent) => void;
  /** Agent notice shown above the editor (`Draft written by the model`, `Use the draft`). */
  banner?: ReactNode;
  /** Extra controls in the footer, after the send buttons (`Remind me if no reply`). */
  footerExtra?: ReactNode;
  /** Increment to focus the editor (`R` while the dock is open). */
  focusSignal?: number;
  /** false: a new draft is shown without taking focus (prepared drafts). */
  focusOnOpen?: boolean;
}

export function InlineReplyComposer({ onSend, banner, footerExtra, focusSignal = 0, focusOnOpen = true }: InlineReplyComposerProps = {}) {
  const store = useAppStore();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const composerRef = useRef<HTMLDivElement>(null);
  const lastDraftIdRef = useRef<string | null>(null);
  const [quotedTextExpanded, setQuotedTextExpanded] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSelectedText, setLinkSelectedText] = useState('');
  const [linkSelectionRange, setLinkSelectionRange] = useState<Range | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);
  const [sendLaterOpen, setSendLaterOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [liveBodyPlain, setLiveBodyPlain] = useState('');
  const [liveBodyHtml, setLiveBodyHtml] = useState<string | null>(null);

  useEffect(() => {
    const draft = store.activeDraft;
    if (!draft || draft.threadId !== store.openedThread?.id || store.composeLayout !== 'inline') return;

    const isNewDraft = draft.id !== lastDraftIdRef.current;
    if (!isNewDraft) return;

    lastDraftIdRef.current = draft.id;
    setLiveBodyPlain(draft.bodyPlain);
    setLiveBodyHtml(draft.bodyHtml ?? null);
    setQuotedTextExpanded(false);
    if (!focusOnOpen) return;
    window.setTimeout(() => {
      editorRef.current?.focusAtStart();
    }, 50);
  }, [store.activeDraft?.id, store.activeDraft?.threadId, store.composeLayout, store.openedThread?.id]);

  useEffect(() => {
    if (focusSignal === 0) return;
    editorRef.current?.focus();
  }, [focusSignal]);

  const activeDraft = store.activeDraft;

  if (!activeDraft || activeDraft.threadId !== store.openedThread?.id || store.composeLayout !== 'inline') {
    return null;
  }

  const liveDraft = () => store.getActiveDraft() || activeDraft;

  const toEmails = recipientList(activeDraft.to);
  const ccEmails = recipientList(activeDraft.cc);
  const hasQuotedReply = Boolean(activeDraft.bodyHtml?.includes('data-dumka-quoted-reply="true"'));
  const reminderThread = activeDraft.threadId
    ? store.threads.find(thread => thread.id === activeDraft.threadId && thread.accountId === activeDraft.accountId) ||
      (store.openedThread?.id === activeDraft.threadId && store.openedThread.accountId === activeDraft.accountId ? store.openedThread : null)
    : null;

  const execute = (command: string, value?: string) => {
    editorRef.current?.execute(command, value);
  };

  const closeLinkPopover = () => {
    setLinkOpen(false);
    setLinkSelectedText('');
    setLinkSelectionRange(null);
  };

  const openLinkPopover = () => {
    setLinkSelectedText(editorRef.current?.getSelectedText() || '');
    setLinkSelectionRange(editorRef.current?.getSelectionRange() || null);
    setLinkOpen(true);
  };

  const insertLink = (url: string) => {
    const selected = linkSelectedText.trim();
    if (!selected) {
      const safeUrl = escapeHtml(url);
      editorRef.current?.insertHtml(`<a href="${safeUrl}" target="_blank" rel="noreferrer" style="color:#5383E6;text-decoration:underline;">${safeUrl}</a>`);
      closeLinkPopover();
      return;
    }

    if (linkSelectionRange) {
      editorRef.current?.restoreSelectionRange(linkSelectionRange);
    }
    editorRef.current?.execute('createLink', url);
    closeLinkPopover();
  };

  const insertDefaultSnippet = () => {
    const alreadyHasSignature = Boolean(liveDraft().bodyHtml?.includes('gmail_signature'));
    const snippet = renderDefaultSnippetHtml(
      alreadyHasSignature
        ? { ...store.settings.snippets, includeSignature: false }
        : store.settings.snippets,
      store.settings.compose,
      store.settings.profile,
      activeDraft.accountId,
    );
    if (!snippet) {
      emitToast({ type: 'info', message: 'No default snippet configured.' });
      return;
    }
    editorRef.current?.insertHtml(snippet);
    setTemplatesOpen(false);
  };

  const insertSnippetTemplate = (template: SnippetTemplate) => {
    const alreadyHasSignature = Boolean(liveDraft().bodyHtml?.includes('gmail_signature'));
    const snippet = renderSnippetTemplateHtml(
      alreadyHasSignature
        ? { ...template, includeSignature: false }
        : template,
      store.settings.snippets,
      store.settings.compose,
      store.settings.profile,
      activeDraft.accountId,
    );
    if (!snippet) {
      emitToast({ type: 'info', message: 'Snippet template is empty.' });
      return;
    }
    editorRef.current?.insertHtml(snippet);
    setTemplatesOpen(false);
  };

  const saveCurrentBodyAsSnippet = async () => {
    const currentDraft = liveDraft();
    const body = currentDraft.bodyPlain.trim();
    if (!body) {
      emitToast({ type: 'warning', message: 'Write a body before saving a snippet.' });
      return;
    }
    const titleSeed = currentDraft.subject.trim() || 'New snippet';
    await store.updateSettings(s => {
      s.snippets.enabled = true;
      const id = createSnippetTemplateId(titleSeed, s.snippets.templates);
      s.snippets.templates = [
        ...s.snippets.templates,
        {
          id,
          title: titleSeed,
          trigger: '',
          body,
          includeSignature: s.snippets.includeSignature,
        },
      ];
    });
    setTemplatesOpen(false);
    emitToast({ type: 'success', message: 'Saved as a snippet template.' });
  };

  const insertSchedulingLink = async () => {
    try {
      const provider = store.settings.calendar.defaultConferenceProvider;
      if (provider === 'calendly' && store.settings.calendar.calendlyUrl.trim()) {
        const link = escapeHtml(store.settings.calendar.calendlyUrl.trim());
        editorRef.current?.insertHtml(`<p>Book a time: <a href="${link}" target="_blank" rel="noreferrer">${link}</a></p>`);
        emitToast({ type: 'success', message: 'Calendly link inserted.' });
        return;
      }

      if (provider === 'calCom' && store.settings.calendar.calComUrl.trim()) {
        const link = escapeHtml(store.settings.calendar.calComUrl.trim());
        editorRef.current?.insertHtml(`<p>Book a time: <a href="${link}" target="_blank" rel="noreferrer">${link}</a></p>`);
        emitToast({ type: 'success', message: 'Cal.com link inserted.' });
        return;
      }

      const event = await store.createGoogleMeetDraftEvent();
      const link = event?.conferenceUrl || event?.htmlLink;
      if (link) {
        const safeLink = escapeHtml(link);
        editorRef.current?.insertHtml(`<p>Google Meet: <a href="${safeLink}" target="_blank" rel="noreferrer">${safeLink}</a></p>`);
        emitToast({ type: 'success', message: 'Google Meet link inserted.' });
      }
    } catch (err) {
      console.error('Scheduling link insert failed:', err);
      emitToast({ type: 'error', message: 'Could not insert scheduling link' });
    }
  };

  // Per-account "After sending a reply" (SPEC §3, §8): the label shows what ⌘↩ will do.
  const accountAfterSend = resolveAccountSetting(store.settings, activeDraft.accountId, 'afterSend').value;
  const primaryAfterSend = resolveAfterSend(accountAfterSend, 'default');
  const sendAndArchive = primaryAfterSend === 'archive';
  const primaryLabel = sendButtonLabel(primaryAfterSend, true);
  const secondaryLabel = sendAndArchive ? 'Send only' : 'Send and archive';
  const send = (intent: SendIntent) => {
    if (onSend) onSend(intent);
    else void store.sendDraftWithUndo({ intent });
  };

  return (
    <div
      ref={composerRef}
      data-reply-composer
      className="dm-compose print-hidden flex min-h-0 flex-1 flex-col"
    >
      {banner}
      <div className="flex shrink-0 items-center gap-2 px-1 pb-1.5 text-[calc(11px*var(--font-scale))] select-none">
        <span className="shrink-0 font-semibold text-[var(--text-secondary)]">To</span>
        <span className="min-w-0 flex-1 truncate text-[var(--text-primary)]" title={ccEmails ? `${toEmails}; Cc ${ccEmails}` : toEmails}>
          {toEmails}
          {ccEmails && <span className="text-[var(--text-tertiary)]"> · Cc {ccEmails}</span>}
        </span>
        <span className="hidden shrink-0 truncate text-[var(--text-tertiary)] sm:inline">{activeDraft.accountId}</span>
        <button
          type="button"
          onClick={() => store.setComposeLayout('floating')}
          title="Open the reply in its own window to change To, Cc and Bcc"
          data-reply-edit-recipients
          className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-1 font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          Edit recipients
          <ExternalLink aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* The editor scrolls on its own; the toolbar and footer below always stay visible. */}
      <div className="flex min-h-[72px] flex-1 flex-col overflow-hidden rounded-[var(--control-radius)] border border-[var(--strong-border)] bg-[var(--raised-surface)]" data-reply-editor>

      <RichTextEditor
        ref={editorRef}
        draftId={`${activeDraft.id}:${activeDraft.accountId}:${store.draftBodySeed}`}
        bodyPlain={liveDraft().bodyPlain}
        bodyHtml={liveDraft().bodyHtml}
        placeholder="Write your reply"
        spellCheck={store.settings.compose.spellCheck}
        fontSize={store.settings.compose.defaultFontSize}
        smartCompose={{
          enabled: store.settings.compose.smartCompose,
          subject: liveDraft().subject,
          toRecipientName: activeDraft.to[0]?.name || activeDraft.to[0]?.email || '',
          provider: store.aiProvider,
          interactiveModel: store.settings.ai.globalDefaultModel,
          automationModel: store.settings.ai.automationModel,
        }}
        snippets={{
          settings: store.settings.snippets,
          compose: store.settings.compose,
          profile: store.settings.profile,
          accountId: activeDraft.accountId,
        }}
        editorClassName="min-h-[64px]! px-4 py-3"
        collapseQuotedText={hasQuotedReply && !quotedTextExpanded}
        onChange={(bodyPlain, bodyHtml) => {
          setLiveBodyPlain(bodyPlain);
          setLiveBodyHtml(bodyHtml);
          store.updateDraftBody(bodyPlain, bodyHtml);
        }}
        onDropFiles={store.addDroppedFilesToDraft}
      />

      <DraftPlaceholderWarning bodyPlain={liveBodyPlain} bodyHtml={liveBodyHtml} />

      {hasQuotedReply && (
        <div className="shrink-0 border-t border-[var(--border)]/40 px-4 py-1.5 select-none">
          <button
            type="button"
            title={quotedTextExpanded ? 'Hide quoted text' : 'Show quoted text'}
            aria-label={quotedTextExpanded ? 'Hide quoted text' : 'Show quoted text'}
            aria-expanded={quotedTextExpanded}
            onClick={() => setQuotedTextExpanded(value => !value)}
            className={`inline-flex h-6 items-center justify-center rounded-md px-2 transition-colors ${
              quotedTextExpanded
                ? 'bg-[var(--hover-row)] text-[var(--accent-ink)]'
                : 'bg-[var(--hover-row)]/50 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}

      {activeDraft.attachments.length > 0 && (
        <div className="max-h-[64px] shrink-0 overflow-y-auto border-t border-[var(--border)] px-4 py-1.5 select-none">
          <div className="flex flex-wrap gap-1.5">
            {activeDraft.attachments.map(att => (
              <div key={att.id} className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised-surface)] px-2.5 py-1 text-[calc(11px*var(--font-scale))]">
                <span className="truncate text-[var(--text-primary)]">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => store.removeAttachmentFromDraft(att.id)}
                  className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger-solid)]"
                  title={`Remove ${att.filename}`}
                  aria-label={`Remove ${att.filename}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-0.5 gap-y-1 pt-1.5 select-none" role="toolbar" aria-label="Formatting and attachments">
        <ToolbarButton title="Bold" onClick={() => execute('bold')}><Bold className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Italic" onClick={() => execute('italic')}><Italic className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Underline" onClick={() => execute('underline')}><Underline className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Bullet list" onClick={() => execute('insertUnorderedList')}><List className="h-3.5 w-3.5" /></ToolbarButton>
        <ToolbarButton title="Numbered list" onClick={() => execute('insertOrderedList')}><ListOrdered className="h-3.5 w-3.5" /></ToolbarButton>
        <div className="relative">
          <ToolbarButton title="Link" onClick={openLinkPopover}><Link className="h-3.5 w-3.5" /></ToolbarButton>
          {linkOpen && (
            <LinkPopover
              selectedText={linkSelectedText}
              onSubmit={insertLink}
              onCancel={closeLinkPopover}
            />
          )}
        </div>
        <span className="flex-1" />
        <ToolbarButton title="Attach file" onClick={() => void store.addAttachmentToDraft()}><Paperclip className="h-3.5 w-3.5" /></ToolbarButton>
        <div className="relative">
          <ToolbarButton title="Templates and snippets" active={templatesOpen} onClick={() => setTemplatesOpen(value => !value)}><Braces className="h-3.5 w-3.5" /></ToolbarButton>
          {templatesOpen && (
            <ComposeTemplatesMenu
              templates={store.settings.snippets.templates}
              onInsertDefaultSnippet={insertDefaultSnippet}
              onInsertTemplate={insertSnippetTemplate}
              onSaveBodyAsSnippet={() => void saveCurrentBodyAsSnippet()}
              onClose={() => setTemplatesOpen(false)}
            />
          )}
        </div>
        <ToolbarButton title="Insert scheduling link" onClick={() => void insertSchedulingLink()}><Calendar className="h-3.5 w-3.5" /></ToolbarButton>
        <div className="relative">
          <ToolbarButton title="Send later" active={Boolean(activeDraft.sendAt)} onClick={() => setSendLaterOpen(value => !value)}><Clock className="h-3.5 w-3.5" /></ToolbarButton>
          {sendLaterOpen && (
            <SendLaterMenu
              onSchedule={(date) => void store.scheduleDraftSend(date)}
              onClose={() => setSendLaterOpen(false)}
              align="right"
            />
          )}
        </div>
        {reminderThread && (
          <div className="relative">
            <ToolbarButton title="Later: bring this conversation back" active={Boolean(reminderThread.reminderAt)} onClick={() => setReminderOpen(value => !value)}><CalendarClockIcon /></ToolbarButton>
            {reminderOpen && (
              <SnoozeMenu
                floating
                targetSubject={reminderThread.subject}
                onPick={(date) => store.snoozeThread(reminderThread, date)}
                onClose={() => setReminderOpen(false)}
              />
            )}
          </div>
        )}
        <ToolbarButton title="AI assistant" onClick={() => store.setAiPanelOpen(!store.aiPanelOpen)}>
          <Sparkles className="h-3.5 w-3.5 text-[var(--ai-solid)]" />
        </ToolbarButton>
        <ToolbarButton title="Discard draft" onClick={() => store.discardDraft(activeDraft.id)}><Trash2 className="h-3.5 w-3.5" /></ToolbarButton>
        {store.draftSaveStatusLabel && (
          <span className={`pl-2 text-[calc(11px*var(--font-scale))] ${store.draftSaveStatus === 'error' ? 'text-[var(--danger-solid)]' : 'text-[var(--text-tertiary)]'}`} role="status">
            {store.draftSaveStatusLabel}
          </span>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-2 pt-2 select-none" data-reply-footer>
        <button
          type="button"
          onClick={() => send('default')}
          aria-keyshortcuts="Meta+Enter"
          data-reply-send="primary"
          title={sendAndArchive ? 'Send and archive (⌘↩)' : 'Send (⌘↩)'}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] bg-[var(--accent-fill)] px-3 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]"
        >
          <Send aria-hidden="true" className="h-3.5 w-3.5" />
          {primaryLabel}
          <KeyHint keys={['⌘', '↩']} />
        </button>
        <button
          type="button"
          onClick={() => send('alternate')}
          aria-keyshortcuts="Meta+Shift+Enter"
          data-reply-send="secondary"
          title={`${secondaryLabel} (⌘⇧↩)`}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] border border-[var(--strong-border)] px-3 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)]"
        >
          {secondaryLabel}
          <KeyHint keys={['⌘', '⇧', '↩']} />
        </button>
        {footerExtra}
      </div>
    </div>
  );
}
