// Single source of truth for density metrics (mirrors index.css [data-density] blocks
// and Swift WorkspaceDensityMetrics). Use for JS-computed sizing where a Tailwind
// arbitrary `var(--x)` cannot be used (e.g. resize clamps, inline pixel math).

export type WorkspaceDensity = 'compact' | 'comfortable' | 'spacious';

export interface DensityMetrics {
  accountBarHeight: number;
  accountChipHeight: number;
  topChromeHeight: number;
  splitTabsHeight: number;
  splitTabHeight: number;
  threadRowHeight: number;
  rowHorizontalPadding: number;
  bottomBarHeight: number;
  rightPanelWidth: number;
  settingsSidebarRowHeight: number;
  settingsRowMinHeight: number;
  settingsRowVerticalPadding: number;
  settingsControlHeight: number;
}

export const DENSITY: Record<WorkspaceDensity, DensityMetrics> = {
  compact: {
    accountBarHeight: 34, accountChipHeight: 24, topChromeHeight: 40,
    splitTabsHeight: 44, splitTabHeight: 30, threadRowHeight: 33,
    rowHorizontalPadding: 16, bottomBarHeight: 28, rightPanelWidth: 300,
    settingsSidebarRowHeight: 28, settingsRowMinHeight: 42,
    settingsRowVerticalPadding: 8, settingsControlHeight: 28,
  },
  comfortable: {
    accountBarHeight: 40, accountChipHeight: 28, topChromeHeight: 46,
    splitTabsHeight: 50, splitTabHeight: 34, threadRowHeight: 39,
    rowHorizontalPadding: 18, bottomBarHeight: 32, rightPanelWidth: 320,
    settingsSidebarRowHeight: 32, settingsRowMinHeight: 50,
    settingsRowVerticalPadding: 10, settingsControlHeight: 32,
  },
  spacious: {
    accountBarHeight: 46, accountChipHeight: 32, topChromeHeight: 52,
    splitTabsHeight: 56, splitTabHeight: 38, threadRowHeight: 45,
    rowHorizontalPadding: 24, bottomBarHeight: 36, rightPanelWidth: 340,
    settingsSidebarRowHeight: 36, settingsRowMinHeight: 58,
    settingsRowVerticalPadding: 14, settingsControlHeight: 36,
  },
};

export function densityMetrics(d: WorkspaceDensity): DensityMetrics {
  return DENSITY[d] ?? DENSITY.compact;
}
