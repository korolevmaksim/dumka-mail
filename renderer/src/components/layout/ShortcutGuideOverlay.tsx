import { Keyboard, X } from 'lucide-react';
import { shortcutGuideSections } from '../../../../shared/shortcutGuide';
import type { ShortcutSettings } from '../../../../shared/types';

interface ShortcutGuideOverlayProps {
  isOpen: boolean;
  settings: ShortcutSettings;
  onClose: () => void;
}

export function ShortcutGuideOverlay({ isOpen, settings, onClose }: ShortcutGuideOverlayProps) {
  if (!isOpen) return null;

  const sections = shortcutGuideSections(settings);

  return (
    <div className="absolute inset-0 z-[70] flex items-start justify-center bg-black/40 px-4 pt-16 select-none">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcut-guide-title"
        className="flex max-h-[min(760px,calc(100vh-96px))] w-[min(860px,calc(100vw-32px))] flex-col overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl"
      >
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--accent)]/12 text-[var(--accent)]">
              <Keyboard className="h-4 w-4" />
            </span>
            <div>
              <h2 id="shortcut-guide-title" className="text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
                Keyboard Shortcuts
              </h2>
              <p className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                {settings.mode === 'appleMail' ? 'Apple Mail mode' : settings.mode === 'gmail' ? 'Gmail mode' : 'Superhuman mode'}
              </p>
            </div>
          </div>
          <button
            type="button"
            title="Close"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-md text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 overflow-y-auto p-4 md:grid-cols-2">
          {sections.map(section => (
            <section key={section.title} className="min-w-0">
              <h3 className="mb-2 text-[calc(11px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]">
                {section.title}
              </h3>
              <div className="overflow-hidden rounded-lg border border-[var(--border)]">
                {section.items.map(item => (
                  <div key={`${section.title}:${item.label}`} className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2 last:border-b-0">
                    <span className="min-w-0 truncate text-[calc(12px*var(--font-scale))] text-[var(--text-primary)]">{item.label}</span>
                    <kbd className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                      {item.keys}
                    </kbd>
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
