import { Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';

export function AIPromptShortcutStrip() {
  const store = useAppStore();
  const shortcuts = store.settings.ai.promptShortcuts || [];

  if (shortcuts.length === 0) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--app-bg)] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-[calc(9px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">Prompt Shortcuts</span>
      </div>
      <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-1">
        {shortcuts.map(shortcut => {
          const disabled = store.aiPanelLoading || (shortcut.requiresThread && !store.openedThread);
          return (
            <button
              key={shortcut.id}
              type="button"
              disabled={disabled}
              onClick={() => void store.runAIPromptShortcut(shortcut)}
              title={shortcut.requiresThread && !store.openedThread ? 'Open a thread first' : shortcut.instruction}
              className="flex min-w-0 max-w-full items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--panel-bg)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)] hover:border-[var(--ai-accent)]/50 hover:bg-[var(--ai-accent)]/8 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ai-accent)]"
            >
              <Sparkles className="h-3 w-3 shrink-0 text-[var(--ai-accent)]" />
              <span className="truncate">{shortcut.title}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
