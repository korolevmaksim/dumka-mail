import { CheckCircle, Inbox, MailOpen, Mail, MailMinus, Clock, Send, BellOff, Sparkles, Braces, Activity, Trash2, ArchiveRestore, OctagonAlert, Tag, FolderInput, CalendarCheck, CalendarPlus, type LucideIcon } from 'lucide-react';
import { MailActionLog, ActionStatus } from '../../../shared/types';
import { makeActivityItems } from '../../../shared/activityTimeline';
import { relativeTime } from '../../../shared/dateFormat';

const ICON: Record<string, LucideIcon> = {
  CheckCircle, Inbox, MailOpen, Mail, Clock, Send, BellOff, Sparkles, Braces,
  Trash2, ArchiveRestore, OctagonAlert, Tag, FolderInput, CalendarCheck, CalendarPlus, MailMinus,
};

const STATUS_COLOR: Record<ActionStatus, string> = {
  queued: 'var(--accent)',
  running: 'var(--warning)',
  completed: 'var(--success)',
  failed: 'var(--failed)',
  pending_sync: 'var(--warning)',
};

interface ActivityTimelineProps {
  logs: MailActionLog[];
  /** Max rows after dedup; defaults to 8. */
  max?: number;
  /** When set, rows backed by a thread become clickable. */
  onOpenThread?: (threadId: string) => void;
}

// Rich action-log timeline (RA-C9/RA-C11): titled, status-tinted icon rows with
// relative time and retry grouping — no raw enum kinds or Thread IDs.
export function ActivityTimeline({ logs, max = 8, onOpenThread }: ActivityTimelineProps) {
  const items = makeActivityItems(logs, max);
  if (items.length === 0) {
    return <div className="text-[calc(10px*var(--font-scale))] text-[var(--text-secondary)] text-center py-4">No recent activity</div>;
  }
  return (
    <div className="flex flex-col gap-0.5">
      {items.map((item) => {
        const Icon = ICON[item.iconName] || Activity;
        const color = STATUS_COLOR[item.status] || 'var(--text-secondary)';
        const threadId = item.threadId;
        const body = (
          <>
            <span
              className="flex items-center justify-center w-5 h-5 rounded-full shrink-0"
              style={{ backgroundColor: `color-mix(in srgb, ${color} 16%, transparent)` }}
            >
              <Icon className="w-3 h-3" style={{ color }} />
            </span>
            <div className="flex flex-col min-w-0 flex-1">
              <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] truncate">
                {item.title}
                {item.repeatCount > 1 ? ` · ${item.repeatCount} attempts` : ''}
              </span>
              {item.failureMessage && (
                <span className="text-[calc(9px*var(--font-scale))] text-[var(--danger)] truncate">{item.failureMessage}</span>
              )}
            </div>
            <span className="text-[calc(9px*var(--font-scale))] text-[var(--text-tertiary)] shrink-0 whitespace-nowrap">
              {relativeTime(item.createdAt)}
            </span>
          </>
        );
        if (threadId && onOpenThread) {
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onOpenThread(threadId)}
              className="-mx-1.5 flex cursor-pointer items-center gap-2 rounded px-1.5 py-1 text-left transition-colors hover:bg-[var(--app-bg)]"
            >
              {body}
            </button>
          );
        }
        return (
          <div key={item.id} className="-mx-1.5 flex items-center gap-2 rounded px-1.5 py-1">
            {body}
          </div>
        );
      })}
    </div>
  );
}
