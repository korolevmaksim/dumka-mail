import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';
import { useAppStore } from '../../stores/AppStore';
import { computeVisibleTabCount } from '../../../../shared/splitTabs';
import type { TabCategory } from '../../../../shared/types';

/** Horizontal gap between tabs in the strip (Tailwind `gap-1`). */
const TAB_GAP_PX = 4;

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function SplitTabBar({ categories }: { categories: TabCategory[] }) {
  const store = useAppStore();
  const stripRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [tabWidths, setTabWidths] = useState<number[]>([]);
  const [moreButtonWidth, setMoreButtonWidth] = useState(0);
  const [moreOpen, setMoreOpen] = useState(false);
  const [moreAnchor, setMoreAnchor] = useState<{ top: number; right: number } | null>(null);
  const moreButtonRef = useRef<HTMLButtonElement>(null);
  const [draggedTabId, setDraggedTabId] = useState<string | null>(null);
  const [dragOverTabId, setDragOverTabId] = useState<string | null>(null);

  const totalUnread = categories.reduce((sum, category) => sum + (store.splitUnreadCounts[category.id] || 0), 0);
  const categoryKey = categories.map(category => category.id).join(',');

  // Measure the real tab widths from a hidden replica strip so the overflow
  // math matches what the browser would lay out. Runs after every render;
  // state guards below keep it from looping.
  useLayoutEffect(() => {
    const measure = () => {
      const strip = stripRef.current;
      const measureStrip = measureRef.current;
      if (!strip || !measureStrip) return;
      const children = Array.from(measureStrip.children) as HTMLElement[];
      const nextTabWidths = children
        .slice(0, categories.length)
        .map(child => child.offsetWidth + TAB_GAP_PX);
      const moreButton = children[categories.length];
      const nextMoreButtonWidth = moreButton ? moreButton.offsetWidth + TAB_GAP_PX : 0;
      const nextContainerWidth = strip.clientWidth;
      setTabWidths(previous => (sameNumbers(previous, nextTabWidths) ? previous : nextTabWidths));
      setMoreButtonWidth(previous => (Math.abs(previous - nextMoreButtonWidth) < 1 ? previous : nextMoreButtonWidth));
      setContainerWidth(previous => (Math.abs(previous - nextContainerWidth) < 1 ? previous : nextContainerWidth));
    };

    measure();
    const strip = stripRef.current;
    if (!strip) return;
    const observer = new ResizeObserver(measure);
    observer.observe(strip);
    return () => observer.disconnect();
  });

  useEffect(() => {
    if (!moreOpen) return;
    const close = () => setMoreOpen(false);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [moreOpen]);

  useEffect(() => {
    if (!moreOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMoreOpen(false);
    };
    const close = () => setMoreOpen(false);
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', close);
    };
  }, [moreOpen]);

  // Close the overflow menu when the tab set itself changes.
  useEffect(() => {
    setMoreOpen(false);
  }, [categoryKey]);

  const measured = tabWidths.length === categories.length && containerWidth > 0;
  // Always keep at least one tab on the strip: a zero-tab bar is useless, and
  // with a content-sized container it would lock the bar into the collapsed state.
  const fitCount = categories.length === 0
    ? 0
    : Math.max(1, measured ? computeVisibleTabCount(tabWidths, containerWidth, moreButtonWidth) : categories.length);

  let visibleTabs = categories.slice(0, fitCount);
  let overflowTabs = categories.slice(fitCount);
  if (fitCount > 0 && overflowTabs.some(category => category.id === store.activeSplit)) {
    // The active tab must stay on the strip: swap it with the last fitting tab.
    const activeIndex = categories.findIndex(category => category.id === store.activeSplit);
    const reordered = [...categories];
    [reordered[fitCount - 1], reordered[activeIndex]] = [reordered[activeIndex], reordered[fitCount - 1]];
    visibleTabs = reordered.slice(0, fitCount);
    overflowTabs = reordered.slice(fitCount);
  }
  const overflowUnread = overflowTabs.reduce((sum, category) => sum + (store.splitUnreadCounts[category.id] || 0), 0);

  const selectTab = (id: string) => {
    store.setWorkspaceView('mail');
    store.setActiveSplit(id);
    store.setSettingsOpen(false);
    store.setCleanupOpen(false);
    setMoreOpen(false);
  };

  const handleDragStartTab = (event: React.DragEvent, id: string) => {
    setDraggedTabId(id);
    event.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOverTab = (event: React.DragEvent) => {
    event.preventDefault();
  };

  const handleDragEnterTab = (event: React.DragEvent, id: string) => {
    event.preventDefault();
    setDragOverTabId(id);
  };

  const handleDropTab = (event: React.DragEvent, targetId: string) => {
    event.preventDefault();
    if (draggedTabId && draggedTabId !== targetId) {
      const draggedIndex = store.tabCategories.findIndex(c => c.id === draggedTabId);
      const targetIndex = store.tabCategories.findIndex(c => c.id === targetId);
      if (draggedIndex !== -1 && targetIndex !== -1) {
        const newCategories = [...store.tabCategories];
        const [removed] = newCategories.splice(draggedIndex, 1);
        newCategories.splice(targetIndex, 0, removed);
        store.updateTabCategoriesOrder(newCategories);
      }
    }
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  const handleDragEndTab = () => {
    setDraggedTabId(null);
    setDragOverTabId(null);
  };

  const renderBadge = (category: TabCategory) => {
    const unread = store.splitUnreadCounts[category.id] || 0;
    const count = store.splitCounts[category.id] || 0;
    if (unread > 0) {
      return (
        <span className="rounded-full bg-[var(--accent)] px-1 text-[calc(10px*var(--font-scale))] font-semibold text-white">
          {unread}
        </span>
      );
    }
    if (count > 0) {
      return (
        <span className="text-[calc(10px*var(--font-scale))] font-normal text-[var(--text-tertiary)]">
          {count}
        </span>
      );
    }
    return null;
  };

  const renderTabContent = (category: TabCategory) => (
    <>
      {category.colorHex && (
        <span className="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={{ backgroundColor: category.colorHex }} />
      )}
      <span>{category.displayName}</span>
      {renderBadge(category)}
    </>
  );

  return (
    <div ref={stripRef} className="relative flex h-[var(--split-tab-h)] min-w-0 flex-1 items-end gap-1 overflow-hidden">
      {visibleTabs.map(category => (
        <button
          key={category.id}
          aria-pressed={store.activeSplit === category.id}
          draggable
          onDragStart={(event) => handleDragStartTab(event, category.id)}
          onDragOver={handleDragOverTab}
          onDragEnter={(event) => handleDragEnterTab(event, category.id)}
          onDragEnd={handleDragEndTab}
          onDrop={(event) => handleDropTab(event, category.id)}
          onClick={() => selectTab(category.id)}
          className={`dm-category-tab flex h-full shrink-0 items-center gap-1.5 border-b-2 px-3 text-tab transition-all cursor-grab ${
            store.activeSplit === category.id
              ? 'border-[var(--accent)] text-[var(--accent)] font-semibold'
              : 'border-transparent text-[var(--text-secondary)] hover:text-[var(--text-primary)]'
          } ${
            draggedTabId === category.id ? 'opacity-40 scale-95' : ''
          } ${
            dragOverTabId === category.id && draggedTabId !== category.id
              ? 'bg-[var(--accent)]/10 border-b-[var(--accent)] border-dashed'
              : ''
          }`}
        >
          {renderTabContent(category)}
        </button>
      ))}

      {overflowTabs.length > 0 && (
        <div className="flex h-full shrink-0 items-center" onClick={(event) => event.stopPropagation()}>
          <button
            ref={moreButtonRef}
            type="button"
            onClick={() => {
              if (!moreOpen && moreButtonRef.current) {
                const rect = moreButtonRef.current.getBoundingClientRect();
                setMoreAnchor({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
              }
              setMoreOpen(value => !value);
            }}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            title="More splits"
            className="dm-category-tab flex h-full items-center gap-1 border-b-2 border-transparent px-2 text-tab text-[var(--text-secondary)] transition-all hover:text-[var(--text-primary)]"
          >
            <span>More</span>
            {overflowUnread > 0 && (
              <span className="rounded-full bg-[var(--accent)] px-1 text-[calc(10px*var(--font-scale))] font-semibold text-white">
                {overflowUnread}
              </span>
            )}
            <ChevronDown className="h-3 w-3 shrink-0 text-[var(--text-tertiary)]" />
          </button>
          {/* Portal: the strip has overflow-hidden, so an in-tree dropdown would be clipped. */}
          {moreOpen && moreAnchor && createPortal(
            <div
              className="dm-overlay fixed z-50 w-52 rounded-md border border-[var(--strong-border)] bg-[var(--panel-bg)] p-1 shadow-lg"
              style={{ top: moreAnchor.top, right: moreAnchor.right }}
              onClick={(event) => event.stopPropagation()}
            >
              {overflowTabs.map(category => {
                const isActive = store.activeSplit === category.id;
                return (
                  <button
                    key={category.id}
                    type="button"
                    onClick={() => selectTab(category.id)}
                    className={`flex w-full min-w-0 items-center justify-between gap-2 rounded px-2 py-1.5 text-left text-[calc(11px*var(--font-scale))] ${
                      isActive
                        ? 'bg-[var(--accent)]/10 text-[var(--accent)]'
                        : 'text-[var(--text-secondary)] hover:bg-[var(--hover-row)] hover:text-[var(--text-primary)]'
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      {category.colorHex && (
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: category.colorHex }} />
                      )}
                      <span className="truncate">{category.displayName}</span>
                    </span>
                    <span className="shrink-0">{renderBadge(category)}</span>
                  </button>
                );
              })}
            </div>,
            document.body
          )}
        </div>
      )}

      {/* Hidden measuring pass: every tab plus a widest-case More button. */}
      <div
        ref={measureRef}
        aria-hidden="true"
        className="pointer-events-none invisible absolute left-0 top-0 flex h-[var(--split-tab-h)] items-end gap-1"
      >
        {categories.map(category => (
          <button
            key={category.id}
            type="button"
            tabIndex={-1}
            className="dm-category-tab flex h-full shrink-0 items-center gap-1.5 border-b-2 px-3 text-tab"
          >
            {renderTabContent(category)}
          </button>
        ))}
        <button
          type="button"
          tabIndex={-1}
          className="dm-category-tab flex h-full shrink-0 items-center gap-1 border-b-2 border-transparent px-2 text-tab"
        >
          <span>More</span>
          {totalUnread > 0 && (
            <span className="rounded-full bg-[var(--accent)] px-1 text-[calc(10px*var(--font-scale))] font-semibold text-white">
              {totalUnread}
            </span>
          )}
          <ChevronDown className="h-3 w-3 shrink-0" />
        </button>
      </div>
    </div>
  );
}
