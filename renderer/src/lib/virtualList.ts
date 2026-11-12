export interface VirtualWindowInput {
  itemCount: number;
  rowHeight: number;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
}

export interface VirtualWindow {
  startIndex: number;
  endIndex: number;
  offsetTop: number;
  totalHeight: number;
}

const DEFAULT_OVERSCAN = 8;

function sanitizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function calculateVirtualWindow({
  itemCount,
  rowHeight,
  viewportHeight,
  scrollTop,
  overscan = DEFAULT_OVERSCAN,
}: VirtualWindowInput): VirtualWindow {
  if (itemCount <= 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }

  const safeRowHeight = sanitizePositive(rowHeight, 1);
  const safeViewportHeight = sanitizePositive(viewportHeight, safeRowHeight);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const totalHeight = itemCount * safeRowHeight;
  const maxScrollTop = Math.max(0, totalHeight - safeViewportHeight);
  const safeScrollTop = clamp(Number.isFinite(scrollTop) ? scrollTop : 0, 0, maxScrollTop);
  const firstVisibleIndex = Math.floor(safeScrollTop / safeRowHeight);
  const visibleCount = Math.ceil(safeViewportHeight / safeRowHeight);
  const startIndex = clamp(firstVisibleIndex - safeOverscan, 0, itemCount);
  const endIndex = clamp(firstVisibleIndex + visibleCount + safeOverscan, startIndex, itemCount);

  return {
    startIndex,
    endIndex,
    offsetTop: startIndex * safeRowHeight,
    totalHeight,
  };
}

export function scrollTopForIndex({
  index,
  rowHeight,
  viewportHeight,
  currentScrollTop,
  itemCount,
  marginRows = 2,
}: {
  index: number;
  rowHeight: number;
  viewportHeight: number;
  currentScrollTop: number;
  itemCount: number;
  marginRows?: number;
}): number {
  if (index < 0 || itemCount <= 0) return currentScrollTop;

  const safeRowHeight = sanitizePositive(rowHeight, 1);
  const safeViewportHeight = sanitizePositive(viewportHeight, safeRowHeight);
  const safeMargin = Math.max(0, marginRows) * safeRowHeight;
  const totalHeight = itemCount * safeRowHeight;
  const maxScrollTop = Math.max(0, totalHeight - safeViewportHeight);
  const safeCurrent = clamp(Number.isFinite(currentScrollTop) ? currentScrollTop : 0, 0, maxScrollTop);
  const itemTop = index * safeRowHeight;
  const itemBottom = itemTop + safeRowHeight;
  const visibleTop = safeCurrent + safeMargin;
  const visibleBottom = safeCurrent + safeViewportHeight - safeMargin;

  if (itemTop < visibleTop) {
    return clamp(itemTop - safeMargin, 0, maxScrollTop);
  }
  if (itemBottom > visibleBottom) {
    return clamp(itemBottom - safeViewportHeight + safeMargin, 0, maxScrollTop);
  }
  return safeCurrent;
}

// --- Variable item heights ---------------------------------------------------
//
// Section headers, collapsed groups, one-line and two-line rows have different
// heights. `buildItemOffsets` turns the heights into a prefix sum once per item
// list; window and scroll lookups are then a binary search.

export interface ItemOffsets {
  /** `offsets[i]` is the top of item `i`; `offsets[count]` is the total height. */
  offsets: number[];
  count: number;
}

export function buildItemOffsets(heights: readonly number[]): ItemOffsets {
  const offsets = new Array<number>(heights.length + 1);
  offsets[0] = 0;
  for (let index = 0; index < heights.length; index += 1) {
    const height = heights[index];
    offsets[index + 1] = offsets[index] + (Number.isFinite(height) && height > 0 ? height : 0);
  }
  return { offsets, count: heights.length };
}

export function totalItemsHeight(index: ItemOffsets): number {
  return index.offsets[index.count];
}

/** Index of the item containing `position` (clamped to the list). */
export function itemIndexAt(index: ItemOffsets, position: number): number {
  if (index.count === 0) return 0;
  const target = Number.isFinite(position) ? Math.max(0, position) : 0;
  let low = 0;
  let high = index.count - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (index.offsets[middle] <= target) low = middle;
    else high = middle - 1;
  }
  return low;
}

export function calculateVariableVirtualWindow({
  index,
  viewportHeight,
  scrollTop,
  overscan = DEFAULT_OVERSCAN,
}: {
  index: ItemOffsets;
  viewportHeight: number;
  scrollTop: number;
  overscan?: number;
}): VirtualWindow {
  const totalHeight = totalItemsHeight(index);
  if (index.count === 0) {
    return { startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 };
  }
  const safeViewport = sanitizePositive(viewportHeight, 1);
  const safeOverscan = Math.max(0, Math.floor(overscan));
  const maxScrollTop = Math.max(0, totalHeight - safeViewport);
  const safeScrollTop = clamp(Number.isFinite(scrollTop) ? scrollTop : 0, 0, maxScrollTop);
  const first = itemIndexAt(index, safeScrollTop);
  const last = itemIndexAt(index, safeScrollTop + safeViewport);
  const startIndex = clamp(first - safeOverscan, 0, index.count);
  const endIndex = clamp(last + 1 + safeOverscan, startIndex, index.count);
  return {
    startIndex,
    endIndex,
    offsetTop: index.offsets[startIndex],
    totalHeight,
  };
}

/**
 * Scroll position that brings item `itemIndex` into view with `marginPx` of
 * context above/below; returns `currentScrollTop` when it is already visible.
 */
export function scrollTopForItem({
  index,
  itemIndex,
  viewportHeight,
  currentScrollTop,
  marginPx = 0,
}: {
  index: ItemOffsets;
  itemIndex: number;
  viewportHeight: number;
  currentScrollTop: number;
  marginPx?: number;
}): number {
  if (itemIndex < 0 || itemIndex >= index.count) return currentScrollTop;
  const totalHeight = totalItemsHeight(index);
  const itemTop = index.offsets[itemIndex];
  const itemBottom = index.offsets[itemIndex + 1];
  const safeViewport = sanitizePositive(viewportHeight, Math.max(1, itemBottom - itemTop));
  const maxScrollTop = Math.max(0, totalHeight - safeViewport);
  const safeCurrent = clamp(Number.isFinite(currentScrollTop) ? currentScrollTop : 0, 0, maxScrollTop);
  const margin = Math.max(0, Math.min(marginPx, Math.max(0, (safeViewport - (itemBottom - itemTop)) / 2)));
  if (itemTop < safeCurrent + margin) return clamp(itemTop - margin, 0, maxScrollTop);
  if (itemBottom > safeCurrent + safeViewport - margin) {
    return clamp(itemBottom - safeViewport + margin, 0, maxScrollTop);
  }
  return safeCurrent;
}
