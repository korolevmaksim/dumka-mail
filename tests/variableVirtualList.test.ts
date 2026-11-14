import { describe, expect, it } from 'vitest';
import {
  buildItemOffsets,
  calculateVariableVirtualWindow,
  itemIndexAt,
  scrollTopForItem,
  totalItemsHeight,
} from '../renderer/src/lib/virtualList';

// header 30, rows 33, a two-line row 56, collapsed group 39
const heights = [30, 33, 56, 33, 30, 33, 33, 39, 39];
const index = buildItemOffsets(heights);

describe('variable-height virtual list', () => {
  it('builds prefix sums', () => {
    expect(index.offsets.slice(0, 4)).toEqual([0, 30, 63, 119]);
    expect(totalItemsHeight(index)).toBe(326);
  });

  it('finds the item at a position', () => {
    expect(itemIndexAt(index, 0)).toBe(0);
    expect(itemIndexAt(index, 29.9)).toBe(0);
    expect(itemIndexAt(index, 30)).toBe(1);
    expect(itemIndexAt(index, 100)).toBe(2);
    expect(itemIndexAt(index, 10_000)).toBe(8);
    expect(itemIndexAt(index, -5)).toBe(0);
  });

  it('returns a window covering the viewport plus overscan', () => {
    const window = calculateVariableVirtualWindow({ index, viewportHeight: 60, scrollTop: 70, overscan: 1 });
    // 70..130 covers items 2 (63–119) and 3 (119–152)
    expect(window).toEqual({ startIndex: 1, endIndex: 5, offsetTop: 30, totalHeight: 326 });
  });

  it('clamps scrollTop beyond the end and handles empty lists', () => {
    const window = calculateVariableVirtualWindow({ index, viewportHeight: 100, scrollTop: 9_999, overscan: 0 });
    expect(window.endIndex).toBe(9);
    expect(window.startIndex).toBeLessThan(9);
    expect(calculateVariableVirtualWindow({ index: buildItemOffsets([]), viewportHeight: 100, scrollTop: 0 }))
      .toEqual({ startIndex: 0, endIndex: 0, offsetTop: 0, totalHeight: 0 });
  });

  it('treats invalid heights as zero', () => {
    expect(buildItemOffsets([10, Number.NaN, -4, 5]).offsets).toEqual([0, 10, 10, 10, 15]);
  });

  it('scrolls an item into view with a margin and leaves visible items alone', () => {
    expect(scrollTopForItem({ index, itemIndex: 2, viewportHeight: 120, currentScrollTop: 0 })).toBe(0);
    // item 7 spans 248–287: bring its bottom into a 100px viewport with 10px margin
    expect(scrollTopForItem({ index, itemIndex: 7, viewportHeight: 100, currentScrollTop: 0, marginPx: 10 })).toBe(197);
    // scrolling back up to item 1 (30–63)
    expect(scrollTopForItem({ index, itemIndex: 1, viewportHeight: 100, currentScrollTop: 200, marginPx: 10 })).toBe(20);
    expect(scrollTopForItem({ index, itemIndex: 99, viewportHeight: 100, currentScrollTop: 42 })).toBe(42);
  });
});
