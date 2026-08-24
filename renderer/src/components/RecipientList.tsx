import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import { Recipient } from '../../../shared/types';
import {
  countHiddenRecipients,
  joinRecipientNames,
  recipientDisplayName,
  recipientFullIdentity,
  recipientsSignature,
} from '../lib/recipientList';

/**
 * Collapsible To/Cc line for the message header.
 *
 * Follows the established mail-client overflow pattern (Gmail / Apple Mail /
 * Outlook web): the collapsed list fills the available width on a single
 * line; when recipients overflow, a "+N more" expander appears; expanding
 * reveals a wrapped list with the full identity (name + address) of every
 * participant, and the line can be collapsed again. Overflow is measured
 * against the rendered width (ResizeObserver), so it stays correct at any
 * window width or font scale instead of relying on a character count.
 */
export const RecipientList = memo(function RecipientList({
  label,
  recipients,
}: {
  label: string;
  recipients: Recipient[];
}) {
  const [expanded, setExpanded] = useState(false);
  const [hiddenCount, setHiddenCount] = useState(0);
  const lineRef = useRef<HTMLSpanElement>(null);
  const signature = useMemo(() => recipientsSignature(recipients), [recipients]);

  const measure = useCallback(() => {
    const el = lineRef.current;
    if (!el?.isConnected) return;
    const containerRight = el.getBoundingClientRect().right;
    let fullyVisible = 0;
    for (const child of Array.from(el.children)) {
      if (!(child instanceof HTMLElement) || !child.isConnected) break;
      if (child.getBoundingClientRect().right <= containerRight + 1) {
        fullyVisible += 1;
      } else {
        break;
      }
    }
    const nextHidden = countHiddenRecipients(recipients.length, fullyVisible);
    setHiddenCount(current => (current === nextHidden ? current : nextHidden));
  }, [recipients.length]);

  useLayoutEffect(() => {
    if (expanded) return;
    measure();
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        measure();
      });
    };
    const el = lineRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(schedule);
    observer.observe(el);
    return () => {
      observer.disconnect();
      if (frame) cancelAnimationFrame(frame);
    };
  }, [expanded, measure]);

  useEffect(() => {
    setExpanded(false);
  }, [signature]);

  if (recipients.length === 0) return null;

  return (
    <div
      className="flex items-baseline gap-1 min-w-0 text-[calc(10px*var(--font-scale))] text-[var(--text-tertiary)]"
      data-email-search-skip=""
    >
      <span className="shrink-0">{label}:</span>
      {expanded ? (
        <span className="min-w-0 flex-1 leading-snug select-text">
          {recipients.map((recipient, index) => (
            <span key={`${recipient.email}-${index}`} title={recipient.email}>
              {recipientFullIdentity(recipient)}
              {index < recipients.length - 1 ? ', ' : ''}
            </span>
          ))}
        </span>
      ) : (
        <span
          ref={lineRef}
          className="min-w-0 flex-1 truncate"
          title={hiddenCount > 0 ? joinRecipientNames(recipients) : undefined}
        >
          {recipients.map((recipient, index) => (
            <span key={`${recipient.email}-${index}`}>
              {recipientDisplayName(recipient)}
              {index < recipients.length - 1 ? ', ' : ''}
            </span>
          ))}
        </span>
      )}
      {(expanded || hiddenCount > 0) && (
        <button
          type="button"
          onClick={() => setExpanded(value => !value)}
          aria-expanded={expanded}
          title={expanded ? 'Show fewer recipients' : `Show all ${recipients.length} recipients`}
          className="flex items-center gap-0.5 shrink-0 px-1 -mx-1 rounded hover:bg-[var(--hover-row)] hover:text-[var(--accent)] cursor-pointer transition-colors"
        >
          {expanded ? (
            <>
              <span>Show less</span>
              <ChevronUp className="w-3 h-3" />
            </>
          ) : (
            <>
              <span>+{hiddenCount} more</span>
              <ChevronDown className="w-3 h-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
});
