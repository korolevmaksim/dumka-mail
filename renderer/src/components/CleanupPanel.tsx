import { useCallback, useEffect, useMemo, useState } from 'react';
import { Archive, Eraser, MailMinus, RefreshCw, ShieldAlert, X } from 'lucide-react';
import type { MailThread, SenderCleanupStat } from '../../../shared/types';
import { CLEANUP_ARCHIVE_BATCH_LIMIT, suggestCleanupAction, type CleanupSuggestedAction } from '../../../shared/cleanup';
import { buildCleanupArchiveItem, buildCleanupUnsubscribeItem } from '../../../shared/agentPlan';
import { parseUnsubscribeCandidate } from '../../../shared/mailSecurity';
import { useAppStore } from '../stores/AppStore';
import { emitToast } from '../lib/toastBus';

const PRIVACY_NOTE = 'Computed locally from your cached mail. Nothing leaves your machine until you approve an action.';
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
const UNSUBSCRIBE_THREAD_PROBE_LIMIT = 5;

const RISK_TONE: Record<'low' | 'medium' | 'high', string> = {
  low: 'border-emerald-500/25 bg-emerald-500/10 text-emerald-600',
  medium: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]',
  high: 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]',
};

const SUGGESTION_META: Record<Exclude<CleanupSuggestedAction, 'none'>, { label: string; tone: string }> = {
  review: { label: 'Review', tone: 'border-[var(--danger)]/30 bg-[var(--danger)]/10 text-[var(--danger)]' },
  unsubscribe: { label: 'Unsubscribe', tone: 'border-[var(--warning)]/30 bg-[var(--warning)]/10 text-[var(--warning)]' },
  archiveOld: { label: 'Archive old', tone: 'border-[var(--accent)]/30 bg-[var(--accent)]/10 text-[var(--accent)]' },
};

function formatDate(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleDateString([], { year: 'numeric', month: 'short', day: 'numeric' });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function senderGroupKey(accountId: string, senderEmail: string): string {
  return `${accountId}:${senderEmail}`;
}

function archiveCandidatesFrom(senderThreads: MailThread[] | undefined): MailThread[] {
  if (!senderThreads || senderThreads.length === 0) return [];
  const cutoff = Date.now() - THIRTY_DAYS_MS;
  return senderThreads
    .filter(thread =>
      !thread.isUnread &&
      thread.labelIds.some(label => label.toUpperCase() === 'INBOX') &&
      Date.parse(thread.lastMessageAt) < cutoff
    )
    .sort((a, b) => Date.parse(a.lastMessageAt) - Date.parse(b.lastMessageAt))
    .slice(0, CLEANUP_ARCHIVE_BATCH_LIMIT);
}

export function CleanupPanel() {
  const store = useAppStore();
  const [stats, setStats] = useState<SenderCleanupStat[] | null>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [unsubscribeBusyKey, setUnsubscribeBusyKey] = useState<string | null>(null);

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

  // One O(threads) grouping pass shared by every sender row instead of a full
  // thread-list scan per row. Stats keys are lowercase (sender_key in SQL), so
  // thread sender emails are lowercased to match.
  const senderThreadGroups = useMemo(() => {
    const groups = new Map<string, MailThread[]>();
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

  const handleArchiveOld = (stat: SenderCleanupStat) => {
    const candidates = archiveCandidatesFrom(senderThreadGroups.get(senderGroupKey(stat.accountId, stat.senderEmail)));
    if (candidates.length === 0) {
      emitToast({ type: 'info', message: 'No read threads older than 30 days for this sender in the local cache.' });
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

  return (
    <div className="flex-1 flex flex-col bg-[var(--panel-bg)] h-full overflow-hidden select-none text-[calc(11px*var(--font-scale))]">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="flex items-center gap-1.5 font-semibold text-[var(--text-primary)] text-[calc(13px*var(--font-scale))]">
            <Eraser className="h-4 w-4 text-[var(--accent)]" /> Privacy &amp; Cleanup
          </span>
          <span className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{PRIVACY_NOTE}</span>
        </div>
        <div className="flex items-center gap-1">
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
          <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
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
          <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
            Connect a Gmail account to see cleanup stats.
          </div>
        )}

        {!error && stats !== null && accountsToLoad.map(acc => {
          const accountStats = stats.filter(stat => stat.accountId === acc.email);
          return (
            <section key={acc.email} className="flex flex-col gap-2">
              {accountsToLoad.length > 1 && (
                <h3 className="text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wider text-[var(--text-secondary)]">
                  {acc.email}
                </h3>
              )}

              {accountStats.length === 0 ? (
                <div className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-3 text-center text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                  No sender activity in the local cache yet.
                </div>
              ) : accountStats.map(stat => {
                const archiveCandidates = archiveCandidatesFrom(senderThreadGroups.get(senderGroupKey(stat.accountId, stat.senderEmail)));
                const suggestion = suggestCleanupAction(stat);
                const busyKey = `${stat.accountId}:${stat.senderEmail}`;

                return (
                  <article key={busyKey} className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex flex-col gap-0.5">
                        <span className="truncate font-semibold text-[var(--text-primary)]">
                          {stat.senderName || stat.senderEmail}
                        </span>
                        <span className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                          {stat.senderEmail}
                        </span>
                      </div>
                      {suggestion !== 'none' && (
                        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[calc(8px*var(--font-scale))] font-semibold uppercase ${SUGGESTION_META[suggestion].tone}`}>
                          {SUGGESTION_META[suggestion].label}
                        </span>
                      )}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">
                      <span>{stat.messageCount} message{stat.messageCount === 1 ? '' : 's'}</span>
                      <span>{stat.recent30dCount}/30d</span>
                      <span>{stat.unreadCount} unread</span>
                      <span>Last activity {formatDate(stat.lastReceivedAt)}</span>
                      {stat.attachmentBytes > 0 && <span>{formatBytes(stat.attachmentBytes)} attachments</span>}
                    </div>

                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {stat.trackerCount > 0 && (
                        <span className="flex items-center gap-1 rounded border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--warning)]">
                          <ShieldAlert className="h-3 w-3" /> {stat.trackerCount} tracker{stat.trackerCount === 1 ? '' : 's'} among analyzed
                        </span>
                      )}
                      {stat.maxRiskLevel && (
                        <span className={`rounded border px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] font-semibold uppercase ${RISK_TONE[stat.maxRiskLevel]}`}>
                          {stat.maxRiskLevel} risk
                        </span>
                      )}
                      {stat.hasUnsubscribeHeader && (
                        <span className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                          Unsubscribe available
                        </span>
                      )}
                    </div>

                    <div className="mt-2 flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={archiveCandidates.length === 0}
                        onClick={() => handleArchiveOld(stat)}
                        title={`Add up to ${CLEANUP_ARCHIVE_BATCH_LIMIT} archive proposals to the review queue`}
                        className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <Archive className="h-3 w-3" /> Archive old ({archiveCandidates.length})
                      </button>
                      <button
                        type="button"
                        disabled={!stat.hasUnsubscribeHeader || unsubscribeBusyKey === busyKey}
                        onClick={() => void handleUnsubscribe(stat)}
                        title="Add an unsubscribe proposal to the review queue"
                        className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        <MailMinus className="h-3 w-3" /> {unsubscribeBusyKey === busyKey ? 'Resolving…' : 'Unsubscribe'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </section>
          );
        })}
      </div>
    </div>
  );
}
