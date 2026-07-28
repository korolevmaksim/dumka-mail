/**
 * Smart Compose — inline AI "ghost text" autocomplete for the email composer.
 *
 * This module is pure and DOM-free. It owns:
 *   - trigger gating (when a suggestion is worth requesting),
 *   - prompt construction for the completion request,
 *   - sanitizing raw model output into a safe inline continuation.
 *
 * DOM concerns (caret context extraction, ghost rendering, key handling) live
 * in renderer/src/components/compose/useSmartCompose.ts.
 */

/** Minimum non-whitespace characters before the caret before we ask the AI. */
export const SMART_COMPOSE_MIN_CONTEXT_CHARS = 20;
/** Bounded tail window of draft text sent as context. */
export const SMART_COMPOSE_CONTEXT_WINDOW_CHARS = 1500;
/** Suggestions stay short: a continuation, not a paragraph. */
export const SMART_COMPOSE_MAX_COMPLETION_WORDS = 12;
export const SMART_COMPOSE_MAX_COMPLETION_CHARS = 140;

export interface SmartComposePromptInput {
  /** Plain text of the draft before the caret (already windowed). */
  textBeforeCursor: string;
  subject?: string;
  toRecipientName?: string;
}

export interface SmartComposePrompt {
  context: string;
  userInstruction: string;
}

const WORD_CHAR_RE = /[\p{L}\p{N}]/u;

function isWordChar(ch: string | undefined): boolean {
  return Boolean(ch && WORD_CHAR_RE.test(ch));
}

/**
 * Gating for a suggestion request. The DOM side additionally guarantees a
 * collapsed caret inside the editor and refuses quoted-reply blocks; here we
 * only judge the text itself.
 *
 * Requires enough real context (whitespace-only padding does not count) and
 * refuses a caret resting on a blank line after another blank line — the user
 * paused between paragraphs there, they are not mid-thought.
 */
export function shouldTriggerSmartCompose(
  textBeforeCursor: string,
  minContextChars: number = SMART_COMPOSE_MIN_CONTEXT_CHARS,
): boolean {
  if (!textBeforeCursor) return false;
  if (/\n\s*\n\s*$/.test(textBeforeCursor)) return false;

  let nonWhitespace = 0;
  for (const ch of textBeforeCursor) {
    if (!/\s/.test(ch)) nonWhitespace += 1;
    if (nonWhitespace >= minContextChars) return true;
  }
  return false;
}

/**
 * Builds the context/instruction pair handed to completeAI with action
 * 'smartCompose'. The instruction is deliberately strict: ghost text is shown
 * inline and unreviewed, so the model must return only the continuation.
 */
export function buildSmartComposePrompt(input: SmartComposePromptInput): SmartComposePrompt {
  const contextLines: string[] = [];
  const subject = input.subject?.trim();
  contextLines.push(`Subject: ${subject || '(none)'}`);
  const toRecipientName = input.toRecipientName?.trim();
  if (toRecipientName) contextLines.push(`To: ${toRecipientName}`);
  contextLines.push('', 'Draft so far (the caret is at the very end):', '"""', input.textBeforeCursor, '"""');

  const userInstruction = [
    'Continue the draft exactly where the caret stops.',
    `Output only the next few words of the email itself: a single line, no more than ${SMART_COMPOSE_MAX_COMPLETION_WORDS} words.`,
    'Never repeat or restate text that is already written.',
    'No greeting, no sign-off, no signature, no quotation marks, no markdown, no explanation.',
    "Match the draft's language and tone.",
    'Spacing: if the draft ends with a space, start immediately; if it ends mid-word, continue that word without a leading space; otherwise start with a single space.',
    'If there is no natural continuation, output nothing.',
  ].join(' ');

  return { context: contextLines.join('\n'), userInstruction };
}

/**
 * Removes leading words of `completion` that already appear verbatim at the
 * tail of `textBeforeCursor` (models sometimes restate the last words despite
 * instructions). Returns the remaining text plus how many words were stripped.
 */
function stripEchoedWords(
  textBeforeCursor: string,
  completion: string,
): { text: string; stripped: number } {
  const beforeWords = textBeforeCursor.trim().split(/\s+/).filter(Boolean).map(word => word.toLowerCase());
  const completionWords = completion.trim().split(/\s+/).filter(Boolean);
  const maxOverlap = Math.min(beforeWords.length, completionWords.length);

  for (let overlap = maxOverlap; overlap >= 1; overlap -= 1) {
    let matches = true;
    for (let i = 0; i < overlap; i += 1) {
      if (beforeWords[beforeWords.length - overlap + i] !== completionWords[i].toLowerCase()) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return { text: completionWords.slice(overlap).join(' '), stripped: overlap };
    }
  }
  return { text: completion, stripped: 0 };
}

/**
 * Turns raw model output into a suggestion that can be spliced in at the
 * caret, or null when there is nothing worth showing. Pure and deterministic
 * so every edge case is unit-tested.
 *
 * Rules, in order:
 *  1. keep only the first non-empty line (models often continue past the
 *     suggestion) and unwrap a single pair of wrapping quotes;
 *  2. drop words the model restated from the draft tail — when that proves
 *     the caret word was complete, the remainder re-joins with one space;
 *  3. join against the caret position:
 *     - caret after whitespace: completion must not add more whitespace;
 *     - caret after a word character (mid-word): a completion starting with a
 *       word character continues that word directly (a repeated partial word
 *       is stripped); a completion starting with whitespace begins a new word
 *       with exactly one space;
 *     - caret after punctuation: leading copies of the same punctuation are
 *       dropped, then exactly one space separates a following word;
 *  4. cap at SMART_COMPOSE_MAX_COMPLETION_WORDS words, then at
 *     SMART_COMPOSE_MAX_COMPLETION_CHARS characters on a word boundary;
 *  5. never suggest an exact echo of the draft tail.
 */
export function sanitizeSmartComposeCompletion(
  raw: string,
  textBeforeCursor: string,
): string | null {
  if (!raw.trim()) return null;

  // First non-empty line only (models often continue past the suggestion).
  // Leading whitespace is kept: it carries the "new word after a complete
  // word" signal for the join rules below.
  const firstLine = raw
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .find(line => line.trim().length > 0 && !line.trim().startsWith('```')) ?? '';
  let completion = firstLine.replace(/\s+$/, '');

  if (completion.length >= 2) {
    const first = completion[0];
    const last = completion[completion.length - 1];
    if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
      completion = completion.slice(1, -1).trim();
    }
  }
  if (!completion) return null;

  const before = textBeforeCursor;
  const beforeEndsWithSpace = before.length === 0 || /\s$/.test(before);
  const lastChar = beforeEndsWithSpace ? undefined : before[before.length - 1];

  const echo = stripEchoedWords(before, completion);
  completion = echo.text;
  if (!completion.trim()) return null;
  // A stripped echo word means the model saw the caret word as complete, so
  // the remainder starts a new word and needs a separating space.
  if (echo.stripped > 0 && !beforeEndsWithSpace && isWordChar(lastChar) && isWordChar(completion[0])) {
    completion = ` ${completion}`;
  }

  if (beforeEndsWithSpace) {
    completion = completion.replace(/^\s+/, '');
  } else if (isWordChar(lastChar)) {
    const partialWord = before.match(/[\p{L}\p{N}'’_-]+$/u)?.[0] ?? '';
    if (isWordChar(completion[0])) {
      // Mid-word continuation: drop a repeated partial word ("…schedul" +
      // "scheduling a call" → "ing a call"); otherwise join directly.
      if (
        partialWord
        && completion.length > partialWord.length
        && completion.toLowerCase().startsWith(partialWord.toLowerCase())
      ) {
        completion = completion.slice(partialWord.length);
      }
    } else if (/\s/.test(completion[0])) {
      // The model judged the caret word complete — exactly one space.
      completion = ` ${completion.replace(/^\s+/, '')}`;
    }
    // Leading punctuation right after a word character is fine (e.g. closing
    // a sentence).
  } else if (lastChar) {
    // Caret after punctuation.
    while (completion.length > 0 && completion[0] === lastChar) {
      completion = completion.slice(1);
    }
    if (/^\s/.test(completion)) {
      completion = ` ${completion.replace(/^\s+/, '')}`;
    } else if (completion.length > 0 && isWordChar(completion[0])) {
      completion = ` ${completion}`;
    }
  }

  completion = completion.replace(/\s+/g, ' ').trimEnd();
  if (!completion.trim()) return null;

  const leadingSpace = completion.startsWith(' ') ? ' ' : '';
  const words = completion.trim().split(' ').filter(Boolean);
  if (words.length > SMART_COMPOSE_MAX_COMPLETION_WORDS) {
    completion = leadingSpace + words.slice(0, SMART_COMPOSE_MAX_COMPLETION_WORDS).join(' ');
  }

  if (completion.length > SMART_COMPOSE_MAX_COMPLETION_CHARS) {
    const cut = completion.slice(0, SMART_COMPOSE_MAX_COMPLETION_CHARS);
    const lastSpace = cut.lastIndexOf(' ');
    if (lastSpace <= 0) return null;
    completion = cut.slice(0, lastSpace).trimEnd();
  }

  if (!completion.trim()) return null;

  // Never echo the draft back at the caret.
  const normalize = (value: string) => value.replace(/\s+/g, ' ').trim().toLowerCase();
  if (normalize(before).endsWith(normalize(completion))) return null;

  return completion;
}
