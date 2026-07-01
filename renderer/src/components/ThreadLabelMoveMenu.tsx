import { FolderInput, Tags } from 'lucide-react';
import type { LabelTreeNode } from '../../../shared/labels';

interface ThreadLabelMoveMenuProps {
  nodes: LabelTreeNode[];
  onMove: (labelId: string) => void;
  onSyncLabels: () => void;
  className?: string;
}

export function ThreadLabelMoveMenu({
  nodes,
  onMove,
  onSyncLabels,
  className = '',
}: ThreadLabelMoveMenuProps) {
  return (
    <div
      className={`z-30 w-[230px] max-h-[280px] overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl ${className}`}
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
      ) : nodes.map(node => (
        node.label ? (
          <button
            key={node.fullName}
            type="button"
            onClick={() => onMove(node.label!.id)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
            style={{ paddingLeft: `${10 + node.depth * 14}px` }}
          >
            <FolderInput className="h-3.5 w-3.5 text-[var(--text-secondary)]" />
            <span className="truncate">{node.segment}</span>
          </button>
        ) : (
          <div
            key={node.fullName}
            className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[calc(10px*var(--font-scale))] font-semibold text-[var(--text-secondary)]"
            style={{ paddingLeft: `${10 + node.depth * 14}px` }}
          >
            <FolderInput className="h-3.5 w-3.5 text-[var(--text-tertiary)]" />
            <span className="truncate">{node.segment}</span>
          </div>
        )
      ))}
    </div>
  );
}
