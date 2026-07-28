import { describe, it, expect } from 'vitest';
import {
  buildSmartComposePrompt,
  sanitizeSmartComposeCompletion,
  shouldTriggerSmartCompose,
  SMART_COMPOSE_MAX_COMPLETION_CHARS,
  SMART_COMPOSE_MAX_COMPLETION_WORDS,
} from '../shared/smartCompose';

describe('shouldTriggerSmartCompose', () => {
  it('returns false for empty text', () => {
    expect(shouldTriggerSmartCompose('')).toBe(false);
  });

  it('returns false below the minimum context length', () => {
    expect(shouldTriggerSmartCompose('Hi team')).toBe(false);
    // 19 non-whitespace characters.
    expect(shouldTriggerSmartCompose('aa aa aa aa aa aa aa aa aa a')).toBe(false);
  });

  it('counts only non-whitespace characters', () => {
    expect(shouldTriggerSmartCompose('a b c d e f g h i j')).toBe(false);
  });

  it('returns true once enough real context exists', () => {
    expect(shouldTriggerSmartCompose('aaaaaaaaaaaaaaaaaaaa')).toBe(true);
    expect(shouldTriggerSmartCompose('Thanks for the detailed update')).toBe(true);
  });

  it('still triggers when the caret is mid-word', () => {
    expect(shouldTriggerSmartCompose('Thanks for the detailed updat')).toBe(true);
  });

  it('returns false for whitespace-only text', () => {
    expect(shouldTriggerSmartCompose('          \n          ')).toBe(false);
  });

  it('returns false when the caret rests on a blank line after a blank line', () => {
    expect(shouldTriggerSmartCompose('Thanks for the detailed update.\n\n')).toBe(false);
    expect(shouldTriggerSmartCompose('Thanks for the detailed update.\n  \n   ')).toBe(false);
  });

  it('returns true on a fresh line right after a paragraph', () => {
    expect(shouldTriggerSmartCompose('Thanks for the detailed update.\n')).toBe(true);
  });

  it('honours a custom minimum', () => {
    expect(shouldTriggerSmartCompose('short', 3)).toBe(true);
    expect(shouldTriggerSmartCompose('short', 30)).toBe(false);
  });
});

describe('buildSmartComposePrompt', () => {
  it('includes subject, recipient and the draft text in the context', () => {
    const { context } = buildSmartComposePrompt({
      textBeforeCursor: 'Hello team, quick update on',
      subject: 'Launch plan',
      toRecipientName: 'Ada Lovelace',
    });
    expect(context).toContain('Subject: Launch plan');
    expect(context).toContain('To: Ada Lovelace');
    expect(context).toContain('Hello team, quick update on');
  });

  it('falls back to a placeholder subject and omits the recipient line', () => {
    const { context } = buildSmartComposePrompt({ textBeforeCursor: 'draft text here' });
    expect(context).toContain('Subject: (none)');
    expect(context).not.toContain('To:');
  });

  it('constrains the completion to a short, plain continuation', () => {
    const { userInstruction } = buildSmartComposePrompt({ textBeforeCursor: 'draft text here' });
    expect(userInstruction).toContain('single line');
    expect(userInstruction).toContain(String(SMART_COMPOSE_MAX_COMPLETION_WORDS));
    expect(userInstruction).toContain('sign-off');
    expect(userInstruction).toContain('mid-word');
    expect(userInstruction).toContain('Never repeat');
  });
});

describe('sanitizeSmartComposeCompletion', () => {
  it('returns null for empty or whitespace-only output', () => {
    expect(sanitizeSmartComposeCompletion('', 'some draft text')).toBeNull();
    expect(sanitizeSmartComposeCompletion('   ', 'some draft text')).toBeNull();
    expect(sanitizeSmartComposeCompletion('\n\n', 'some draft text')).toBeNull();
  });

  it('keeps only the first non-empty line of multiline output', () => {
    expect(sanitizeSmartComposeCompletion('see you tomorrow\nAnd then some more', 'Let us ')).toBe('see you tomorrow');
    expect(sanitizeSmartComposeCompletion('\n\nsee you tomorrow', 'Let us ')).toBe('see you tomorrow');
  });

  it('skips markdown code fences', () => {
    expect(sanitizeSmartComposeCompletion('```\nsee you tomorrow\n```', 'Let us ')).toBe('see you tomorrow');
  });

  it('unwraps a single pair of wrapping quotes', () => {
    expect(sanitizeSmartComposeCompletion('"see you tomorrow"', 'Let us ')).toBe('see you tomorrow');
  });

  it('returns null when the completion is a pure echo of the draft tail', () => {
    expect(sanitizeSmartComposeCompletion('hearing from you', 'Looking forward to hearing from you')).toBeNull();
    expect(sanitizeSmartComposeCompletion('YOUR reply', 'Looking forward to your reply')).toBeNull();
  });

  it('strips words the model restated and re-joins with one space', () => {
    expect(sanitizeSmartComposeCompletion('I would like to schedule a call', 'I would like to')).toBe(' schedule a call');
    expect(sanitizeSmartComposeCompletion('the usual place', 'I will be at the')).toBe(' usual place');
  });

  it('joins mid-word continuations without a space', () => {
    expect(sanitizeSmartComposeCompletion('ing a call', 'Let us schedul')).toBe('ing a call');
  });

  it('strips a repeated partial word', () => {
    expect(sanitizeSmartComposeCompletion('scheduling a call', 'Let us schedul')).toBe('ing a call');
  });

  it('keeps a single leading space when the model starts a new word after a complete word', () => {
    expect(sanitizeSmartComposeCompletion(' meeting notes', 'I read the')).toBe(' meeting notes');
    expect(sanitizeSmartComposeCompletion('   meeting notes', 'I read the')).toBe(' meeting notes');
  });

  it('strips leading whitespace when the draft already ends with whitespace', () => {
    expect(sanitizeSmartComposeCompletion('  everyone,', 'Hello ')).toBe('everyone,');
  });

  it('collapses punctuation duplicated at the caret', () => {
    expect(sanitizeSmartComposeCompletion('. Looking forward to it', 'Thanks.')).toBe(' Looking forward to it');
    expect(sanitizeSmartComposeCompletion(', thanks for writing', 'Hello,')).toBe(' thanks for writing');
  });

  it('inserts a space between sentence punctuation and a following word', () => {
    expect(sanitizeSmartComposeCompletion('Looking forward', 'Thanks.')).toBe(' Looking forward');
  });

  it('returns null when only the duplicated punctuation remains', () => {
    expect(sanitizeSmartComposeCompletion('.', 'The end.')).toBeNull();
  });

  it('caps the completion at the word limit', () => {
    const raw = 'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen';
    const result = sanitizeSmartComposeCompletion(raw, 'Start here ');
    expect(result).toBe('one two three four five six seven eight nine ten eleven twelve');
    expect(result?.split(' ')).toHaveLength(SMART_COMPOSE_MAX_COMPLETION_WORDS);
  });

  it('truncates overlong completions at a word boundary', () => {
    const words = Array.from({ length: 12 }, (_, index) => `word${String(index).padStart(7, '0')}`);
    const raw = words.join(' ');
    const result = sanitizeSmartComposeCompletion(raw, 'Start here ');
    expect(result).not.toBeNull();
    expect(result!.length).toBeLessThanOrEqual(SMART_COMPOSE_MAX_COMPLETION_CHARS);
    expect(raw.startsWith(result!)).toBe(true);
    expect(result!.endsWith(' ')).toBe(false);
  });

  it('returns null when an overlong completion has no word boundary', () => {
    const raw = 'a'.repeat(SMART_COMPOSE_MAX_COMPLETION_CHARS + 10);
    expect(sanitizeSmartComposeCompletion(raw, 'Start here ')).toBeNull();
  });
});
