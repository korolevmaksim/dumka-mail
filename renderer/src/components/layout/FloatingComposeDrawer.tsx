import { useState, useEffect } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { X, Paperclip } from 'lucide-react';
import { compileDraftBodyHtml } from '../../../../shared/draftHtml';
import { expandSnippetAtCursor } from '../../../../shared/snippets';

export function FloatingComposeDrawer() {
  const store = useAppStore();
  const [composeBody, setComposeBody] = useState('');
  const [composeTo, setComposeTo] = useState('');
  const [composeSubject, setComposeSubject] = useState('');
  const [editorTab, setEditorTab] = useState<'write' | 'preview'>('write');

  // Sync draft local state to fields when activeDraft changes
  useEffect(() => {
    if (store.activeDraft && !store.activeDraft.threadId) {
      setComposeBody(store.activeDraft.bodyPlain);
      setComposeTo(store.activeDraft.to.map(r => r.email).join(', '));
      setComposeSubject(store.activeDraft.subject || '');
    }
  }, [store.activeDraft]);

  if (!store.activeDraft || store.activeDraft.threadId) {
    return null;
  }

  const activeDraft = store.activeDraft;

  return (
    <div className="absolute bottom-10 right-6 w-[540px] bg-[var(--panel-bg)] border border-[var(--strong-border)] rounded-xl shadow-2xl flex flex-col z-40 overflow-hidden select-text">
      <div className="flex justify-between items-center bg-[var(--rail-bg)] px-4 py-3 border-b border-[var(--border)] select-none">
        <span className="font-semibold text-[calc(13px*var(--font-scale))] text-[var(--text-primary)]">New Message</span>
        <button 
          onClick={() => store.setActiveDraft(null)} 
          className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] cursor-pointer"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
      
      <div className="flex flex-col p-4 gap-3">
        {/* To field */}
        <div className="flex items-center border-b border-[var(--border)] pb-2 gap-2 text-[calc(12px*var(--font-scale))]">
          <span className="text-[var(--text-secondary)] font-medium w-16 select-none">To:</span>
          <input
            type="text"
            placeholder="recipients@email.com (comma separated)"
            value={composeTo}
            onChange={(e) => {
              setComposeTo(e.target.value);
              store.saveDraftLocally(composeBody, e.target.value, composeSubject);
            }}
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] font-sans"
          />
        </div>
        
        {/* Subject field */}
        <div className="flex items-center border-b border-[var(--border)] pb-2 gap-2 text-[calc(12px*var(--font-scale))]">
          <span className="text-[var(--text-secondary)] font-medium w-16 select-none">Subject:</span>
          <input
            type="text"
            placeholder="Subject"
            value={composeSubject}
            onChange={(e) => {
              setComposeSubject(e.target.value);
              store.saveDraftLocally(composeBody, composeTo, e.target.value);
            }}
            className="flex-1 bg-transparent border-none outline-none text-[var(--text-primary)] font-sans"
          />
        </div>

        {/* Markdown Tabs (Write / Preview) */}
        <div className="flex border-b border-[var(--border)] text-[calc(11px*var(--font-scale))] gap-2 select-none">
          <button
            onClick={() => setEditorTab('write')}
            className={`pb-1 border-b-2 px-1 cursor-pointer transition-colors ${editorTab === 'write' ? 'border-[var(--accent)] text-[var(--accent)] font-semibold' : 'border-transparent text-[var(--text-secondary)]'}`}
          >
            Write (Markdown)
          </button>
          <button
            onClick={() => setEditorTab('preview')}
            className={`pb-1 border-b-2 px-1 cursor-pointer transition-colors ${editorTab === 'preview' ? 'border-[var(--accent)] text-[var(--accent)] font-semibold' : 'border-transparent text-[var(--text-secondary)]'}`}
          >
            Preview
          </button>
        </div>

        {/* Content area */}
        {editorTab === 'write' ? (
          <textarea
            rows={10}
            placeholder="Write your email in Markdown — press Tab to expand a snippet…"
            value={composeBody}
            onKeyDown={(e) => {
              if (e.key === 'Tab' && !e.shiftKey && store.settings.snippets.enabled && store.settings.snippets.expandWithTab) {
                const ta = e.currentTarget;
                const result = expandSnippetAtCursor(composeBody, ta.selectionStart ?? composeBody.length, store.settings.snippets, store.settings.compose, store.settings.profile, activeDraft.accountId);
                if (result) {
                  e.preventDefault();
                  setComposeBody(result.text);
                  store.saveDraftLocally(result.text, composeTo, composeSubject);
                  requestAnimationFrame(() => { try { ta.selectionStart = ta.selectionEnd = result.selection; } catch { /* noop */ } });
                }
              }
            }}
            onChange={(e) => {
              setComposeBody(e.target.value);
              store.saveDraftLocally(e.target.value, composeTo, composeSubject);
            }}
            className="w-full bg-[var(--app-bg)] border border-[var(--border)] rounded-lg p-3 outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)] focus:outline-offset-1 text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] resize-none font-sans"
          />
        ) : (
          <div className="w-full h-[180px] overflow-y-auto bg-[var(--app-bg)] border border-[var(--border)] rounded-lg p-3 text-[var(--text-primary)] text-[calc(12px*var(--font-scale))]">
            <div dangerouslySetInnerHTML={{ __html: compileDraftBodyHtml(composeBody, store.settings.compose, activeDraft.accountId) }} />
          </div>
        )}

        {/* Attachments Section */}
        {store.activeDraft.attachments && store.activeDraft.attachments.length > 0 && (
          <div className="flex flex-col gap-1 border-t border-[var(--border)] pt-2.5">
            <span className="text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)] select-none">Attachments:</span>
            <div className="flex flex-wrap gap-1.5">
              {store.activeDraft.attachments.map(att => (
                <div key={att.id} className="flex items-center gap-1.5 px-2 py-0.5 bg-[var(--app-bg)] border border-[var(--border)] rounded">
                  <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] max-w-[140px] truncate">{att.filename}</span>
                  <button
                    onClick={() => store.removeAttachmentFromDraft(att.id)}
                    className="text-[var(--text-secondary)] hover:text-[var(--danger)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer buttons */}
        <div className="flex justify-between items-center mt-2.5 select-none">
          <button
            onClick={() => store.addAttachmentToDraft()}
            className="flex items-center gap-1.5 px-3 py-1.5 border border-[var(--border)] text-[var(--text-primary)] hover:border-[var(--strong-border)] rounded text-[calc(11px*var(--font-scale))] cursor-pointer"
          >
            <Paperclip className="w-3.5 h-3.5" /> Attach File
          </button>

          <div className="flex gap-2">
            <button
              onClick={() => store.setActiveDraft(null)}
              className="px-3 py-1.5 border border-[var(--border)] text-[var(--text-secondary)] rounded font-medium cursor-pointer hover:text-[var(--text-primary)] text-[calc(11px*var(--font-scale))]"
            >
              Discard
            </button>
            <button
              onClick={() => store.sendDraftWithUndo()}
              className="px-4 py-1.5 bg-[var(--accent)] text-white rounded font-medium cursor-pointer hover:bg-[var(--accent)]/95 text-[calc(11px*var(--font-scale))]"
            >
              Send Message
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
