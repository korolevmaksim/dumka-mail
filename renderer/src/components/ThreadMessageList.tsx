import { memo, useEffect, useMemo, useState } from 'react';
import type { MailMessage } from '../../../shared/types';
import type { ThreadHeaderMessagesStatus } from '../lib/threadHeader';
import { DeferredMessageCard } from './DeferredMessageCard';
import {
  EARLIER_MESSAGE_BATCH_SIZE,
  initialMessageWindowStart,
  revealEarlierMessageWindowStart,
} from '../lib/threadMessageWindow';

interface ThreadMessageListProps {
  threadKey: string;
  messages: MailMessage[];
  status: ThreadHeaderMessagesStatus;
  defaultLoadImages: boolean;
}

export const ThreadMessageList = memo(function ThreadMessageList({
  threadKey,
  messages,
  status,
  defaultLoadImages,
}: ThreadMessageListProps) {
  const [visibleStart, setVisibleStart] = useState(() => initialMessageWindowStart(messages.length));
  const [isExpanding, setIsExpanding] = useState(false);

  useEffect(() => {
    setVisibleStart(initialMessageWindowStart(messages.length));
    setIsExpanding(false);
  }, [messages.length, threadKey]);

  const visibleMessages = useMemo(() => messages.slice(visibleStart), [messages, visibleStart]);
  const earlierCount = visibleStart;

  const revealEarlierMessages = () => {
    const reader = document.getElementById('thread-reader-pane');
    const previousHeight = reader?.scrollHeight || 0;
    const previousTop = reader?.scrollTop || 0;
    setIsExpanding(true);
    setVisibleStart(revealEarlierMessageWindowStart);
    globalThis.requestAnimationFrame(() => {
      globalThis.requestAnimationFrame(() => {
        if (reader) {
          reader.scrollTop = previousTop + Math.max(0, reader.scrollHeight - previousHeight);
        }
        setIsExpanding(false);
      });
    });
  };

  if (status === 'loading' || (status !== 'ready' && messages.length === 0)) {
    return (
      <div aria-busy="true" aria-label="Loading conversation" className="flex flex-col gap-4">
        {[0, 1, 2].map(index => (
          <div
            key={index}
            className="h-32 animate-pulse rounded-[6px] border border-[var(--border)] bg-[var(--raised-surface)] motion-reduce:animate-none"
          />
        ))}
      </div>
    );
  }

  if (messages.length === 0) {
    return (
      <div role="status" className="py-10 text-center text-[var(--text-secondary)]">
        No cached message content is available for this conversation.
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 select-text" aria-busy={isExpanding}>
      {earlierCount > 0 && (
        <button
          type="button"
          onClick={revealEarlierMessages}
          className="mx-auto rounded-full border border-[var(--border)] bg-[var(--raised-surface)] px-4 py-2 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)] transition-colors hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]"
        >
          {isExpanding ? 'Rendering messages…' : `Show ${Math.min(EARLIER_MESSAGE_BATCH_SIZE, earlierCount)} of ${earlierCount} earlier messages`}
        </button>
      )}
      {visibleMessages.map(message => (
        <DeferredMessageCard
          key={message.id}
          message={message}
          defaultLoadImages={defaultLoadImages}
        />
      ))}
    </div>
  );
});
