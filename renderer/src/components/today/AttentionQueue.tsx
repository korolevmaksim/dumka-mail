import { useEffect, useMemo, useState } from 'react';
import { useAppStore } from '../../stores/AppStore';
import { buildTodayAttention } from '../../../../shared/todayAttention';
import { AttentionRow } from './AttentionRow';
import { emitToast } from '../../lib/toastBus';

export function AttentionQueue() {
  const store = useAppStore();
  const [limit, setLimit] = useState(7);
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(timer); }, []);
  useEffect(() => setLimit(7), [store.activeAccount?.id]);
  const items = useMemo(() => buildTodayAttention({ accountIds: store.activeAccount?.id === 'unified' ? store.accounts.map(account => account.email) : store.activeAccount ? [store.activeAccount.email] : [], threads: store.threads, replies: store.replyPipelineItems,
    proposals: store.agentPlan?.items || [], briefing: store.dailyBriefing?.items || [], commitments: store.commitments,
    snoozes: store.attentionSnoozes, corrections: store.reviewCorrections, now,
  }), [store.activeAccount, store.accounts, store.threads, store.replyPipelineItems, store.agentPlan, store.dailyBriefing, store.commitments, store.attentionSnoozes, store.reviewCorrections, now]);
  const snoozed = store.attentionSnoozes.filter(item => Date.parse(item.until) > now);
  return <section className="dm-productivity" aria-label="Needs your attention">
    <div className="flex flex-wrap items-baseline justify-between gap-2"><h2 className="text-base font-semibold">Needs your attention</h2><span className="text-[var(--text-secondary)]">{items.length} {items.length === 1 ? 'action' : 'actions'} · most urgent first</span></div>
    {!store.productivityLoaded ? <p role="status" className="py-4">Loading saved commitments and preferences…</p> : !items.length ? <p className="py-4">No actions in the current review. Check coverage below before treating your mailbox as clear.</p> : items.slice(0, limit).map(row => <AttentionRow key={`${row.accountId}:${row.id}`} row={row} />)}
    {items.length > limit && <button className="dm-productivity-button mb-3" onClick={() => setLimit(value => value + 7)}>Show next {Math.min(7, items.length - limit)} of {items.length - limit}</button>}
    {snoozed.length > 0 && <details className="py-3"><summary className="cursor-pointer">Snoozed · {snoozed.length}</summary>{snoozed.map(item => <div key={item.id} className="flex items-center justify-between gap-2 py-2"><span>{store.threads.find(thread => thread.accountId === item.accountId && thread.id === item.threadId)?.subject || 'Conversation'} · {new Date(item.until).toLocaleString()}</span><button className="dm-productivity-button" onClick={() => void store.deleteProductivity(item).catch(error => emitToast({ type: 'error', message: String(error) }))}>Bring back</button></div>)}</details>}
    <div className="border-t border-[var(--border)] py-3 text-[var(--text-secondary)]">
      <p>{store.dailyBriefing ? `Briefing: ${store.dailyBriefing.coverage.candidateThreadCount} candidate threads over ${store.dailyBriefing.coverage.lookbackHours} hours · ${new Date(store.dailyBriefing.generatedAt).toLocaleString()}` : 'No briefing generated for this account yet.'}</p>
      <p>{store.syncStatusText || 'Sync status not available'}{store.backfillProgress ? ` · ${store.backfillProgress}` : ''}</p>
      <p>{store.lastSuccessfulSync ? `Last successful sync: ${new Date(store.lastSuccessfulSync.completedAt).toLocaleString()} · ${store.lastSuccessfulSync.accountIds.join(', ')}` : 'No successful sync recorded in this session.'}</p>
      {store.dailyBriefing?.coverage.warnings.map(warning => <p key={warning}>{warning}</p>)}
      {store.productivityError && <p role="alert">{store.productivityError} <button className="dm-productivity-button" onClick={() => void store.refreshProductivity()}>Retry</button></p>}
      {store.replyPipelineError && <p role="alert">{store.replyPipelineError}</p>}
    </div>
  </section>;
}
