import { useAppStore } from '../../stores/AppStore';
import { hintsForContext } from '../../../../shared/shortcutHints';

export function BottomShortcutBar() {
  const store = useAppStore();

  if (!store.settings.general.showBottomShortcutBar) return null;

  if (store.workspaceView === 'calendar') {
    return (
      <div className="h-[var(--bottom-bar-h)] min-h-[24px] shrink-0 border-t border-[var(--border)] bg-[var(--rail-bg)] px-4 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
        <div className="flex h-full items-center gap-3.5 overflow-hidden">
          <span><kbd className="rounded bg-[var(--border)] px-1 font-mono">N</kbd> New event</span>
          <span><kbd className="rounded bg-[var(--border)] px-1 font-mono">T</kbd> Today</span>
          <span><kbd className="rounded bg-[var(--border)] px-1 font-mono">← →</kbd> Navigate</span>
          <span><kbd className="rounded bg-[var(--border)] px-1 font-mono">1–6</kbd> Change view</span>
          <span><kbd className="rounded bg-[var(--border)] px-1 font-mono">/</kbd> Search</span>
        </div>
      </div>
    );
  }

  const ctx = store.activeDraft && !store.activeDraft.threadId ? 'compose'
    : store.openedThread ? 'reader'
    : store.searchQuery ? 'search' : 'list';
  const hints = hintsForContext(ctx, store.settings.shortcuts);

  return (
    <div className="h-[var(--bottom-bar-h)] min-h-[24px] bg-[var(--rail-bg)] border-t border-[var(--border)] flex items-center justify-between px-4 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] select-none gap-4 shrink-0">
      <div className="flex items-center gap-3.5 overflow-hidden">
        {hints.map((h: any, i: number) => (
          <span key={i} className="flex items-center gap-1 whitespace-nowrap shrink-0">
            <kbd className="bg-[var(--border)] px-1 rounded font-mono">{h.keys}</kbd> {h.label}
          </span>
        ))}
      </div>
      <div className="shrink-0">
        <span>
          <kbd className="bg-[var(--border)] px-1 rounded font-mono font-semibold">⌘J</kbd> AI
          {store.settings.shortcuts.commandPaletteEnabled && (
            <>
              <span className="px-1.5 text-[var(--text-tertiary)]">·</span>
              <kbd className="bg-[var(--border)] px-1 rounded font-mono font-semibold">⌘K</kbd> Commands
            </>
          )}
        </span>
      </div>
    </div>
  );
}
