// Flattens the mailbox into the items of one virtualized list: thread rows,
// section headers, collapsed group rows, the "arrived later" divider and the
// search-result headers. Pure; heights come from `inboxItemHeights`.
import {
  SECTION_LABELS,
  isCollapsibleSection,
  isTwoLineSection,
  summarizeSenders,
  threadEntryKey,
} from '../../../shared/inboxSections';
import type { DecisionEntry, DecisionSection } from '../../../shared/decision';
import type { Decision, MailThread, ThreadDecision } from '../../../shared/types';

export interface GroupViewState {
  expanded: boolean;
  /** Thread keys captured when the group was opened; later arrivals are not in it. */
  frozenKeys: ReadonlySet<string> | null;
  /** Rows the user unchecked; they stay out of the group action. */
  excludedKeys: ReadonlySet<string>;
}

export type GroupViewStates = Partial<Record<Decision, GroupViewState>>;

export type ThreadRowLayout = 'flat' | 'oneLine' | 'twoLine';

export interface ThreadListItem {
  kind: 'thread';
  key: string;
  thread: MailThread;
  layout: ThreadRowLayout;
  /** 1-based position among thread rows (aria-posinset). */
  position: number;
  section?: Decision;
  decision?: ThreadDecision;
  /** Present for rows of an opened Clear / Unsubscribe group. */
  group?: {
    decision: Decision;
    /** Part of the frozen set: carries a checkbox and joins the group action when checked. */
    inBatch: boolean;
    checked: boolean;
  };
}

export interface SectionHeaderItem {
  kind: 'sectionHeader';
  key: string;
  decision: Decision;
  label: string;
  count: number;
  entries: DecisionEntry[];
}

export interface CollapsedGroupItem {
  kind: 'collapsedGroup';
  key: string;
  decision: Decision;
  label: string;
  count: number;
  summary: string;
  entries: DecisionEntry[];
}

export interface LateDividerItem {
  kind: 'lateDivider';
  key: string;
  decision: Decision;
  count: number;
}

export interface SearchHeaderItem {
  kind: 'searchHeader';
  key: string;
  label: string;
}

export type MailboxListItem = ThreadListItem | SectionHeaderItem | CollapsedGroupItem | LateDividerItem | SearchHeaderItem;

/** Flat list (search results, Sent, Later, …) with the optional "Top results" split. */
export function buildFlatListItems(threads: readonly MailThread[], searchTopCount = 0): MailboxListItem[] {
  const items: MailboxListItem[] = [];
  threads.forEach((thread, index) => {
    if (searchTopCount > 0 && index === 0) items.push({ kind: 'searchHeader', key: 'search:top', label: 'Top results' });
    if (searchTopCount > 0 && index === searchTopCount) items.push({ kind: 'searchHeader', key: 'search:all', label: 'All matches' });
    items.push({ kind: 'thread', key: threadEntryKey(thread), thread, layout: 'flat', position: index + 1 });
  });
  return items;
}

/** Sectioned inbox. Collapsible sections render as one row until opened. */
export function buildSectionListItems(
  sections: readonly DecisionSection[],
  groups: GroupViewStates = {},
): MailboxListItem[] {
  const items: MailboxListItem[] = [];
  let position = 0;
  const pushThread = (entry: DecisionEntry, section: Decision, group?: ThreadListItem['group']) => {
    position += 1;
    items.push({
      kind: 'thread',
      key: threadEntryKey(entry.thread),
      thread: entry.thread,
      layout: isTwoLineSection(section) && entry.decision.reason ? 'twoLine' : 'oneLine',
      position,
      section,
      decision: entry.decision,
      ...(group ? { group } : {}),
    });
  };

  for (const section of sections) {
    const label = SECTION_LABELS[section.decision];
    const state = groups[section.decision];
    if (isCollapsibleSection(section.decision) && !state?.expanded) {
      items.push({
        kind: 'collapsedGroup',
        key: `group:${section.decision}`,
        decision: section.decision,
        label,
        count: section.entries.length,
        summary: summarizeSenders(section.entries.map(entry => entry.thread)),
        entries: section.entries,
      });
      continue;
    }

    items.push({
      kind: 'sectionHeader',
      key: `section:${section.decision}`,
      decision: section.decision,
      label,
      count: section.entries.length,
      entries: section.entries,
    });

    if (!isCollapsibleSection(section.decision) || !state) {
      for (const entry of section.entries) pushThread(entry, section.decision);
      continue;
    }

    const frozen: DecisionEntry[] = [];
    const late: DecisionEntry[] = [];
    for (const entry of section.entries) {
      if (!state.frozenKeys || state.frozenKeys.has(threadEntryKey(entry.thread))) frozen.push(entry);
      else late.push(entry);
    }
    for (const entry of frozen) {
      const key = threadEntryKey(entry.thread);
      pushThread(entry, section.decision, {
        decision: section.decision,
        inBatch: !entry.decision.protected,
        checked: !entry.decision.protected && !state.excludedKeys.has(key),
      });
    }
    if (late.length > 0) {
      items.push({ kind: 'lateDivider', key: `late:${section.decision}`, decision: section.decision, count: late.length });
      for (const entry of late) {
        pushThread(entry, section.decision, { decision: section.decision, inBatch: false, checked: false });
      }
    }
  }
  return items;
}

export interface ListItemMetrics {
  flatRow: number;
  oneLine: number;
  twoLine: number;
  sectionHeader: number;
  collapsedGroup: number;
  divider: number;
}

/** Row heights for a density / font scale. Rows render with exactly these heights. */
export function listItemMetrics(baseRowHeight: number, fontScale: number, flatRowHeight: number): ListItemMetrics {
  const scale = Number.isFinite(fontScale) && fontScale > 0 ? fontScale : 1;
  const base = Math.max(28, baseRowHeight);
  return {
    flatRow: Math.max(1, Math.round(flatRowHeight)),
    oneLine: Math.round(base * scale),
    twoLine: Math.round(base * 1.7 * scale),
    sectionHeader: Math.round((base - 3) * scale),
    collapsedGroup: Math.round((base + 6) * scale),
    divider: Math.round(24 * scale),
  };
}

export function listItemHeight(item: MailboxListItem, metrics: ListItemMetrics): number {
  switch (item.kind) {
    case 'thread':
      return item.layout === 'flat' ? metrics.flatRow : item.layout === 'twoLine' ? metrics.twoLine : metrics.oneLine;
    case 'sectionHeader':
      return metrics.sectionHeader;
    case 'collapsedGroup':
      return metrics.collapsedGroup;
    case 'lateDivider':
      return metrics.divider;
    case 'searchHeader':
      return metrics.flatRow;
  }
}

/**
 * Keyboard order (J/K, arrows, "next after archive"): every thread row in list
 * order; a collapsed group contributes its first thread as a stand-in so focus
 * can land on the group row.
 */
export function navigationThreads(items: readonly MailboxListItem[]): MailThread[] {
  const threads: MailThread[] = [];
  for (const item of items) {
    if (item.kind === 'thread') threads.push(item.thread);
    else if (item.kind === 'collapsedGroup' && item.entries[0]) threads.push(item.entries[0].thread);
  }
  return threads;
}

/**
 * `⌘A`: only threads shown as their own row. Threads inside a collapsed group
 * are hidden behind the group row and are not selected.
 */
export function selectableThreadIds(items: readonly MailboxListItem[]): string[] {
  const ids: string[] = [];
  for (const item of items) if (item.kind === 'thread') ids.push(item.thread.id);
  return ids;
}

/** List index of the item that shows `threadId` (its row, or the collapsed group holding it). */
export function itemIndexForThread(items: readonly MailboxListItem[], threadId: string | null | undefined): number {
  if (!threadId) return -1;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item.kind === 'thread' && item.thread.id === threadId) return index;
    if (item.kind === 'collapsedGroup' && item.entries.some(entry => entry.thread.id === threadId)) return index;
  }
  return -1;
}

/** The collapsed group whose stand-in (first thread) is `threadId`, if any. */
export function collapsedGroupForThread(items: readonly MailboxListItem[], threadId: string | null | undefined): CollapsedGroupItem | null {
  if (!threadId) return null;
  for (const item of items) {
    if (item.kind === 'collapsedGroup' && item.entries.some(entry => entry.thread.id === threadId)) return item;
  }
  return null;
}
