import { useCallback, useEffect, useMemo, useState } from 'react';
import { Eraser, ListFilter, RefreshCw, X } from 'lucide-react';
import type { CleanupSenderExclusion, SenderCleanupStat } from '../../../shared/types';
import {
  CLEANUP_ARCHIVE_BATCH_LIMIT,
  isCleanupSenderActionable,
  selectArchiveOldCandidates,
} from '../../../shared/cleanup';
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../../../shared/agentPlan';
import { parseUnsubscribeCandidate } from '../../../shared/mailSecurity';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';
import { CleanupExcludedSenders } from './CleanupExcludedSenders';
import { CleanupSenderPreview } from './CleanupSenderPreview';
import { useCleanupExclusions } from '../hooks/useCleanupExclusions';
import { CleanupSenderCard } from './CleanupSenderCard';

const PRIVACY_NOTE = 'Computed locally from your cached mail. Nothing leaves your machine until you approve an action.';
const UNSUBSCRIBE_THREAD_PROBE_LIMIT = 5;
const EMPTY_ACTIONABLE =
  'Nothing to clean up right now. Senders appear here when they have old Inbox mail you can archive, or a List-Unsubscribe header.';

function senderGroupKey(accountId: string, senderEmail: string): string {
  return `${accountId}:${senderEmail}`;
}

export function CleanupPanel() {
  const store = useAppStore();
  const [stats, setStats] = useState<SenderCleanupStat[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [unsubscribeBusyKey, setUnsubscribeBusyKey] = useState<string | null>(null);
  const [exclusionsOpen, setExclusionsOpen] = useState(false);
  const [previewStat, setPreviewStat] = useState<SenderCleanupStat | null>(null);
  const closeExclusions = useCallback(() => setExclusionsOpen(false), []);
  const closePreview = useCallback(() => setPreviewStat(null), []);

  const accountsToLoad = useMemo(() => {
    if (!store.activeAccount) return [];
    if (store.activeAccount.id === 'unified') return store.accounts.filter(acc => acc.email);
    return [store.activeAccount];
  }, [store.activeAccount, store.accounts]);

  const loadStats = useCallback(async () => {
    if (accountsToLoad.length === 0) {
      setStats([]);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const results = await Promise.all(
        accountsToLoad.map(acc => window.electronAPI.listCleanupSenderStats(acc.email))
      );
      setStats(results.flat());
    } catch (err) {
      console.error('Cleanup sender stats failed:', err);
      setStats(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [accountsToLoad]);

  useEffect(() => {
    void loadStats();
  }, [loadStats]);

  // After a successful unsubscribe, the main process marks the sender and the
  // action log flips to completed. Reload stats so the row disappears without
  // requiring a manual refresh (historical List-Unsubscribe headers still match).
  const completedUnsubscribeKey = useMemo(() => store.actionLog
    .filter(log => log.kind === 'unsubscribeSender' && log.status === 'completed')
    .map(log => `${log.id}:${log.completedAt || ''}`)
    .join('|'), [store.actionLog]);

  useEffect(() => {
    if (!completedUnsubscribeKey) return;
    void loadStats();
  }, [completedUnsubscribeKey, loadStats]);

  // One O(threads) grouping pass shared by every sender row instead of a full
  // thread-list scan per row. Stats keys are lowercase (sender_key in SQL), so
  // thread sender emails are lowercased to match.
  const senderThreadGroups = useMemo(() => {
    const groups = new Map<string, typeof store.threads>();
    for (const thread of store.threads) {
      const key = senderGroupKey(thread.accountId, thread.senderEmail.toLowerCase());
      const group = groups.get(key);
      if (group) {
        group.push(thread);
      } else {
        groups.set(key, [thread]);
      }
    }
    return groups;
  }, [store.threads]);

  const accountIds = useMemo(() => accountsToLoad.map(account => account.email), [accountsToLoad]);
  const handleExcluded = useCallback((exclusion: CleanupSenderExclusion) => {
    const key = senderGroupKey(exclusion.accountId, exclusion.senderEmail);
    setStats(current => current?.filter(item => senderGroupKey(item.accountId, item.senderEmail) !== key) || current);
    setPreviewStat(current => current && senderGroupKey(current.accountId, current.senderEmail) === key ? null : current);
  }, []);
  const {
    exclusions,
    excludeBusyKey,
    restoreBusyKey,
    excludeSender,
    restoreExclusion,
  } = useCleanupExclusions({ accountIds, refreshStats: loadStats, onExcluded: handleExcluded });

  const handleArchiveOld = async (stat: SenderCleanupStat) => {
    let candidates = selectArchiveOldCandidates(
      senderThreadGroups.get(senderGroupKey(stat.accountId, stat.senderEmail)) || [],
    );

    // Renderer thread list can lag the SQL stats query; re-fetch that account's
    // threads so "Archive old" never shows a count it cannot enqueue.
    if (candidates.length === 0 && stat.archiveableOldCount > 0) {
      try {
        const allThreads = await window.electronAPI.listThreads(stat.accountId);
        candidates = selectArchiveOldCandidates(
          allThreads.filter(thread => thread.senderEmail.toLowerCase() === stat.senderEmail),
        );
      } catch (err) {
        console.error('Cleanup archive candidate refresh failed:', err);
      }
    }

    if (candidates.length === 0) {
      emitToast({ type: 'info', message: 'No Inbox threads older than 30 days for this sender in the local cache.' });
      return;
    }
    store.addAgentPlanItems(candidates.map(thread => buildCleanupArchiveItem({ stat, thread })));
    emitToast({
      type: 'success',
      message: `${candidates.length} action${candidates.length === 1 ? '' : 's'} added to review queue.`,
    });
  };

  const handleUnsubscribe = async (stat: SenderCleanupStat) => {
    const busyKey = `${stat.accountId}:${stat.senderEmail}`;
    setUnsubscribeBusyKey(busyKey);
    try {
      const senderThreads = [...(senderThreadGroups.get(senderGroupKey(stat.accountId, stat.senderEmail)) || [])]
        .sort((a, b) => Date.parse(b.lastMessageAt) - Date.parse(a.lastMessageAt))
        .slice(0, UNSUBSCRIBE_THREAD_PROBE_LIMIT);

      for (const thread of senderThreads) {
        const messages = await window.electronAPI.listMessagesForThread(stat.accountId, thread.id);
        const newestFirst = [...messages].sort((a, b) => Date.parse(b.receivedAt) - Date.parse(a.receivedAt));
        for (const sourceMessage of newestFirst) {
          const candidate = parseUnsubscribeCandidate(sourceMessage);
          if (candidate?.recommendedMethod) {
            store.addAgentPlanItems([buildCleanupUnsubscribeItem({ stat, candidate })]);
            emitToast({ type: 'success', message: '1 action added to review queue.' });
            return;
          }
        }
      }
      emitToast({ type: 'warning', message: 'No usable unsubscribe method found for this sender.' });
    } catch (err) {
      console.error('Unsubscribe candidate resolution failed:', err);
      emitToast({ type: 'error', message: 'Could not resolve an unsubscribe method for this sender.' });
    } finally {
      setUnsubscribeBusyKey(null);
    }
  };

  const previewContext = useMemo(() => {
    if (!previewStat) return null;
    const archiveCandidates = selectArchiveOldCandidates(
      senderThreadGroups.get(senderGroupKey(previewStat.accountId, previewStat.senderEmail)) || [],
    );
    const canArchive = archiveCandidates.length > 0 || previewStat.archiveableOldCount > 0;
    return {
      canArchive,
      canUnsubscribe: previewStat.hasUnsubscribeHeader,
      archiveCount: archiveCandidates.length > 0
        ? archiveCandidates.length
        : Math.min(previewStat.archiveableOldCount, CLEANUP_ARCHIVE_BATCH_LIMIT),
    };
  }, [previewStat, senderThreadGroups]);

  return (
    <div className="dm-cleanup relative flex-1 flex flex-col bg-[var(--panel-bg)] h-full overflow-hidden select-none text-[calc(11px*var(--font-scale))]">
      {/* Header */}
      <div className="dm-page-header flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] text-[calc(13px*var(--font-scale))]">
            <Eraser className="h-4 w-4 text-[var(--accent)]" /> Privacy &amp; Cleanup
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{PRIVACY_NOTE}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExclusionsOpen(true)}
            title="Manage excluded Cleanup senders"
            className="flex items-center gap-1 rounded px-1.5 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <ListFilter className="h-3.5 w-3.5" /> Excluded ({exclusions.length})
          </button>
          <button
            type="button"
            onClick={() => void loadStats()}
            disabled={loading}
            title="Refresh stats"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)] disabled:opacity-40"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={() => store.setCleanupOpen(false)}
            title="Close cleanup"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
        {loading && stats === null && (
          <div className="dm-inset rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Computing sender stats from the local cache…
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-start gap-2 rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/10 p-3 text-[calc(10px*var(--font-scale))] text-[var(--danger)]">
            <span>Could not compute sender stats: {error}</span>
            <button
              type="button"
              onClick={() => void loadStats()}
              className="rounded border border-[var(--danger)]/40 px-2 py-1 font-semibold hover:bg-[var(--danger)]/15"
            >
              Retry
            </button>
          </div>
        )}

        {!error && stats !== null && accountsToLoad.length === 0 && (
          <div className="dm-inset rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Connect a Gmail account to see cleanup stats.
          </div>
        )}

        {!error && stats !== null && accountsToLoad.map(acc => {
          const accountStats = stats
            .filter(stat => stat.accountId === acc.email)
            .map(stat => {
              const archiveCandidates = selectArchiveOldCandidates(
                senderThreadGroups.get(senderGroupKey(stat.accountId, stat.senderEmail)) || [],
              );
              const canUnsubscribe = stat.hasUnsubscribeHeader;
              // Prefer live candidates for the button (what we can enqueue now).
              // Fall back to the SQL archiveable count so rows stay visible/actionable
              // if the renderer thread list is still catching up.
              const canArchive = archiveCandidates.length > 0 || stat.archiveableOldCount > 0;
              return { stat, archiveCandidates, canArchive, canUnsubscribe };
            })
            .filter(({ stat, archiveCandidates, canArchive, canUnsubscribe }) =>
              isCleanupSenderActionable({
                hasUnsubscribeHeader: canUnsubscribe,
                archiveableOldCount: Math.max(stat.archiveableOldCount, archiveCandidates.length),
              }) && (canArchive || canUnsubscribe)
            );

          return (
            <section key={acc.email} className="flex flex-col gap-2">
              {accountsToLoad.length > 1 && (
                <h3 className="text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {acc.email}
                </h3>
              )}

              {accountStats.length === 0 ? (
                <div className="dm-inset rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  {EMPTY_ACTIONABLE}
                </div>
              ) : accountStats.map(({ stat, archiveCandidates, canArchive, canUnsubscribe }) => {
                const archiveCount = archiveCandidates.length > 0
                  ? archiveCandidates.length
                  : Math.min(stat.archiveableOldCount, CLEANUP_ARCHIVE_BATCH_LIMIT);
                const busyKey = `${stat.accountId}:${stat.senderEmail}`;

                return (
                  <CleanupSenderCard
                    key={busyKey}
                    stat={stat}
                    archiveCount={archiveCount}
                    effectiveArchiveableOldCount={Math.max(stat.archiveableOldCount, archiveCandidates.length)}
                    canArchive={canArchive}
                    canUnsubscribe={canUnsubscribe}
                    unsubscribeBusy={unsubscribeBusyKey === busyKey}
                    excludeBusy={excludeBusyKey === busyKey}
                    onPreview={() => setPreviewStat(stat)}
                    onArchive={() => void handleArchiveOld(stat)}
                    onUnsubscribe={() => void handleUnsubscribe(stat)}
                    onExclude={() => void excludeSender(stat)}
                  />
                );
              })}
            </section>
          );
        })}
      </div>

      {exclusionsOpen && (
        <CleanupExcludedSenders
          exclusions={exclusions}
          restoringKey={restoreBusyKey}
          showAccount={accountsToLoad.length > 1}
          onRestore={exclusion => void restoreExclusion(exclusion)}
          onClose={closeExclusions}
        />
      )}

      {previewStat && previewContext && (
        <CleanupSenderPreview
          stat={previewStat}
          canArchive={previewContext.canArchive}
          canUnsubscribe={previewContext.canUnsubscribe}
          archiveCount={previewContext.archiveCount}
          unsubscribeBusy={unsubscribeBusyKey === senderGroupKey(previewStat.accountId, previewStat.senderEmail)}
          excludeBusy={excludeBusyKey === senderGroupKey(previewStat.accountId, previewStat.senderEmail)}
          onArchive={() => void handleArchiveOld(previewStat)}
          onUnsubscribe={() => void handleUnsubscribe(previewStat)}
          onExclude={() => void excludeSender(previewStat)}
          onClose={closePreview}
        />
      )}
    </div>
  );
}
