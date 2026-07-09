import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Bold,
  Braces,
  Calendar,
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
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      className={`flex h-8 w-8 items-center justify-center rounded-md transition-colors ${
        active
          ? 'bg-[var(--hover-row)] text-[var(--accent)]'
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

export function InlineReplyComposer() {
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

  useEffect(() => {
    const draft = store.activeDraft;
    if (!draft || draft.threadId !== store.openedThread?.id || store.composeLayout !== 'inline') return;

    const isNewDraft = draft.id !== lastDraftIdRef.current;
    if (!isNewDraft) return;

    lastDraftIdRef.current = draft.id;
    setQuotedTextExpanded(false);
    window.setTimeout(() => {
      composerRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      editorRef.current?.focusAtStart();
    }, 50);
  }, [store.activeDraft?.id, store.activeDraft?.threadId, store.composeLayout, store.openedThread?.id]);

  const activeDraft = store.activeDraft;

  if (!activeDraft || activeDraft.threadId !== store.openedThread?.id || store.composeLayout !== 'inline') {
    return null;
  }

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
    const alreadyHasSignature = Boolean(activeDraft.bodyHtml?.includes('gmail_signature'));
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
    const alreadyHasSignature = Boolean(activeDraft.bodyHtml?.includes('gmail_signature'));
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
    const body = activeDraft.bodyPlain.trim();
    if (!body) {
      emitToast({ type: 'warning', message: 'Write a body before saving a snippet.' });
      return;
    }
    const titleSeed = activeDraft.subject.trim() || 'New snippet';
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

  return (
    <div
      ref={composerRef}
      className="print-hidden mt-6 flex shrink-0 flex-col overflow-hidden rounded-[8px] border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-[0_10px_32px_rgba(0,0,0,0.08)]"
    >
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--rail-bg)] px-4 py-3 select-none">
        <div className="flex min-w-0 items-center gap-3">
          <span className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Reply</span>
          <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
            {activeDraft.accountId}
          </span>
        </div>
        <button
          type="button"
          onClick={() => store.setComposeLayout('floating')}
          title="Pop out reply"
          className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
        >
          <ExternalLink className="h-4 w-4" />
        </button>
      </div>

      <div className="space-y-1 border-b border-[var(--border)] px-4 py-3 text-[calc(12px*var(--font-scale))]">
        <div className="flex min-w-0 items-center gap-2">
          <span className="w-8 shrink-0 text-[var(--text-secondary)]">To</span>
          <span className="truncate text-[var(--text-primary)]" title={toEmails}>{toEmails}</span>
        </div>
        {ccEmails && (
          <div className="flex min-w-0 items-center gap-2">
            <span className="w-8 shrink-0 text-[var(--text-secondary)]">Cc</span>
            <span className="truncate text-[var(--text-primary)]" title={ccEmails}>{ccEmails}</span>
          </div>
        )}
      </div>

      <RichTextEditor
        ref={editorRef}
        draftId={`${activeDraft.id}:${activeDraft.accountId}`}
        bodyPlain={activeDraft.bodyPlain}
        bodyHtml={activeDraft.bodyHtml}
        placeholder="Write your reply"
        spellCheck={store.settings.compose.spellCheck}
        editorClassName="min-h-[170px] max-h-[min(42vh,420px)] px-4 py-3"
        collapseQuotedText={hasQuotedReply && !quotedTextExpanded}
        onChange={(bodyPlain, bodyHtml) => store.updateDraftBody(bodyPlain, bodyHtml)}
      />

      <DraftPlaceholderWarning bodyPlain={activeDraft.bodyPlain} bodyHtml={activeDraft.bodyHtml} />

      {hasQuotedReply && (
        <div className="border-t border-[var(--border)]/40 px-4 py-2 select-none">
          <button
            type="button"
            title={quotedTextExpanded ? 'Hide quoted text' : 'Show quoted text'}
            onClick={() => setQuotedTextExpanded(value => !value)}
            className={`inline-flex h-6 items-center justify-center rounded-md px-2 transition-colors ${
              quotedTextExpanded
                ? 'bg-[var(--hover-row)] text-[var(--accent)]'
                : 'bg-[var(--hover-row)]/50 text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
            }`}
          >
            <MoreHorizontal className="h-4 w-4" />
          </button>
        </div>
      )}

      {activeDraft.attachments.length > 0 && (
        <div className="border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 select-none">
          <div className="flex flex-wrap gap-1.5">
            {activeDraft.attachments.map(att => (
              <div key={att.id} className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised-surface)] px-2.5 py-1 text-[calc(11px*var(--font-scale))]">
                <span className="truncate text-[var(--text-primary)]">{att.filename}</span>
                <button
                  type="button"
                  onClick={() => store.removeAttachmentFromDraft(att.id)}
                  className="rounded p-0.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--danger)]"
                  title={`Remove ${att.filename}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 select-none">
        <div className="flex min-w-0 items-center gap-1">
          <button
            type="button"
            onClick={() => void store.sendDraftWithUndo()}
            className="mr-2 inline-flex h-8 items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 text-[calc(12px*var(--font-scale))] font-semibold text-white hover:opacity-95"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
          <ToolbarButton title="Bold" onClick={() => execute('bold')}><Bold className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Italic" onClick={() => execute('italic')}><Italic className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Underline" onClick={() => execute('underline')}><Underline className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Bullet list" onClick={() => execute('insertUnorderedList')}><List className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Numbered list" onClick={() => execute('insertOrderedList')}><ListOrdered className="h-4 w-4" /></ToolbarButton>
          <div className="relative">
            <ToolbarButton title="Link" onClick={openLinkPopover}><Link className="h-4 w-4" /></ToolbarButton>
            {linkOpen && (
              <LinkPopover
                selectedText={linkSelectedText}
                onSubmit={insertLink}
                onCancel={closeLinkPopover}
              />
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <ToolbarButton title="AI assistant" onClick={() => store.setAiPanelOpen(!store.aiPanelOpen)}>
            <Sparkles className="h-4 w-4 text-[var(--ai-accent)]" />
          </ToolbarButton>
          <div className="relative">
            <ToolbarButton title="Send later" active={Boolean(activeDraft.sendAt)} onClick={() => setSendLaterOpen(value => !value)}><Clock className="h-4 w-4" /></ToolbarButton>
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
              <ToolbarButton title="Remind me" active={Boolean(reminderThread.reminderAt)} onClick={() => setReminderOpen(value => !value)}><Clock className="h-4 w-4" /></ToolbarButton>
              {reminderOpen && (
                <SnoozeMenu
                  align="right"
                  targetSubject={reminderThread.subject}
                  onPick={(date) => store.snoozeThread(reminderThread, date)}
                  onClose={() => setReminderOpen(false)}
                />
              )}
            </div>
          )}
          <ToolbarButton title="Scheduling link" onClick={() => void insertSchedulingLink()}><Calendar className="h-4 w-4" /></ToolbarButton>
          <div className="relative">
            <ToolbarButton title="Templates and snippets" active={templatesOpen} onClick={() => setTemplatesOpen(value => !value)}><Braces className="h-4 w-4" /></ToolbarButton>
            {templatesOpen && (
              <ComposeTemplatesMenu
                templates={store.settings.snippets.templates}
                onInsertDefaultSnippet={insertDefaultSnippet}
                onInsertTemplate={insertSnippetTemplate}
                onSaveBodyAsSnippet={() => void saveCurrentBodyAsSnippet()}
              />
            )}
          </div>
          <ToolbarButton title="Attach file" onClick={() => void store.addAttachmentToDraft()}><Paperclip className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Discard draft" onClick={() => store.discardDraft(activeDraft.id)}><Trash2 className="h-4 w-4" /></ToolbarButton>
        </div>
      </div>
    </div>
  );
}
