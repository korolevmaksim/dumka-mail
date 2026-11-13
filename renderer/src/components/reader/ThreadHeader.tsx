// Thread header (SPEC §3): subject on its own line(s), the other party below,
// and four labelled actions `Reply R`, `Archive E`, `Later H`, `More`.
// The header is a size container: below ~720 px the labels collapse to icons
// (accessible names and tooltips stay), and below ~460 px the actions move
// under the subject, so the four buttons never clip or scroll sideways.
import type { ReactNode } from 'react';
import { Archive, ArrowLeft, Clock, MoreHorizontal, Reply } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { ActionMenu, type ActionMenuItem } from './ActionMenu';
import type { Counterparty } from '../../../../shared/threadCounterparty';
import { formatLaterChip } from '../../../../shared/inboxSections';
import { hintLabel, type ActionKeyHint } from '../../lib/actionKeyHints';

const BUTTON_BASE = 'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-[var(--control-radius)] border px-2.5 text-[calc(12px*var(--font-scale))] font-semibold transition-colors hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-default disabled:opacity-45 motion-reduce:transition-none';
const BUTTON_CLASS = `${BUTTON_BASE} border-[var(--strong-border)] bg-[var(--raised-surface)] text-[var(--text-primary)]`;
const BUTTON_PRESSED_CLASS = `${BUTTON_BASE} border-[var(--accent)] bg-[var(--raised-surface)] text-[var(--accent-ink)]`;
const MORE_BUTTON_CLASS = `${BUTTON_BASE} border-transparent text-[var(--text-primary)]`;

function KeyCap({ children }: { children: ReactNode }) {
  return (
    <kbd aria-hidden="true" className="inline-flex min-w-[16px] items-center justify-center rounded border border-[var(--border)] px-1 font-mono text-[calc(10px*var(--font-scale))] font-medium leading-[14px] text-[var(--text-secondary)] @max-[720px]:hidden">
      {children}
    </kbd>
  );
}

function HeaderButton({
  label,
  detail,
  hint,
  icon: Icon,
  onClick,
  disabled,
  disabledReason,
  testId,
  pressed,
}: {
  label: string;
  /** Extra visible text after the label (e.g. the reminder time); part of the accessible name. */
  detail?: string;
  /** Key for the current shortcut mode; no key cap when unbound. */
  hint: ActionKeyHint;
  icon: LucideIcon;
  onClick: () => void;
  disabled?: boolean;
  disabledReason?: string;
  testId: string;
  /** Toggle-like state (Later: a reminder is set). Conveyed by aria-pressed and text, not only colour. */
  pressed?: boolean;
}) {
  const keyText = hintLabel(hint);
  const fullLabel = detail ? `${label} · ${detail}` : label;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      disabled={disabled}
      title={disabled && disabledReason ? disabledReason : keyText ? `${fullLabel} (${keyText})` : fullLabel}
      aria-keyshortcuts={hint.aria}
      aria-pressed={pressed === undefined ? undefined : pressed}
      data-reader-action={testId}
      className={pressed ? BUTTON_PRESSED_CLASS : BUTTON_CLASS}
    >
      <Icon aria-hidden="true" className="h-3.5 w-3.5 shrink-0 @min-[721px]:hidden" />
      {/* sr-only keeps the accessible name when the label collapses to the icon. */}
      <span className="@max-[720px]:sr-only">
        {label}
        {detail ? <span className="font-normal"> · {detail}</span> : null}
      </span>
      {hint.keys.length > 0 ? <KeyCap>{keyText}</KeyCap> : null}
    </button>
  );
}

export interface ThreadHeaderProps {
  subject: string;
  counterparty: Counterparty | null;
  identityLoading: boolean;
  messageCount: number;
  showBack: boolean;
  backLabel: string;
  onBack: () => void;
  onReply: () => void;
  canReply: boolean;
  onArchive: () => void;
  canArchive: boolean;
  onLater: () => void;
  /** ISO time of the thread's reminder, if one is set. */
  reminderAt: string | null | undefined;
  hints: { reply: ActionKeyHint; archive: ActionKeyHint; later: ActionKeyHint };
  moreItems: ActionMenuItem[];
  /** Popovers anchored to the actions (label menu). */
  children?: ReactNode;
}

export function ThreadHeader({
  subject,
  counterparty,
  identityLoading,
  messageCount,
  showBack,
  backLabel,
  onBack,
  onReply,
  canReply,
  onArchive,
  canArchive,
  onLater,
  reminderAt,
  hints,
  moreItems,
  children,
}: ThreadHeaderProps) {
  const reminderDate = reminderAt ? new Date(reminderAt) : null;
  const reminderText = reminderDate && Number.isFinite(reminderDate.getTime()) ? formatLaterChip(reminderDate) : null;
  return (
    <header className="dm-reader-header @container shrink-0 border-b border-[var(--border)] select-text" data-reader-header>
      {showBack && (
        <button
          type="button"
          onClick={onBack}
          className="print-hidden mb-3 flex items-center gap-1 rounded bg-[var(--hover-row)] px-2 py-1 text-[calc(11px*var(--font-scale))] font-medium text-[var(--accent-ink)] select-none hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]"
        >
          <ArrowLeft aria-hidden="true" className="h-3.5 w-3.5" />
          {backLabel}
        </button>
      )}
      <div className="flex items-start gap-4 @max-[460px]:flex-col @max-[460px]:gap-2">
        <div className="min-w-0 flex-1">
          <h1 className="text-thread-title break-words text-[var(--text-primary)]" data-reader-subject>
            {subject.trim() || '(no subject)'}
          </h1>
          <div className="mt-1 flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5 text-[calc(12px*var(--font-scale))]" data-reader-counterparty>
            {counterparty ? (
              <>
                <span className="font-semibold text-[var(--text-primary)]">{counterparty.name}</span>
                {counterparty.email && counterparty.email !== counterparty.name && (
                  <span className="min-w-0 truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">{counterparty.email}</span>
                )}
                {messageCount > 1 && (
                  <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">{messageCount} messages</span>
                )}
              </>
            ) : (
              <span className="text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
                {identityLoading ? 'Loading sender…' : ''}
              </span>
            )}
          </div>
        </div>

        <div className="print-hidden relative flex shrink-0 items-center gap-1.5 select-none" role="toolbar" aria-label="Conversation actions" data-reader-actions>
          <HeaderButton label="Reply" hint={hints.reply} icon={Reply} onClick={onReply} disabled={!canReply} disabledReason="Nothing to reply to yet" testId="reply" />
          <HeaderButton label="Archive" hint={hints.archive} icon={Archive} onClick={onArchive} disabled={!canArchive} disabledReason="This conversation is not in the inbox" testId="archive" />
          {/* A set reminder shows its time and aria-pressed, not only the accent border. */}
          <HeaderButton
            label="Later"
            detail={reminderText ?? undefined}
            hint={hints.later}
            icon={Clock}
            onClick={onLater}
            testId="later"
            pressed={Boolean(reminderAt)}
          />
          <ActionMenu
            label="More actions"
            triggerTitle="More actions"
            items={moreItems}
            testId="more"
            triggerClassName={MORE_BUTTON_CLASS}
          >
            <MoreHorizontal aria-hidden="true" className="h-3.5 w-3.5 shrink-0 @min-[721px]:hidden" />
            <span className="@max-[720px]:sr-only">More</span>
          </ActionMenu>
          {children}
        </div>
      </div>
    </header>
  );
}
