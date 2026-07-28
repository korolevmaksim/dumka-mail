import { useCallback, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent } from 'react';
import type { ComposeSettings, ProfileSettings, SnippetSettings } from '../../../../shared/types';
import { expandSnippetAtCursor } from '../../../../shared/snippets';
import { plainTextToHtmlFragment } from '../../../../shared/draftHtml';
import {
  domPositionForPlainTextOffset,
  extractPreCaretContext,
  serializeEditorPlainText,
  SMART_COMPOSE_GHOST_SELECTOR,
} from './editorPlainText';

export interface SnippetExpansionConfig {
  settings: SnippetSettings;
  compose: ComposeSettings;
  profile: ProfileSettings;
  accountId?: string | null;
}

interface UseSnippetExpansionArgs {
  editorRef: { current: HTMLDivElement | null };
  config: SnippetExpansionConfig | null;
  emitChange: () => void;
}

export interface SnippetExpansionController {
  /**
   * Attempts a snippet expansion for a Tab keystroke. Returns true when the
   * keystroke was consumed (an expansion was applied); false means the caller
   * should leave Tab to its default behavior.
   */
  handleTab: (event: ReactKeyboardEvent<HTMLDivElement>) => boolean;
}

/**
 * Wires the shared snippet engine (expandSnippetAtCursor) into the compose
 * RichTextEditor. In the Tab priority chain this runs after Smart Compose
 * ghost-accept: a visible ghost owns Tab, and extractPreCaretContext already
 * refuses quoted history / the signature block.
 */
export function useSnippetExpansion({
  editorRef,
  config,
  emitChange,
}: UseSnippetExpansionArgs): SnippetExpansionController {
  const emitChangeRef = useRef(emitChange);
  emitChangeRef.current = emitChange;
  const configRef = useRef(config);
  configRef.current = config;

  const handleTab = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): boolean => {
    const current = configRef.current;
    if (!current || !current.settings.enabled || !current.settings.expandWithTab) return false;
    const editor = editorRef.current;
    if (!editor) return false;
    // A visible Smart Compose ghost owns Tab — never expand over it.
    if (editor.querySelector(SMART_COMPOSE_GHOST_SELECTOR)) return false;

    const caret = extractPreCaretContext(editor);
    if (!caret) return false;

    const body = serializeEditorPlainText(editor);
    const expansion = expandSnippetAtCursor(
      body,
      caret.text.length,
      current.settings,
      current.compose,
      current.profile,
      current.accountId,
    );
    if (!expansion) return false;

    event.preventDefault();
    editor.innerHTML = plainTextToHtmlFragment(expansion.text) || '<p><br></p>';

    const position = domPositionForPlainTextOffset(editor, expansion.selection);
    const selection = window.getSelection();
    const range = document.createRange();
    if (position) {
      range.setStart(position.container, position.offset);
    } else {
      range.selectNodeContents(editor);
      range.collapse(false);
    }
    range.collapse(true);
    selection?.removeAllRanges();
    selection?.addRange(range);

    emitChangeRef.current();
    return true;
  }, [editorRef]);

  return { handleTab };
}
