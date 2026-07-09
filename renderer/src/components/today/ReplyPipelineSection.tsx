import { useMemo, useState } from 'react';
import { Check, Clock3, ExternalLink, LoaderCircle, MailPlus, PauseCircle, RefreshCw, X } from 'lucide-react';
import type { ReplyPipelineState } from '../../../../shared/types';
import { emitToast } from '../../lib/toastBus';
import { useAppStore } from '../../stores/AppStore';

type PendingAction = 'draft' | 'open' | 'snooze' | 'suppress' | 'resolve';

function itemKey(item: ReplyPipelineState): string {
  return `${item.accountId}:${item.threadId}`;
}

function dueLabel(item: ReplyPipelineState): string {
  if (item.status === 'due') return 'Due now';
  if (!item.dueAt) return 'Waiting';
  const due = new Date(item.dueAt);
  if (!Number.isFinite(due.getTime())) return 'Waiting';
  return `Due ${due.toLocaleString([], { month: 'short', day: 'numeric' })}`;
}

function PipelineItem({ item }: { item: ReplyPipelineState }) {
  const store = useAppStore();
  const [pending, setPending] = useState<PendingAction | null>(null);
  const thread = store.threads.find(candidate => (
    candidate.accountId === item.accountId && candidate.id === item.threadId
  ));

  const run = async (action: PendingAction, task: () => Promise<void>) => {
    if (pending) return;
    setPending(action);
    try {
      await task();
    } catch (error) {
      console.error(`Reply Pipeline ${action} failed:`, error);
      emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Reply Pipeline action failed.' });
    } finally {
      setPending(null);
    }
  };

  const openThread = async () => {
    if (!thread) throw new Error('Source thread is no longer in the local cache.');
    await store.openThreadFromToday(thread);
  };

  const prepareOrOpenDraft = async () => {
    await run(item.draftId ? 'open' : 'draft', async () => {
      const result = await store.prepareReplyPipelineDraft(item.accountId, item.threadId);
      await store.loadDrafts();
      await openThread();
      store.setActiveDraft(result.draft);
      store.setComposeLayout('inline');
      if (result.placeholders.length > 0) {
        emitToast({ type: 'warning', message: 'Draft opened. Replace the placeholder before sending.' });
      } else {
        emitToast({
          type: 'success',
          message: result.state.draftOrigin === 'automation' ? 'Automation draft ready for review.' : 'Template draft ready for editing.',
        });
      }
    });
  };

  const snooze = async () => {
    await run('snooze', async () => {
      const hours = store.settings.inbox.followUpSnoozeHours || 24;
      const until = new Date(Date.now() + hours * 3_600_000).toISOString();
      await store.snoozeReplyPipelineItem(item, until);
    });
  };

  return (
    <article className="rounded-md border border-[var(--border)] bg-[var(--app-bg)] p-3">
      <div className="flex items-start justify-between gap-3">
        <button type="button" onClick={() => void run('open', openThread)} disabled={Boolean(pending)} className="min-w-0 flex-1 text-left disabled:opacity-60">
          <div className="truncate font-medium text-[var(--text-primary)]">{thread?.subject || '(Thread unavailable)'}</div>
          <div className="mt-0.5 line-clamp-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{item.reason}</div>
          {store.activeAccount?.id === 'unified' && (
            <div className="mt-1 truncate text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">{item.accountId}</div>
          )}
        </button>
        <span className={`shrink-0 rounded px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] ${item.status === 'due' ? 'bg-[var(--warning)]/15 text-[var(--warning)]' : 'bg-[var(--border)] text-[var(--text-secondary)]'}`}>
          {item.status === 'draftReady' ? 'Draft ready' : item.status === 'needsReply' ? 'Needs reply' : dueLabel(item)}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap gap-1.5">
        {(item.status === 'needsReply' || item.status === 'draftReady' || item.status === 'due') && (
          <button type="button" onClick={() => void prepareOrOpenDraft()} disabled={Boolean(pending)} className="flex min-w-[90px] items-center justify-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-white disabled:opacity-60">
            {pending === 'draft' || pending === 'open' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <MailPlus className="h-3 w-3" />}
            {item.draftId ? 'Open draft' : 'Prepare draft'}
          </button>
        )}
        <button type="button" onClick={() => void run('open', openThread)} disabled={Boolean(pending)} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] disabled:opacity-60">
          <ExternalLink className="h-3 w-3" /> Open
        </button>
        <button type="button" onClick={() => void snooze()} disabled={Boolean(pending)} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] disabled:opacity-60">
          {pending === 'snooze' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Clock3 className="h-3 w-3" />} Snooze
        </button>
        <button type="button" onClick={() => void run('resolve', () => store.resolveReplyPipelineItem(item))} disabled={Boolean(pending)} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-primary)] disabled:opacity-60">
          <Check className="h-3 w-3" /> Resolve
        </button>
        <button type="button" onClick={() => void run('suppress', () => store.suppressReplyPipelineItem(item))} disabled={Boolean(pending)} className="flex items-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] disabled:opacity-60">
          <X className="h-3 w-3" /> Suppress
        </button>
      </div>
      {item.hasPlaceholders && (
        <div role="alert" className="mt-2 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-2 py-1.5 text-[calc(9px*var(--font-scale))] text-[var(--warning)]">
          Replace the draft placeholders before sending. This warning clears after the edited draft is saved and rechecked.
        </div>
      )}
    </article>
  );
}

export function ReplyPipelineSection() {
  const store = useAppStore();
  const { ready, waiting } = useMemo(() => {
    const visible = store.replyPipelineItems.filter(item => !['resolved', 'snoozed', 'suppressed'].includes(item.status));
    return {
      ready: visible.filter(item => item.status === 'needsReply' || item.status === 'draftReady'),
      waiting: visible.filter(item => item.status === 'waitingOnThem' || item.status === 'due'),
    };
  }, [store.replyPipelineItems]);

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
          <PauseCircle className="h-4 w-4 text-[var(--accent)]" /> Reply Pipeline
        </div>
        <button type="button" onClick={() => void store.loadReplyPipeline()} disabled={store.replyPipelineLoading} className="flex items-center gap-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] disabled:opacity-50">
          <RefreshCw className={`h-3 w-3 ${store.replyPipelineLoading ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {store.replyPipelineError && (
        <div className="rounded border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">{store.replyPipelineError}</div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            <span>Ready to reply</span><span className="text-[var(--text-secondary)]">{ready.length}</span>
          </div>
          {ready.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border)] px-3 py-3 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No current reply obligations.</div>
          ) : ready.map(item => <PipelineItem key={itemKey(item)} item={item} />)}
        </div>

        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            <span>Waiting</span><span className="text-[var(--text-secondary)]">{waiting.length}</span>
          </div>
          {waiting.length === 0 ? (
            <div className="rounded border border-dashed border-[var(--border)] px-3 py-3 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No replies currently waiting on someone else.</div>
          ) : waiting.map(item => <PipelineItem key={itemKey(item)} item={item} />)}
        </div>
      </div>
    </section>
  );
}
