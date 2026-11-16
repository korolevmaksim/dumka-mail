// `V` popover: the standing choice for a sender is offered only when it can be
// made, and `⇧` + a digit is read from the physical key (with Shift held the
// character is `!`, `@`, …, never the digit).
import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { MoveToSectionPopover, sectionDigitIndex } from '../renderer/src/components/mailbox/MoveToSectionPopover';
import { senderSectionSenderName } from '../renderer/src/stores/useSenderSections';
import type { MailThread } from '../shared/types';

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
