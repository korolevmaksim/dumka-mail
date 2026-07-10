import { useCallback, useEffect, useRef, useState } from 'react';
import { Archive, ChevronLeft, ChevronRight, MailMinus, RefreshCw, UserMinus, X } from 'lucide-react';
import type { MailMessage, SenderCleanupStat } from '../../../shared/types';
import { MessageCard } from './MessageCard';
import { useDialogFocus } from '../hooks/useDialogFocus';

const PREVIEW_MESSAGE_LIMIT = 3;

interface CleanupSenderPreviewProps {
  stat: SenderCleanupStat;
  canArchive: boolean;
  canUnsubscribe: boolean;
  archiveCount: number;
  unsubscribeBusy: boolean;
  excludeBusy: boolean;
  onArchive: () => void;
  onUnsubscribe: () => void;
  onExclude: () => void;
  onClose: () => void;
}

export function CleanupSenderPreview({
  stat,
  canArchive,
  canUnsubscribe,
  archiveCount,
  unsubscribeBusy,
  excludeBusy,
  onArchive,
  onUnsubscribe,
  onExclude,
  onClose,
}: CleanupSenderPreviewProps) {
  const [messages, setMessages] = useState<MailMessage[] | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  const loadMessages = useCallback(async () => {
    setMessages(null);
    setActiveIndex(0);
    setError(null);
    try {
      const latest = await window.electronAPI.listRecentSenderMessages(
        stat.accountId,
        stat.senderEmail,
        PREVIEW_MESSAGE_LIMIT,
      );
      setMessages(latest);
    } catch (loadError) {
      console.error('Cleanup sender preview failed:', loadError);
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    }
  }, [stat.accountId, stat.senderEmail]);

  useEffect(() => {
    void loadMessages();
  }, [loadMessages]);

  useDialogFocus(dialogRef, closeButtonRef, onClose);

  const activeMessage = messages?.[activeIndex] || null;

  return (
    <div className="absolute inset-0 z-40 flex justify-end bg-black/15" role="presentation">
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="cleanup-preview-title"
        className="flex h-full w-[min(760px,76vw)] min-w-[460px] flex-col border-l border-[var(--border)] bg-[var(--panel-bg)] shadow-[-6px_0_12px_rgba(0,0,0,0.08)]"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <div className="min-w-0">
            <h2 id="cleanup-preview-title" className="truncate text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
              Recent mail from {stat.senderName || stat.senderEmail}
            </h2>
            <p className="mt-0.5 truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
              {stat.senderEmail} · locally cached messages
            </p>
          </div>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            aria-label="Close sender preview"
            title="Close sender preview (Esc)"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2">
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            {messages && messages.length > 0 ? `${activeIndex + 1} of ${messages.length} newest` : 'Newest cached messages'}
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              disabled={!messages || activeIndex >= messages.length - 1}
              onClick={() => setActiveIndex(index => Math.min((messages?.length || 1) - 1, index + 1))}
              title="Show older message"
              className="rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              disabled={activeIndex === 0}
              onClick={() => setActiveIndex(index => Math.max(0, index - 1))}
              title="Show newer message"
              className="rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-35"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {messages === null && !error && (
            <div className="skeleton h-40" aria-label="Loading recent sender messages" />
          )}
          {error && (
            <div className="flex flex-col items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
              <span>Could not load recent messages: {error}</span>
              <button type="button" onClick={() => void loadMessages()} className="flex items-center gap-1 rounded border border-[var(--danger)]/40 px-2 py-1 font-semibold">
                <RefreshCw className="h-3 w-3" /> Retry
              </button>
            </div>
          )}
          {messages && messages.length === 0 && (
            <div className="rounded-lg border border-[var(--border)] p-4 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
              No locally cached messages are available for this sender.
            </div>
          )}
          {activeMessage && <MessageCard msg={activeMessage} defaultLoadImages={false} />}
        </div>

        <footer className="flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-4 py-3">
          {canArchive && (
            <button type="button" onClick={onArchive} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)]">
              <Archive className="h-3 w-3" /> Archive old ({archiveCount})
            </button>
          )}
          {canUnsubscribe && (
            <button type="button" disabled={unsubscribeBusy} onClick={onUnsubscribe} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:text-[var(--text-primary)] disabled:opacity-40">
              <MailMinus className="h-3 w-3" /> {unsubscribeBusy ? 'Resolving…' : 'Unsubscribe'}
            </button>
          )}
          <button type="button" disabled={excludeBusy} onClick={onExclude} className="ml-auto flex items-center gap-1 rounded px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] disabled:opacity-40">
            <UserMinus className="h-3 w-3" /> {excludeBusy ? 'Excluding…' : 'Exclude from Cleanup'}
          </button>
        </footer>
      </section>
    </div>
  );
}
