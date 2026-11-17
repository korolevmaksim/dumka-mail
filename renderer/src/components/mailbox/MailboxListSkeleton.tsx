import type { ListItemMetrics } from '../../lib/inboxListItems';

/** Bar widths in percent of their column, cycled so the rows do not look like a grid. */
const SENDER_WIDTHS = [62, 84, 48, 74, 56, 90, 68, 44];
const SUBJECT_WIDTHS = [78, 52, 91, 64, 43, 85, 58, 70];
const PREVIEW_WIDTHS = [92, 70, 84, 56, 96, 62, 78, 88];

/** Chips of the section jump bar above the sectioned inbox, in px. */
const JUMP_BAR_WIDTHS = [58, 44, 52, 72];

/** Rows before the second section header in the sectioned inbox. */
const FIRST_SECTION_ROWS = 4;
const MAX_ROWS = 40;

type SkeletonItem = { kind: 'header' } | { kind: 'row'; index: number };

/**
 * What the placeholder list holds: enough rows to fill the viewport and no more
 * (they are clipped, never scrolled). The sectioned inbox gets two section
 * headers, a flat mailbox none.
 */
export function mailboxSkeletonItems(input: {
  sectioned: boolean;
  metrics: ListItemMetrics;
  viewportHeight: number;
}): SkeletonItem[] {
  const { sectioned, metrics } = input;
  const available = input.viewportHeight > 0 ? input.viewportHeight : 600;
  const rowHeight = Math.max(1, sectioned ? metrics.oneLine : metrics.flatRow);
  const items: SkeletonItem[] = [];
  let used = 0;
  let rows = 0;
  while (used < available && rows < MAX_ROWS) {
    if (sectioned && (rows === 0 || rows === FIRST_SECTION_ROWS)) {
      items.push({ kind: 'header' });
      used += metrics.sectionHeader;
    }
    items.push({ kind: 'row', index: rows });
    used += rowHeight;
    rows += 1;
  }
  return items;
}

function Bar({ width, className = '' }: { width: string; className?: string }) {
  return <span className={`mailbox-skeleton-bar ${className}`} style={{ width }} />;
}

/** One text line of a flat row: the bar sits where the text's x-height would. */
const lineClass = 'flex h-[calc(15px*var(--font-scale))] items-center';

/**
 * Placeholder rows for a mailbox whose conversations are still being read,
 * indexed or filtered. Rows keep the real rows' heights and columns, so the
 * list does not jump when the conversations replace them.
 */
export function MailboxListSkeleton({
  sectioned,
  metrics,
  viewportHeight,
  showAvatars,
}: {
  sectioned: boolean;
  metrics: ListItemMetrics;
  viewportHeight: number;
  showAvatars: boolean;
}) {
  const items = mailboxSkeletonItems({ sectioned, metrics, viewportHeight });
  return (
    <div
      data-mailbox-skeleton={sectioned ? 'sections' : 'flat'}
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="mailbox-skeleton flex min-h-0 flex-1 flex-col"
    >
      <span className="sr-only">Loading conversations…</span>
      {sectioned && (
        // Stands where the section jump bar will be, so the first section does not shift down.
        <div aria-hidden="true" className="flex shrink-0 items-center gap-4 border-b border-[var(--border)] px-[var(--row-px)] py-1">
          {JUMP_BAR_WIDTHS.map((width, index) => (
            <span key={index} className={`${lineClass} py-0.5 box-content`}>
              <Bar width={`${width}px`} />
            </span>
          ))}
        </div>
      )}
      {items.map((item, position) => {
        if (item.kind === 'header') {
          return (
            <div
              key={`header-${position}`}
              aria-hidden="true"
              style={{ height: metrics.sectionHeader }}
              className="flex shrink-0 items-center border-b border-[var(--border)] px-[var(--row-px)]"
            >
              <Bar width={position === 0 ? '64px' : '88px'} />
            </div>
          );
        }
        const pick = (widths: number[]) => `${widths[item.index % widths.length]}%`;
        if (sectioned) {
          return (
            <div
              key={`row-${item.index}`}
              aria-hidden="true"
              style={{ height: metrics.oneLine }}
              className="flex shrink-0 items-center gap-2 border-b border-[var(--border)] px-[var(--row-px)]"
            >
              <span className="h-1.5 w-1.5 shrink-0" />
              <span className="w-[32%] max-w-[200px] shrink-0">
                <Bar width={pick(SENDER_WIDTHS)} />
              </span>
              <span className="min-w-0 flex-1">
                <Bar width={pick(SUBJECT_WIDTHS)} />
              </span>
              <Bar width="34px" className="shrink-0" />
            </div>
          );
        }
        return (
          <div
            key={`row-${item.index}`}
            aria-hidden="true"
            style={{ height: metrics.flatRow }}
            className="flex shrink-0 items-start gap-2.5 overflow-hidden border-b border-[var(--border)] px-[var(--row-px)] py-2"
          >
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center">
              {showAvatars && <span className="mailbox-skeleton-bar" style={{ width: 24, height: 24 }} />}
            </span>
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className={`${lineClass} justify-between gap-2`}>
                <span className="w-[45%]">
                  <Bar width={pick(SENDER_WIDTHS)} />
                </span>
                <Bar width="34px" className="shrink-0" />
              </span>
              <span className={lineClass}>
                <Bar width={pick(SUBJECT_WIDTHS)} />
              </span>
              <span className={lineClass}>
                <Bar width={pick(PREVIEW_WIDTHS)} />
              </span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
