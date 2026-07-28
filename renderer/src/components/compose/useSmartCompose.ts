import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { AIProviderPreference } from '../../../../shared/types';
import {
  buildSmartComposePrompt,
  sanitizeSmartComposeCompletion,
  shouldTriggerSmartCompose,
  SMART_COMPOSE_CONTEXT_WINDOW_CHARS,
} from '../../../../shared/smartCompose';
import { resolveAIModelForPurpose } from '../../../../shared/aiModelPurpose';
import { withAIRequestTimeout } from '../../../../shared/aiRequest';
import {
  extractPreCaretContext,
  SMART_COMPOSE_GHOST_SELECTOR,
} from './editorPlainText';

export { SMART_COMPOSE_GHOST_SELECTOR };

/** Pause after the last keystroke before a suggestion is requested. */
const DEBOUNCE_MS = 700;
/** A suggestion that takes longer than this is simply dropped. */
const REQUEST_TIMEOUT_MS = 4000;

export interface SmartComposeConfig {
  enabled: boolean;
  subject?: string;
  toRecipientName?: string;
  provider: AIProviderPreference;
  interactiveModel?: string | null;
  automationModel?: string | null;
}

interface UseSmartComposeArgs {
  editorRef: { current: HTMLDivElement | null };
  draftId: string;
  config: SmartComposeConfig | null;
  emitChange: () => void;
}

export interface SmartComposeController {
  /**
   * Returns true when the keystroke was consumed (Tab accepted a ghost, or
   * Escape dismissed one). When it returns false for Tab, later Tab
   * consumers — e.g. snippet Tab-expansion — may chain after Smart Compose.
   */
  handleKeyDown: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
  handleInput: () => void;
  handleBlur: () => void;
  handleCompositionStart: () => void;
  handleCompositionEnd: () => void;
  dismiss: () => void;
}

const MODIFIER_ONLY_KEYS = new Set(['Shift', 'Control', 'Alt', 'Meta', 'CapsLock']);

function findGhost(editor: HTMLElement): HTMLElement | null {
  return editor.querySelector<HTMLElement>(SMART_COMPOSE_GHOST_SELECTOR);
}

function isSelectionUnchanged(saved: Range): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const current = selection.getRangeAt(0);
  return current.startContainer === saved.startContainer && current.startOffset === saved.startOffset;
}

/** True while the caret rests immediately before the ghost element. */
function isCaretBeforeGhost(range: Range, ghost: HTMLElement): boolean {
  if (!range.collapsed) return false;
  const parent = ghost.parentNode;
  if (!parent) return false;
  if (range.startContainer === parent) {
    const ghostIndex = Array.prototype.indexOf.call(parent.childNodes, ghost);
    return range.startOffset === ghostIndex;
  }
  const prev = ghost.previousSibling;
  if (prev && prev.nodeType === Node.TEXT_NODE) {
    return range.startContainer === prev && range.startOffset === (prev.textContent?.length ?? 0);
  }
  return false;
}

/**
 * Inserts the ghost span at the caret via the Range API (never execCommand,
 * so it stays out of the undo stack) and parks the caret immediately before
 * it. Programmatic DOM edits fire no input event, so the draft is untouched.
 */
function insertGhostAtCaret(editor: HTMLElement, suggestion: string): boolean {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return false;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer)) return false;

  const ghost = document.createElement('span');
  ghost.className = 'smart-compose-ghost';
  ghost.setAttribute('contenteditable', 'false');
  ghost.setAttribute('data-smart-compose-ghost', 'true');
  ghost.textContent = suggestion;

  range.insertNode(ghost);

  const caretRange = document.createRange();
  caretRange.setStartBefore(ghost);
  caretRange.collapse(true);
  selection.removeAllRanges();
  selection.addRange(caretRange);
  return true;
}

/** Replaces the ghost with a real text node and parks the caret after it. */
function acceptGhost(editor: HTMLElement): boolean {
  const ghost = findGhost(editor);
  if (!ghost) return false;
  const text = ghost.textContent ?? '';
  const textNode = document.createTextNode(text);
  ghost.parentNode?.replaceChild(textNode, ghost);

  const selection = window.getSelection();
  const range = document.createRange();
  range.setStart(textNode, text.length);
  range.collapse(true);
  selection?.removeAllRanges();
  selection?.addRange(range);
  return true;
}

/**
 * Inline AI ghost-text autocomplete for the compose RichTextEditor.
 *
 * Lifecycle: typing schedules a debounced request; the response renders as a
 * contenteditable=false ghost span at the caret. Tab accepts, Escape / any
 * keystroke / caret move / blur / draft switch dismisses. A generation
 * counter invalidates in-flight requests the moment the context goes stale.
 * When the toggle is off or no AI provider is configured, the hook performs
 * zero network requests and renders nothing.
 */
export function useSmartCompose({
  editorRef,
  draftId,
  config,
  emitChange,
}: UseSmartComposeArgs): SmartComposeController {
  const enabled = config?.enabled ?? false;
  const provider = config?.provider ?? 'automatic';
  const modelOverride = resolveAIModelForPurpose('automation', {
    interactiveModel: config?.interactiveModel,
    automationModel: config?.automationModel,
  });

  const generationRef = useRef(0);
  const debounceTimerRef = useRef<number | null>(null);
  const inFlightRef = useRef(false);
  const aiReadyRef = useRef(false);
  const composingRef = useRef(false);
  /** Caret position captured when the debounce was scheduled. Typing moves
   * the caret and fires selectionchange *after* input; without this record
   * that very selectionchange would cancel the fresh debounce. */
  const scheduledCaretRef = useRef<{ container: Node; offset: number } | null>(null);

  const emitChangeRef = useRef(emitChange);
  emitChangeRef.current = emitChange;
  const promptMetaRef = useRef({ subject: config?.subject ?? '', toRecipientName: config?.toRecipientName ?? '' });
  promptMetaRef.current = { subject: config?.subject ?? '', toRecipientName: config?.toRecipientName ?? '' };

  const clearDebounce = useCallback(() => {
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
  }, []);

  const dismiss = useCallback(() => {
    generationRef.current += 1;
    clearDebounce();
    const editor = editorRef.current;
    if (editor) findGhost(editor)?.remove();
  }, [clearDebounce, editorRef]);

  // Resolve provider availability once per draft session / settings change.
  // Smart Compose stays silently off when no provider is configured.
  useEffect(() => {
    aiReadyRef.current = false;
    if (!enabled) return;
    let cancelled = false;
    window.electronAPI.getAIProviderDescriptor(provider, modelOverride)
      .then(descriptor => {
        if (cancelled) return;
        aiReadyRef.current = Boolean(
          descriptor
          && descriptor.preference !== 'disabled'
          && descriptor.capabilities?.canDraft
          && !descriptor.status.startsWith('Missing')
        );
      })
      .catch(() => {
        if (!cancelled) aiReadyRef.current = false;
      });
    return () => { cancelled = true; };
  }, [enabled, provider, modelOverride, draftId]);

  // Reset on draft switch / toggle flip; the ghost node dies with the
  // editor's innerHTML swap, but timers and in-flight requests must go too.
  useEffect(() => {
    dismiss();
  }, [draftId, enabled, dismiss]);

  // Cancel everything on unmount.
  useEffect(() => () => {
    generationRef.current += 1;
    clearDebounce();
  }, [clearDebounce]);

  const requestSuggestion = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor || !enabled || !aiReadyRef.current || inFlightRef.current || composingRef.current) return;

    const caretContext = extractPreCaretContext(editor);
    if (!caretContext) return;
    const windowed = caretContext.text.slice(-SMART_COMPOSE_CONTEXT_WINDOW_CHARS);
    if (!shouldTriggerSmartCompose(windowed)) return;

    const generation = generationRef.current;
    inFlightRef.current = true;
    const { subject, toRecipientName } = promptMetaRef.current;
    const prompt = buildSmartComposePrompt({ textBeforeCursor: windowed, subject, toRecipientName });

    try {
      const response = await withAIRequestTimeout(
        window.electronAPI.completeAI({
          action: 'smartCompose',
          context: prompt.context,
          conversationHistory: [],
          userInstruction: prompt.userInstruction,
        }, provider, modelOverride),
        REQUEST_TIMEOUT_MS,
      );
      if (generation !== generationRef.current) return;
      const suggestion = sanitizeSmartComposeCompletion(response.text, windowed);
      if (!suggestion) return;
      if (!isSelectionUnchanged(caretContext.caretRange)) return;
      insertGhostAtCaret(editor, suggestion);
    } catch {
      // Smart Compose is a background convenience — it fails silently.
    } finally {
      inFlightRef.current = false;
    }
  }, [enabled, provider, modelOverride, editorRef]);

  const scheduleSuggestion = useCallback(() => {
    clearDebounce();
    if (!enabled || !aiReadyRef.current || composingRef.current) return;
    const selection = window.getSelection();
    scheduledCaretRef.current = selection && selection.rangeCount > 0 && selection.isCollapsed
      ? { container: selection.getRangeAt(0).startContainer, offset: selection.getRangeAt(0).startOffset }
      : null;
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void requestSuggestion();
    }, DEBOUNCE_MS);
  }, [enabled, clearDebounce, requestSuggestion]);

  // Dismiss the ghost when the caret moves away from it, and invalidate any
  // in-flight request when the selection changes without an edit.
  useEffect(() => {
    if (!enabled) return;
    const onSelectionChange = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const selection = window.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      if (!editor.contains(range.startContainer)) return;
      const ghost = findGhost(editor);
      if (ghost) {
        if (!isCaretBeforeGhost(range, ghost)) dismiss();
        return;
      }
      // A selectionchange that merely reflects the keystroke which scheduled
      // the debounce must not cancel it; anything else (arrows, clicks)
      // invalidates pending work.
      const scheduled = scheduledCaretRef.current;
      if (scheduled && range.startContainer === scheduled.container && range.startOffset === scheduled.offset) {
        return;
      }
      generationRef.current += 1;
      clearDebounce();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    return () => document.removeEventListener('selectionchange', onSelectionChange);
  }, [enabled, dismiss, clearDebounce, editorRef]);

  const handleInput = useCallback(() => {
    if (!enabled) return;
    const editor = editorRef.current;
    if (editor) findGhost(editor)?.remove();
    generationRef.current += 1;
    scheduleSuggestion();
  }, [enabled, editorRef, scheduleSuggestion]);

  const handleKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    if (!enabled) return false;
    const editor = editorRef.current;
    if (!editor) return false;

    if (event.key === 'Tab') {
      if (acceptGhost(editor)) {
        event.preventDefault();
        generationRef.current += 1;
        clearDebounce();
        emitChangeRef.current();
        return true;
      }
      // No ghost visible: leave Tab untouched so the next consumer (snippet
      // Tab-expansion) can handle it.
      return false;
    }

    if (event.key === 'Escape') {
      const ghost = findGhost(editor);
      if (!ghost) return false;
      ghost.remove();
      generationRef.current += 1;
      clearDebounce();
      event.preventDefault();
      event.stopPropagation();
      return true;
    }

    // Modifier-only presses keep the ghost; every other keystroke dismisses
    // it (but is never consumed, so typing/editing proceeds normally).
    if (MODIFIER_ONLY_KEYS.has(event.key)) return false;
    findGhost(editor)?.remove();
    clearDebounce();
    return false;
  }, [enabled, editorRef, clearDebounce]);

  const handleBlur = useCallback(() => {
    if (!enabled) return;
    dismiss();
  }, [enabled, dismiss]);

  const handleCompositionStart = useCallback(() => {
    composingRef.current = true;
    dismiss();
  }, [dismiss]);

  const handleCompositionEnd = useCallback(() => {
    composingRef.current = false;
    scheduleSuggestion();
  }, [scheduleSuggestion]);

  return {
    handleKeyDown,
    handleInput,
    handleBlur,
    handleCompositionStart,
    handleCompositionEnd,
    dismiss,
  };
}
