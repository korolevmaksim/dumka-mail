import { useMemo, useState } from 'react';
import { Archive, Bell, CalendarDays, CheckCircle2, Clock3, ExternalLink, LoaderCircle, MailPlus, Radar, RefreshCw, ShieldAlert, Sparkles, X } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { emitToast } from '../../lib/toastBus';
import { DailyBriefingCard } from '../DailyBriefingCard';
import { AgentReviewQueueCard } from '../AgentReviewQueueCard';
import { RuleSimulatorPanel } from '../automation/RuleSimulatorPanel';
import type { FollowUpRadarItem, MailActionLog } from '../../../../shared/types';

function formatRelativeAge(hours: number): string {
  if (hours < 48) return `${Math.max(1, Math.round(hours))}h ago`;
  return `${Math.max(1, Math.round(hours / 24))}d ago`;
}

function formatCalendarTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function actionLabel(action: MailActionLog): string {
  const label = action.kind.replace(/([A-Z])/g, ' $1').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type FollowUpPendingAction = 'draft' | 'remind' | 'snooze' | 'dismiss';

const FOLLOW_UP_EXIT_ANIMATION_MS = 220;
const followUpButtonClass = 'flex min-w-[82px] items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(10px*var(--font-scale))] transition-[background-color,border-color,color,opacity,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-60';

function followUpItemKey(item: FollowUpRadarItem): string {
  return `${item.accountId}:${item.threadId}:${item.sentMessageId}`;
}

function waitForFollowUpExitAnimation(): Promise<void> {
  return new Promise(resolve => globalThis.setTimeout(resolve, FOLLOW_UP_EXIT_ANIMATION_MS));
}

function followUpFailureMessage(action: FollowUpPendingAction): string {
  switch (action) {
    case 'draft':
      return 'Could not open the follow-up draft.';
    case 'remind':
      return 'Could not save the reminder.';
    case 'snooze':
      return 'Could not snooze the follow-up.';
    case 'dismiss':
      return 'Could not dismiss the follow-up.';
  }
}

export function TodayHome() {
  const store = useAppStore();
  const followUps = store.followUpRadar?.items || [];
  const [pendingFollowUpActions, setPendingFollowUpActions] = useState<Record<string, FollowUpPendingAction>>({});
  const [exitingFollowUpIds, setExitingFollowUpIds] = useState<Set<string>>(() => new Set());
  const calendarEvents = useMemo(() => [...store.calendarEvents]
    .filter(event => Date.parse(event.startAt) >= Date.now() - 15 * 60 * 1000)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 4), [store.calendarEvents]);
  const recentActions = useMemo(() => [...store.actionLog]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5), [store.actionLog]);

  const openThread = async (item: FollowUpRadarItem) => {
    store.setWorkspaceView('mail');
    store.setSettingsOpen(false);
    store.setCleanupOpen(false);
    await store.openThread(item.thread);
  };

  const runFollowUpAction = async (
    item: FollowUpRadarItem,
    action: FollowUpPendingAction,
    task: () => Promise<void>,
    exitAfterClick = false,
  ) => {
    const key = followUpItemKey(item);
    if (pendingFollowUpActions[key]) return;

    setPendingFollowUpActions(prev => ({ ...prev, [key]: action }));
    if (exitAfterClick) {
      setExitingFollowUpIds(prev => new Set(prev).add(key));
      await waitForFollowUpExitAnimation();
    }

    try {
      await task();
    } catch (err) {
      console.error('Follow-up Radar action failed:', err);
      if (exitAfterClick) {
        setExitingFollowUpIds(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
      emitToast({ type: 'error', message: followUpFailureMessage(action) });
    } finally {
      setPendingFollowUpActions(prev => {
        const next = { ...prev };
        delete next[key];
        return next;
      });
    }
  };

  const draftFollowUp = async (item: FollowUpRadarItem) => {
    await runFollowUpAction(item, 'draft', async () => {
      await openThread(item);
      const draft = store.startReplyWithBody(item.sentMessage, '\n\nFollowing up on this.');
      if (draft) {
        store.setComposeLayout('inline');
        emitToast({ type: 'success', message: 'Follow-up draft opened.' });
      }
    });
  };

  const remindFollowUp = async (item: FollowUpRadarItem) => {
    await runFollowUpAction(item, 'remind', async () => {
      const reminderAt = new Date();
      reminderAt.setDate(reminderAt.getDate() + 1);
      reminderAt.setHours(9, 0, 0, 0);
      await window.electronAPI.saveReminder(item.accountId, item.threadId, reminderAt.toISOString());
      await store.executeMailAction(
        'setReminder',
        item.threadId,
        null,
        async () => null,
        JSON.stringify({
          source: 'followUpRadar',
          accountId: item.accountId,
          sentMessageId: item.sentMessageId,
          reminderAt: reminderAt.toISOString(),
        })
      );
      await store.dismissFollowUpRadarItem(item);
    }, true);
  };

  const snoozeFollowUp = async (item: FollowUpRadarItem) => {
    await runFollowUpAction(item, 'snooze', async () => {
      const hours = store.settings.inbox.followUpSnoozeHours || 24;
      const snoozedUntil = new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();
      await store.snoozeFollowUpRadarItem(item, snoozedUntil);
    }, true);
  };

  const dismissFollowUp = async (item: FollowUpRadarItem) => {
    await runFollowUpAction(item, 'dismiss', async () => {
      await store.dismissFollowUpRadarItem(item);
    }, true);
  };

  return (
    <main className="flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--app-bg)]">
      <div className="mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
          <div className="min-w-0">
            <h1 className="text-[calc(18px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Today</h1>
            <p className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
              {store.activeAccount?.id === 'unified' ? 'Unified operator queue' : store.activeAccount?.email || 'Local mailbox operator queue'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-[calc(10px*var(--font-scale))]">
            <button
              type="button"
              onClick={() => void store.runDailyBriefing(undefined, { openPanel: false })}
              disabled={store.dailyBriefingLoading}
              className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--ai-accent)]" />
              Briefing
            </button>
            <button
              type="button"
              onClick={() => void store.loadFollowUpRadar()}
              disabled={store.followUpRadarLoading}
              className="flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${store.followUpRadarLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Review queue</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{store.agentPlan?.items.length || 0}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Follow-ups</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{followUps.length}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Briefing items</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{store.dailyBriefing?.items.length || 0}</div>
          </div>
          <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Recent actions</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{recentActions.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {store.agentPlan ? (
              <AgentReviewQueueCard />
            ) : (
              <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                  <ShieldAlert className="h-4 w-4 text-[var(--ai-accent)]" />
                  Agent Review Queue
                </div>
                <p className="mt-1">No pending agent approvals.</p>
              </section>
            )}

            <section className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                  <Radar className="h-4 w-4 text-[var(--accent)]" />
                  Follow-up Radar
                </div>
                <div className="flex items-center gap-2 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  {store.followUpRadarLoading && (
                    <span role="status" aria-live="polite" className="flex items-center gap-1 text-[var(--accent)]">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Updating
                    </span>
                  )}
                  <span>{store.followUpRadar?.scannedThreadCount || 0} sent threads scanned</span>
                </div>
              </div>
              {store.followUpRadarError && (
                <div className="rounded border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
                  {store.followUpRadarError}
                </div>
              )}
              {store.followUpRadar?.warnings.map(warning => (
                <div key={warning} className="rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-3 py-2 text-[calc(10px*var(--font-scale))] text-[var(--warning)]">
                  {warning}
                </div>
              ))}
              {followUps.length === 0 ? (
                <div className="rounded border border-dashed border-[var(--border)] bg-[var(--app-bg)] px-3 py-3 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  No unanswered sent mail past the follow-up threshold.
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  {followUps.slice(0, 8).map(item => {
                    const key = followUpItemKey(item);
                    const pendingAction = pendingFollowUpActions[key];
                    const isBusy = Boolean(pendingAction);
                    const isExiting = exitingFollowUpIds.has(key);

                    return (
                      <article
                        key={key}
                        aria-busy={isBusy}
                        className={`overflow-hidden rounded-md border bg-[var(--app-bg)] transition-[opacity,transform,max-height,padding,border-color] duration-200 ease-out ${
                          isExiting
                            ? 'max-h-0 -translate-y-1 scale-[0.98] border-transparent p-0 opacity-0'
                            : 'max-h-72 border-[var(--border)] p-3 opacity-100'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <button type="button" onClick={() => void openThread(item)} disabled={isBusy} className="min-w-0 flex-1 text-left disabled:cursor-not-allowed">
                            <div className="truncate font-medium text-[var(--text-primary)]">{item.subject || '(no subject)'}</div>
                            <div className="mt-0.5 truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{item.reason}</div>
                            <div className="mt-1 line-clamp-2 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]">{item.snippet}</div>
                          </button>
                          <span className="shrink-0 rounded bg-[var(--border)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-primary)]">{formatRelativeAge(item.ageHours)}</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <button type="button" onClick={() => void draftFollowUp(item)} disabled={isBusy} className="flex min-w-[72px] items-center justify-center gap-1 rounded bg-[var(--accent)] px-2 py-1 text-[calc(10px*var(--font-scale))] font-medium text-white transition-[opacity,transform] duration-150 disabled:cursor-not-allowed disabled:opacity-60">
                            {pendingAction === 'draft' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <MailPlus className="h-3 w-3" />}
                            {pendingAction === 'draft' ? 'Opening' : 'Draft'}
                          </button>
                          <button type="button" onClick={() => void remindFollowUp(item)} disabled={isBusy} className={`${followUpButtonClass} text-[var(--text-primary)]`}>
                            {pendingAction === 'remind' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Bell className="h-3 w-3" />}
                            {pendingAction === 'remind' ? 'Saving' : 'Remind'}
                          </button>
                          <button type="button" onClick={() => void snoozeFollowUp(item)} disabled={isBusy} className={`${followUpButtonClass} text-[var(--text-primary)]`}>
                            {pendingAction === 'snooze' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <Clock3 className="h-3 w-3" />}
                            {pendingAction === 'snooze' ? 'Snoozing' : 'Snooze'}
                          </button>
                          <button type="button" onClick={() => void dismissFollowUp(item)} disabled={isBusy} className={`${followUpButtonClass} text-[var(--text-secondary)]`}>
                            {pendingAction === 'dismiss' ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <X className="h-3 w-3" />}
                            {pendingAction === 'dismiss' ? 'Dismissing' : 'Dismiss'}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>

            {store.dailyBriefing ? (
              <DailyBriefingCard />
            ) : (
              <section className="rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                Run Briefing to build a focused daily mail digest.
              </section>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <RuleSimulatorPanel compact />
            <section className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                <Archive className="h-4 w-4 text-[var(--accent)]" />
                Cleanup
              </div>
              <button
                type="button"
                onClick={() => {
                  store.setWorkspaceView('mail');
                  store.setSettingsOpen(false);
                  store.setCleanupOpen(true);
                }}
                className="flex w-full items-center justify-between rounded border border-[var(--border)] bg-[var(--app-bg)] px-3 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
              >
                Open privacy and cleanup tools
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                <CalendarDays className="h-4 w-4 text-[var(--accent)]" />
                Calendar
              </div>
              {calendarEvents.length === 0 ? (
                <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No upcoming events in the local agenda.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {calendarEvents.map(event => (
                    <div key={event.id} className="rounded bg-[var(--app-bg)] px-2.5 py-2">
                      <div className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">{event.summary || 'Untitled event'}</div>
                      <div className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{formatCalendarTime(event.startAt)}</div>
                    </div>
                  ))}
                </div>
              )}
            </section>
            <section className="rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                Recent Actions
              </div>
              {recentActions.length === 0 ? (
                <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No recent local actions.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {recentActions.map(action => (
                    <div key={action.id} className="flex items-center justify-between gap-2 rounded bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))]">
                      <span className="truncate text-[var(--text-primary)]">{actionLabel(action)}</span>
                      <span className="shrink-0 text-[var(--text-secondary)]">{action.status}</span>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
