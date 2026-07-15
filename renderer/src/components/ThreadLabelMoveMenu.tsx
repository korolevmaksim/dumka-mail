import { Check, FolderInput, Tag, Tags, X } from 'lucide-react';
import type { LabelPresence, LabelTreeNode } from '../../../shared/labels';

interface ThreadLabelMoveMenuProps {
  nodes: LabelTreeNode[];
  onMove?: (labelId: string) => void;
  onApply?: (labelId: string) => void;
  onRemove?: (labelId: string) => void;
  onSyncLabels: () => void;
  currentLabelIds?: readonly string[];
  labelPresenceById?: Readonly<Record<string, LabelPresence>>;
  className?: string;
}

export function ThreadLabelMoveMenu({
  nodes,
  onMove,
  onApply,
  onRemove,
  onSyncLabels,
  currentLabelIds = [],
  labelPresenceById = {},
  className = '',
}: ThreadLabelMoveMenuProps) {
  const currentLabelSet = new Set(currentLabelIds);

  return (
    <div
      className={`dm-overlay z-30 w-[300px] max-h-[320px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl ${className}`}
      onClick={(event) => event.stopPropagation()}
    >
      {nodes.length === 0 ? (
        <button
          type="button"
          onClick={onSyncLabels}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
        >
          <Tags className="h-3.5 w-3.5" />
          Sync Gmail labels
        </button>
      ) : nodes.map(node => {
        if (!node.label) {
          return (
            <div
              key={node.fullName}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]"
              style={{ paddingLeft: `${10 + node.depth * 14}px` }}
            >
              <FolderInput className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
              <span className="truncate">{node.segment}</span>
            </div>
          );
        }

        const labelId = node.label.id;
        const presence = labelPresenceById[labelId] || (currentLabelSet.has(labelId) ? 'all' : 'none');
        const isApplied = presence === 'all';
        const isPartiallyApplied = presence === 'some';

        return (
          <div
            key={node.fullName}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
            style={{ paddingLeft: `${10 + node.depth * 14}px` }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FolderInput className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
              <span className="min-w-0 truncate">{node.segment}</span>
              {isApplied && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-label="Applied" />
              )}
              {isPartiallyApplied && (
                <span className="shrink-0 rounded bg-[var(--app-bg)] px-1.5 py-0.5 text-[calc(9px*var(--font-scale))] text-[var(--text-secondary)]">
                  Some
                </span>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-0.5">
              {onMove && (
                <button
                  type="button"
                  title="Move to label"
                  onClick={() => onMove(labelId)}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
                >
                  <FolderInput className="h-3.5 w-3.5" />
                </button>
              )}
              {onApply && (
                <button
                  type="button"
                  title="Apply label"
                  onClick={() => onApply(labelId)}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--text-primary)]"
                >
                  <Tag className="h-3.5 w-3.5" />
                </button>
              )}
              {onRemove && presence !== 'none' && (
                <button
                  type="button"
                  title="Remove label"
                  onClick={() => onRemove(labelId)}
                  className="rounded p-1.5 text-[var(--text-secondary)] hover:bg-[var(--border)] hover:text-[var(--danger)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
