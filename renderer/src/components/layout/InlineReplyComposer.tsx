import { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { X, ExternalLink, Calendar, Braces, Paperclip, Trash2 } from 'lucide-react';
import { compileMarkdownToHtml } from '../../../../shared/markdown';
import { expandSnippetAtCursor, renderDefaultSnippet } from '../../../../shared/snippets';
import { emitToast } from '../../lib/toastBus';

export function InlineReplyComposer() {
  const store = useAppStore();
  const [composeBody, setComposeBody] = useState('');
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');
  const inlineReplyRef = useRef<HTMLTextAreaElement>(null);
  const lastDraftIdRef = useRef<string | null>(null);

  // Sync draft local state to fields when activeDraft changes
  useEffect(() => {
    if (store.activeDraft) {
      setComposeBody(store.activeDraft.bodyPlain);

      const isNewDraft = store.activeDraft.id !== lastDraftIdRef.current;
      if (isNewDraft) {
        lastDraftIdRef.current = store.activeDraft.id;
        setTimeout(() => {
          if (inlineReplyRef.current) {
            inlineReplyRef.current.focus();
            inlineReplyRef.current.setSelectionRange(0, 0);
            // Scroll to composer
            inlineReplyRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          }
        }, 50);
      }
    }
  }, [store.activeDraft]);

  if (!store.activeDraft || store.activeDraft.threadId !== store.openedThread?.id) {
    return null;
  }

  const toEmails = store.activeDraft.to.map(r => r.email).join(', ');

  return (
    <div className="bg-[var(--raised-surface)] border border-[var(--border)] rounded-[8px] shadow-[0_4px_12px_rgba(0,0,0,0.05)] overflow-hidden mt-6 flex flex-col transition-all duration-200 shrink-0">
      {/* Header: Draft to [recipient] + Actions (Preview Toggle, Popout) */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]/40 bg-[var(--panel-bg)]/30 select-none">
        <div className="flex items-center gap-1.5 text-[calc(12px*var(--font-scale))] min-w-0">
          <span className="text-[var(--success)] font-semibold shrink-0">Draft</span>
          <span className="text-[var(--text-secondary)] shrink-0">to</span>
          <span className="text-[var(--text-primary)] font-medium truncate max-w-[280px] sm:max-w-[420px]" title={toEmails}>
            {toEmails}
          </span>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setEditorTab(editorTab === 'write' ? 'preview' : 'write')}
            className="text-[calc(10px*var(--font-scale))] font-semibold tracking-wider uppercase text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer px-2 py-0.5 rounded bg-[var(--hover-row)]/40 hover:bg-[var(--hover-row)]"
          >
            {editorTab === 'write' ? 'Preview' : 'Edit'}
          </button>
          <button
            onClick={() => {
              store.setActiveDraft({ ...store.activeDraft!, threadId: null });
            }}
            title="Popout draft to compose window"
            className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-tertiary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <ExternalLink className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Editor Textarea or HTML Preview */}
      <div className="flex-1 flex flex-col bg-[var(--panel-bg)]">
        {editorTab === 'write' ? (
          <textarea
            ref={inlineReplyRef}
            rows={5}
            placeholder="Tip: Hit ⌘J for AI"
            className="w-full bg-transparent border-0 outline-none focus:outline-none focus:ring-0 p-4 text-[calc(13px*var(--font-scale))] text-[var(--text-primary)] placeholder-[var(--text-tertiary)] resize-none leading-relaxed"
            value={composeBody}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey && store.settings.snippets.enabled && store.settings.snippets.expandWithTab) {
                const ta = e.currentTarget;
                const result = expandSnippetAtCursor(composeBody, ta.selectionStart ?? composeBody.length, store.settings.snippets, store.settings.compose, store.settings.profile);
                if (result) {
                  e.preventDefault();
                  setComposeBody(result.text);
                  store.updateDraftBody(result.text);
                  requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = result.selection; } catch { /* noop */ } });
                }
              }
            }}
            onChange={(e) => {
              setComposeBody(e.target.value);
              store.updateDraftBody(e.target.value);
            }}
          />
        ) : (
          <div className="w-full min-h-[120px] bg-transparent p-4 text-[var(--text-primary)] text-[calc(13px*var(--font-scale))] overflow-y-auto leading-relaxed select-text">
            <div dangerouslySetInnerHTML={{ __html: compileMarkdownToHtml(composeBody) }} />
          </div>
        )}

        {/* Trimmed content / Signature button (Three dots '...') */}
        <div className="px-4 pb-3 text-left">
          <button
            onClick={() => {
              const snip = renderDefaultSnippet(store.settings.snippets, store.settings.compose, store.settings.profile);
              if (snip) {
                const hasSnip = composeBody.includes(snip);
                const next = hasSnip 
                  ? composeBody.replace(`\n\n${snip}`, '').replace(snip, '') 
                  : (composeBody ? `${composeBody}\n\n${snip}` : snip);
                setComposeBody(next);
                store.updateDraftBody(next);
              } else {
                emitToast({ type: 'info', message: 'No signature configured in settings' });
              }
            }}
            title="Toggle signature"
            className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-tertiary)] hover:text-[var(--text-secondary)] bg-[var(--hover-row)]/40 hover:bg-[var(--hover-row)] px-2 py-0.5 rounded transition-all cursor-pointer select-none"
          >
            ...
          </button>
        </div>
      </div>

      {/* Attachments Section */}
      {store.activeDraft.attachments && store.activeDraft.attachments.length > 0 && (
        <div className="flex flex-col gap-1.5 px-4 py-2 bg-[var(--panel-bg)] border-t border-[var(--border)]/40">
          <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)] uppercase tracking-wider">Attachments:</span>
          <div className="flex flex-wrap gap-1.5">
            {store.activeDraft.attachments.map(att => (
              <div key={att.id} className="flex items-center gap-1.5 px-2.5 py-1 bg-[var(--app-bg)] border border-[var(--border)] rounded-[6px]">
                <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] max-w-[150px] truncate">{att.filename}</span>
                <button
                  onClick={() => store.removeAttachmentFromDraft(att.id)}
                  className="text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer p-0.5 rounded hover:bg-[var(--hover-row)]"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer Actions */}
      <div className="flex items-center justify-between px-4 py-3 border-t border-[var(--border)]/40 bg-[var(--panel-bg)]/40 select-none">
        {/* Left: text actions */}
        <div className="flex items-center">
          <button
            onClick={() => store.sendDraftWithUndo()}
            className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:opacity-85 active:scale-95 transition-all cursor-pointer"
          >
            Send
          </button>
          <button
            onClick={() => emitToast({ type: 'info', message: 'Scheduled to send later' })}
            className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-5 transition-colors cursor-pointer"
          >
            Send later
          </button>
          <button
            onClick={() => emitToast({ type: 'info', message: 'Reminder scheduled' })}
            className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-5 transition-colors cursor-pointer"
          >
            Remind me
          </button>
          <button
            onClick={() => emitToast({ type: 'info', message: 'Draft link copied to clipboard' })}
            className="text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)] hover:text-[var(--text-primary)] ml-5 transition-colors cursor-pointer"
          >
            Share draft
          </button>
        </div>

        {/* Right: icon actions */}
        <div className="flex items-center gap-3.5">
          <button
            onClick={() => store.setAiPanelOpen(!store.aiPanelOpen)}
            title="AI Assistant (⌘J)"
            className="font-mono text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer px-1 py-0.5 rounded hover:bg-[var(--hover-row)] transition-colors"
          >
            ai
          </button>
          <button
            onClick={() => emitToast({ type: 'info', message: 'Scheduling settings opened' })}
            title="Schedule"
            className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Calendar className="w-4 h-4" />
          </button>
          <button
            onClick={() => {
              const snip = renderDefaultSnippet(store.settings.snippets, store.settings.compose, store.settings.profile);
              if (snip) {
                const next = composeBody ? `${composeBody}\n\n${snip}` : snip;
                setComposeBody(next);
                store.updateDraftBody(next);
              } else {
                emitToast({ type: 'info', message: 'No default snippet configured' });
              }
            }}
            title="Insert default snippet / signature"
            className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Braces className="w-4 h-4" />
          </button>
          <button
            onClick={() => store.addAttachmentToDraft()}
            title="Attach File"
            className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors cursor-pointer"
          >
            <Paperclip className="w-4 h-4" />
          </button>
          <button
            onClick={() => store.discardDraft(store.activeDraft!.id)}
            title="Discard Draft"
            className="p-1 rounded hover:bg-[var(--hover-row)] text-[var(--text-secondary)] hover:text-[var(--danger)] transition-colors cursor-pointer"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
