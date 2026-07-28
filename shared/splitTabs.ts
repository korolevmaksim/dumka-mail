import type { TabCategory } from './types';

/** Split that always stays visible, even when it has no threads. */
const ALWAYS_VISIBLE_SPLIT_ID = 'important';

/**
 * Split tabs the tab bar should render: active categories, optionally hiding
 * the empty ones. The Important split and the currently active split never
 * hide, so the user always keeps a stable anchor tab.
 */
export function visibleSplitTabs(
  categories: TabCategory[],
  counts: Record<string, number>,
  hideEmptySplits: boolean,
  activeSplit: string,
): TabCategory[] {
  const activeCategories = categories.filter(category => category.active);
  if (!hideEmptySplits) return activeCategories;
  return activeCategories.filter(category =>
    category.id === ALWAYS_VISIBLE_SPLIT_ID
    || category.id === activeSplit
    || (counts[category.id] || 0) > 0
  );
}

/**
 * How many leading tabs fit inside `containerWidth`. When every tab fits, no
 * space is reserved; otherwise `moreButtonWidth` is reserved for the overflow
 * button that must accompany the hidden tabs.
 */
export function computeVisibleTabCount(
  tabWidths: number[],
  containerWidth: number,
  moreButtonWidth: number,
): number {
  const totalWidth = tabWidths.reduce((sum, width) => sum + width, 0);
  if (totalWidth <= containerWidth) return tabWidths.length;
  let usedWidth = 0;
  let visibleCount = 0;
  for (const width of tabWidths) {
    if (usedWidth + width + moreButtonWidth > containerWidth) break;
    usedWidth += width;
    visibleCount += 1;
  }
  return visibleCount;
}
