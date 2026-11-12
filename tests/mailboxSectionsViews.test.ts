import { describe, expect, it } from 'vitest';
import { isThreadInMailbox, isWaitingThread, waitingThreadKey } from '../shared/mailboxView';
import { deriveShortcuts, resolveInviteKey, resolveSectionKey, resolveSingleKey } from '../shared/keyboard';
import { appKeymapBindings } from '../shared/appKeymap';
import { reverseMailActionKind } from '../shared/mailActions';
import { isUndoableMailActionLog } from '../shared/mailActionFeedback';
import { EMPTY_THREAD_SIGNALS } from '../shared/threadSignals';
import type { MailThread, ShortcutSettings } from '../shared/types';

const now = new Date('2026-11-12T12:00:00.000Z');
const thread: MailThread = {
  id: 'thread-1',
  accountId: 'alex.morgan@northwind.example',
  subject: 'Subject',
  snippet: 'Snippet',
  lastMessageAt: '2026-11-11T10:00:00.000Z',
  senderNames: ['Priya Raman'],
  senderEmail: 'priya.raman@lumenlabs.example',
  labelIds: ['INBOX'],
  hasAttachments: false,
  isUnread: false,
  reminderAt: null,
};

describe('Later, Waiting and All mail', () => {
  it('Later holds threads with a pending reminder, which the inbox hides', () => {
    const reminded = { ...thread, reminderAt: '2026-11-13T09:00:00.000Z' };
    expect(isThreadInMailbox(reminded, 'later', now)).toBe(true);
    expect(isThreadInMailbox(reminded, 'inbox', now)).toBe(false);
    expect(isThreadInMailbox({ ...reminded, reminderAt: '2026-11-12T09:00:00.000Z' }, 'later', now)).toBe(false);
    expect(isThreadInMailbox({ ...reminded, labelIds: ['TRASH'] }, 'later', now)).toBe(false);
  });

  it('All mail is everything except Trash and Spam', () => {
    expect(isThreadInMailbox({ ...thread, labelIds: [] }, 'allMail', now)).toBe(true);
    expect(isThreadInMailbox({ ...thread, labelIds: ['SENT'] }, 'allMail', now)).toBe(true);
    expect(isThreadInMailbox({ ...thread, labelIds: ['TRASH'] }, 'allMail', now)).toBe(false);
    expect(isThreadInMailbox({ ...thread, labelIds: ['SPAM', 'INBOX'] }, 'allMail', now)).toBe(false);
  });

  it('Waiting holds recent sent conversations whose last message is ours, and radar items', () => {
    const sent = { ...thread, labelIds: ['SENT'], signals: { ...EMPTY_THREAD_SIGNALS, fromUser: true } };
    expect(isWaitingThread(sent, now)).toBe(true);
    expect(isWaitingThread({ ...sent, signals: { ...EMPTY_THREAD_SIGNALS, fromUser: false } }, now)).toBe(false);
    expect(isWaitingThread({ ...sent, lastMessageAt: '2026-09-01T10:00:00.000Z' }, now)).toBe(false);
    expect(isWaitingThread({ ...sent, lastMessageAt: '2026-09-01T10:00:00.000Z' }, now, { waiting: { maxAgeDays: 90 } })).toBe(true);
    expect(isWaitingThread({ ...sent, labelIds: ['SENT', 'TRASH'] }, now)).toBe(false);
    const radarThreadKeys = new Set([waitingThreadKey(thread.accountId, thread.id)]);
    expect(isThreadInMailbox(thread, 'waiting', now, { waiting: { radarThreadKeys } })).toBe(true);
    expect(isThreadInMailbox(thread, 'waiting', now)).toBe(false);
  });
});

describe('section keys', () => {
  const settings: ShortcutSettings = {
    mode: 'superhuman',
    singleKeyShortcuts: true,
    commandPaletteEnabled: true,
    vimNavigation: false,
    composeShortcutEnabled: true,
    reminderShortcutEnabled: true,
  };
  const sc = deriveShortcuts(settings);

  it('resolves ⇧E, ⇧H and V without touching E and H', () => {
    expect(resolveSectionKey('E', 'KeyE', { shiftKey: true }, sc)).toBe('archiveClearSection');
    expect(resolveSectionKey('H', 'KeyH', { shiftKey: true }, sc)).toBe('remindLaterSection');
    expect(resolveSectionKey('v', 'KeyV', { shiftKey: false }, sc)).toBe('moveToSection');
    expect(resolveSectionKey('e', 'KeyE', { shiftKey: false }, sc)).toBe('none');
    expect(resolveSingleKey('e', sc)).toBe('archive');
    expect(resolveSingleKey('h', sc)).toBe('remind');
  });

  it('works on non-Latin layouts and ignores modified keys', () => {
    expect(resolveSectionKey('У', 'KeyE', { shiftKey: true }, sc)).toBe('archiveClearSection');
    expect(resolveSectionKey('м', 'KeyV', { shiftKey: false }, sc)).toBe('moveToSection');
    expect(resolveSectionKey('E', 'KeyE', { shiftKey: true, metaKey: true }, sc)).toBe('none');
  });

  it('keeps Y and N unbound and respects Apple Mail mode', () => {
    expect(resolveSectionKey('y', 'KeyY', { shiftKey: false }, sc)).toBe('none');
    expect(resolveSingleKey('y', sc)).toBe('none');
    expect(resolveSingleKey('n', sc)).toBe('none');
    expect(resolveSectionKey('E', 'KeyE', { shiftKey: true }, deriveShortcuts({ ...settings, mode: 'appleMail' }))).toBe('none');
  });
});

describe('Later is undoable', () => {
  it('reverses setReminder with clearReminder and back', () => {
    expect(reverseMailActionKind('setReminder')).toBe('clearReminder');
    expect(reverseMailActionKind('clearReminder')).toBe('setReminder');
    expect(isUndoableMailActionLog({
      kind: 'setReminder',
      status: 'completed',
      payloadJson: JSON.stringify({ batchId: 'b1', reminderAt: '2026-11-13T08:00:00.000Z', silent: true }),
    })).toBe(true);
  });
});

describe('Invitation keys', () => {
  const settings: ShortcutSettings = {
    mode: 'superhuman',
    singleKeyShortcuts: true,
    vimNavigation: false,
    commandPaletteEnabled: true,
    composeShortcutEnabled: true,
    reminderShortcutEnabled: true,
  };
  const sc = deriveShortcuts(settings);

  it('binds Y / N only when the thread needs an answer', () => {
    expect(resolveInviteKey('y', 'KeyY', { shiftKey: false }, sc, true)).toBe('acceptInvite');
    expect(resolveInviteKey('n', 'KeyN', { shiftKey: false }, sc, true)).toBe('declineInvite');
    expect(resolveInviteKey('н', 'KeyY', { shiftKey: false }, sc, true)).toBe('acceptInvite');
    expect(resolveInviteKey('y', 'KeyY', { shiftKey: false }, sc, false)).toBe('none');
    expect(resolveInviteKey('Y', 'KeyY', { shiftKey: true }, sc, true)).toBe('none');
    expect(resolveInviteKey('y', 'KeyY', { shiftKey: false, metaKey: true }, sc, true)).toBe('none');
    expect(resolveInviteKey('y', 'KeyY', { shiftKey: false }, deriveShortcuts({ ...settings, mode: 'appleMail' }), true)).toBe('none');
  });

  it('lists Y / N in the shortcut guide', () => {
    const bindings = appKeymapBindings(settings);
    expect(bindings.find(binding => binding.id === 'acceptInvite')?.keys).toBe('Y');
    expect(bindings.find(binding => binding.id === 'declineInvite')?.keys).toBe('N');
  });
});
