import { describe, expect, it } from 'vitest';
import { isReversibleMailActionKind, reverseMailActionKind } from '../shared/mailActions';

describe('mail action helpers', () => {
  it('reverses destructive and ignore actions', () => {
    expect(reverseMailActionKind('moveToTrash')).toBe('restoreFromTrash');
    expect(reverseMailActionKind('restoreFromTrash')).toBe('moveToTrash');
    expect(reverseMailActionKind('reportSpam')).toBe('restoreFromSpam');
    expect(reverseMailActionKind('restoreFromSpam')).toBe('reportSpam');
    expect(reverseMailActionKind('muteThread')).toBe('unmuteThread');
    expect(reverseMailActionKind('unmuteThread')).toBe('muteThread');
  });

  it('reverses read, archive, and label actions without marking unrelated actions reversible', () => {
    expect(reverseMailActionKind('markDone')).toBe('restoreInbox');
    expect(reverseMailActionKind('markRead')).toBe('markUnread');
    expect(reverseMailActionKind('applyLabel')).toBe('removeLabel');
    expect(isReversibleMailActionKind('sendDraft')).toBe(false);
    expect(reverseMailActionKind('calendarRSVP')).toBeNull();
  });
});
