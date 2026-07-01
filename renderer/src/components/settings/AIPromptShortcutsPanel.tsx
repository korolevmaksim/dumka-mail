import { useState } from 'react';
import { Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { Toggle } from './SettingsControls';
import { emitToast } from '../../lib/toastBus';
import type { AIPromptShortcut } from '../../../../shared/types';

interface ShortcutDraft {
  id?: string;
  title: string;
  instruction: string;
  requiresThread: boolean;
}

function emptyDraft(): ShortcutDraft {
  return {
    title: '',
    instruction: '',
    requiresThread: true,
  };
}

function draftFromShortcut(shortcut: AIPromptShortcut): ShortcutDraft {
  return {
    id: shortcut.id,
    title: shortcut.title,
    instruction: shortcut.instruction,
    requiresThread: shortcut.requiresThread,
  };
}

export function AIPromptShortcutsPanel() {
  const store = useAppStore();
  const shortcuts = store.settings.ai.promptShortcuts || [];
  const [draft, setDraft] = useState<ShortcutDraft | null>(null);

  const saveDraft = () => {
    if (!draft) return;
    const title = draft.title.trim();
    const instruction = draft.instruction.trim();

    if (!title || !instruction) {
      emitToast({ type: 'warning', message: 'Add both a title and a prompt.' });
      return;
    }

    const shortcut: AIPromptShortcut = {
      id: draft.id || crypto.randomUUID(),
      title,
      instruction,
      requiresThread: draft.requiresThread,
    };

    void store.updateSettings(settings => {
      const current = settings.ai.promptShortcuts || [];
      settings.ai.promptShortcuts = draft.id
        ? current.map(item => item.id === draft.id ? shortcut : item)
        : [...current, shortcut];
    });
    setDraft(null);
  };

  const deleteShortcut = (shortcut: AIPromptShortcut) => {
    if (!window.confirm(`Delete "${shortcut.title}"?`)) return;
    void store.updateSettings(settings => {
      settings.ai.promptShortcuts = (settings.ai.promptShortcuts || []).filter(item => item.id !== shortcut.id);
    });
    if (draft?.id === shortcut.id) {
      setDraft(null);
    }
  };

  return (
    <div className="border border-[var(--border)] rounded-lg p-4 bg-[var(--rail-bg)] flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-col gap-0.5 min-w-0">
          <span className="text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">AI Prompt Shortcuts</span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] font-normal">Reusable assistant prompts shown in the AI panel</span>
        </div>
        <button
          type="button"
          onClick={() => setDraft(emptyDraft())}
          title="New prompt shortcut"
          className="flex h-7 items-center gap-1.5 rounded border border-[var(--border)] px-2 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--strong-border)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <Plus className="h-3.5 w-3.5" />
          New
        </button>
      </div>

      <div className="flex flex-col divide-y divide-[var(--border)]/50">
        {shortcuts.length === 0 ? (
          <span className="py-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No prompt shortcuts configured.</span>
        ) : (
          shortcuts.map(shortcut => (
            <div key={shortcut.id} className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-[calc(11px*var(--font-scale))] font-medium text-[var(--text-primary)]">{shortcut.title}</span>
                  <span className="shrink-0 rounded border border-[var(--border)] px-1.5 py-0.5 text-[calc(8px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                    {shortcut.requiresThread ? 'Thread' : 'General'}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-[calc(9px*var(--font-scale))] leading-snug text-[var(--text-secondary)]">
                  {shortcut.instruction}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() => setDraft(draftFromShortcut(shortcut))}
                  title="Edit prompt shortcut"
                  className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
                >
                  <Pencil className="h-3.5 w-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => deleteShortcut(shortcut)}
                  title="Delete prompt shortcut"
                  className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--danger)]/10 hover:text-[var(--danger)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--danger)]"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {draft && (
        <div className="flex flex-col gap-2 border-t border-[var(--border)] pt-3">
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <label className="text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)]">Title</label>
            <input
              type="text"
              value={draft.title}
              onChange={event => setDraft(current => current ? { ...current, title: event.target.value } : current)}
              placeholder="Explain Request"
              className="min-w-0 rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)]"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-start gap-2">
            <label className="pt-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)]">Prompt</label>
            <textarea
              value={draft.instruction}
              onChange={event => setDraft(current => current ? { ...current, instruction: event.target.value } : current)}
              placeholder="Explain what the sender wants, who they are, why it matters, and what I should do next."
              className="min-h-[92px] min-w-0 resize-y rounded border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5 text-[calc(11px*var(--font-scale))] leading-normal text-[var(--text-primary)] outline-none focus:outline focus:outline-2 focus:outline-[var(--accent)]"
            />
          </div>
          <div className="grid grid-cols-[120px_1fr] items-center gap-2">
            <span className="text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)]">Open thread</span>
            <div className="flex items-center gap-2">
              <Toggle
                checked={draft.requiresThread}
                onChange={value => setDraft(current => current ? { ...current, requiresThread: value } : current)}
              />
              <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                {draft.requiresThread ? 'Required' : 'Not required'}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="flex items-center gap-1.5 rounded border border-[var(--border)] px-2.5 py-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              type="button"
              onClick={saveDraft}
              className="flex items-center gap-1.5 rounded bg-[var(--accent)] px-2.5 py-1 text-[calc(10px*var(--font-scale))] font-medium text-white hover:bg-[var(--accent)]/95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
            >
              <Save className="h-3.5 w-3.5" />
              Save
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
