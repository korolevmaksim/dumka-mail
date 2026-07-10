import { Archive, Eye, MailMinus, ShieldAlert, UserMinus } from 'lucide-react';
import type { SenderCleanupStat } from '../../../shared/types';
import {
  CLEANUP_ARCHIVE_BATCH_LIMIT,
  suggestCleanupAction,
  type CleanupSuggestedAction,
} from '../../../shared/cleanup';

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

interface CleanupSenderCardProps {
  stat: SenderCleanupStat;
  archiveCount: number;
  effectiveArchiveableOldCount: number;
  canArchive: boolean;
  canUnsubscribe: boolean;
  unsubscribeBusy: boolean;
  excludeBusy: boolean;
  onPreview: () => void;
  onArchive: () => void;
  onUnsubscribe: () => void;
  onExclude: () => void;
}

export function CleanupSenderCard({
  stat,
  archiveCount,
  effectiveArchiveableOldCount,
  canArchive,
  canUnsubscribe,
  unsubscribeBusy,
  excludeBusy,
  onPreview,
  onArchive,
  onUnsubscribe,
  onExclude,
}: CleanupSenderCardProps) {
  const suggestion = suggestCleanupAction({ ...stat, archiveableOldCount: effectiveArchiveableOldCount });

  return (
    <article className="rounded-lg border border-[var(--border)] bg-[var(--app-bg)] p-2.5">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex flex-col gap-0.5">
          <span className="truncate font-semibold text-[var(--text-primary)]">{stat.senderName || stat.senderEmail}</span>
          <span className="truncate text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)]">{stat.senderEmail}</span>
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
        {stat.previouslyUnsubscribed && (
          <span className="rounded border border-[var(--danger)]/30 bg-[var(--danger)]/10 px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--danger)]" title="This sender kept mailing after a previous in-app unsubscribe (past the 7-day grace window).">
            Still sending{typeof stat.postUnsubscribeMessageCount === 'number' && stat.postUnsubscribeMessageCount > 0 ? ` (${stat.postUnsubscribeMessageCount})` : ''}
          </span>
        )}
        {canUnsubscribe && (
          <span className="rounded border border-[var(--border)] bg-[var(--panel-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
            Unsubscribe available
          </span>
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <button type="button" onClick={onPreview} title="Preview the newest locally cached messages from this sender" className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
          <Eye className="h-3 w-3" /> Preview latest
        </button>
        {canArchive && (
          <button type="button" onClick={onArchive} title={`Add up to ${CLEANUP_ARCHIVE_BATCH_LIMIT} archive proposals to the review queue`} className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)]">
            <Archive className="h-3 w-3" /> Archive old ({archiveCount})
          </button>
        )}
        {canUnsubscribe && (
          <button type="button" disabled={unsubscribeBusy} onClick={onUnsubscribe} title="Add an unsubscribe proposal to the review queue" className="flex items-center justify-center gap-1 rounded border border-[var(--border)] px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-secondary)] hover:border-[var(--strong-border)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40">
            <MailMinus className="h-3 w-3" /> {unsubscribeBusy ? 'Resolving…' : 'Unsubscribe'}
          </button>
        )}
        <button type="button" disabled={excludeBusy} onClick={onExclude} title="Hide this sender from future Cleanup suggestions" className="ml-auto flex items-center justify-center gap-1 rounded px-2 py-1 text-[calc(9px*var(--font-scale))] font-semibold text-[var(--text-tertiary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)] disabled:cursor-not-allowed disabled:opacity-40">
          <UserMinus className="h-3 w-3" /> {excludeBusy ? 'Excluding…' : 'Exclude'}
        </button>
      </div>
    </article>
  );
}
