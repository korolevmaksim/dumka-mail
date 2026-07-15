import { useMemo, useState } from 'react';
import { Archive, Bell, ExternalLink, ListChecks, MailPlus, RefreshCw, ShieldAlert, Sparkles, Tag, X } from 'lucide-react';
import type { DailyBriefingCategory, DailyBriefingItem, MailLabelDefinition, ReplyPipelineCandidate } from '../../../shared/types';
import { labelDisplayName } from '../../../shared/labels';
import { canPrepareReplyPipelineCandidateDraft } from '../../../shared/replyPipeline';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';

const CATEGORY_META: Record<DailyBriefingCategory, { title: string; empty: string; tone: string }> = {
  needsReply: {
    title: 'Needs reply',
    empty: 'No reply-critical messages.',
    tone: 'text-[var(--accent)] bg-[var(--accent)]/10 border-[var(--accent)]/25',
  },
  waitingOnMe: {
    title: 'Waiting on me',
    empty: 'No stale requests found.',
    tone: 'text-[var(--warning)] bg-[var(--warning)]/10 border-[var(--warning)]/25',
  },
  fyi: {
    title: 'FYI',
    empty: 'No FYI messages in scope.',
    tone: 'text-[var(--info)] bg-[var(--info)]/10 border-[var(--info)]/20',
  },
  riskOrNoise: {
    title: 'Risk or noise',
    empty: 'No risk or noise candidates.',
    tone: 'text-[var(--danger)] bg-[var(--danger)]/10 border-[var(--danger)]/20',
  },
};

const CATEGORY_ORDER: DailyBriefingCategory[] = ['needsReply', 'waitingOnMe', 'riskOrNoise', 'fyi'];

function nextReminderAt(hour: number): Date {
  const date = new Date();
  date.setHours(hour, 0, 0, 0);
  if (date.getTime() <= Date.now()) date.setDate(date.getDate() + 1);
  return date;
}

function labelOptions(labels: MailLabelDefinition[], accountId: string): MailLabelDefinition[] {
  return labels
    .filter(label => label.accountId === accountId && label.type !== 'system')
    .sort((a, b) => labelDisplayName(a.name || a.id).localeCompare(labelDisplayName(b.name || b.id)));
}

function categoryGroups(items: DailyBriefingItem[]): Record<DailyBriefingCategory, DailyBriefingItem[]> {
  return CATEGORY_ORDER.reduce((result, category) => {
    result[category] = items.filter(item => item.category === category);
    return result;
  }, {} as Record<DailyBriefingCategory, DailyBriefingItem[]>);
}

function replyCandidateFor(item: DailyBriefingItem): ReplyPipelineCandidate {
  return {
    accountId: item.accountId,
    threadId: item.threadId,
    sourceMessageId: item.source.messageId,
    sourceReceivedAt: item.source.receivedAt,
    sourceKind: 'inbound',
    status: 'needsReply',
    reason: item.reason,
    priority: item.priority,
  };
}

export function DailyBriefingCard() {
  const store = useAppStore();
  const briefing = store.dailyBriefing;
  const [labelByItemId, setLabelByItemId] = useState<Record<string, string>>({});

  const groups = useMemo(() => categoryGroups(briefing?.items || []), [briefing?.items]);
  if (!briefing) return null;

  const payloadFor = (item: DailyBriefingItem, action: string, extra: Record<string, unknown> = {}) => JSON.stringify({
    source: 'dailyBriefing',
    briefingId: briefing.id,
    accountId: item.accountId,
    category: item.category,
    action,
    sourceMessageId: item.source.messageId,
    ...extra,
  });

  const findThread = (item: DailyBriefingItem) => store.threads.find(thread => (
    thread.accountId === item.accountId && thread.id === item.threadId
  ));

  const blockingPipelineState = (item: DailyBriefingItem) => {
    const state = store.replyPipelineItems.find(candidate => (
      candidate.accountId === item.accountId && candidate.threadId === item.threadId
    ));
    if (!state || Date.parse(state.sourceReceivedAt) < Date.parse(item.source.receivedAt)) return null;
    if (canPrepareReplyPipelineCandidateDraft(state, replyCandidateFor(item))) return null;
    return state;
  };

  const openThread = async (item: DailyBriefingItem) => {
    const thread = findThread(item);
    if (!thread) {
      emitToast({ type: 'warning', message: 'Thread is no longer in the local cache.' });
      return;
    }
    await store.openThreadFromToday(thread);
  };

  const draftReply = async (item: DailyBriefingItem) => {
    try {
      const thread = findThread(item);
      if (!thread) {
        emitToast({ type: 'warning', message: 'Thread is no longer in the local cache.' });
        return;
      }
      const candidate = replyCandidateFor(item);
      const [state] = await window.electronAPI.reconcileReplyPipeline([candidate]);
      if (!canPrepareReplyPipelineCandidateDraft(state || null, candidate)) {
        if (state?.status !== 'snoozed') store.dismissDailyBriefingItem(item);
        emitToast({
          type: 'info',
          message: state?.status === 'snoozed'
            ? 'This reply is snoozed in the Reply Pipeline.'
            : 'This briefing item has already moved to a newer reply state.',
        });
        return;
      }
      const result = await store.prepareReplyPipelineDraft(item.accountId, item.threadId);
      await store.loadDrafts();
      await store.openThreadFromToday(thread);
      store.setActiveDraft(result.draft);
      store.setComposeLayout('inline');
      await store.executeMailAction(
        'applyAIDraftPreview',
        item.threadId,
        result.draft.id,
        async () => null,
        payloadFor(item, 'draftReply', { draftId: result.draft.id, draftOrigin: result.state.draftOrigin })
      );
      emitToast({
        type: result.placeholders.length > 0 ? 'warning' : 'success',
        message: result.placeholders.length > 0
          ? 'Reply draft opened. Replace the placeholder before sending.'
          : 'Reply draft opened from briefing source.',
      });
    } catch (error) {
      console.error('Daily Briefing reply draft failed:', error);
      emitToast({ type: 'error', message: error instanceof Error ? error.message : 'Could not prepare the reply draft.' });
    }
  };

  const setReminder = async (item: DailyBriefingItem) => {
    const reminderAt = nextReminderAt(briefing.settings.defaultReminderHour).toISOString();
    await store.executeMailAction(
      'setReminder',
      item.threadId,
      null,
      undefined,
      payloadFor(item, 'setReminder', { reminderAt })
    );
    store.dismissDailyBriefingItem(item);
  };

  const archive = async (item: DailyBriefingItem) => {
    await store.executeMailAction('markDone', item.threadId, null, undefined, payloadFor(item, 'archive'));
    store.dismissDailyBriefingItem(item);
  };

  const applyLabel = async (item: DailyBriefingItem, selectedLabelId?: string) => {
    const labelId = selectedLabelId || labelByItemId[item.id];
    if (!labelId) {
      emitToast({ type: 'warning', message: 'Choose a label first.' });
      return;
    }
    await store.executeMailAction('applyLabel', item.threadId, null, undefined, payloadFor(item, 'applyLabel', { labelId }));
    store.dismissDailyBriefingItem(item);
  };

  const addToReviewQueue = (item: DailyBriefingItem, selectedLabelId?: string) => {
    store.addDailyBriefingItemToAgentPlan(item, selectedLabelId || null);
  };

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="dm-panel mb-4 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--rail-bg)] p-3 text-[calc(11px*var(--font-scale))] shadow-md">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-1 font-semibold text-[var(--ai-accent)]">
            <Sparkles className="h-3.5 w-3.5" /> Daily Briefing
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            {briefing.coverage.includedItemCount} item{briefing.coverage.includedItemCount === 1 ? '' : 's'} from {briefing.coverage.candidateThreadCount} candidate threads
          </span>
          <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)]">
            {briefing.coverage.lookbackHours}h scope · semantic {briefing.coverage.semanticSearchEnabled ? `${briefing.coverage.semanticMatches} matches` : 'off'} · {formatTime(briefing.generatedAt)}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void store.runDailyBriefing()}
            disabled={store.dailyBriefingLoading}
            title="Refresh briefing"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${store.dailyBriefingLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => store.setDailyBriefing(null)}
            title="Close briefing"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {briefing.coverage.warnings.length > 0 && (
        <div className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning)]/10 p-2 text-[calc(9px*var(--font-scale))] text-[var(--warning)]">
          {briefing.coverage.warnings[0]}
        </div>
      )}

      <div className="flex flex-col gap-2">
        {CATEGORY_ORDER.map(category => {
          const meta = CATEGORY_META[category];
          const items = groups[category];
          if (items.length === 0) return null;

          return (
            <section key={category} className="flex flex-col gap-1.5">
              <div className={`flex w-fit items-center gap-1 rounded-md border px-2 py-0.5 text-[calc(9px*var(--font-scale))] font-semibold uppercase ${meta.tone}`}>
                {category === 'riskOrNoise' && <ShieldAlert className="h-3 w-3" />}
                {meta.title}
              </div>

              {items.map(item => {
                const labels = labelOptions(store.labelDefinitions, item.accountId);
                const selectedLabel = labelByItemId[item.id] || labels[0]?.id || '';
                const blockedPipelineState = blockingPipelineState(item);
                const draftLabel = blockedPipelineState?.status === 'snoozed' ? 'Snoozed' : blockedPipelineState ? 'Handled' : 'Draft';
                return (
                  <article key={item.id} className="dm-inset rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="truncate font-semibold text-[var(--text-primary)]">{item.source.sender}</span>
                        <span className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{item.source.subject}</span>
                      </div>
                      <span className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 font-mono text-[calc(8px*var(--font-scale))] text-[var(--text-secondary)]">
                        {item.priority}
                      </span>
                    </div>

                    <p className="mt-1.5 line-clamp-3 text-[calc(10px*var(--font-scale))] leading-snug text-[var(--text-primary)]">
                      {item.summary}
                    </p>

                    <div className="dm-inset mt-1.5 flex flex-col gap-0.5 rounded-md border border-[var(--border)]/60 bg-[var(--app-bg)] p-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                      <span className="font-semibold text-[var(--text-primary)]">Source: {formatTime(item.source.receivedAt)}</span>
                      <span>{item.reason}</span>
                      {(item.trackerCount > 0 || item.phishingLinkCount > 0) && (
                        <span className="text-[var(--danger)]">
                          {item.trackerCount} tracker{item.trackerCount === 1 ? '' : 's'} · {item.phishingLinkCount} phishing signal{item.phishingLinkCount === 1 ? '' : 's'}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 grid grid-cols-4 gap-1">
                      <button type="button" title="Open source thread" onClick={() => void openThread(item)} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
                        <ExternalLink className="h-3 w-3" /> Open
                      </button>
                      <button type="button" title={blockedPipelineState ? 'This source has already moved to another Reply Pipeline state' : 'Draft reply'} disabled={Boolean(blockedPipelineState)} onClick={() => void draftReply(item)} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-45">
                        <MailPlus className="h-3 w-3" /> {draftLabel}
                      </button>
                      <button type="button" title="Set reminder" onClick={() => void setReminder(item)} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
                        <Bell className="h-3 w-3" /> Remind
                      </button>
                      <button type="button" title="Archive thread" onClick={() => void archive(item)} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
                        <Archive className="h-3 w-3" /> Archive
                      </button>
                    </div>

                    <div className="mt-1.5 flex items-center gap-1">
                      <select
                        value={selectedLabel}
                        disabled={labels.length === 0}
                        onChange={(event) => setLabelByItemId(prev => ({ ...prev, [item.id]: event.target.value }))}
                        className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--app-bg)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-primary)] outline-none disabled:opacity-40"
                      >
                        {labels.length === 0 ? (
                          <option value="">No labels cached</option>
                        ) : labels.map(label => (
                          <option key={label.id} value={label.id}>{labelDisplayName(label.name || label.id)}</option>
                        ))}
                      </select>
                      <button
                        type="button"
                        title="Apply selected label"
                        disabled={!selectedLabel}
                        onClick={() => {
                          setLabelByItemId(prev => ({ ...prev, [item.id]: selectedLabel }));
                          void applyLabel(item, selectedLabel);
                        }}
                        className="rounded border border-[var(--border)] p-1 text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:opacity-40"
                      >
                        <Tag className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <button
                      type="button"
                      title="Add proposed action to Agent Review Queue"
                      onClick={() => addToReviewQueue(item, selectedLabel)}
                      className="mt-1.5 flex w-full items-center justify-center gap-1 rounded border border-[var(--ai-accent)]/35 bg-[var(--ai-accent)]/10 px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:border-[var(--ai-accent)] hover:bg-[var(--ai-accent)]/15"
                    >
                      <ListChecks className="h-3 w-3 text-[var(--ai-accent)]" /> Add to Review
                    </button>
                  </article>
                );
              })}
            </section>
          );
        })}

        {briefing.items.length === 0 && (
          <div className="dm-inset rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            No briefing items in the current scope.
          </div>
        )}
      </div>
    </div>
  );
}
