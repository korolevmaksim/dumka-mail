import { useAppStore } from '../../stores/AppStore';
import { hintsForContext } from '../../../../shared/shortcutHints';

export function BottomShortcutBar() {
  const store = useAppStore();

  if (!store.settings.general.showBottomShortcutBar) return null;

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
        <span>Press <kbd className="bg-[var(--border)] px-1 rounded font-mono font-semibold">⌘K</kbd> for commands</span>
      </div>
    </div>
  );
}
