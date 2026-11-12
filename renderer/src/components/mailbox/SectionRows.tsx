import React from 'react';
import { Check, ChevronDown, ChevronRight, Paperclip, Sparkles } from 'lucide-react';
import { listTimestamp } from '../../../../shared/dateFormat';
import { formatLaterChip, laterTimeFor } from '../../../../shared/inboxSections';
import { threadRowSender } from '../../../../shared/threadCounterparty';
import { threadNeedsInviteAnswer } from '../../../../shared/inviteRsvp';
import type { Decision, MailThread, ThreadDecision } from '../../../../shared/types';
import type { ThreadRowLayout } from '../../lib/inboxListItems';

export function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex min-w-[16px] items-center justify-center rounded border border-[var(--strong-border)] px-1 font-mono text-[calc(10px*var(--font-scale))] leading-[14px] text-[var(--text-secondary)]">
      {children}
    </kbd>
  );
}

export function KeyHint({ keys }: { keys: readonly string[] }) {
  if (keys.length === 0) return null;
  return (
    <span aria-hidden="true" className="inline-flex items-center gap-0.5">
      {keys.map((key, index) => <Kbd key={`${key}-${index}`}>{key}</Kbd>)}
    </span>
  );
}

/** Invitation answers on Event rows (Yes / No chips, `Y` / `N`). */
export interface RowRsvp {
  /** null while the account's calendar access is being read. */
  calendarConnected: boolean | null;
  busy: boolean;
  onAnswer: (answer: 'accepted' | 'declined') => void;
  onConnectCalendar: () => void;
}

function stopRowKeys(event: React.KeyboardEvent) {
  // The row opens on Enter / Space; a chip handles its own activation.
  if (event.metaKey || event.ctrlKey || event.altKey) return; // ⌘↩ still reaches the reply dock
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
}

const CHIP_CLASS = 'inline-flex shrink-0 items-center gap-1 rounded-[var(--control-radius)] border px-1.5 text-[calc(10px*var(--font-scale))] font-semibold leading-[18px] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-60';

function RsvpChips({ rsvp, subject }: { rsvp: RowRsvp; subject: string }) {
  if (rsvp.calendarConnected === false) {
    return (
      <button
        type="button"
        data-rsvp-chip="connect"
        title="Connect Google Calendar to answer invitations"
        onClick={(event) => { event.stopPropagation(); rsvp.onConnectCalendar(); }}
        onKeyDown={stopRowKeys}
        className={`${CHIP_CLASS} border-[var(--strong-border)] text-[var(--text-primary)] hover:bg-[var(--hover-row)]`}
      >
        Connect Calendar
      </button>
    );
  }
  return (
    <span className="flex shrink-0 items-center gap-1" role="group" aria-label={`Answer invitation: ${subject}`}>
      <button
        type="button"
        data-rsvp-chip="yes"
        disabled={rsvp.busy}
        aria-keyshortcuts="Y"
        title="Accept and archive (Y)"
        onClick={(event) => { event.stopPropagation(); rsvp.onAnswer('accepted'); }}
        onKeyDown={stopRowKeys}
        className={`${CHIP_CLASS} border-[var(--accent)] text-[var(--accent)] hover:bg-[var(--accent)]/10`}
      >
        Yes <Kbd>Y</Kbd>
      </button>
      <button
        type="button"
        data-rsvp-chip="no"
        disabled={rsvp.busy}
        aria-keyshortcuts="N"
        title="Decline and archive (N)"
        onClick={(event) => { event.stopPropagation(); rsvp.onAnswer('declined'); }}
        onKeyDown={stopRowKeys}
        className={`${CHIP_CLASS} border-[var(--strong-border)] text-[var(--text-primary)] hover:bg-[var(--hover-row)]`}
      >
        No <Kbd>N</Kbd>
      </button>
    </span>
  );
}

export interface SectionAction {
  label: string;
  keys: readonly string[];
  ariaKeyShortcuts?: string;
  onRun: () => void;
  busy?: boolean;
}

function ActionButton({ action }: { action: SectionAction }) {
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        action.onRun();
      }}
      disabled={action.busy}
      aria-keyshortcuts={action.ariaKeyShortcuts}
      className="inline-flex shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] px-1.5 py-0.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-60"
    >
      <span>{action.busy ? 'Preparing…' : action.label}</span>
      <KeyHint keys={action.keys} />
    </button>
  );
}

export function SectionHeaderRow({
  decision,
  label,
  count,
  height,
  action,
  collapsible,
  onCollapse,
}: {
  decision: Decision;
  label: string;
  count: number;
  height: number;
  action?: SectionAction;
  collapsible?: boolean;
  onCollapse?: () => void;
}) {
  const headingId = `section-heading-${decision}`;
  return (
    <div
      role="listitem"
      aria-labelledby={headingId}
      data-section-header={decision}
      style={{ height }}
      className="dm-section-header flex shrink-0 items-center gap-2 overflow-hidden border-b border-[var(--border)] bg-[var(--panel-bg)] px-[var(--row-px)]"
    >
      {collapsible ? (
        <button
          type="button"
          onClick={onCollapse}
          aria-expanded="true"
          aria-label={`Collapse ${label}`}
          className="-ml-1 flex h-5 w-5 shrink-0 items-center justify-center rounded text-[var(--text-secondary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />
        </button>
      ) : null}
      <h3 id={headingId} className="flex min-w-0 items-baseline gap-2 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-normal tabular-nums text-[var(--text-tertiary)]" aria-label={`${count} ${count === 1 ? 'conversation' : 'conversations'}`}>{count}</span>
      </h3>
      <span className="flex-1" />
      {action ? <ActionButton action={action} /> : null}
    </div>
  );
}

export function CollapsedGroupRow({
  decision,
  label,
  count,
  summary,
  height,
  isFocused,
  action,
  onExpand,
}: {
  decision: Decision;
  label: string;
  count: number;
  summary: string;
  height: number;
  isFocused: boolean;
  action?: SectionAction;
  onExpand: () => void;
}) {
  const conversations = `${count} ${count === 1 ? 'conversation' : 'conversations'}`;
  return (
    // The row is a list item; the expand control is a real button inside it,
    // so its expanded state and Enter / Space belong to that button, and the
    // group action button next to it activates on its own keys.
    <div
      role="listitem"
      data-group-row={decision}
      data-section-header={decision}
      onClick={onExpand}
      style={{ height }}
      className={`dm-collapsed-group relative flex shrink-0 cursor-pointer items-center gap-2 overflow-hidden border-b border-[var(--border)] px-[var(--row-px)] ${
        isFocused ? 'bg-[var(--focus-row)]' : 'bg-[var(--panel-bg)] hover:bg-[var(--hover-row)]'
      }`}
    >
      {isFocused && <span aria-hidden="true" className="absolute bottom-0 left-0 top-0 w-[2px] bg-[var(--accent)]" />}
      <button
        type="button"
        data-group-expand={decision}
        aria-expanded={false}
        aria-label={`${label}, ${conversations}: ${summary}. Open the group.`}
        onClick={(event) => {
          event.stopPropagation();
          onExpand();
        }}
        className="-ml-1 flex min-w-0 flex-1 items-center gap-2 self-stretch rounded-[var(--control-radius)] pl-1 text-left outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)]"
      >
        <ChevronRight aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
        <span className="shrink-0 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{label}</span>
        <span className="shrink-0 tabular-nums text-[calc(12px*var(--font-scale))] text-[var(--text-tertiary)]">{count}</span>
        <span className="min-w-0 flex-1 truncate text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">{summary}</span>
      </button>
      {action ? <ActionButton action={action} /> : null}
    </div>
  );
}

export function LateDividerRow({ count, height }: { count: number; height: number }) {
  return (
    <div
      role="listitem"
      style={{ height }}
      className="flex shrink-0 items-center border-b border-[var(--border)] bg-[var(--inset-surface)] px-[var(--row-px)] text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-secondary)]"
    >
      Arrived after you opened this group ({count}) — not included
    </div>
  );
}

export function SearchHeaderRow({ label, height }: { label: string; height: number }) {
  return (
    <div
      role="presentation"
      style={{ height }}
      className="flex shrink-0 items-end px-3 pb-1.5 text-[calc(10px*var(--font-scale))] font-semibold uppercase tracking-wide text-[var(--text-secondary)]"
    >
      {label}
    </div>
  );
}

interface SectionThreadRowProps {
  thread: MailThread;
  section: Decision;
  decision: ThreadDecision;
  layout: Exclude<ThreadRowLayout, 'flat'>;
  height: number;
  isFocused: boolean;
  isOpened: boolean;
  isSelected: boolean;
  isSelectionModeActive: boolean;
  positionInSet: number;
  setSize: number;
  /** Rows of an opened Clear / Unsubscribe group. */
  group?: { inBatch: boolean; checked: boolean };
  onOpen: () => void;
  onToggleSelect: (event: React.MouseEvent) => void;
  onToggleChecked?: (checked: boolean) => void;
  onContextMenu: (event: React.MouseEvent) => void;
  /** Display name of the thread's account, so the row names the other party. */
  accountName?: string;
  /** Present on rows whose invitation still needs an answer. */
  rsvp?: RowRsvp;
}

// Not memoised: the list re-renders on every store change and passes fresh
// callbacks per row, so React.memo would only add a props comparison.
export function SectionThreadRow({
  thread,
  section,
  decision,
  layout,
  height,
  isFocused,
  isOpened,
  isSelected,
  isSelectionModeActive,
  positionInSet,
  setSize,
  group,
  onOpen,
  onToggleSelect,
  onToggleChecked,
  onContextMenu,
  accountName,
  rsvp,
}: SectionThreadRowProps) {
  const sender = threadRowSender(thread, { email: thread.accountId, displayName: accountName });
  const subject = thread.subject.trim() || '(no subject)';
  const timestamp = listTimestamp(thread.lastMessageAt);
  const reason = decision.reason;
  const laterChip = section === 'later' ? formatLaterChip(laterTimeFor(decision)) : null;
  const hasRsvpChips = Boolean(rsvp && threadNeedsInviteAnswer(thread));
  const accessibilityLabel = [
    thread.isUnread ? 'Unread' : null,
    isOpened ? 'currently open' : null,
    isSelected ? 'selected' : null,
    group && group.inBatch ? (group.checked ? 'included in the group action' : 'excluded from the group action') : null,
    group && !group.inBatch ? 'not part of the group action' : null,
    `from ${sender}`,
    `subject ${subject}`,
    reason ? `reason ${reason}` : null,
    hasRsvpChips ? 'invitation needs an answer, Y accepts, N declines' : null,
    laterChip ? `suggested for ${laterChip}` : null,
    thread.hasAttachments ? 'has attachments' : null,
    timestamp ? `last message ${timestamp}` : null,
  ].filter(Boolean).join(', ');

  const unreadDot = (
    <span
      aria-hidden="true"
      className={`h-1.5 w-1.5 shrink-0 rounded-full ${thread.isUnread ? 'bg-[var(--accent)]' : 'bg-transparent'}`}
    />
  );
  const leading = group ? (
    group.inBatch ? (
      <input
        type="checkbox"
        checked={group.checked}
        aria-label={`${group.checked ? 'Exclude' : 'Include'} ${sender}: ${subject}`}
        onClick={(event) => event.stopPropagation()}
        onChange={(event) => onToggleChecked?.(event.target.checked)}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-[var(--accent)]"
      />
    ) : (
      <span aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
    )
  ) : isSelectionModeActive || isSelected ? (
    <button
      type="button"
      aria-label={`${isSelected ? 'Deselect' : 'Select'} thread: ${subject}`}
      aria-pressed={isSelected}
      onClick={(event) => {
        event.stopPropagation();
        onToggleSelect(event);
      }}
      className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-full border ${
        isSelected ? 'border-[var(--accent)] bg-[var(--accent)] text-white' : 'border-[var(--strong-border)] bg-[var(--panel-bg)]'
      }`}
    >
      {isSelected && <Check aria-hidden="true" className="h-2.5 w-2.5 stroke-[3.5px]" />}
    </button>
  ) : unreadDot;

  const eventChips = rsvp && hasRsvpChips ? <RsvpChips rsvp={rsvp} subject={subject} /> : null;
  const laterBadge = laterChip ? (
    <span className="shrink-0 rounded-[var(--control-radius)] border border-[var(--ai-accent)] px-1.5 text-[calc(10px*var(--font-scale))] font-medium text-[var(--text-primary)]">
      {laterChip}
    </span>
  ) : null;

  return (
    <div
      data-thread-row
      data-section={section}
      tabIndex={0}
      role="listitem"
      aria-current={isOpened ? 'true' : undefined}
      aria-label={accessibilityLabel}
      aria-posinset={positionInSet}
      aria-setsize={setSize}
      onClick={(event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey) {
          onToggleSelect(event);
          return;
        }
        onOpen();
      }}
      onContextMenu={onContextMenu}
      onKeyDown={(event) => {
        // Only keys on the row itself: Space on the include checkbox toggles it,
        // Enter on a chip or the selection button activates that control.
        if (event.target !== event.currentTarget) return;
        // ⌘↩ / ⌘⇧↩ belong to the reply dock (send), not to the row.
        if (event.metaKey || event.ctrlKey || event.altKey) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          // The row opens itself; keep the global handler from opening the focused thread too.
          event.stopPropagation();
          onOpen();
        }
      }}
      style={{ height }}
      className={`dm-mail-row relative flex shrink-0 cursor-pointer select-none flex-col justify-center gap-0.5 overflow-hidden border-b border-[var(--border)] px-[var(--row-px)] outline-none transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
        isSelected || isOpened ? 'bg-[var(--selected-row)]' : isFocused ? 'bg-[var(--focus-row)]' : 'hover:bg-[var(--hover-row)]'
      }`}
    >
      {(isFocused || isOpened) && <span aria-hidden="true" className="dm-selection-rail absolute bottom-0 left-0 top-0 w-[2px] bg-[var(--accent)]" />}
      {layout === 'twoLine' ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leading}
            <span className={`max-w-[40%] shrink-0 truncate text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] ${thread.isUnread ? 'font-semibold' : 'font-medium'}`}>
              {sender}
            </span>
            <span className={`min-w-0 flex-1 truncate text-[calc(12px*var(--font-scale))] ${thread.isUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}`}>
              {subject}
            </span>
            {thread.hasAttachments && <Paperclip aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
            {eventChips}
            {laterBadge}
            <span className="shrink-0 whitespace-nowrap text-[calc(10px*var(--font-scale))] tabular-nums text-[var(--text-tertiary)]">{timestamp}</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5 pl-[14px]">
            <Sparkles aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--ai-accent)]" />
            <span className="truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{reason}</span>
          </div>
        </>
      ) : (
        <div className="flex min-w-0 items-center gap-2">
          {leading}
          <span className={`w-[32%] max-w-[200px] shrink-0 truncate text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] ${thread.isUnread ? 'font-semibold' : 'font-medium'}`}>
            {sender}
          </span>
          <span className="min-w-0 flex-1 truncate text-[calc(12px*var(--font-scale))]">
            <span className={thread.isUnread ? 'text-[var(--text-primary)]' : 'text-[var(--text-secondary)]'}>{subject}</span>
            {reason ? <span className="text-[var(--text-tertiary)]"> — {reason}</span> : null}
          </span>
          {thread.hasAttachments && <Paperclip aria-hidden="true" className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />}
          {eventChips}
          {laterBadge}
          <span className="shrink-0 whitespace-nowrap text-[calc(10px*var(--font-scale))] tabular-nums text-[var(--text-tertiary)]">{timestamp}</span>
        </div>
      )}
    </div>
  );
}
