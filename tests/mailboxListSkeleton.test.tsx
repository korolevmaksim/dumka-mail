// Render smoke test of the placeholder rows shown while a mailbox list is not
// known yet (server-side markup, no browser).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MailboxListSkeleton, mailboxSkeletonItems } from '../renderer/src/components/mailbox/MailboxListSkeleton';
import { MailboxEmptyState } from '../renderer/src/components/MailboxEmptyState';
import { listItemMetrics } from '../renderer/src/lib/inboxListItems';
import { mailboxEmptyCopy } from '../shared/mailboxEmptyCopy';
import { Inbox } from 'lucide-react';

const metrics = listItemMetrics(39, 1, 72);
const count = (items: ReturnType<typeof mailboxSkeletonItems>, kind: 'header' | 'row') =>
  items.filter(item => item.kind === kind).length;

describe('mailboxSkeletonItems', () => {
  it('fills the viewport of a flat mailbox with rows and no section headers', () => {
    const items = mailboxSkeletonItems({ sectioned: false, metrics, viewportHeight: 720 });
    expect(count(items, 'header')).toBe(0);
    expect(count(items, 'row')).toBe(10);
  });

  it('gives the sectioned inbox two section headers', () => {
    const items = mailboxSkeletonItems({ sectioned: true, metrics, viewportHeight: 720 });
    expect(items[0]).toEqual({ kind: 'header' });
    expect(count(items, 'header')).toBe(2);
    const height = count(items, 'header') * metrics.sectionHeader + count(items, 'row') * metrics.oneLine;
    expect(height).toBeGreaterThanOrEqual(720);
    expect(height - metrics.oneLine).toBeLessThan(720);
  });

  it('stays bounded before the viewport is measured and in a very tall window', () => {
    expect(count(mailboxSkeletonItems({ sectioned: false, metrics, viewportHeight: 0 }), 'row')).toBe(9);
    expect(count(mailboxSkeletonItems({ sectioned: true, metrics, viewportHeight: 100_000 }), 'row')).toBe(40);
  });
});

describe('MailboxListSkeleton', () => {
  it('announces loading once and hides the placeholder rows from assistive technology', () => {
    const html = renderToStaticMarkup(
      <MailboxListSkeleton sectioned={false} metrics={metrics} viewportHeight={300} showAvatars />,
    );
    expect(html).toContain('data-mailbox-skeleton="flat"');
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/Loading conversations…/g)).toHaveLength(1);
    // Every row is decoration; none of them is a list item or focusable.
    expect(html.match(/aria-hidden="true"/g)).toHaveLength(5);
    expect(html).not.toMatch(/role="listitem"|tabindex/);
    expect(html).toContain(`height:${metrics.flatRow}px`);
  });

  it('keeps the row heights of the sectioned inbox', () => {
    const html = renderToStaticMarkup(
      <MailboxListSkeleton sectioned metrics={metrics} viewportHeight={300} showAvatars={false} />,
    );
    expect(html).toContain('data-mailbox-skeleton="sections"');
    // Jump bar, section header and rows: all decoration.
    expect(html.match(/<div aria-hidden="true"/g)!.length).toBeGreaterThan(4);
    expect(html).not.toMatch(/role="listitem"|tabindex|<nav/);
    expect(html).toContain(`height:${metrics.sectionHeader}px`);
    expect(html).toContain(`height:${metrics.oneLine}px`);
  });
});

describe('a mailbox whose local read failed', () => {
  it('says so and offers to try again instead of claiming an empty inbox', () => {
    const copy = mailboxEmptyCopy('inbox', '', undefined, { loadFailed: true });
    expect(copy).toMatchObject({ title: 'Could not load this mailbox', action: 'retryLoad' });
    // The failure outranks both the first-sync copy and a typed search.
    expect(mailboxEmptyCopy('inbox', 'invoice', undefined, { loadFailed: true, fetchingInbox: true }).action).toBe('retryLoad');
    const html = renderToStaticMarkup(
      <MailboxEmptyState icon={Inbox} copy={copy} onClearSearch={() => undefined} onRetryLoad={() => undefined} />,
    );
    expect(html).toContain('Could not load this mailbox');
    expect(html).toContain('Try again');
    expect(html).not.toContain('Inbox is clear');
  });
});
