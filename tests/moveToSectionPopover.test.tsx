// `V` popover: the standing choice for a sender is offered only when it can be
// made, and `⇧` + a digit is read from the physical key (with Shift held the
// character is `!`, `@`, …, never the digit).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoveToSectionPopover, sectionDigitIndex } from '../renderer/src/components/mailbox/MoveToSectionPopover';
import { senderSectionSenderName, settleSenderSections, type PendingSenderSection } from '../renderer/src/stores/useSenderSections';
import { getSenderRules, getSenderSections, setSenderRules, type AccountSettingsSource } from '../shared/accountSettings';
import { createSenderSection, undoSenderSection } from '../shared/senderSections';
import type { MailThread, SenderRule, SenderSectionTarget } from '../shared/types';

const thread = {
  id: 't1',
  accountId: 'alex.morgan@northwind.example',
  subject: 'Build finished',
  senderEmail: 'notifications@codeforge.example',
  senderNames: ['CodeForge'],
} as MailThread;
const noop = () => undefined;

describe('MoveToSectionPopover', () => {
  it('says how to make the choice standing when the sender can have a section', () => {
    const html = renderToStaticMarkup(
      <MoveToSectionPopover thread={thread} hasModel={false} currentSection="automated" alwaysForSender="CodeForge" onChoose={noop} onClose={noop} />,
    );
    expect(html).toContain('data-move-to-section-hint');
    expect(html).toContain('Hold ⇧ to always sort mail from CodeForge this way');
    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
  });

  it('keeps the plain wording when the sender cannot have a section', () => {
    const html = renderToStaticMarkup(
      <MoveToSectionPopover thread={thread} hasModel={false} currentSection="event" onChoose={noop} onClose={noop} />,
    );
    expect(html).toContain('Remembered for this conversation only.');
    expect(html).not.toContain('Hold ⇧');
  });
});

describe('sectionDigitIndex', () => {
  it('reads the digit from the physical key, so Shift does not hide it', () => {
    expect(sectionDigitIndex({ key: '1', code: 'Digit1' })).toBe(0);
    expect(sectionDigitIndex({ key: '!', code: 'Digit1' })).toBe(0);
    expect(sectionDigitIndex({ key: '№', code: 'Digit3' })).toBe(2);
    expect(sectionDigitIndex({ key: '6', code: 'Numpad6' })).toBe(5);
  });

  it('falls back to the character when the code is missing, and ignores other keys', () => {
    expect(sectionDigitIndex({ key: '4', code: '' })).toBe(3);
    expect(sectionDigitIndex({ key: '0', code: 'Digit0' })).toBeNull();
    expect(sectionDigitIndex({ key: 'v', code: 'KeyV' })).toBeNull();
    expect(sectionDigitIndex({ key: '!', code: '' })).toBeNull();
  });
});

describe('senderSectionSenderName', () => {
  it('names the sender only when the thread has one participant name', () => {
    expect(senderSectionSenderName(thread)).toBe('CodeForge');
    expect(senderSectionSenderName({ senderNames: ['Alex Morgan', 'Sofia Lindqvist'], senderEmail: ' sofia@harborpine.example ' })).toBe('sofia@harborpine.example');
    expect(senderSectionSenderName({ senderNames: [' '], senderEmail: 'a@x.example' })).toBe('a@x.example');
  });
});

// The settings update runs later than the call that queued it, so what a
// choice replaced and switched off is taken from the update that was applied.
describe('settleSenderSections', () => {
  const accountId = 'alex.morgan@northwind.example';
  const sender = 'hello@pragmaticdispatch.example';
  const rule: SenderRule = { id: 'r1', senderEmail: sender, action: 'archive', enabled: true, createdAt: '2026-01-01T00:00:00.000Z', confirmations: 3, bringBacks: 0 };
  const NOW = new Date('2026-11-17T10:00:00.000Z');

  function pending(id: string, section: SenderSectionTarget): PendingSenderSection {
    return { accountId, senderName: 'Dispatch', input: { id, senderEmail: sender, section, now: NOW }, outcome: null };
  }
  /** What the queued updater does once React runs it. */
  function apply(settings: AccountSettingsSource, entry: PendingSenderSection): AccountSettingsSource {
    const result = createSenderSection(settings, accountId, entry.input);
    entry.outcome = { section: result.section, replaced: result.replaced, disabledRule: result.disabledRule };
    return result.settings;
  }

  it('waits until the update ran and its settings are committed', () => {
    const start = setSenderRules({ accountOverrides: {} }, accountId, [rule]);
    const first = pending('s1', 'read');
    expect(settleSenderSections([first], start, NOW)).toEqual({ announce: [], waiting: [first] });
    const after = apply(start, first);
    // Applied in a render that has not committed: still waiting.
    expect(settleSenderSections([first], start, NOW).waiting).toEqual([first]);
    const settled = settleSenderSections([first], after, NOW);
    expect(settled.waiting).toEqual([]);
    expect(settled.announce[0].outcome.disabledRule?.id).toBe('r1');
  });

  it('two choices for one sender before a render: only the later one is announced, and its Undo restores the earlier one', () => {
    const start = setSenderRules({ accountOverrides: {} }, accountId, [rule]);
    const first = pending('s1', 'read');
    const second = pending('s2', 'clear');
    // Both updaters run on the real state, in order, in one render.
    const after = apply(apply(start, first), second);
    const settled = settleSenderSections([first, second], after, NOW);
    expect(settled.announce.map(entry => entry.input.id)).toEqual(['s2']);
    expect(settled.waiting).toEqual([]);
    // From the applied transition, not from the settings at the time of the call.
    expect(settled.announce[0].outcome.replaced?.id).toBe('s1');
    expect(settled.announce[0].outcome.disabledRule).toBeNull();

    const undone = undoSenderSection(after, accountId, settled.announce[0].outcome);
    expect(getSenderSections(undone, accountId).map(section => [section.id, section.section])).toEqual([['s1', 'read']]);
    // The rule the first choice switched off stays off: archiving is not re-enabled.
    expect(getSenderRules(undone, accountId)[0].enabled).toBe(false);
  });

  it('gives up on a choice that never shows up', () => {
    const start: AccountSettingsSource = { accountOverrides: {} };
    const never = pending('s1', 'read');
    const late = new Date(NOW.getTime() + 60_000);
    expect(settleSenderSections([never], start, late)).toEqual({ announce: [], waiting: [] });
    const applied = pending('s2', 'read');
    apply(start, applied);
    expect(settleSenderSections([applied], start, late)).toEqual({ announce: [], waiting: [] });
  });
});
