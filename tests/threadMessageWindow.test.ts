import { describe, expect, it } from 'vitest';
import {
  initialMessageWindowStart,
  revealEarlierMessageWindowStart,
} from '../renderer/src/lib/threadMessageWindow';

describe('thread message window', () => {
  it('opens with only the latest three messages visible', () => {
    expect(initialMessageWindowStart(0)).toBe(0);
    expect(initialMessageWindowStart(3)).toBe(0);
    expect(initialMessageWindowStart(100)).toBe(97);
  });

  it('reveals earlier messages in batches of ten', () => {
    expect(revealEarlierMessageWindowStart(97)).toBe(87);
    expect(revealEarlierMessageWindowStart(7)).toBe(0);
  });
});
