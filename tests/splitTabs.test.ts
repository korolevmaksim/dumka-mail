import { describe, expect, it } from 'vitest';
import { computeVisibleTabCount, visibleSplitTabs } from '../shared/splitTabs';
import type { TabCategory } from '../shared/types';

function category(id: string, overrides: Partial<TabCategory> = {}): TabCategory {
  return { id, displayName: id, isSystem: true, active: true, ...overrides };
}

describe('visibleSplitTabs', () => {
  const categories = [
    category('important'),
    category('purchases'),
    category('linkedIn'),
    category('other'),
    category('custom-inactive', { active: false, isSystem: false }),
  ];

  it('returns active tabs unchanged when hiding is disabled', () => {
    const visible = visibleSplitTabs(categories, {}, false, 'important');
    expect(visible.map(c => c.id)).toEqual(['important', 'purchases', 'linkedIn', 'other']);
  });

  it('hides empty splits but keeps Important and tabs with threads', () => {
    const visible = visibleSplitTabs(categories, { purchases: 3, linkedIn: 0, other: 1 }, true, 'important');
    expect(visible.map(c => c.id)).toEqual(['important', 'purchases', 'other']);
  });

  it('keeps the active split visible even when it is empty', () => {
    const visible = visibleSplitTabs(categories, { purchases: 2 }, true, 'other');
    expect(visible.map(c => c.id)).toEqual(['important', 'purchases', 'other']);
  });

  it('never hides Important even with zero threads', () => {
    const visible = visibleSplitTabs(categories, {}, true, 'purchases');
    expect(visible.map(c => c.id)).toEqual(['important', 'purchases']);
  });

  it('treats missing counts as empty', () => {
    const visible = visibleSplitTabs([category('important'), category('other')], { other: 0 }, true, 'important');
    expect(visible.map(c => c.id)).toEqual(['important']);
  });
});

describe('computeVisibleTabCount', () => {
  it('fits every tab without reserving space for the More button', () => {
    expect(computeVisibleTabCount([100, 100], 200, 60)).toBe(2);
  });

  it('uses the full container when all tabs fit exactly', () => {
    expect(computeVisibleTabCount([100, 100, 40], 240, 60)).toBe(3);
  });

  it('reserves the More button width when tabs remain hidden', () => {
    // 100 + 60 reserve fits at 210; the second tab would need 200 + 60.
    expect(computeVisibleTabCount([100, 100, 100], 210, 60)).toBe(1);
  });

  it('fits a leading prefix that leaves room for the More button', () => {
    expect(computeVisibleTabCount([100, 100], 160, 60)).toBe(1);
  });

  it('returns zero when nothing fits or there are no tabs', () => {
    expect(computeVisibleTabCount([100, 100], 50, 60)).toBe(0);
    expect(computeVisibleTabCount([], 500, 60)).toBe(0);
  });

  it('stops at the first tab that does not fit', () => {
    expect(computeVisibleTabCount([100, 400, 100], 150, 0)).toBe(1);
  });
});
