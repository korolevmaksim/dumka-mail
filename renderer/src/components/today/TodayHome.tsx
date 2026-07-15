import { useMemo } from 'react';
import { Archive, CalendarDays, CheckCircle2, ExternalLink, RefreshCw, ShieldAlert, Sparkles } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { DailyBriefingCard } from '../DailyBriefingCard';
import { AgentReviewQueueCard } from '../AgentReviewQueueCard';
import { RuleSimulatorPanel } from '../automation/RuleSimulatorPanel';
import { ReplyPipelineSection } from './ReplyPipelineSection';
import type { MailActionLog } from '../../../../shared/types';

function formatCalendarTime(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function actionLabel(action: MailActionLog): string {
  const label = action.kind.replace(/([A-Z])/g, ' $1').trim();
  return label.charAt(0).toUpperCase() + label.slice(1);
}

export function TodayHome() {
  const store = useAppStore();
  const calendarEvents = useMemo(() => [...store.calendarEvents]
    .filter(event => Date.parse(event.startAt) >= Date.now() - 15 * 60 * 1000)
    .sort((a, b) => Date.parse(a.startAt) - Date.parse(b.startAt))
    .slice(0, 4), [store.calendarEvents]);
  const followUpEvents = useMemo(() => store.calendarEvents
    .filter(event => event.attendees.length > 0 && Date.parse(event.endAt) < Date.now() && Date.parse(event.endAt) >= Date.now() - 6 * 60 * 60_000)
    .sort((left, right) => Date.parse(right.endAt) - Date.parse(left.endAt))
    .slice(0, 2), [store.calendarEvents]);
  const calendarIssues = useMemo(() => store.actionLog.filter(action =>
    ['createCalendarEvent', 'updateCalendarEvent', 'deleteCalendarEvent'].includes(action.kind)
    && (action.status === 'failed' || action.status === 'pending_sync')
  ).length, [store.actionLog]);
  const recentActions = useMemo(() => [...store.actionLog]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 5), [store.actionLog]);

  return (
    <main className="dm-today-workspace flex h-full min-w-0 flex-1 flex-col overflow-y-auto bg-[var(--app-bg)]">
      <div className="dm-page-content mx-auto flex w-full max-w-[1180px] flex-col gap-4 px-5 py-4">
        <div className="dm-page-header flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] pb-3">
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
              className="dm-secondary-button flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Sparkles className="h-3.5 w-3.5 text-[var(--ai-accent)]" />
              Briefing
            </button>
            <button
              type="button"
              onClick={() => void store.loadFollowUpRadar()}
              disabled={store.followUpRadarLoading}
              className="dm-secondary-button flex items-center gap-1 rounded border border-[var(--border)] bg-[var(--panel-bg)] px-2.5 py-1.5 text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${store.followUpRadarLoading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="dm-summary-card dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Review queue</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{store.agentPlan?.items.length || 0}</div>
          </div>
          <div className="dm-summary-card dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Reply pipeline</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{store.replyPipelineItems.filter(item => !['resolved', 'snoozed', 'suppressed'].includes(item.status)).length}</div>
          </div>
          <div className="dm-summary-card dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Briefing items</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{store.dailyBriefing?.items.length || 0}</div>
          </div>
          <div className="dm-summary-card dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
            <div className="text-[calc(9px*var(--font-scale))] uppercase tracking-normal text-[var(--text-tertiary)]">Recent actions</div>
            <div className="mt-1 text-[calc(22px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{recentActions.length}</div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.35fr)_minmax(320px,0.65fr)]">
          <div className="flex min-w-0 flex-col gap-4">
            {store.agentPlan ? (
              <AgentReviewQueueCard />
            ) : (
              <section className="dm-panel rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                <div className="flex items-center gap-2 font-semibold text-[var(--text-primary)]">
                  <ShieldAlert className="h-4 w-4 text-[var(--ai-accent)]" />
                  Agent Review Queue
                </div>
                <p className="mt-1">No pending agent approvals.</p>
              </section>
            )}

            <ReplyPipelineSection />

            {store.dailyBriefing ? (
              <DailyBriefingCard />
            ) : (
              <section className="dm-panel rounded-lg border border-dashed border-[var(--border)] bg-[var(--panel-bg)] p-4 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                Run Briefing to build a focused daily mail digest.
              </section>
            )}
          </div>

          <aside className="flex min-w-0 flex-col gap-4">
            <RuleSimulatorPanel compact />
            <section className="dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
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
                className="dm-inset flex w-full items-center justify-between rounded border border-[var(--border)] bg-[var(--app-bg)] px-3 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]"
              >
                Open privacy and cleanup tools
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
            </section>
            <section className="dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <button type="button" onClick={() => store.setWorkspaceView('calendar')} className="mb-2 flex w-full items-center justify-between gap-1.5 font-semibold text-[var(--text-primary)] hover:text-[var(--accent)]">
                <span className="flex items-center gap-1.5"><CalendarDays className="h-4 w-4 text-[var(--accent)]" />Calendar</span>
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              {calendarEvents.length === 0 && followUpEvents.length === 0 && calendarIssues === 0 ? (
                <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No upcoming events in the local agenda.</div>
              ) : (
                <div className="flex flex-col gap-2">
                  {calendarEvents.map(event => (
                    <button type="button" onClick={() => store.openCalendarEvent(event)} key={`${event.accountId}:${event.calendarId}:${event.id}`} className="dm-inset rounded bg-[var(--app-bg)] px-2.5 py-2 text-left hover:ring-1 hover:ring-[var(--accent)]">
                      <div className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-primary)]">{event.summary || 'Untitled event'}</div>
                      <div className="text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">{formatCalendarTime(event.startAt)}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-[calc(8px*var(--font-scale))] font-semibold uppercase tracking-wide">
                        {event.selfResponseStatus === 'needsAction' && <span className="text-[var(--warning)]">RSVP needed</span>}
                        {event.sourceThreadId && Date.parse(event.startAt) <= Date.now() + 24 * 60 * 60_000 && <span className="text-[var(--accent)]">Prep · linked mail</span>}
                        {event.conferenceUrl && <span className="text-[var(--success)]">Join ready</span>}
                      </div>
                    </button>
                  ))}
                  {followUpEvents.map(event => <button type="button" onClick={() => store.openCalendarEvent(event)} key={`follow-up:${event.accountId}:${event.calendarId}:${event.id}`} className="rounded border border-[var(--border)] bg-[var(--app-bg)] px-2.5 py-2 text-left text-[calc(10px*var(--font-scale))] text-[var(--accent)]">Draft follow-up · {event.summary}</button>)}
                  {calendarIssues > 0 && <button type="button" onClick={() => store.setWorkspaceView('calendar')} className="rounded border border-[var(--warning)]/40 bg-[var(--warning)]/10 px-2.5 py-2 text-left text-[calc(10px*var(--font-scale))] font-semibold text-[var(--warning)]">{calendarIssues} calendar sync {calendarIssues === 1 ? 'issue' : 'issues'} need attention</button>}
                </div>
              )}
            </section>
            <section className="dm-panel rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-3">
              <div className="mb-2 flex items-center gap-1.5 font-semibold text-[var(--text-primary)]">
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                Recent Actions
              </div>
              {recentActions.length === 0 ? (
                <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">No recent local actions.</div>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {recentActions.map(action => (
                    <div key={action.id} className="dm-inset flex items-center justify-between gap-2 rounded bg-[var(--app-bg)] px-2.5 py-1.5 text-[calc(10px*var(--font-scale))]">
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
