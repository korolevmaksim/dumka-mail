/**
 * Plain-text mapping for the compose RichTextEditor.
 *
 * One deterministic node walk backs three needs:
 *   - serialize the editor to plain text (blocks → '\n', <br> → '\n',
 *     images → alt placeholder, Smart Compose ghost spans skipped),
 *   - read the plain text before the caret (a strict prefix of the full
 *     serialization, so its length doubles as the caret's plain-text offset),
 *   - map a plain-text offset back to a DOM position (used to restore the
 *     caret after snippet expansion re-renders the editor).
 *
 * DOM-only module — the pure Smart Compose / snippet engines live in shared/.
 */

export const SMART_COMPOSE_GHOST_SELECTOR = '[data-smart-compose-ghost="true"]';

/** Block-level tags that map to line breaks in compose plain text. */
const CONTEXT_BLOCK_TAGS = new Set([
  'P', 'DIV', 'LI', 'UL', 'OL', 'TR', 'TABLE', 'BLOCKQUOTE', 'PRE',
  'H1', 'H2', 'H3', 'H4', 'H5', 'H6',
]);

function isGhostElement(node: HTMLElement): boolean {
  return node.hasAttribute('data-smart-compose-ghost');
}

function imagePlaceholder(node: HTMLElement): string {
  return ` ${node.getAttribute('alt')?.trim() || '[image]'} `;
}

interface CaretTrackState {
  text: string;
  caretContainer: Node | null;
  caretOffset: number;
  caretFound: boolean;
}

/**
 * Recursive editor→text walk. When a caret (container + offset inside the
 * walked root) is provided, only content before it contributes; the walk
 * stops at the caret, which guarantees the result is a prefix of the full
 * serialization. Block-end newlines of blocks that contain the caret are
 * skipped — they belong to content after the caret.
 */
function walkPlainText(node: Node, state: CaretTrackState): void {
  if (state.caretFound) return;

  const caret = state.caretContainer;
  if (caret) {
    if (node === caret) {
      if (node.nodeType === Node.TEXT_NODE) {
        state.text += (node.textContent ?? '').slice(0, state.caretOffset);
      } else {
        for (let i = 0; i < state.caretOffset; i += 1) {
          walkPlainText(node.childNodes[i], state);
          if (state.caretFound) return;
        }
      }
      state.caretFound = true;
      return;
    }
    const position = caret.compareDocumentPosition(node);
    const nodeBeforeCaret = Boolean(position & Node.DOCUMENT_POSITION_PRECEDING);
    const nodeContainsCaret = Boolean(position & Node.DOCUMENT_POSITION_CONTAINS);
    if (!nodeBeforeCaret && !nodeContainsCaret) return;
  }

  if (node.nodeType === Node.TEXT_NODE) {
    state.text += node.textContent ?? '';
    return;
  }
  if (!(node instanceof HTMLElement)) return;
  if (isGhostElement(node)) return;

  const tag = node.tagName;
  if (tag === 'BR') {
    // A <br> reached by the walk always precedes the caret (the caret cannot
    // sit inside one).
    state.text += '\n';
    return;
  }
  if (tag === 'IMG') {
    state.text += imagePlaceholder(node);
    return;
  }
  const isBlock = CONTEXT_BLOCK_TAGS.has(tag);
  if (isBlock && state.text.length > 0 && !state.text.endsWith('\n')) state.text += '\n';
  node.childNodes.forEach(child => walkPlainText(child, state));
  if (state.caretFound) return; // block-end newline lands after the caret
  if (isBlock && !state.text.endsWith('\n')) state.text += '\n';
}

/** Full editor content as plain text (ghost spans excluded). */
export function serializeEditorPlainText(root: HTMLElement): string {
  const state: CaretTrackState = { text: '', caretContainer: null, caretOffset: 0, caretFound: false };
  root.childNodes.forEach(child => walkPlainText(child, state));
  return state.text;
}

export interface PreCaretContext {
  /** Plain text before the caret — a prefix of serializeEditorPlainText. */
  text: string;
  /** Cloned collapsed caret range, for staleness checks. */
  caretRange: Range;
}

/**
 * Plain text before the caret plus a cloned caret range, or null when there
 * is no collapsed caret inside the editor, or the caret sits inside quoted
 * history / the signature block (no completions or snippet expansions there).
 */
export function extractPreCaretContext(editor: HTMLElement): PreCaretContext | null {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0 || !selection.isCollapsed) return null;
  const caret = selection.getRangeAt(0);
  if (!editor.contains(caret.startContainer)) return null;

  let node: Node | null = caret.startContainer;
  while (node && node !== editor) {
    if (node instanceof HTMLElement) {
      if (
        node.tagName === 'BLOCKQUOTE'
        || node.dataset.dumkaQuotedReply === 'true'
        || node.dataset.dumkaSignature === 'true'
        || node.classList.contains('gmail_signature')
      ) {
        return null;
      }
    }
    node = node.parentNode;
  }

  const state: CaretTrackState = {
    text: '',
    caretContainer: caret.startContainer,
    caretOffset: caret.startOffset,
    caretFound: false,
  };
  if (caret.startContainer === editor) {
    for (let i = 0; i < caret.startOffset; i += 1) {
      walkPlainText(editor.childNodes[i], state);
      if (state.caretFound) break;
    }
    state.caretFound = true;
  } else {
    editor.childNodes.forEach(child => walkPlainText(child, state));
  }
  if (!state.caretFound) return null;
  return { text: state.text, caretRange: caret.cloneRange() };
}

interface OffsetWalkState {
  count: number;
  endsWithBreak: boolean;
  result: { container: Node; offset: number } | null;
}

/**
 * Inverse of the plain-text walk: finds the DOM position carrying the given
 * plain-text offset. Break characters map to the nearest sensible boundary
 * (before a <br>, at a block edge); offsets beyond the content return null.
 */
export function domPositionForPlainTextOffset(
  root: HTMLElement,
  plainOffset: number,
): { container: Node; offset: number } | null {
  const state: OffsetWalkState = { count: 0, endsWithBreak: true, result: null };

  const positionBefore = (node: Node): void => {
    const parent = node.parentNode;
    if (parent) {
      state.result = { container: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) };
    }
  };

  const visit = (node: Node): void => {
    if (state.result) return;

    if (node.nodeType === Node.TEXT_NODE) {
      const length = (node.textContent ?? '').length;
      if (state.count + length >= plainOffset) {
        state.result = { container: node, offset: plainOffset - state.count };
        return;
      }
      state.count += length;
      if (length > 0) state.endsWithBreak = false;
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (isGhostElement(node)) return;

    const tag = node.tagName;
    if (tag === 'BR') {
      if (state.count === plainOffset) {
        positionBefore(node);
        return;
      }
      state.count += 1;
      state.endsWithBreak = true;
      return;
    }
    if (tag === 'IMG') {
      const length = imagePlaceholder(node).length;
      if (state.count + length >= plainOffset) {
        // Land after the image — its placeholder has no editable interior.
        const parent = node.parentNode;
        if (parent) {
          state.result = { container: parent, offset: Array.prototype.indexOf.call(parent.childNodes, node) + 1 };
        }
        return;
      }
      state.count += length;
      state.endsWithBreak = false;
      return;
    }

    const isBlock = CONTEXT_BLOCK_TAGS.has(tag);
    if (isBlock && state.count > 0 && !state.endsWithBreak) {
      if (state.count === plainOffset) {
        positionBefore(node);
        return;
      }
      state.count += 1;
      state.endsWithBreak = true;
    }
    node.childNodes.forEach(visit);
    if (state.result) return;
    if (isBlock && !state.endsWithBreak) {
      if (state.count === plainOffset) {
        state.result = { container: node, offset: node.childNodes.length };
        return;
      }
      state.count += 1;
      state.endsWithBreak = true;
    }
  };

  root.childNodes.forEach(visit);
  return state.result;
}
