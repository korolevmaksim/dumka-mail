import type { BuiltInMailCategorySettings, InboxSettings, TabCategory } from './types';

export const TOGGLEABLE_INBOX_SPLITS = ['purchases', 'linkedIn', 'automation'] as const;

export function isInboxSplitEnabled(splitId: string, inbox: InboxSettings): boolean {
  switch (splitId) {
    case 'purchases':
      return inbox.showPurchasesSplit;
    case 'linkedIn':
      return inbox.showLinkedInSplit;
    case 'automation':
      return inbox.showAutomationSplit;
    default:
      return true;
  }
}

export function filterEnabledSplitTabs(categories: TabCategory[], inbox: InboxSettings): TabCategory[] {
  return categories.filter(category => isInboxSplitEnabled(category.id, inbox));
}

export function applyInboxSplitToggles(
  builtIn: BuiltInMailCategorySettings[],
  inbox: InboxSettings,
): BuiltInMailCategorySettings[] {
  const next = builtIn.map(entry => (
    isInboxSplitEnabled(entry.id, inbox) ? entry : { ...entry, isEnabled: false }
  ));
  const present = new Set(next.map(entry => entry.id));
  for (const id of TOGGLEABLE_INBOX_SPLITS) {
    if (isInboxSplitEnabled(id, inbox) || present.has(id)) continue;
    next.push({
      id,
      title: id,
      isEnabled: false,
      matchMode: 'any',
      extraRules: [],
    });
  }
  return next;
}
