import { describe, expect, it } from 'vitest';
import { applyInboxSplitToggles, filterEnabledSplitTabs, isInboxSplitEnabled } from '../shared/inboxSplits';
import type { InboxSettings } from '../shared/types';

function inbox(overrides: Partial<InboxSettings> = {}): InboxSettings {
  return {
    enableSplitInbox: true,
    showUnreadFirst: false,
    autoMarkReadOnOpen: true,
    openNextThreadAfterDone: true,
    archiveOnDoneShortcut: true,
    enableReminders: true,
    enableFollowUps: true,
    followUpThresholdHours: 48,
    followUpMaxAgeDays: 30,
    followUpMaxItems: 20,
    followUpSnoozeHours: 24,
    showPurchasesSplit: true,
    showLinkedInSplit: true,
    showAutomationSplit: true,
    collapseReadThreads: false,
    hideEmptySplits: false,
    categories: { builtIn: [], custom: [] },
    ...overrides,
  };
}

describe('inboxSplits', () => {
  it('hides purchases, LinkedIn, and automation when their toggles are off', () => {
    const hidden = inbox({
      showPurchasesSplit: false,
      showLinkedInSplit: false,
      showAutomationSplit: false,
    });
    expect(isInboxSplitEnabled('purchases', hidden)).toBe(false);
    expect(isInboxSplitEnabled('linkedIn', hidden)).toBe(false);
    expect(isInboxSplitEnabled('linkedin', hidden)).toBe(true);
    expect(isInboxSplitEnabled('automation', hidden)).toBe(false);
    expect(isInboxSplitEnabled('important', hidden)).toBe(true);
    expect(filterEnabledSplitTabs([
      { id: 'important', displayName: 'Important', isSystem: true, active: true },
      { id: 'purchases', displayName: 'Purchases', isSystem: true, active: true },
      { id: 'linkedIn', displayName: 'LinkedIn', isSystem: true, active: true },
    ], hidden).map(tab => tab.id)).toEqual(['important']);
    expect(applyInboxSplitToggles([
      { id: 'linkedIn', title: 'LinkedIn', isEnabled: true, matchMode: 'any', extraRules: [] },
    ], hidden).find(entry => entry.id === 'linkedIn')?.isEnabled).toBe(false);
    expect(applyInboxSplitToggles([], hidden).map(entry => entry.id)).toEqual([
      'purchases',
      'linkedIn',
      'automation',
    ]);
  });
});
