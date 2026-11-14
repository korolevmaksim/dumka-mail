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
  resolveCurrentSection,
  sectionJumpDestination,
  sectionJumpTargets,
  sectionPositionAt,
  selectableThreadIds,
  type GroupViewStates,
  type MailboxListItem,
} from '../renderer/src/lib/inboxListItems';
import { buildItemOffsets } from '../renderer/src/lib/virtualList';
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

describe('section jump targets', () => {
  const items = buildSectionListItems(sections);
  const targets = sectionJumpTargets(items);

  it('lists every shown section in order, pointing at its header or collapsed row', () => {
    expect(targets.map(target => target.decision)).toEqual(['people', 'read', 'event', 'automated', 'clear', 'unsubscribe']);
    for (const target of targets) {
      const item = items[target.index];
      expect(item.kind === 'sectionHeader' || item.kind === 'collapsedGroup').toBe(true);
      expect('decision' in item && item.decision).toBe(target.decision);
    }
    expect(targets.find(target => target.decision === 'clear')).toMatchObject({ label: 'Clear', count: 3 });
    expect(targets.find(target => target.decision === 'automated')?.label).toBe('Automated, not sorted');
    expect(targets.reduce((sum, target) => sum + target.count, 0)).toBe(28);
  });

  it('focuses the first row of a section, or the stand-in of a collapsed group', () => {
    const order = navigationThreads(items).map(thread => thread.id);
    for (const target of targets) {
      const next = items[target.index + 1];
      const collapsed = items[target.index].kind === 'collapsedGroup';
      if (!collapsed) expect(next).toMatchObject({ kind: 'thread', thread: { id: target.firstThreadId } });
      // Either way it is a stop the keyboard can reach, so J / K continue from it.
      expect(order).toContain(target.firstThreadId);
    }
    const clear = sections.find(section => section.decision === 'clear')!;
    expect(targets.find(target => target.decision === 'clear')?.firstThreadId).toBe(clear.entries[0].thread.id);
  });

  it('uses the first reviewed row of an opened group, not a later arrival', () => {
    const clear = sections.find(section => section.decision === 'clear')!;
    const late = clear.entries[0].thread;
    const frozen = clear.entries.slice(1).map(entry => threadEntryKey(entry.thread));
    const opened = buildSectionListItems(sections, { clear: { expanded: true, frozenKeys: new Set(frozen), excludedKeys: new Set() } });
    const target = sectionJumpTargets(opened).find(candidate => candidate.decision === 'clear')!;
    expect(opened[target.index]).toMatchObject({ kind: 'sectionHeader', decision: 'clear' });
    expect(target.firstThreadId).toBe(clear.entries[1].thread.id);
    expect(target.firstThreadId).not.toBe(late.id);
    expect(target.count).toBe(3);
  });

  it('has no targets in a flat list', () => {
    expect(sectionJumpTargets(buildFlatListItems(threads.slice(0, 4), 2))).toEqual([]);
  });

  it('finds the section a list position belongs to', () => {
    const read = targets.find(target => target.decision === 'read')!;
    expect(sectionPositionAt(targets, 0)).toBe(0);
    expect(sectionPositionAt(targets, read.index - 1)).toBe(0);
    expect(sectionPositionAt(targets, read.index)).toBe(1);
    expect(sectionPositionAt(targets, items.length - 1)).toBe(targets.length - 1);
    expect(sectionPositionAt([], 3)).toBe(-1);
  });

  it('moves ] forward and stops at the last section', () => {
    expect(sectionJumpDestination(targets, 'people', 1, false)?.decision).toBe('read');
    expect(sectionJumpDestination(targets, 'clear', 1, true)?.decision).toBe('unsubscribe');
    expect(sectionJumpDestination(targets, 'unsubscribe', 1, true)).toBeNull();
  });

  it('moves [ to the start of the current section first, then to the previous one', () => {
    expect(sectionJumpDestination(targets, 'read', -1, false)?.decision).toBe('read');
    expect(sectionJumpDestination(targets, 'read', -1, true)?.decision).toBe('people');
    expect(sectionJumpDestination(targets, 'people', -1, false)?.decision).toBe('people');
    expect(sectionJumpDestination(targets, 'people', -1, true)).toBeNull();
  });

  it('starts from the top when the current section is gone or unknown', () => {
    expect(sectionJumpDestination(targets, 'later', 1, true)?.decision).toBe('people');
    expect(sectionJumpDestination(targets, null, -1, false)?.decision).toBe('people');
    expect(sectionJumpDestination([], 'people', 1, true)).toBeNull();
  });
});

describe('resolveCurrentSection (what the jump bar marks)', () => {
  const items = buildSectionListItems(sections);
  const targets = sectionJumpTargets(items);
  const metrics = listItemMetrics(33, 1, 58);
  const offsets = buildItemOffsets(items.map(item => listItemHeight(item, metrics)));
  const total = offsets.offsets[offsets.count];
  const viewportHeight = 300;
  const maxScrollTop = total - viewportHeight;
  const headerTop = (decision: string) => offsets.offsets[targets.find(target => target.decision === decision)!.index];
  const firstRow = (decision: string) => targets.find(target => target.decision === decision)!.firstThreadId;
  const resolve = (scrollTop: number, extra: Partial<Parameters<typeof resolveCurrentSection>[0]> = {}) => resolveCurrentSection({
    targets, offsets, scrollTop, viewportHeight, headerHeight: metrics.sectionHeader,
    targetItemIndex: -1, targetThreadId: null, anchor: null, ...extra,
  });
  /** Section and `atStart` only; `anchored` is asserted where it matters. */
  const at = (scrollTop: number, extra: Partial<Parameters<typeof resolveCurrentSection>[0]> = {}) => {
    const { decision, atStart } = resolve(scrollTop, extra);
    return { decision, atStart };
  };

  it('names the section at the top of the list when the focused row is off screen', () => {
    expect(at(0)).toEqual({ decision: 'people', atStart: true });
    expect(at(headerTop('read'))).toEqual({ decision: 'read', atStart: true });
    expect(at(headerTop('read') + 40)).toEqual({ decision: 'read', atStart: false });
    expect(maxScrollTop).toBeGreaterThan(headerTop('event'));
  });

  it('lets a header a few pixels below the top win over the sliver above it', () => {
    expect(at(headerTop('event') - 3)).toEqual({ decision: 'event', atStart: false });
    // A whole row of the previous section still showing: that section is current.
    expect(at(headerTop('event') - metrics.oneLine).decision).toBe('read');
  });

  it('follows the focused row while it is on screen', () => {
    const eventRow = itemIndexForThread(items, firstRow('event'));
    // The list top is still in Read, the keyboard is in Event below it.
    expect(at(headerTop('read') + 10, { targetItemIndex: eventRow, targetThreadId: firstRow('event') }))
      .toEqual({ decision: 'event', atStart: false });
    // Scrolled back to the top: that row is off screen, the position decides.
    expect(at(0, { targetItemIndex: eventRow, targetThreadId: firstRow('event') }).decision).toBe('people');
  });

  it('keeps a section jumped to at the end of the list, where its header cannot reach the top', () => {
    const anchor = { decision: 'unsubscribe' as const, scrollTop: maxScrollTop, threadId: firstRow('unsubscribe') };
    expect(headerTop('unsubscribe')).toBeGreaterThan(maxScrollTop);
    expect(at(maxScrollTop, { anchor, targetThreadId: anchor.threadId, targetItemIndex: itemIndexForThread(items, anchor.threadId) }))
      .toEqual({ decision: 'unsubscribe', atStart: true });
    // Without the jump the same position names the section that is at the top.
    expect(at(maxScrollTop).decision).not.toBe('unsubscribe');
    // K onto the Clear group at the end of the list: a jump to Clear could not
    // scroll any further, so `[` goes straight to the section before it.
    const clearRow = firstRow('clear');
    expect(at(maxScrollTop, { anchor, targetThreadId: clearRow, targetItemIndex: itemIndexForThread(items, clearRow) }))
      .toEqual({ decision: 'clear', atStart: true });
  });

  it('drops the jump once the list scrolls or the keyboard moves to another row', () => {
    const anchor = { decision: 'read' as const, scrollTop: headerTop('read'), threadId: firstRow('read') };
    const held = { anchor, targetThreadId: anchor.threadId, targetItemIndex: itemIndexForThread(items, anchor.threadId) };
    expect(at(headerTop('read'), held)).toEqual({ decision: 'read', atStart: true });
    // Wheel scroll: focus is now off screen, the top of the list decides.
    expect(at(0, held).decision).toBe('people');
    // J into the next section without any scroll: the bar follows the keyboard.
    const eventRow = firstRow('event');
    expect(at(headerTop('read'), { anchor, targetThreadId: eventRow, targetItemIndex: itemIndexForThread(items, eventRow) }).decision).toBe('event');
  });

  it('drops the jump when rows arriving above push the header away from the top', () => {
    const anchor = { decision: 'read' as const, scrollTop: headerTop('read') - 66, threadId: null };
    // Same scroll position as the anchor, but Read's header is no longer there.
    expect(at(anchor.scrollTop, { anchor })).toEqual({ decision: 'people', atStart: false });
  });

  it('ignores a jump to a section that has emptied, and an empty list', () => {
    const anchor = { decision: 'later' as const, scrollTop: 0, threadId: null };
    expect(at(0, { anchor })).toEqual({ decision: 'people', atStart: true });
    expect(resolveCurrentSection({
      targets: [], offsets: buildItemOffsets([]), scrollTop: 0, viewportHeight, headerHeight: 30,
      targetItemIndex: -1, targetThreadId: null, anchor,
    })).toEqual({ decision: null, atStart: false, anchored: false });
  });

  it('reports whether the jump still holds, so the list can forget it for good', () => {
    // Clear jumped to at the end of the list while an Unsubscribe conversation is open.
    const opened = firstRow('unsubscribe');
    const openedIndex = itemIndexForThread(items, opened);
    const anchor = { decision: 'clear' as const, scrollTop: maxScrollTop, threadId: opened };
    const held = { anchor, targetThreadId: opened, targetItemIndex: openedIndex };
    expect(resolve(maxScrollTop, held)).toEqual({ decision: 'clear', atStart: true, anchored: true });
    // Scrolled away: the anchor no longer holds and the caller drops it.
    expect(resolve(0, held).anchored).toBe(false);
    // Back at the same position without the anchor: the opened row decides.
    expect(resolve(maxScrollTop, { ...held, anchor: null })).toEqual({ decision: 'unsubscribe', atStart: true, anchored: false });
    // Focus moved away: not anchored either, even though the position is the same.
    expect(resolve(maxScrollTop, { ...held, targetThreadId: firstRow('clear'), targetItemIndex: itemIndexForThread(items, firstRow('clear')) }).anchored).toBe(false);
    expect(resolve(0).anchored).toBe(false);
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
