import { useMemo, useState } from 'react';
import { Archive, Bell, ExternalLink, MailPlus, RefreshCw, ShieldAlert, Sparkles, Tag, X } from 'lucide-react';
import type { DailyBriefingCategory, DailyBriefingItem, MailLabelDefinition, MailMessage } from '../../../shared/types';
import { labelDisplayName } from '../../../shared/labels';
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
    tone: 'text-cyan-600 bg-cyan-500/10 border-cyan-500/20',
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

function latestMessage(messages: MailMessage[], item: DailyBriefingItem): MailMessage | null {
  return messages.find(message => message.id === item.source.messageId) ||
    [...messages].sort((a, b) => Date.parse(a.receivedAt) - Date.parse(b.receivedAt)).at(-1) ||
    null;
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

  const openThread = async (item: DailyBriefingItem) => {
    const thread = findThread(item);
    if (!thread) {
      emitToast({ type: 'warning', message: 'Thread is no longer in the local cache.' });
      return;
    }
    await store.openThread(thread);
  };

  const draftReply = async (item: DailyBriefingItem) => {
    const thread = findThread(item);
    if (!thread) {
      emitToast({ type: 'warning', message: 'Thread is no longer in the local cache.' });
      return;
    }
    const messages = await window.electronAPI.listMessagesForThread(item.accountId, item.threadId);
    const message = latestMessage(messages, item);
    if (!message) {
      emitToast({ type: 'warning', message: 'No source message found for this briefing item.' });
      return;
    }
    await store.openThread(thread);
    const draft = store.startReplyWithBody(message, '');
    if (draft) {
      await store.executeMailAction(
        'applyAIDraftPreview',
        item.threadId,
        draft.id,
        async () => null,
        payloadFor(item, 'draftReply', { draftId: draft.id })
      );
    }
    emitToast({ type: 'success', message: 'Reply draft opened from briefing source.' });
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

  const formatTime = (iso: string) => {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--rail-bg)] p-3 text-[calc(11px*var(--font-scale))] shadow-md">
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
                return (
                  <article key={item.id} className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-2.5">
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

                    <div className="mt-1.5 flex flex-col gap-0.5 rounded-md border border-[var(--border)]/60 bg-[var(--app-bg)] p-1.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
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
                      <button type="button" title="Draft reply" onClick={() => void draftReply(item)} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-1.5 py-1 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
                        <MailPlus className="h-3 w-3" /> Draft
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
                  </article>
                );
              })}
            </section>
          );
        })}

        {briefing.items.length === 0 && (
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            No briefing items in the current scope.
          </div>
        )}
      </div>
    </div>
  );
}
