import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, FolderInput, Search, Tag, Tags, X } from 'lucide-react';
import {
  filterLabelTree,
  flattenLabelTree,
  selectableLabeledNodes,
  type LabelPresence,
  type LabelTreeNode,
} from '../../../shared/labels';

interface ThreadLabelMoveMenuProps {
  nodes: LabelTreeNode[];
  onMove?: (labelId: string) => void;
  onApply?: (labelId: string) => void;
  onRemove?: (labelId: string) => void;
  onSyncLabels: () => void;
  onClose?: () => void;
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
  onClose,
  currentLabelIds = [],
  labelPresenceById = {},
  className = '',
}: ThreadLabelMoveMenuProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const currentLabelSet = new Set(currentLabelIds);
  const visibleNodes = useMemo(() => filterLabelTree(nodes, query), [nodes, query]);
  const renderedNodes = useMemo(() => flattenLabelTree(visibleNodes), [visibleNodes]);
  const labeledNodes = useMemo(() => selectableLabeledNodes(visibleNodes), [visibleNodes]);

  useEffect(() => {
    previousFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    inputRef.current?.focus();
    return () => {
      previousFocusRef.current?.focus();
    };
  }, []);

  useEffect(() => {
    if (activeIndex >= labeledNodes.length) {
      setActiveIndex(Math.max(0, labeledNodes.length - 1));
    }
  }, [activeIndex, labeledNodes.length]);

  const activate = (labelId: string) => {
    if (onApply) {
      onApply(labelId);
      return;
    }
    onMove?.(labelId);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      onClose?.();
      return;
    }
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex(index => Math.min(labeledNodes.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex(index => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      const active = labeledNodes[activeIndex];
      if (!active?.label) return;
      event.preventDefault();
      activate(active.label.id);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Labels"
      className={`dm-overlay z-30 w-[300px] max-h-[360px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--panel-bg)] p-1.5 shadow-xl ${className}`}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
    >
      <div className="mb-1.5 flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--app-bg)] px-2 py-1.5">
        <Search className="h-3.5 w-3.5 shrink-0 text-[var(--text-tertiary)]" />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          placeholder="Filter labels"
          aria-label="Filter labels"
          className="min-w-0 flex-1 bg-transparent text-[calc(12px*var(--font-scale))] text-[var(--text-primary)] outline-none placeholder:text-[var(--text-tertiary)]"
        />
      </div>
      <div className="max-h-[292px] overflow-y-auto">
      {renderedNodes.length === 0 ? (
        nodes.length === 0 ? (
        <button
          type="button"
          onClick={onSyncLabels}
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] hover:bg-[var(--hover-row)]"
        >
          <Tags className="h-3.5 w-3.5" />
          Sync Gmail labels
        </button>
        ) : (
          <div className="px-2.5 py-2 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
            No labels match “{query.trim()}”.
          </div>
        )
      ) : renderedNodes.map(node => {
        if (!node.label) {
          return (
            <div
              key={node.fullName}
              className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[calc(11px*var(--font-scale))] font-semibold text-[var(--text-secondary)]"
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
        const isActive = labeledNodes[activeIndex]?.label?.id === labelId;

        return (
          <div
            key={node.fullName}
            className={`flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[calc(11px*var(--font-scale))] text-[var(--text-primary)] ${
              isActive ? 'bg-[var(--focus-row)]' : 'hover:bg-[var(--hover-row)]'
            }`}
            style={{ paddingLeft: `${10 + node.depth * 14}px` }}
          >
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <FolderInput className="h-3.5 w-3.5 shrink-0 text-[var(--text-secondary)]" />
              <span className="min-w-0 truncate">{node.segment}</span>
              {isApplied && (
                <Check className="h-3.5 w-3.5 shrink-0 text-[var(--success)]" aria-label="Applied" />
              )}
              {isPartiallyApplied && (
                <span className="shrink-0 rounded bg-[var(--app-bg)] px-1.5 py-0.5 text-[calc(11px*var(--font-scale))] text-[var(--text-secondary)]">
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
    </div>
  );
}
