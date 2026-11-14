// Render smoke test of the section jump bar (server-side markup, no browser):
// one link per section with its count, the current one marked as a location,
// and no tab semantics, because the list is not filtered.
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { SectionJumpBar, SectionJumpMenu } from '../renderer/src/components/mailbox/SectionJumpBar';
import type { SectionJumpTarget } from '../renderer/src/lib/inboxListItems';

const targets: SectionJumpTarget[] = [
  { decision: 'people', label: 'People', count: 198, index: 0, firstThreadId: 'a' },
  { decision: 'read', label: 'Read', count: 4, index: 199, firstThreadId: 'b' },
  { decision: 'automated', label: 'Automated, not sorted', count: 9, index: 204, firstThreadId: 'c' },
  { decision: 'clear', label: 'Clear', count: 1, index: 214, firstThreadId: 'd' },
];
const noop = () => undefined;

describe('SectionJumpBar', () => {
  it('renders a navigation landmark with one link per section and its count', () => {
    const html = renderToStaticMarkup(<SectionJumpBar targets={targets} current="read" onJump={noop} keysLabel="[ ]" />);
    expect(html).toContain('<nav aria-label="Jump to section"');
    for (const decision of ['people', 'read', 'automated', 'clear']) {
      expect(html).toContain(`data-section-jump="${decision}"`);
    }
    // The accessible name is the visible text plus a noun for screen readers.
    expect(html).toContain('<span>People</span>');
    expect(html).toMatch(/>198<span class="sr-only"> conversations<\/span>/);
    expect(html).toMatch(/>1<span class="sr-only"> conversation<\/span>/);
    expect(html).not.toContain('aria-label="People');
    // The short name in the bar, the full one in the tooltip.
    expect(html).toContain('title="Jump to Automated, not sorted ([ ])"');
    expect(html).toContain('<span>Automated</span>');
  });

  it('marks only the current section, as a location and not as a selected tab', () => {
    const html = renderToStaticMarkup(<SectionJumpBar targets={targets} current="read" onJump={noop} />);
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(html).toMatch(/data-section-jump="read" aria-current="location"/);
    expect(html).not.toMatch(/role="tab(list)?"/);
    expect(html).not.toContain('aria-selected');
    expect(html).toContain('title="Jump to Read"');
  });

  it('falls back to the first section when the current one is unknown', () => {
    const html = renderToStaticMarkup(<SectionJumpBar targets={targets} current={null} onJump={noop} />);
    expect(html).toMatch(/data-section-jump="people" aria-current="location"/);
  });

  it('is not shown when there is nowhere to jump', () => {
    expect(renderToStaticMarkup(<SectionJumpBar targets={targets.slice(0, 1)} current="people" onJump={noop} />)).toBe('');
    expect(renderToStaticMarkup(<SectionJumpBar targets={[]} current={null} onJump={noop} />)).toBe('');
  });
});

describe('SectionJumpMenu (narrow column)', () => {
  const html = renderToStaticMarkup(<SectionJumpMenu targets={targets} current="automated" onChoose={noop} />);

  it('lists every section with its full name and count as menu items', () => {
    expect(html).toContain('role="menu"');
    expect(html.match(/role="menuitem"/g)).toHaveLength(targets.length);
    expect(html).toContain('Automated, not sorted');
    expect(html).toMatch(/>198<span class="sr-only"> conversations<\/span>/);
  });

  it('marks the current section and makes it the one tab stop', () => {
    expect(html.match(/aria-current="location"/g)).toHaveLength(1);
    expect(html).toMatch(/data-section-jump="automated" aria-current="location" tabindex="0"/);
    expect(html.match(/tabindex="-1"/g)).toHaveLength(targets.length - 1);
    expect(html).not.toContain('aria-checked');
  });
});
