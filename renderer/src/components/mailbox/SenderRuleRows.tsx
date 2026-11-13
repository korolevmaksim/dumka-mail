// Sender-rule surfaces at the top of the sectioned inbox (SPEC §7): the quiet
// offer row, the "Handled for you" row with its expanded list, and the
// consent dialog used by the context menu `Always archive from this sender…`.
import React, { useCallback, useId, useRef } from 'react';
import { ChevronDown, ChevronRight, Sparkles, X } from 'lucide-react';
import { listTimestamp } from '../../../../shared/dateFormat';
import {
  SENDER_RULE_OFFER_DESCRIPTION,
  senderRuleAutonomyConsent,
  senderRuleOfferTitle,
} from '../../../../shared/senderRules';
import type { SenderRuleHandledItem } from '../../../../shared/types';
import { useDialogFocus } from '../../hooks/useDialogFocus';
import type { SenderRuleConsent } from '../../stores/useSenderRules';

const BUTTON_CLASS = 'inline-flex shrink-0 items-center rounded-[var(--control-radius)] border border-[var(--strong-border)] px-2 py-0.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)] hover:bg-[var(--hover-row)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-60';
const PRIMARY_BUTTON_CLASS = 'inline-flex shrink-0 items-center rounded-[var(--control-radius)] bg-[var(--accent-fill)] px-2 py-0.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--accent)] disabled:cursor-wait disabled:opacity-60';

function stopKeys(event: React.KeyboardEvent) {
  // Buttons activate themselves; keep Enter / Space from reaching row handlers.
  if (event.metaKey || event.ctrlKey || event.altKey) return; // ⌘↩ still reaches the reply dock
  if (event.key === 'Enter' || event.key === ' ') event.stopPropagation();
}

export function SenderRuleOfferRow({
  offer,
  accountEmail,
  busy,
  onAccept,
  onDismiss,
}: {
  offer: SenderRuleConsent;
  accountEmail: string;
  busy: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const titleId = useId();
  const descId = useId();
  return (
    <section
      data-rule-offer={offer.senderEmail}
      aria-labelledby={titleId}
      aria-describedby={descId}
      className="flex shrink-0 flex-col gap-1.5 border-b border-[var(--border)] bg-[var(--panel-bg)] px-[var(--row-px)] py-2"
    >
      <h3 id={titleId} className="flex items-center gap-1.5 text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ai-solid)]" />
        <span className="truncate">{senderRuleOfferTitle(offer.senderName)}</span>
      </h3>
      <div id={descId} className="flex flex-col gap-0.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
        <p>{SENDER_RULE_OFFER_DESCRIPTION}</p>
        {offer.needsAutonomy ? <p>{senderRuleAutonomyConsent(accountEmail)}</p> : null}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" data-rule-offer-accept onClick={onAccept} onKeyDown={stopKeys} disabled={busy} className={PRIMARY_BUTTON_CLASS}>
          Always archive
        </button>
        <button type="button" data-rule-offer-dismiss onClick={onDismiss} onKeyDown={stopKeys} disabled={busy} className={BUTTON_CLASS}>
          Not now
        </button>
      </div>
    </section>
  );
}

function ruleLabel(item: SenderRuleHandledItem): string {
  return `Rule: ${item.senderName || item.senderEmail}`;
}

export function HandledForYouRow({
  items,
  expanded,
  isFocused,
  onToggle,
  onBringBack,
  onBringBackAll,
  onMarkReviewed,
}: {
  items: SenderRuleHandledItem[];
  expanded: boolean;
  isFocused: boolean;
  onToggle: (expand?: boolean) => void;
  onBringBack: (item: SenderRuleHandledItem) => void;
  onBringBackAll: () => void;
  onMarkReviewed: () => void;
}) {
  const listId = useId();
  const count = items.length;
  const Chevron = expanded ? ChevronDown : ChevronRight;
  return (
    <div role="list" aria-label="Handled for you" className="flex shrink-0 flex-col border-b border-[var(--border)]">
      <div
        role="listitem"
        data-handled-row
        tabIndex={0}
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        aria-label={`Handled for you, ${count} ${count === 1 ? 'conversation' : 'conversations'} archived by your sender rules. Press Enter to ${expanded ? 'close' : 'review'}.`}
        onClick={() => onToggle()}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.metaKey || event.ctrlKey || event.altKey) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            event.stopPropagation();
            onToggle();
          }
        }}
        className={`flex shrink-0 cursor-pointer items-center gap-2 px-[var(--row-px)] py-2 outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--accent)] ${
          isFocused ? 'bg-[var(--focus-row)]' : 'bg-[var(--panel-bg)] hover:bg-[var(--hover-row)]'
        }`}
      >
        <Chevron aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
        <Sparkles aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-[var(--ai-solid)]" />
        <span className="text-[calc(12px*var(--font-scale))] font-semibold text-[var(--text-primary)]">Handled for you</span>
        <span className="tabular-nums text-[calc(12px*var(--font-scale))] text-[var(--text-tertiary)]">{count}</span>
        <span className="min-w-0 flex-1 truncate text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">archived by your sender rules</span>
        <span aria-hidden="true" className="shrink-0 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-primary)]">{expanded ? 'Close' : 'Review'}</span>
      </div>
      {expanded ? (
        <div className="flex max-h-[45vh] flex-col overflow-y-auto border-t border-[var(--border)] bg-[var(--panel-bg)]">
          <ul id={listId} aria-label="Archived by sender rules" className="flex flex-col divide-y divide-[var(--border)]">
            {items.map(item => (
              <li key={item.actionId} data-handled-item={item.threadId} className="flex items-center gap-2 px-[var(--row-px)] py-1.5">
                <span className="w-[28%] min-w-0 shrink-0 truncate text-[calc(12px*var(--font-scale))] font-medium text-[var(--text-primary)]">
                  {item.senderName || item.senderEmail}
                </span>
                <span className="min-w-0 flex-1 truncate text-[calc(12px*var(--font-scale))] text-[var(--text-secondary)]">{item.subject || '(no subject)'}</span>
                <span className="hidden shrink-0 truncate text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)] sm:inline">{ruleLabel(item)}</span>
                <time dateTime={item.handledAt} className="shrink-0 tabular-nums text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
                  {listTimestamp(item.handledAt)}
                </time>
                <button
                  type="button"
                  onClick={() => onBringBack(item)}
                  onKeyDown={stopKeys}
                  aria-label={`Bring back ${item.subject || 'conversation'} from ${item.senderName || item.senderEmail}`}
                  className={BUTTON_CLASS}
                >
                  Bring back
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 border-t border-[var(--border)] px-[var(--row-px)] py-2">
            <button type="button" data-handled-bring-all onClick={onBringBackAll} onKeyDown={stopKeys} className={BUTTON_CLASS}>
              Bring all back
            </button>
            <button type="button" data-handled-reviewed onClick={onMarkReviewed} onKeyDown={stopKeys} className={BUTTON_CLASS}>
              Mark reviewed
            </button>
            <span className="min-w-0 flex-1 truncate text-[calc(11px*var(--font-scale))] text-[var(--text-tertiary)]">
              A sender you bring back twice stops being handled automatically.
            </span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/** Consent for `Always archive from this sender…` (context menu); same text as the offer row. */
export function SenderRuleConsentDialog({
  consent,
  onConfirm,
  onCancel,
}: {
  consent: SenderRuleConsent;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const descId = useId();
  const cancel = useCallback(() => onCancel(), [onCancel]);
  useDialogFocus(dialogRef, confirmRef, cancel);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) cancel();
    }}>
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={descId}
        data-rule-consent={consent.senderEmail}
        onKeyDown={event => {
          event.stopPropagation();
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            onConfirm();
          }
        }}
        className="dm-overlay flex w-[min(440px,92vw)] flex-col overflow-hidden rounded-xl border border-[var(--strong-border)] bg-[var(--panel-bg)] shadow-2xl select-none"
      >
        <header className="flex items-start justify-between gap-3 border-b border-[var(--border)] px-4 py-3">
          <h2 id={titleId} className="min-w-0 text-[calc(13px*var(--font-scale))] font-semibold text-[var(--text-primary)]">
            {senderRuleOfferTitle(consent.senderName)}
          </h2>
          <button
            type="button"
            onClick={cancel}
            aria-label="Cancel"
            className="rounded p-1 text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]"
          >
            <X className="h-4 w-4" />
          </button>
        </header>
        <div id={descId} className="flex flex-col gap-2 px-4 py-3 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
          <p className="text-[var(--text-primary)]">{consent.senderEmail}</p>
          <p>{SENDER_RULE_OFFER_DESCRIPTION}</p>
          {consent.needsAutonomy ? <p>{senderRuleAutonomyConsent(consent.accountId)}</p> : null}
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <button
            type="button"
            onClick={cancel}
            className="rounded-md border border-[var(--border)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
          >
            Not now
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={onConfirm}
            aria-keyshortcuts="Meta+Enter"
            className="inline-flex items-center gap-1.5 rounded-md bg-[var(--accent-fill)] px-3 py-1.5 text-[calc(11px*var(--font-scale))] font-semibold text-[var(--on-accent)] hover:opacity-95"
          >
            Always archive
            <kbd className="text-[calc(10px*var(--font-scale))] font-normal opacity-80">⌘↩</kbd>
          </button>
        </div>
      </section>
    </div>
  );
}
