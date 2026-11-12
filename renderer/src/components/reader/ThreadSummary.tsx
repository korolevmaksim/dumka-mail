import { useEffect } from 'react';
import { Sparkles } from 'lucide-react';
import { shouldSummarizeThread } from '../../../../shared/agentPrompts';
import type { MailThread } from '../../../../shared/types';
import { useAppStore } from '../../stores/AppStore';
import { useAgentPrep } from '../../stores/useAgentPrep';

interface ThreadSummaryProps {
  thread: MailThread;
}

/**
 * Agent summary above a long thread (SPEC §3, §5): 2–4 bullets, streamed in.
 * Requested on mount for threads with more than 5 messages when a model is
 * configured; renders nothing on error, when refused, or without a model.
 */
export function ThreadSummary({ thread }: ThreadSummaryProps) {
  const { openedThread, openedThreadMessages, openedThreadMessagesStatus } = useAppStore();
  const { modelStatus, getThreadSummary, requestThreadSummary } = useAgentPrep();

  // The open thread's loaded messages tell the length without a round trip
  // (wait until they are loaded); for any other thread the main process
  // checks the length itself.
  const isOpenThread = openedThread?.id === thread.id && openedThread.accountId === thread.accountId;
  const longEnough = !isOpenThread || (openedThreadMessagesStatus === 'ready'
    && shouldSummarizeThread(openedThreadMessages.filter(message => message.threadId === thread.id).length));
  const eligible = modelStatus !== 'none' && longEnough;
  const lastMessageId = thread.signals?.lastMessageId || '';

  useEffect(() => {
    if (eligible) requestThreadSummary(thread);
    // Re-request only for a different thread or a new last message.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [eligible, thread.accountId, thread.id, lastMessageId, requestThreadSummary]);

  if (!eligible) return null;
  const summary = getThreadSummary(thread);
  if (summary.status === 'idle' || summary.status === 'error') return null;
  if (summary.status === 'loading' && summary.bullets.length === 0) {
    return (
      <p
        className="flex items-center gap-1.5 px-1 py-1 text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]"
        role="status"
        aria-live="polite"
      >
        <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--ai-accent)]" />
        Summarising…
      </p>
    );
  }

  return (
    <section
      aria-label="Thread summary"
      aria-busy={summary.status === 'loading'}
      className="flex gap-2 rounded-[var(--control-radius)] border border-[var(--border)] bg-[var(--panel-bg)] px-3 py-2"
    >
      <Sparkles aria-hidden="true" className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[var(--ai-accent)]" />
      <ul className="flex min-w-0 flex-1 list-disc flex-col gap-0.5 pl-4 text-[calc(12px*var(--font-scale))] leading-snug text-[var(--text-primary)] marker:text-[var(--text-tertiary)]">
        {summary.bullets.map((bullet, index) => (
          <li key={index} className="select-text">{bullet}</li>
        ))}
      </ul>
    </section>
  );
}
