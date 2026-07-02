import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  AlignCenter,
  AlignLeft,
  AlignRight,
  Bold,
  Braces,
  CalendarPlus,
  Clock,
  Eraser,
  Image,
  Italic,
  Link,
  List,
  ListOrdered,
  Maximize2,
  Minimize2,
  Paperclip,
  Palette,
  Send,
  Sparkles,
  Strikethrough,
  Trash2,
  Underline,
  X,
} from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { formatAIUserError } from '../../../../shared/aiErrors';
import {
  buildInitialDraftBodyWithSignature,
  escapeHtml,
  htmlFragmentToPlainText,
  renderComposeSignaturePlain,
  replaceComposeSignatureForAccount,
} from '../../../../shared/draftHtml';
import { createSnippetTemplateId, renderDefaultSnippetHtml, renderSnippetTemplateHtml } from '../../../../shared/snippets';
import type { AttachmentMetadata, EmailAddressSuggestion, SnippetTemplate } from '../../../../shared/types';
import { availabilitySlotsHtml, findAvailabilitySlots, findAvailabilitySlotsFromBusyIntervals, freeBusyWarningMessage, type CalendarAvailabilitySlot } from '../../../../shared/calendarAvailability';
import { fileToBase64, inlineImageHtml, textOrHtmlToFragment } from '../../lib/composeHtmlHelpers';
import { RecipientField } from '../compose/RecipientField';
import { ComposeSchedulingMenu } from '../compose/ComposeSchedulingMenu';
import { ComposeTemplatesMenu } from '../compose/ComposeTemplatesMenu';
import { LinkPopover } from '../compose/LinkPopover';
import { RichTextEditor, RichTextEditorHandle } from '../compose/RichTextEditor';
import { SnoozeMenu } from '../SnoozeMenu';

type ComposeCommand = 'bold' | 'italic' | 'underline' | 'strikeThrough' | 'insertUnorderedList' | 'insertOrderedList' | 'justifyLeft' | 'justifyCenter' | 'justifyRight' | 'removeFormat';

interface ToolbarButtonProps {
  title: string;
  onClick: () => void;
  children: ReactNode;
}

function ToolbarButton({ title, onClick, children }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      onMouseDown={(event) => event.preventDefault()}
      className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
    >
      {children}
    </button>
  );
}

export function FloatingComposeDrawer() {
  const store = useAppStore();
  const editorRef = useRef<RichTextEditorHandle>(null);
  const [expanded, setExpanded] = useState(false);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [schedulingOpen, setSchedulingOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiInstruction, setAiInstruction] = useState('');
  const [aiBusy, setAiBusy] = useState(false);
  const [emailSuggestions, setEmailSuggestions] = useState<EmailAddressSuggestion[]>([]);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkSelectedText, setLinkSelectedText] = useState('');
  const [linkSelectionRange, setLinkSelectionRange] = useState<Range | null>(null);
  const [reminderOpen, setReminderOpen] = useState(false);

  const activeDraft = store.activeDraft;

  useEffect(() => {
    if (!activeDraft) return;
    setShowCc(activeDraft.cc.length > 0);
    setShowBcc(activeDraft.bcc.length > 0);
    setTemplatesOpen(false);
    setAiOpen(false);
    setAiInstruction('');
  }, [activeDraft?.id]);

  useEffect(() => {
    if (!activeDraft) {
      setEmailSuggestions([]);
      return;
    }

    let cancelled = false;
    window.electronAPI.listEmailSuggestions(activeDraft.accountId).then((suggestions) => {
      if (!cancelled) setEmailSuggestions(suggestions);
    }).catch((error) => {
      if (!cancelled) {
        console.error('Failed to load email suggestions:', error);
        setEmailSuggestions([]);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeDraft?.accountId]);

  if (!activeDraft || store.composeLayout !== 'floating') {
    return null;
  }

  const isReply = Boolean(activeDraft.threadId);
  const canSwitchAccount = store.accounts.length > 1 && !isReply;
  const reminderThread = activeDraft.threadId
    ? store.threads.find(thread => thread.id === activeDraft.threadId && thread.accountId === activeDraft.accountId) ||
      (store.openedThread?.id === activeDraft.threadId && store.openedThread.accountId === activeDraft.accountId ? store.openedThread : null)
    : null;

  const updateRecipients = (field: 'to' | 'cc' | 'bcc', recipients: typeof activeDraft.to) => {
    store.updateDraft({ [field]: recipients });
  };

  const execute = (command: ComposeCommand) => {
    editorRef.current?.execute(command);
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

  const addInlineImageAttachment = (attachment: AttachmentMetadata) => {
    const inlineAttachment: AttachmentMetadata = {
      ...attachment,
      isInline: true,
      contentId: attachment.contentId || `${attachment.id}@dumka-mail`,
    };
    store.updateDraft({
      attachments: [...(store.activeDraft?.attachments || []), inlineAttachment],
    });
    return inlineAttachment;
  };

  const insertInlineImageFromDialog = async () => {
    const attachment = await window.electronAPI.uploadAttachment();
    if (!attachment) return;
    if (!attachment.mimeType.startsWith('image/')) {
      emitToast({ type: 'warning', message: 'Choose an image file for inline insertion.' });
      return;
    }
    const inlineAttachment = addInlineImageAttachment(attachment);
    editorRef.current?.insertHtml(inlineImageHtml(inlineAttachment));
  };

  const insertInlineImageFromFile = async (file: File): Promise<string | null> => {
    if (!file.type.startsWith('image/')) return null;
    const base64Data = await fileToBase64(file);
    const attachment = addInlineImageAttachment({
      id: crypto.randomUUID(),
      filename: file.name || 'inline-image',
      mimeType: file.type || 'image/png',
      sizeBytes: file.size,
      base64Data,
    });
    return inlineImageHtml(attachment);
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

  const insertSchedulingLink = async (provider: 'calendly' | 'calCom' | 'googleMeet') => {
    try {
      if (provider === 'googleMeet') {
        if (!store.googleIntegrationStatus?.calendarEnabled) {
          await store.authorizeGoogleIntegration('calendar', activeDraft.accountId);
        }
        const event = await store.createGoogleMeetDraftEvent();
        const link = event?.conferenceUrl || event?.htmlLink;
        if (link) {
          editorRef.current?.insertHtml(`<p>Google Meet: <a href="${link}" target="_blank">${link}</a></p>`);
          emitToast({ type: 'success', message: 'Google Meet link inserted.' });
        }
      } else {
        const link = provider === 'calendly'
          ? store.settings.calendar.calendlyUrl.trim()
          : store.settings.calendar.calComUrl.trim();
        if (!link) {
          emitToast({ type: 'warning', message: provider === 'calendly' ? 'Add a Calendly URL in Calendar settings.' : 'Add a Cal.com URL in Calendar settings.' });
          return;
        }
        editorRef.current?.insertHtml(`<p>Book a time: <a href="${link}" target="_blank">${link}</a></p>`);
      }
      setSchedulingOpen(false);
    } catch (error) {
      console.error('Scheduling link insert failed:', error);
      emitToast({ type: 'error', message: 'Could not insert scheduling link.' });
    }
  };

  const insertAvailability = async () => {
    try {
      if (!store.googleIntegrationStatus?.calendarEnabled) {
        await store.authorizeGoogleIntegration('calendar', activeDraft.accountId);
      }
      const attendeeEmails = [...activeDraft.to, ...activeDraft.cc]
        .map(recipient => recipient.email.trim())
        .filter(Boolean);
      const now = new Date();
      let slots: CalendarAvailabilitySlot[];
      let intro = 'A few times that work for me:';

      if (attendeeEmails.length > 0) {
        const rangeEnd = new Date(now);
        rangeEnd.setDate(rangeEnd.getDate() + Math.max(1, Math.floor(store.settings.calendar.availabilityLookaheadDays || 5)));
        const result = await store.queryCalendarFreeBusy({
          timeMin: now.toISOString(),
          timeMax: rangeEnd.toISOString(),
          attendees: attendeeEmails,
          timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }, activeDraft.accountId);
        const warning = freeBusyWarningMessage(result, attendeeEmails);
        intro = warning
          ? 'A few times that work for my calendar:'
          : 'A few shared times that look open:';
        slots = findAvailabilitySlotsFromBusyIntervals(result.busy, store.settings.calendar, now, 5);
        if (warning) {
          emitToast({ type: 'warning', message: `${warning} Inserted your availability only.` });
        }
      } else {
        const events = await store.syncCalendarAgenda(activeDraft.accountId);
        slots = findAvailabilitySlots(events, store.settings.calendar, now, 3);
      }

      if (slots.length === 0) {
        emitToast({ type: 'warning', message: 'No availability found in your configured window.' });
        return;
      }
      editorRef.current?.insertHtml(availabilitySlotsHtml(slots, intro));
      setSchedulingOpen(false);
      emitToast({ type: 'success', message: attendeeEmails.length > 0 ? 'Proposed times inserted.' : 'Availability inserted.' });
    } catch (error) {
      console.error('Availability insert failed:', error);
      emitToast({ type: 'error', message: 'Could not insert availability.' });
    }
  };

  const updateFromAccount = (accountId: string) => {
    let nextHtml: string | null;
    if (activeDraft.bodyHtml?.trim()) {
      nextHtml = replaceComposeSignatureForAccount(
        activeDraft.bodyHtml,
        store.settings.compose,
        store.settings.profile,
        accountId,
      );
    } else {
      const previousSignature = renderComposeSignaturePlain(
        store.settings.compose,
        store.settings.profile,
        activeDraft.accountId,
      ).trim();
      const bodyPlain = previousSignature && activeDraft.bodyPlain.trim() === previousSignature
        ? ''
        : activeDraft.bodyPlain;
      nextHtml = buildInitialDraftBodyWithSignature(
        bodyPlain,
        store.settings.compose,
        store.settings.profile,
        accountId,
      ).bodyHtml;
    }

    store.updateDraft({
      accountId,
      bodyPlain: nextHtml ? htmlFragmentToPlainText(nextHtml) : activeDraft.bodyPlain,
      bodyHtml: nextHtml,
    });
  };

  const saveCurrentBodyAsSnippet = async () => {
    const body = (store.activeDraft?.bodyPlain || '').trim();
    if (!body) {
      emitToast({ type: 'warning', message: 'Write a body before saving a snippet.' });
      return;
    }
    const titleSeed = activeDraft.subject.trim() || 'New snippet';
    await store.updateSettings(s => {
      s.snippets.enabled = true;
      const title = titleSeed;
      const id = createSnippetTemplateId(title, s.snippets.templates);
      s.snippets.templates = [
        ...s.snippets.templates,
        {
          id,
          title,
          trigger: '',
          body,
          includeSignature: s.snippets.includeSignature,
        },
      ];
    });
    setTemplatesOpen(false);
    emitToast({ type: 'success', message: 'Saved as a snippet template.' });
  };

  const runAICompose = async (mode: 'draft' | 'improve') => {
    const selectedText = editorRef.current?.getSelectedText() || '';
    const body = store.activeDraft?.bodyPlain || '';
    const prompt = aiInstruction.trim();
    if (mode === 'draft' && !prompt) {
      emitToast({ type: 'warning', message: 'Describe what the email should say.' });
      return;
    }
    if (mode === 'improve' && !selectedText && !body.trim()) {
      emitToast({ type: 'warning', message: 'Select text or write a draft first.' });
      return;
    }

    setAiBusy(true);
    try {
      const context = [
        `Subject: ${activeDraft.subject || '(none)'}`,
        `To: ${activeDraft.to.map(r => r.email).join(', ') || '(none)'}`,
        `Cc: ${activeDraft.cc.map(r => r.email).join(', ') || '(none)'}`,
        `Current body:\n${body || '(empty)'}`,
      ].join('\n');
      const instruction = mode === 'draft'
        ? `Write a polished email body from these instructions: ${prompt}. Return only a conservative HTML body fragment with paragraphs, lists, links, and emphasis when useful.`
        : `Rewrite ${selectedText ? 'the selected text' : 'the current draft'} to be clearer, concise, and professional. ${prompt ? `Additional instruction: ${prompt}.` : ''} Return only a conservative HTML body fragment. Text to improve:\n${selectedText || body}`;

      const response = await window.electronAPI.completeAI({
        action: 'compose',
        context,
        conversationHistory: [],
        userInstruction: instruction,
      }, store.aiProvider, store.aiModel || undefined);

      const fragment = textOrHtmlToFragment(response.text);
      if (!fragment) return;
      if (mode === 'draft') {
        editorRef.current?.replaceHtml(fragment);
      } else {
        editorRef.current?.insertHtml(fragment);
      }
      setAiInstruction('');
      setAiOpen(false);
      emitToast({ type: 'success', message: mode === 'draft' ? 'AI draft inserted.' : 'AI rewrite inserted.' });
    } catch (error) {
      emitToast({ type: 'error', message: formatAIUserError(error) });
    } finally {
      setAiBusy(false);
    }
  };

  const containerClass = expanded
    ? 'fixed left-20 right-6 top-12 bottom-10'
    : 'fixed bottom-10 right-6 h-[min(78vh,760px)] w-[min(880px,calc(100vw-96px))] min-h-[520px] min-w-[640px] resize';

  return (
    <div className={`${containerClass} z-40 flex flex-col overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl select-text`}>
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--rail-bg)] px-4 py-3 select-none">
        <div className="flex min-w-0 items-center gap-3">
          <span className="font-semibold text-[calc(13px*var(--font-scale))] text-[var(--text-primary)]">
            {isReply ? 'Reply' : 'New Message'}
          </span>
          <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
            {activeDraft.accountId}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => setExpanded(value => !value)}
            title={expanded ? 'Exit expanded compose' : 'Expand compose'}
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            {expanded ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={() => store.setActiveDraft(null)}
            title="Close composer"
            className="rounded-md p-1.5 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {canSwitchAccount && (
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[calc(12px*var(--font-scale))]">
          <span className="w-12 shrink-0 text-[var(--text-secondary)] font-medium select-none">From</span>
          <select
            value={activeDraft.accountId}
            onChange={(event) => updateFromAccount(event.target.value)}
            className="bg-transparent text-[var(--text-primary)] outline-none"
          >
            {store.accounts.map(account => (
              <option key={account.email} value={account.email}>{account.displayName || account.email}</option>
            ))}
          </select>
        </div>
      )}

      <div className="flex items-start border-b border-[var(--border)] pr-4">
        <div className="flex-1">
          <RecipientField
            label="To"
            recipients={activeDraft.to}
            placeholder="Add recipients"
            autoFocus
            suggestions={emailSuggestions}
            excludedEmails={[activeDraft.accountId]}
            onChange={(recipients) => updateRecipients('to', recipients)}
          />
        </div>
        <div className="flex shrink-0 gap-2 pt-3 text-[calc(11px*var(--font-scale))] font-medium select-none">
          {!showCc && (
            <button type="button" onClick={() => setShowCc(true)} className="text-[var(--text-secondary)] hover:text-[var(--accent)]">
              Cc
            </button>
          )}
          {!showBcc && (
            <button type="button" onClick={() => setShowBcc(true)} className="text-[var(--text-secondary)] hover:text-[var(--accent)]">
              Bcc
            </button>
          )}
        </div>
      </div>
      {showCc && (
        <RecipientField
          label="Cc"
          recipients={activeDraft.cc}
          placeholder="Add carbon copy recipients"
          suggestions={emailSuggestions}
          excludedEmails={[activeDraft.accountId]}
          onChange={(recipients) => updateRecipients('cc', recipients)}
        />
      )}
      {showBcc && (
        <RecipientField
          label="Bcc"
          recipients={activeDraft.bcc}
          placeholder="Add blind carbon copy recipients"
          suggestions={emailSuggestions}
          excludedEmails={[activeDraft.accountId]}
          onChange={(recipients) => updateRecipients('bcc', recipients)}
        />
      )}

      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 text-[calc(12px*var(--font-scale))]">
        <span className="w-16 shrink-0 text-[var(--text-secondary)] font-medium select-none">Subject</span>
        <input
          type="text"
          value={activeDraft.subject}
          onChange={(event) => store.updateDraft({ subject: event.target.value })}
          placeholder="Subject"
          className="flex-1 bg-transparent text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>

      <RichTextEditor
        ref={editorRef}
        draftId={`${activeDraft.id}:${activeDraft.accountId}`}
        bodyPlain={activeDraft.bodyPlain}
        bodyHtml={activeDraft.bodyHtml}
        placeholder="Write your email. Use the toolbar, paste an image, or ask AI to draft."
        spellCheck={store.settings.compose.spellCheck}
        onChange={(bodyPlain, bodyHtml) => store.updateDraftBody(bodyPlain, bodyHtml)}
        onImageFile={insertInlineImageFromFile}
      />

      {activeDraft.attachments.length > 0 && (
        <div className="border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-2 select-none">
          <div className="flex flex-wrap gap-1.5">
            {activeDraft.attachments.map(att => (
              <div key={att.id} className="inline-flex max-w-[260px] items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--raised-surface)] px-2.5 py-1 text-[calc(11px*var(--font-scale))]">
                <span className="truncate text-[var(--text-primary)]">{att.isInline ? 'Inline: ' : ''}{att.filename}</span>
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

      {aiOpen && (
        <div className="border-t border-[var(--border)] bg-[var(--raised-surface)] px-4 py-3">
          <textarea
            value={aiInstruction}
            onChange={(event) => setAiInstruction(event.target.value)}
            placeholder="Tell AI what to write or how to improve the selected text."
            rows={2}
            className="w-full resize-none rounded-md border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)]"
          />
          <div className="mt-2 flex justify-end gap-2 select-none">
            <button
              type="button"
              disabled={aiBusy}
              onClick={() => void runAICompose('improve')}
              className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)] disabled:opacity-50"
            >
              Improve selection
            </button>
            <button
              type="button"
              disabled={aiBusy}
              onClick={() => void runAICompose('draft')}
              className="rounded-md bg-[var(--accent)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-white disabled:opacity-50"
            >
              {aiBusy ? 'Writing…' : 'Generate draft'}
            </button>
          </div>
        </div>
      )}

      <div className="flex items-center justify-between border-t border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3 select-none">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void store.sendDraftWithUndo()}
            className="mr-2 inline-flex items-center gap-1.5 rounded-md bg-[var(--accent)] px-4 py-2 text-[calc(12px*var(--font-scale))] font-semibold text-white hover:opacity-95"
          >
            <Send className="h-3.5 w-3.5" />
            Send
          </button>
          <ToolbarButton title="Bold" onClick={() => execute('bold')}><Bold className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Italic" onClick={() => execute('italic')}><Italic className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Underline" onClick={() => execute('underline')}><Underline className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Strikethrough" onClick={() => execute('strikeThrough')}><Strikethrough className="h-4 w-4" /></ToolbarButton>
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
          <ToolbarButton title="Align left" onClick={() => execute('justifyLeft')}><AlignLeft className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Align center" onClick={() => execute('justifyCenter')}><AlignCenter className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Align right" onClick={() => execute('justifyRight')}><AlignRight className="h-4 w-4" /></ToolbarButton>
          <label
            title="Text color"
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <Palette className="h-4 w-4" />
            <input
              type="color"
              className="sr-only"
              onChange={(event) => editorRef.current?.execute('foreColor', event.target.value)}
            />
          </label>
          <ToolbarButton title="Clear formatting" onClick={() => execute('removeFormat')}><Eraser className="h-4 w-4" /></ToolbarButton>
        </div>

        <div className="relative flex items-center gap-1">
          <ToolbarButton title="Attach file" onClick={() => void store.addAttachmentToDraft()}><Paperclip className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Insert inline image" onClick={() => void insertInlineImageFromDialog()}><Image className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="AI compose" onClick={() => setAiOpen(value => !value)}><Sparkles className="h-4 w-4 text-[var(--ai-accent)]" /></ToolbarButton>
          {reminderThread && (
            <div className="relative">
              <ToolbarButton title="Remind me" onClick={() => setReminderOpen(value => !value)}><Clock className="h-4 w-4" /></ToolbarButton>
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
          <ToolbarButton title="Scheduling links" onClick={() => setSchedulingOpen(value => !value)}><CalendarPlus className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Templates and snippets" onClick={() => setTemplatesOpen(value => !value)}><Braces className="h-4 w-4" /></ToolbarButton>
          <ToolbarButton title="Discard draft" onClick={() => store.discardDraft(activeDraft.id)}><Trash2 className="h-4 w-4" /></ToolbarButton>

          {schedulingOpen && (
            <ComposeSchedulingMenu
              onScheduleSend={(date) => void store.scheduleDraftSend(date)}
              onInsertGoogleMeet={() => void insertSchedulingLink('googleMeet')}
              onInsertAvailability={() => void insertAvailability()}
              onInsertCalendly={() => void insertSchedulingLink('calendly')}
              onInsertCalCom={() => void insertSchedulingLink('calCom')}
            />
          )}

          {templatesOpen && (
            <ComposeTemplatesMenu
              templates={store.settings.snippets.templates}
              onInsertDefaultSnippet={insertDefaultSnippet}
              onInsertTemplate={insertSnippetTemplate}
              onSaveBodyAsSnippet={() => void saveCurrentBodyAsSnippet()}
            />
          )}
        </div>
      </div>
    </div>
  );
}
