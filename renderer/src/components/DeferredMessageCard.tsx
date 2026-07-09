import { memo, useEffect, useRef, useState } from 'react';
import type { MailMessage } from '../../../shared/types';
import { MessageCard } from './MessageCard';

interface DeferredMessageCardProps {
  message: MailMessage;
  defaultLoadImages: boolean;
}

export const DeferredMessageCard = memo(function DeferredMessageCard({ message, defaultLoadImages }: DeferredMessageCardProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [shouldRender, setShouldRender] = useState(false);

  useEffect(() => {
    setShouldRender(false);
    const element = containerRef.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setShouldRender(true);
      return;
    }

    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting)) return;
      setShouldRender(true);
      observer.disconnect();
    }, { rootMargin: '600px 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [message.id]);

  return (
    <div ref={containerRef} data-message-id={message.id}>
      {shouldRender ? (
        <MessageCard msg={message} defaultLoadImages={defaultLoadImages} />
      ) : (
        <div
          aria-label="Message content will render when visible"
          className="h-28 animate-pulse rounded-[6px] border border-[var(--border)] bg-[var(--raised-surface)] motion-reduce:animate-none"
        />
      )}
    </div>
  );
});
