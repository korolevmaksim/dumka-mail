import { describe, expect, it } from 'vitest';
import { decideByRules, groupThreadsByDecision, type DecisionEntry } from '../shared/decision';
import { threadEntryKey } from '../shared/inboxSections';
import { buildMailThreadFromMessages } from '../shared/mailThread';
import type { MailThread } from '../shared/types';
import {
  buildFlatListItems,
  buildSectionListItems,
  collapsedGroupForThread,
  itemIndexForThread,
  listItemHeight,
  listItemMetrics,
  navigationThreads,
  selectableThreadIds,
  type GroupViewStates,
  type MailboxListItem,
} from '../renderer/src/lib/inboxListItems';
import { fixtureMessages, WORK_ACCOUNT, WORK_INBOX } from './fixtures/workInbox';

const accountEmail = WORK_ACCOUNT.email;
const threads: MailThread[] = WORK_INBOX.map(spec => buildMailThreadFromMessages(accountEmail, spec.key, fixtureMessages(spec))!);
const entries: DecisionEntry[] = threads.map(thread => ({ thread, decision: decideByRules(thread, { accountEmail }) }));
const sections = groupThreadsByDecision(entries, false);

function kinds(items: MailboxListItem[]): string[] {
  return items.map(item => (item.kind === 'thread' ? `t:${item.thread.id}` : `${item.kind}:${'decision' in item ? item.decision : item.key}`));
}

describe('buildSectionListItems', () => {
  it('renders headers and rows, with Clear and Unsubscribe collapsed by default', () => {
    const items = buildSectionListItems(sections);
    const structural = items.filter(item => item.kind !== 'thread');
    expect(structural.map(item => `${item.kind}:${'decision' in item ? item.decision : ''}`)).toEqual([
      'sectionHeader:people',
      'sectionHeader:read',
      'sectionHeader:event',
      'sectionHeader:automated',
      'collapsedGroup:clear',
      'collapsedGroup:unsubscribe',
    ]);
    const clear = items.find(item => item.kind === 'collapsedGroup' && item.decision === 'clear');
    expect(clear).toMatchObject({ label: 'Clear', count: 3 });
    expect(items.filter(item => item.kind === 'thread')).toHaveLength(28 - 3 - 3);
  });

  it('numbers thread rows across sections and picks one or two lines by section and reason', () => {
    const items = buildSectionListItems(sections);
    const rows = items.filter((item): item is Extract<MailboxListItem, { kind: 'thread' }> => item.kind === 'thread');
    expect(rows.map(row => row.position)).toEqual(rows.map((_, index) => index + 1));
    // People rows without a reason stay on one line (the rule layer gives none).
    expect(rows.find(row => row.section === 'people')?.layout).toBe('oneLine');
    expect(rows.find(row => row.section === 'automated')?.layout).toBe('oneLine');
    const withReason = buildSectionListItems([{
      decision: 'reply',
      entries: [{ thread: threads[0], decision: { decision: 'reply', reason: 'Asks to move the pilot', source: 'model', protected: true, laterAt: null } }],
    }]);
    expect(withReason[1]).toMatchObject({ kind: 'thread', layout: 'twoLine' });
  });

  it('lists an opened group with checkboxes and keeps later arrivals separate', () => {
    const clear = sections.find(section => section.decision === 'clear')!;
    const frozen = clear.entries.filter(item => item.thread.id !== 'product-weekly').map(item => threadEntryKey(item.thread));
    const groups: GroupViewStates = {
      clear: {
        expanded: true,
        frozenKeys: new Set(frozen),
        excludedKeys: new Set([threadEntryKey(threads.find(thread => thread.id === 'dispatch-212')!)]),
      },
    };
    const items = buildSectionListItems(sections, groups);
    const start = items.findIndex(item => item.kind === 'sectionHeader' && item.decision === 'clear');
    const group = items.slice(start, start + 5);
    expect(kinds(group)).toEqual([
      'sectionHeader:clear',
      't:dispatch-212',
      't:linkedin-requests',
      'lateDivider:clear',
      't:product-weekly',
    ]);
    expect(group[1]).toMatchObject({ group: { inBatch: true, checked: false } });
    expect(group[2]).toMatchObject({ group: { inBatch: true, checked: true } });
    expect(group[4]).toMatchObject({ group: { inBatch: false, checked: false } });
  });

  it('shows protected rows of an opened group without a checkbox', () => {
    const items = buildSectionListItems([{
      decision: 'clear',
      entries: [{ thread: threads[0], decision: { decision: 'clear', reason: '', source: 'user', protected: true, laterAt: null } }],
    }], { clear: { expanded: true, frozenKeys: null, excludedKeys: new Set() } });
    expect(items[1]).toMatchObject({ kind: 'thread', group: { inBatch: false, checked: false } });
  });
});

describe('navigation across sections', () => {
  it('follows display order and stops once on a collapsed group', () => {
    const items = buildSectionListItems(sections);
    const order = navigationThreads(items);
    expect(order).toHaveLength(22 + 2);
    const clearGroup = items.find(item => item.kind === 'collapsedGroup' && item.decision === 'clear');
    expect(clearGroup && clearGroup.kind === 'collapsedGroup' && order.includes(clearGroup.entries[0].thread)).toBe(true);
    // A hidden member of a collapsed group resolves to the group row.
    const hidden = clearGroup && clearGroup.kind === 'collapsedGroup' ? clearGroup.entries[1].thread.id : '';
    expect(itemIndexForThread(items, hidden)).toBe(items.indexOf(clearGroup!));
    expect(collapsedGroupForThread(items, hidden)?.decision).toBe('clear');
    expect(collapsedGroupForThread(items, 'pilot-date')).toBeNull();
  });
});

describe('flat lists', () => {
  it('adds search headers around the top results', () => {
    const items = buildFlatListItems(threads.slice(0, 4), 2);
    expect(kinds(items)).toEqual(['searchHeader:search:top', 't:pilot-date', 't:board-numbers', 'searchHeader:search:all', 't:redlines', 't:interview-loop']);
    expect(navigationThreads(items).map(thread => thread.id)).toEqual(['pilot-date', 'board-numbers', 'redlines', 'interview-loop']);
  });
});

describe('item heights', () => {
  it('scales with density and font scale and differs per kind', () => {
    const metrics = listItemMetrics(33, 1, 58);
    expect(metrics).toMatchObject({ flatRow: 58, oneLine: 33, twoLine: 56 });
    const larger = listItemMetrics(33, 1.2, 58);
    expect(larger.oneLine).toBeGreaterThan(metrics.oneLine);
    const items = buildSectionListItems(sections);
    const heights = new Set(items.map(item => listItemHeight(item, metrics)));
    expect(heights.size).toBeGreaterThan(2);
  });
});

describe('selectableThreadIds (⌘A)', () => {
  it('selects only rows shown on their own, not threads inside collapsed groups', () => {
    const collapsed = buildSectionListItems(sections);
    const hidden = new Set(sections.filter(section => section.decision === 'clear' || section.decision === 'unsubscribe')
      .flatMap(section => section.entries.map(entry => entry.thread.id)));
    const ids = selectableThreadIds(collapsed);
    expect(ids).toHaveLength(28 - 3 - 3);
    expect(ids.some(id => hidden.has(id))).toBe(false);

    const clear = sections.find(section => section.decision === 'clear')!;
    const opened = buildSectionListItems(sections, {
      clear: { expanded: true, frozenKeys: new Set(clear.entries.map(entry => threadEntryKey(entry.thread))), excludedKeys: new Set() },
    });
    expect(selectableThreadIds(opened)).toHaveLength(28 - 3);
  });
});
