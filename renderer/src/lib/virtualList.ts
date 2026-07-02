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
