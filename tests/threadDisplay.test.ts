import { describe, it, expect } from 'vitest';
import {
  planThreadMessages,
  LEADING_VISIBLE_COUNT,
  TRAILING_VISIBLE_COUNT,
  MINIMUM_HIDDEN_COUNT,
  ThreadDisplayPlan,
} from '../shared/threadDisplay';

describe('planThreadMessages', () => {
  const allVisibleIndices = (n: number) => Array.from({ length: n }, (_, i) => i);

  it('exposes the Swift constants verbatim', () => {
    expect(LEADING_VISIBLE_COUNT).toBe(2);
    expect(TRAILING_VISIBLE_COUNT).toBe(6);
    expect(MINIMUM_HIDDEN_COUNT).toBe(3);
  });

  describe('short threads are never collapsed', () => {
    for (const count of [0, 1, 2, 3, 5, 8]) {
      it(`shows all ${count} messages`, () => {
        const plan = planThreadMessages(count, false);
        expect(plan.collapsed).toBe(false);
        expect(plan.hiddenCount).toBe(0);
        expect(plan.visibleIndices).toEqual(allVisibleIndices(count));
      });
    }
  });

  describe('collapse boundary (leading 2 + trailing 6, min 3 hidden)', () => {
    // count must satisfy count - 8 >= 3  ->  count >= 11 to collapse.
    it('count 9 stays fully visible (only 1 would be hidden)', () => {
      const plan = planThreadMessages(9, false);
      expect(plan.collapsed).toBe(false);
      expect(plan.hiddenCount).toBe(0);
      expect(plan.visibleIndices).toEqual(allVisibleIndices(9));
    });

    it('count 10 stays fully visible (only 2 would be hidden)', () => {
      const plan = planThreadMessages(10, false);
      expect(plan.collapsed).toBe(false);
      expect(plan.hiddenCount).toBe(0);
      expect(plan.visibleIndices).toEqual(allVisibleIndices(10));
    });

    it('count 11 collapses with exactly 3 hidden', () => {
      const plan = planThreadMessages(11, false);
      expect(plan.collapsed).toBe(true);
      expect(plan.hiddenCount).toBe(3);
      // leading [0,1] + trailing last 6 = [5,6,7,8,9,10]
      expect(plan.visibleIndices).toEqual([0, 1, 5, 6, 7, 8, 9, 10]);
    });
  });

  describe('collapsed plans keep leading 2 and trailing 6', () => {
    it('count 12', () => {
      const plan = planThreadMessages(12, false);
      expect(plan.collapsed).toBe(true);
      expect(plan.hiddenCount).toBe(4);
      expect(plan.visibleIndices).toEqual([0, 1, 6, 7, 8, 9, 10, 11]);
    });

    it('count 20', () => {
      const plan = planThreadMessages(20, false);
      expect(plan.collapsed).toBe(true);
      expect(plan.hiddenCount).toBe(12);
      expect(plan.visibleIndices).toEqual([0, 1, 14, 15, 16, 17, 18, 19]);
    });

    it('always shows exactly leading + trailing messages when collapsed', () => {
      for (const count of [11, 12, 15, 50, 1000]) {
        const plan = planThreadMessages(count, false);
        expect(plan.collapsed).toBe(true);
        expect(plan.visibleIndices).toHaveLength(
          LEADING_VISIBLE_COUNT + TRAILING_VISIBLE_COUNT,
        );
        expect(plan.hiddenCount).toBe(count - LEADING_VISIBLE_COUNT - TRAILING_VISIBLE_COUNT);
        // visible + hidden accounts for every message exactly once.
        expect(plan.visibleIndices.length + plan.hiddenCount).toBe(count);
      }
    });

    it('hidden middle block is contiguous and disjoint from visible indices', () => {
      const count = 20;
      const plan = planThreadMessages(count, false);
      const visible = new Set(plan.visibleIndices);
      const hidden: number[] = [];
      for (let i = 0; i < count; i++) {
        if (!visible.has(i)) hidden.push(i);
      }
      expect(hidden).toHaveLength(plan.hiddenCount);
      // contiguous range
      for (let i = 1; i < hidden.length; i++) {
        expect(hidden[i]).toBe(hidden[i - 1] + 1);
      }
      // sits between leading and trailing windows
      expect(hidden[0]).toBe(LEADING_VISIBLE_COUNT);
      expect(hidden[hidden.length - 1]).toBe(count - TRAILING_VISIBLE_COUNT - 1);
    });
  });

  describe('expanded always shows everything', () => {
    for (const count of [0, 8, 11, 20, 100]) {
      it(`count ${count}`, () => {
        const plan = planThreadMessages(count, true);
        expect(plan.collapsed).toBe(false);
        expect(plan.hiddenCount).toBe(0);
        expect(plan.visibleIndices).toEqual(allVisibleIndices(count));
      });
    }
  });

  describe('defensive handling of odd inputs', () => {
    it('treats negative counts as empty', () => {
      const plan = planThreadMessages(-5, false);
      expect(plan).toEqual<ThreadDisplayPlan>({
        visibleIndices: [],
        hiddenCount: 0,
        collapsed: false,
      });
    });

    it('truncates fractional counts', () => {
      const plan = planThreadMessages(11.9, false);
      expect(plan.collapsed).toBe(true);
      expect(plan.visibleIndices).toEqual([0, 1, 5, 6, 7, 8, 9, 10]);
    });

    it('treats NaN as empty', () => {
      const plan = planThreadMessages(Number.NaN, false);
      expect(plan.visibleIndices).toEqual([]);
      expect(plan.collapsed).toBe(false);
    });
  });
});
